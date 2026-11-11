import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const localBinYtdlp = path.join(projectRoot, 'bin', 'yt-dlp');

// Supported platform domains allowlist (SSRF prevention)
export const ALLOWED_DOMAINS = [
  // YouTube & YouTube Music
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  // TikTok
  'tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
  // Instagram
  'instagram.com',
  'instagr.am',
  // Facebook
  'facebook.com',
  'fb.watch',
  // X / Twitter
  'twitter.com',
  'x.com',
  // Twitch
  'twitch.tv',
  // Kick
  'kick.com',
  // Vimeo
  'vimeo.com',
  // Reddit
  'reddit.com',
  'v.redd.it',
  // SoundCloud
  'soundcloud.com',
];

/**
 * Identify platform key/name from URL
 */
export function identifyPlatform(hostname) {
  const host = hostname.toLowerCase();
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    if (host.includes('music.youtube.com')) return 'YouTube Music';
    return 'YouTube';
  }
  if (host.includes('tiktok.com')) return 'TikTok';
  if (host.includes('instagram.com') || host.includes('instagr.am')) return 'Instagram';
  if (host.includes('facebook.com') || host.includes('fb.watch')) return 'Facebook';
  if (host.includes('twitter.com') || host.includes('x.com')) return 'X/Twitter';
  if (host.includes('twitch.tv')) return 'Twitch';
  if (host.includes('kick.com')) return 'Kick';
  if (host.includes('vimeo.com')) return 'Vimeo';
  if (host.includes('reddit.com') || host.includes('v.redd.it')) return 'Reddit';
  if (host.includes('soundcloud.com')) return 'SoundCloud';
  return 'Other';
}

/**
 * Validates that URL is http/https and belongs to an allowed platform domain.
 * Prevents SSRF attacks.
 */
export function validateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTP and HTTPS links are supported' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = ALLOWED_DOMAINS.some(domain => {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });

  if (!isAllowed) {
    return {
      valid: false,
      error: 'Platform not supported. Supported: YouTube, TikTok, Instagram, Facebook, X/Twitter, Twitch, Kick, Vimeo, Reddit, SoundCloud.',
    };
  }

  const platform = identifyPlatform(hostname);
  return { valid: true, url: parsed.href, platform };
}

/**
 * Resolves the location of the yt-dlp executable.
 * Checks project local bin/yt-dlp, ~/.local/bin/yt-dlp, or system PATH.
 */
export function getYtdlpCommand() {
  if (fs.existsSync(localBinYtdlp)) {
    return localBinYtdlp;
  }
  if (process.env.HOME) {
    const userLocal = path.join(process.env.HOME, '.local', 'bin', 'yt-dlp');
    if (fs.existsSync(userLocal)) {
      return userLocal;
    }
  }
  return 'yt-dlp';
}

export function getEffectiveCookiePath() {
  if (process.env.YTDLP_COOKIES && process.env.YTDLP_COOKIES.trim().length > 0) {
    const tmpCookie = path.join(os.tmpdir(), 'ytdlp_env_cookies.txt');
    try {
      fs.writeFileSync(tmpCookie, process.env.YTDLP_COOKIES.trim(), 'utf8');
      return tmpCookie;
    } catch (e) {
      console.warn('[ytdlp] Could not write YTDLP_COOKIES to tmp:', e.message);
    }
  }
  const cookiePath = path.join(projectRoot, 'cookies.txt');
  if (fs.existsSync(cookiePath)) {
    return cookiePath;
  }
  return null;
}

export function hasCookies() {
  return Boolean(getEffectiveCookiePath());
}

/**
 * Spawns yt-dlp with an array of arguments (never a shell string) and a timeout.
 * PATH is augmented to ensure local project binaries, ffmpeg-installer, and system paths are reachable.
 */
export function run(args, options = {}) {
  const timeoutMs = options.timeout || 1800000; // default 30 minutes for long videos

  // Construct augmented PATH including ffmpeg and yt-dlp bin locations
  const extraPaths = [path.join(projectRoot, 'bin')];
  if (process.env.HOME) {
    extraPaths.push(path.join(process.env.HOME, '.local', 'bin'));
  }
  if (ffmpegInstaller && ffmpegInstaller.path) {
    extraPaths.push(path.dirname(ffmpegInstaller.path));
  }

  const customEnv = {
    ...process.env,
    PATH: `${extraPaths.join(':')}:${process.env.PATH || ''}`,
  };

  const executable = getYtdlpCommand();

  // Check for cookies configuration (via env YTDLP_COOKIES or cookies.txt file)
  const effectiveCookiePath = getEffectiveCookiePath();

  const finalArgs = [...args];
  if (effectiveCookiePath && !finalArgs.includes('--cookies')) {
    finalArgs.unshift('--cookies', effectiveCookiePath);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(executable, finalArgs, {
      env: customEnv,
      cwd: options.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        proc.kill('SIGKILL');
        reject(new Error(`yt-dlp process timed out after ${timeoutMs / 1000} seconds`));
      }
    }, timeoutMs);

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    proc.stderr.on('data', data => {
      stderr += data.toString();
    });

    proc.on('error', err => {
      clearTimeout(timer);
      finished = true;
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp binary was not found on the server. Please verify binary installation.'));
      } else {
        reject(err);
      }
    });

    proc.on('close', code => {
      clearTimeout(timer);
      finished = true;
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code });
      } else {
        const errorMsg = stderr.trim() || stdout.trim() || `yt-dlp failed with code ${code}`;
        const err = new Error(errorMsg);
        err.exitCode = code;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}
