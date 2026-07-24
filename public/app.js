const CLIP_SECONDS = 10;

const urlInput = document.getElementById("url-input");
const loadBtn = document.getElementById("load-btn");
const loadStatus = document.getElementById("load-status");

const editPanel = document.getElementById("edit-panel");
const preview = document.getElementById("preview");
const scrub = document.getElementById("scrub");
const timeCurrent = document.getElementById("time-current");
const timeTotal = document.getElementById("time-total");
const clipWindow = document.getElementById("clip-window");
const audioToggle = document.getElementById("audio-toggle");
const clipBtn = document.getElementById("clip-btn");
const clipStatus = document.getElementById("clip-status");
const downloadLink = document.getElementById("download-link");

let session = null; // { id, duration }

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

function maxStart(duration) {
  return Math.max(0, duration - CLIP_SECONDS);
}

function updateWindowLabel(start) {
  clipWindow.textContent = `clip: ${fmt(start)} – ${fmt(start + CLIP_SECONDS)}`;
  timeCurrent.textContent = fmt(start);
}

loadBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  loadBtn.disabled = true;
  setStatus(loadStatus, "Fetching video… this can take a minute for longer videos.");
  downloadLink.classList.add("hidden");
  editPanel.classList.add("hidden");

  try {
    const res = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't load that video.");

    session = { id: data.id, duration: data.duration };
    preview.src = data.previewUrl;
    scrub.min = 0;
    scrub.max = maxStart(data.duration);
    scrub.value = 0;
    timeTotal.textContent = fmt(data.duration);
    updateWindowLabel(0);

    editPanel.classList.remove("hidden");
    setStatus(loadStatus, "Loaded. Drag the slider to choose your 10-second start point.");
  } catch (err) {
    setStatus(loadStatus, err.message, true);
  } finally {
    loadBtn.disabled = false;
  }
});

scrub.addEventListener("input", () => {
  const start = Number(scrub.value);
  preview.currentTime = start;
  updateWindowLabel(start);
});

clipBtn.addEventListener("click", async () => {
  if (!session) return;
  clipBtn.disabled = true;
  downloadLink.classList.add("hidden");
  setStatus(clipStatus, "Cutting clip…");

  try {
    const res = await fetch("/api/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: session.id,
        start: Number(scrub.value),
        audio: audioToggle.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Clip generation failed.");

    downloadLink.href = data.downloadUrl;
    downloadLink.classList.remove("hidden");
    setStatus(clipStatus, "Done.");
  } catch (err) {
    setStatus(clipStatus, err.message, true);
  } finally {
    clipBtn.disabled = false;
  }
});
