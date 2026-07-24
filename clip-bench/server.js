const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "sessions");
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLIP_SECONDS = 10;
const OUT_W = 1080;
const OUT_H = 1920;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- helpers -------------------------------------------------------------

// Only accept things that actually look like a YouTube URL. This is the
// single biggest safety valve here: everything downstream (yt-dlp) trusts
// this string, and we run it as an argv element (never through a shell),
// so this check is about scope, not injection.
const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]{6,}/i;

function isYoutubeUrl(url) {
  return typeof url === "string" && YOUTUBE_URL_RE.test(url.trim());
}

function sessionDir(id) {
  return path.join(DATA_DIR, id);
}

function run(cmd, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function ffprobeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return parseFloat(stdout.trim());
}

function cleanupOldSessions() {
  fs.readdir(DATA_DIR, (err, ids) => {
    if (err) return;
    for (const id of ids) {
      const dir = sessionDir(id);
      fs.stat(dir, (err2, stat) => {
        if (err2) return;
        if (Date.now() - stat.mtimeMs > SESSION_TTL_MS) {
          fs.rm(dir, { recursive: true, force: true }, () => {});
        }
      });
    }
  });
}
setInterval(cleanupOldSessions, 30 * 60 * 1000);

// ---- routes ---------------------------------------------------------------

// 1. Resolve a YouTube URL: download the source once, report its duration,
//    hand back a session id the frontend uses for preview + clipping.
app.post("/api/resolve", async (req, res) => {
  const { url } = req.body || {};
  if (!isYoutubeUrl(url)) {
    return res.status(400).json({ error: "That doesn't look like a public YouTube URL." });
  }

  const id = crypto.randomUUID();
  const dir = sessionDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, "source.mp4");

  try {
    await run("yt-dlp", [
      "-f", "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format", "mp4",
      "--no-playlist",
      "-o", sourcePath,
      url.trim(),
    ], { timeoutMs: 15 * 60 * 1000 });

    const duration = await ffprobeDuration(sourcePath);
    res.json({ id, duration, previewUrl: `/media/${id}/source.mp4` });
  } catch (err) {
    fs.rm(dir, { recursive: true, force: true }, () => {});
    console.error(err);
    res.status(502).json({
      error: "Couldn't fetch that video. It may be private, age-restricted, or region-locked.",
    });
  }
});

// 2. Serve the downloaded source with range support so the <video> element
//    can scrub smoothly.
app.get("/media/:id/source.mp4", (req, res) => {
  const file = path.join(sessionDir(req.params.id), "source.mp4");
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file); // express handles Range headers for sendFile automatically
});

// 3. Cut a 10-second, 1080x1920 clip starting at `start` seconds.
app.post("/api/clip", async (req, res) => {
  const { id, start, audio } = req.body || {};
  const dir = sessionDir(id);
  const sourcePath = path.join(dir, "source.mp4");
  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: "Session expired — reload the video and try again." });
  }

  const startSec = Math.max(0, Number(start) || 0);
  const clipPath = path.join(dir, `clip-${Date.now()}.mp4`);

  // Cover-fill into 1080x1920: scale up to cover the frame, then crop the
  // overflow off the edges (no letterboxing, no distortion).
  const vf = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},setsar=1`;

  const args = [
    "-y",
    "-ss", String(startSec),
    "-i", sourcePath,
    "-t", String(CLIP_SECONDS),
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
  ];
  if (audio) {
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }
  args.push(clipPath);

  try {
    await run("ffmpeg", args, { timeoutMs: 5 * 60 * 1000 });
    res.json({ downloadUrl: `/api/clip/${id}/${path.basename(clipPath)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Clip generation failed. Try a different start point." });
  }
});

// 4. Download the finished clip.
app.get("/api/clip/:id/:filename", (req, res) => {
  const file = path.join(sessionDir(req.params.id), req.params.filename);
  if (!fs.existsSync(file) || !file.endsWith(".mp4")) return res.status(404).end();
  res.download(file, "clip.mp4");
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => console.log(`Clip Bench listening on :${PORT}`));
