# Video Saver Server

Backend REST API for **Video Saver**, built with Node.js, Express, Mongoose, yt-dlp, and ffmpeg.

## Features

- **Express ES Modules**: Clean, modular route/controller/service architecture.
- **SSRF Protection & URL Allowlist**: Validates incoming URLs against supported platform domains (YouTube, TikTok, Instagram, Twitter/X, Twitch, Vimeo, SoundCloud, Reddit, Kick, Facebook).
- **Safe yt-dlp Invocation**: Spawns CLI commands with arguments array and timeouts (no arbitrary shell injection).
- **Format Extraction & Custom Streaming**: Extracts video heights or converts to MP3 audio on the fly and streams media back to the client with `Content-Length` and `Content-Disposition`.
- **Automatic Cleanup**: Temporary download directories are strictly pruned after streaming finishes or upon errors.
- **Graceful DB Fallback**: Logs downloads to MongoDB via Mongoose. If MongoDB is down or unavailable, it logs a warning and keeps the application running smoothly with in-memory statistics.
- **Strict CORS & Rate Limiting**: Centralized rate limiting (10 req/min for info, 5 req/min for download) and strict CORS origins.

## Environment Variables

Copy `.env.example` to `.env`:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/video-saver
CLIENT_URL=http://localhost:5173
```

- `PORT`: Port the Express server listens on (default: `5000`).
- `MONGODB_URI`: MongoDB connection string (e.g. local or MongoDB Atlas).
- `CLIENT_URL`: Exact URL of the frontend client. **Never uses a wildcard origin.**

## Local Development

### Prerequisites

1. Node.js 20+
2. Python 3 (`python3`)
3. `ffmpeg` and `ffprobe` in PATH
4. `yt-dlp` in PATH

### Run

```bash
npm install
npm run dev
```

Server runs on [http://localhost:5000](http://localhost:5000).

## Deployment Notes

> **Important**: This server relies on system processes (`yt-dlp` and `ffmpeg`) and long-lived HTTP streams. It **cannot run on serverless platforms** like Vercel Serverless or Netlify Functions.

### Recommended Deployment Platforms

Deploy using Docker on:
- **Railway** (Docker auto-detected)
- **Render** (Web Service -> Docker environment)
- **Fly.io** (`fly launch`)
- **VPS / DigitalOcean / AWS EC2** via Docker or docker-compose

### Docker Build & Run

```bash
docker build -t video-saver-server .
docker run -p 5000:5000 -e PORT=5000 -e CLIENT_URL=https://your-client-domain.com video-saver-server
```

### Production Checklist

1. **MongoDB**: Set up a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas) and supply the connection string in `MONGODB_URI`.
2. **CORS**: After deploying your client, update the server's `CLIENT_URL` environment variable to match the exact client URL (e.g. `https://video-saver.vercel.app`) so requests are not blocked by CORS.
