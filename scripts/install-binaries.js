import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'bin');
const ytdlpPath = path.join(binDir, 'yt-dlp');

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        // Handle HTTP 301 / 302 redirects (GitHub releases redirect to AWS S3/objects)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download binary: HTTP status ${res.statusCode}`));
        }

        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve());
        });

        fileStream.on('error', err => {
          fs.unlink(destPath, () => reject(err));
        });
      })
      .on('error', reject);
  });
}

export async function ensureBinaries() {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // 1. Ensure yt-dlp binary exists
  if (!fs.existsSync(ytdlpPath)) {
    console.log('[install-binaries] Downloading latest yt-dlp standalone binary...');
    const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    try {
      await downloadFile(downloadUrl, ytdlpPath);
      fs.chmodSync(ytdlpPath, 0o755);
      console.log('[install-binaries] yt-dlp downloaded and set as executable at:', ytdlpPath);
    } catch (err) {
      console.warn('[install-binaries] Native download failed, attempting curl fallback...', err.message);
      try {
        execSync(`curl -L ${downloadUrl} -o ${ytdlpPath} && chmod a+rx ${ytdlpPath}`, { stdio: 'inherit' });
        console.log('[install-binaries] yt-dlp downloaded via curl successfully.');
      } catch (curlErr) {
        console.error('[install-binaries] Failed to download yt-dlp binary:', curlErr.message);
      }
    }
  } else {
    // Ensure permissions
    try {
      fs.chmodSync(ytdlpPath, 0o755);
    } catch {
      // Ignore
    }
  }

  // 2. Test execution
  try {
    const version = execSync(`${ytdlpPath} --version`).toString().trim();
    console.log(`[install-binaries] yt-dlp is ready (version: ${version})`);
  } catch (err) {
    console.warn('[install-binaries] yt-dlp execution test warning:', err.message);
  }
}

// Run immediately if executed via CLI (npm run postinstall)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureBinaries()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[install-binaries] Error:', err);
      process.exit(1);
    });
}
