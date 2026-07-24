# Clip Bench

Paste a public YouTube URL, scrub to a start point, cut a 10-second 1080x1920
clip (cropped to fill the frame, no letterboxing), toggle audio on/off, and
download the .mp4.

## How it works

1. `/api/resolve` downloads the source video once (via `yt-dlp`) into a
   session folder and reports its duration.
2. The frontend plays that downloaded file directly, so scrubbing is
   instant and doesn't re-hit YouTube.
3. `/api/clip` runs `ffmpeg` on the already-downloaded source: scales up to
   cover 1080x1920, crops the overflow off the edges, cuts exactly 10
   seconds from your chosen start point, and strips audio if you've toggled
   it off.
4. Sessions (and their downloaded source video) are deleted automatically
   after 2 hours.

## Deploy it (recommended: Docker, since ffmpeg + yt-dlp need to exist on
whatever machine runs this)

Any host that accepts a Dockerfile works — **Render**, **Railway**,
**Fly.io**, or a small VPS. Steps are the same everywhere:

1. Push this folder to a GitHub repo.
2. On your host of choice, create a new service "from Dockerfile" pointed
   at that repo.
3. Set the port to `3000` (or read `$PORT`, which the app already does).
4. Attach a persistent volume at `/data/sessions` if your host supports it
   (not required — it's just scratch space that self-cleans).
5. Deploy. Visit the URL your host gives you.

### Fly.io (concrete example)

```bash
fly launch --no-deploy   # detects the Dockerfile automatically
fly deploy
```

### Local run without Docker (for testing on your own machine)

Requires `ffmpeg` and `yt-dlp` installed and on your PATH.

```bash
npm install
node server.js
# open http://localhost:3000
```

## Things worth knowing before you lean on this daily

- **YouTube's terms of service don't cover third-party downloading.**
  `yt-dlp` is what most clipping/archiving tools use under the hood, but
  it works by reading YouTube's public player data rather than through an
  official API — YouTube could change that at any time, which would break
  fetching until `yt-dlp` is updated (it's actively maintained, so this is
  usually a fast fix, not a dead end).
- **Copyright is on you.** This tool doesn't check who owns the source
  video — worth sticking to your own uploads, licensed footage, or clearly
  fair-use cases (commentary, review, etc.).
- **No auth or rate limiting yet.** Fine for personal use behind a private
  URL; if you ever share the link, anyone with it can trigger downloads on
  your server's dime. Easy to add (e.g. a shared password header) if it
  becomes public-facing.
- **Long videos take a while to resolve** since the whole source downloads
  before you can scrub it. For very long source videos you could swap the
  yt-dlp format selector to a lower resolution to speed this up.
