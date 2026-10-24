const { spawn } = require('child_process');
const path = require('path');
const NodeCache = require('node-cache');

// Cache extracted metadata for 15 minutes (900 seconds)
const mediaCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

const PYTHON_SCRIPT_PATH = path.resolve(__dirname, '../../../python_engine/extractor.py');

/**
 * Extracts metadata and stream formats via Python yt-dlp engine
 */
const extractMetadata = (url) => {
  return new Promise((resolve, reject) => {
    const cachedData = mediaCache.get(url);
    if (cachedData) {
      return resolve({ ...cachedData, cached: true });
    }

    const pyProcess = spawn('python3', [PYTHON_SCRIPT_PATH, url]);
    let stdoutData = '';
    let stderrData = '';

    // 25-second timeout guard
    const timeout = setTimeout(() => {
      pyProcess.kill('SIGKILL');
      reject(new Error('Extraction timed out after 25 seconds.'));
    }, 25000);

    pyProcess.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    pyProcess.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    pyProcess.on('close', (code) => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(stdoutData.trim());
        if (!parsed.success) {
          return reject(new Error(parsed.error || 'Failed to extract media.'));
        }
        mediaCache.set(url, parsed);
        resolve({ ...parsed, cached: false });
      } catch (err) {
        reject(new Error(stderrData || 'Invalid response from extraction engine.'));
      }
    });
  });
};

/**
 * Pipes live video/audio stream directly to the Express HTTP response (Zero-Disk)
 */
const streamDirectDownload = ({ url, formatId, needsMerge, type, filename, req, res }) => {
  // Set headers so browser immediately starts downloading the file
  const contentType = type === 'mp3' ? 'audio/mpeg' : 'video/mp4';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  // Case 1: Real-time MP3 Conversion Pipeline (yt-dlp stdout -> ffmpeg mp3 -> HTTP res)
  if (type === 'mp3' || formatId === 'mp3_192') {
    const ytdlp = spawn('yt-dlp', [
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--geo-bypass',
      '-f', 'bestaudio/best',
      '-o', '-',
      url
    ]);

    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'libmp3lame',
      '-b:a', '192k',
      '-f', 'mp3',
      'pipe:1'
    ]);

    ytdlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    const cleanup = () => {
      ytdlp.kill('SIGKILL');
      ffmpeg.kill('SIGKILL');
    };

    req.on('close', cleanup);
    ffmpeg.on('error', cleanup);
    ytdlp.on('error', cleanup);
    return;
  }

  // Case 2: High-Resolution Video + Audio On-the-Fly Merge (1080p/2K/4K DASH)
  if (needsMerge === 'true') {
    const ytdlp = spawn('yt-dlp', [
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--geo-bypass',
      '-f', `${formatId}+bestaudio/best`,
      '--merge-output-format', 'mp4',
      '--postprocessor-args', 'Merger:-movflags frag_keyframe+empty_moov+default_base_moof',
      '-o', '-',
      url
    ]);

    ytdlp.stdout.pipe(res);

    req.on('close', () => ytdlp.kill('SIGKILL'));
    ytdlp.on('error', () => ytdlp.kill('SIGKILL'));
    return;
  }

  // Case 3: Direct Progressive Stream (TikTok, FB, Insta, YouTube 360p/720p, M4A)
  const ytdlp = spawn('yt-dlp', [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    '-f', formatId || 'best',
    '-o', '-',
    url
  ]);

  ytdlp.stdout.pipe(res);

  req.on('close', () => ytdlp.kill('SIGKILL'));
  ytdlp.on('error', () => ytdlp.kill('SIGKILL'));
};

module.exports = {
  extractMetadata,
  streamDirectDownload
};
