import fs from 'fs';
import path from 'path';
import os from 'os';
import { validateUrl, run } from '../utils/ytdlp.js';
import { recordDownload, getStats as getAggregatedStats } from '../models/Download.js';

/**
 * Clean up error messages from yt-dlp to make them human-readable
 */
function sanitizeYtdlpError(errorMsg = '') {
  const lower = errorMsg.toLowerCase();
  if (lower.includes('max-filesize')) {
    return 'The requested file exceeds the 500MB maximum size limit.';
  }
  if (
    lower.includes('video unavailable') ||
    lower.includes('video is unavailable') ||
    lower.includes('private video') ||
    lower.includes('not available')
  ) {
    return 'This video is private, restricted, or no longer available.';
  }
  if (lower.includes('sign in to confirm your age') || lower.includes('age-restricted')) {
    return 'This video is age-restricted and cannot be downloaded anonymously.';
  }
  if (lower.includes('http error 429') || lower.includes('too many requests')) {
    return 'The content provider is rate limiting requests. Please try again later.';
  }
  if (lower.includes('unsupported url') || lower.includes('is not a valid url')) {
    return 'Unsupported link or invalid media URL.';
  }
  if (lower.includes('timed out')) {
    return 'The download request timed out. Please try again.';
  }
  // Strip stack/python trace if present
  const lines = errorMsg.split('\n').filter(l => l.trim().startsWith('ERROR:'));
  if (lines.length > 0) {
    return lines[0].replace(/^ERROR:\s*/, '').trim();
  }
  return errorMsg.length > 180 ? `${errorMsg.slice(0, 180)}...` : errorMsg;
}

/**
 * POST /api/info
 * Fetch metadata for given URL
 */
export async function getInfo(req, res, next) {
  try {
    const { url } = req.body;
    const validation = validateUrl(url);

    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const args = [
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=android,web',
      '-J',
      '--no-playlist',
      '--',
      validation.url,
    ];

    let result;
    try {
      result = await run(args, { timeout: 45000 });
    } catch (err) {
      const friendlyError = sanitizeYtdlpError(err.message || err.stderr);
      return res.status(422).json({ error: friendlyError || 'Failed to retrieve media information.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (parseErr) {
      return res.status(502).json({ error: 'Failed to parse media metadata from extractor.' });
    }

    // Extract available heights
    const formats = Array.isArray(parsed.formats) ? parsed.formats : [];
    const heightSet = new Set();
    for (const f of formats) {
      if (typeof f.height === 'number' && f.height > 0) {
        heightSet.add(f.height);
      }
    }
    const heights = Array.from(heightSet).sort((a, b) => b - a);

    // Best thumbnail
    let thumbnail = parsed.thumbnail || null;
    if (!thumbnail && Array.isArray(parsed.thumbnails) && parsed.thumbnails.length > 0) {
      thumbnail = parsed.thumbnails[parsed.thumbnails.length - 1].url;
    }

    const payload = {
      title: parsed.title || 'Untitled Media',
      thumbnail,
      duration: typeof parsed.duration === 'number' ? parsed.duration : 0,
      uploader: parsed.uploader || parsed.channel || parsed.creator || parsed.artist || 'Unknown',
      platform: validation.platform,
      heights,
    };

    return res.json(payload);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/download
 * Download and stream media file to client
 */
export async function download(req, res, next) {
  // Prevent Node from prematurely timing out long-running downloads / transcoding
  req.setTimeout(1800000);
  res.setTimeout(1800000);

  const { url, type = 'video', height, title: userTitle } = req.body;
  const validation = validateUrl(url);

  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Create an isolated temp directory for this download
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-saver-'));

  const cleanup = () => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('[Download Controller] Failed to remove temp directory:', e.message);
    }
  };

  try {
    const isAudio = type === 'audio';
    const outputTemplate = path.join(tempDir, '%(title).120B.%(ext)s');

    const args = [
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=android,web',
      '--no-playlist',
      '--max-filesize', '500M',
      '--no-warnings',
      '--concurrent-fragments', '8',
      '--http-chunk-size', '10M',
    ];

    if (isAudio) {
      args.push(
        '-x',
        '--audio-format', 'mp3',
        '--postprocessor-args', 'ffmpeg:-threads 4'
      );
    } else {
      const h = parseInt(height, 10);
      if (h && !isNaN(h)) {
        args.push('-f', `bv*[height<=${h}]+ba/b[height<=${h}]/b`, '--merge-output-format', 'mp4');
      } else {
        args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
      }
    }

    args.push('-o', outputTemplate);
    args.push('--', validation.url);

    // Run download with 30-minute timeout for large and long media files
    await run(args, { timeout: 1800000 });

    // Locate the downloaded file inside tempDir
    const files = fs.readdirSync(tempDir).filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'));
    if (files.length === 0) {
      throw new Error('Download completed but output media file was not created.');
    }

    // Pick the most relevant file
    const targetFilename = files[0];
    const targetFilePath = path.join(tempDir, targetFilename);
    const stats = fs.statSync(targetFilePath);

    // Sanitize filename for Content-Disposition header (RFC 6266 / RFC 5987)
    // ASCII-only fallback in filename="...", full UTF-8 encoded in filename*=UTF-8''...
    const cleanBasename = targetFilename.replace(/[\r\n\t]/g, ' ');
    const asciiFilename = cleanBasename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    const encodedFilename = encodeURIComponent(cleanBasename);

    res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('Content-Length', stats.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
    );

    const stream = fs.createReadStream(targetFilePath);

    res.on('finish', () => {
      cleanup();
      recordDownload({
        platform: validation.platform,
        url: validation.url,
        title: userTitle || cleanBasename,
        type: isAudio ? 'audio' : 'video',
        quality: isAudio ? 'mp3' : (height ? `${height}p` : 'best'),
        status: 'success',
      });
    });

    res.on('close', () => {
      cleanup();
    });

    stream.on('error', streamErr => {
      console.error('[Download Stream Error]', streamErr);
      cleanup();
      recordDownload({
        platform: validation.platform,
        url: validation.url,
        title: userTitle || cleanBasename,
        type: isAudio ? 'audio' : 'video',
        quality: isAudio ? 'mp3' : (height ? `${height}p` : 'best'),
        status: 'failed',
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream the downloaded file.' });
      }
    });

    stream.pipe(res);
  } catch (err) {
    cleanup();
    recordDownload({
      platform: validation.platform,
      url: validation.url,
      title: userTitle || 'Unknown',
      type: type === 'audio' ? 'audio' : 'video',
      quality: type === 'audio' ? 'mp3' : (height ? `${height}p` : 'best'),
      status: 'failed',
    });

    const friendlyError = sanitizeYtdlpError(err.message || err.stderr || '');
    return res.status(500).json({ error: friendlyError || 'Download processing failed.' });
  }
}

/**
 * GET /api/stats
 * Get total downloads and top platforms
 */
export async function getStats(req, res, next) {
  try {
    const stats = await getAggregatedStats();
    return res.json(stats);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/health
 */
export function healthCheck(req, res) {
  return res.json({ ok: true, version: '2026.11.10-patch2' });
}
