const { extractMetadata, streamDirectDownload } = require('../services/extraction.service');

const isValidHttpUrl = (string) => {
  try {
    const parsed = new URL(string);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
};

const sanitizeFilename = (title, ext) => {
  const clean = (title || 'vurix_media')
    .replace(/[^\w\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 80);
  return `${clean || 'vurix_media'}.${ext}`;
};

/**
 * POST /api/v1/extract
 */
const handleExtract = async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid HTTP/HTTPS media URL.'
    });
  }

  try {
    const data = await extractMetadata(url);
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${req.get('host')}`;

    // Attach ready-to-click instant download URLs for every video format
    data.video_formats = data.video_formats.map((v) => {
      const params = new URLSearchParams({
        url: data.webpage_url,
        format_id: v.format_id,
        needs_merge: String(v.needs_merge),
        type: 'video',
        title: data.title
      });
      return {
        ...v,
        download_url: `${baseUrl}/api/v1/stream?${params.toString()}`
      };
    });

    // Attach ready-to-click instant download URLs for every audio format
    data.audio_formats = data.audio_formats.map((a) => {
      const params = new URLSearchParams({
        url: data.webpage_url,
        format_id: a.format_id,
        needs_merge: 'false',
        type: a.ext === 'mp3' ? 'mp3' : 'audio',
        title: data.title
      });
      return {
        ...a,
        download_url: `${baseUrl}/api/v1/stream?${params.toString()}`
      };
    });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Unable to extract media from the provided link.'
    });
  }
};

/**
 * GET /api/v1/stream
 */
const handleStream = (req, res) => {
  const { url, format_id, needs_merge, type, title } = req.query;

  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing media URL parameter.'
    });
  }

  const ext = type === 'mp3' ? 'mp3' : 'mp4';
  const filename = sanitizeFilename(title, ext);

  streamDirectDownload({
    url,
    formatId: format_id || 'best',
    needsMerge: needs_merge || 'false',
    type: type || 'video',
    filename,
    req,
    res
  });
};

module.exports = {
  handleExtract,
  handleStream
};
