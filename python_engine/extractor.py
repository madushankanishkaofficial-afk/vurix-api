import sys
import json
import yt_dlp

def format_size(bytes_val):
    if not bytes_val or bytes_val <= 0:
        return None
    mb = bytes_val / (1024 * 1024)
    return round(mb, 2)

def estimate_size(fmt, duration):
    # 1. Exact filesize check
    size = fmt.get('filesize') or fmt.get('filesize_approx')
    if size:
        return format_size(size)
    
    # 2. Calculate from bitrate (tbr in kbps) and duration
    tbr = fmt.get('tbr') or fmt.get('vbr') or fmt.get('abr')
    if tbr and duration:
        estimated_bytes = (tbr * 1000 / 8) * duration
        return format_size(estimated_bytes)
    
    return None

def get_resolution_label(fmt):
    width = fmt.get('width')
    height = fmt.get('height')
    if width and height:
        # Handle vertical videos (TikTok, Reels, Shorts) accurately
        short_side = min(width, height)
        if short_side >= 2160: return "4K (2160p)"
        if short_side >= 1440: return "2K (1440p)"
        if short_side >= 1080: return "1080p (Full HD)"
        if short_side >= 720:  return "720p (HD)"
        if short_side >= 480:  return "480p"
        if short_side >= 360:  return "360p"
        if short_side >= 240:  return "240p"
        return f"{short_side}p"
    return fmt.get('format_note') or "Standard"

def extract_media_info(url):
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'nocheckcertificate': True,
        'geo_bypass': True,
        'extract_flat': False,
        ' http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            # If playlist or multi-entry, pick the first video
            if 'entries' in info:
                info = info['entries'][0]

            duration = info.get('duration') or 0
            platform = info.get('extractor_key', 'Unknown')
            raw_formats = info.get('formats', [])

            video_map = {}
            audio_formats = []

            # Find best audio size for adding to video-only streams
            best_audio_size_mb = 0
            for f in raw_formats:
                if f.get('vcodec') == 'none' and f.get('acodec') != 'none':
                    a_size = estimate_size(f, duration) or 0
                    if a_size > best_audio_size_mb:
                        best_audio_size_mb = a_size

            for f in raw_formats:
                fmt_id = f.get('format_id')
                ext = f.get('ext', '')
                vcodec = f.get('vcodec', 'none')
                acodec = f.get('acodec', 'none')
                direct_url = f.get('url')

                if not direct_url or ext in ['mhtml', '3gp']:
                    continue

                # Case 1: Video Formats (Combined or Video-Only DASH)
                if vcodec != 'none':
                    res_label = get_resolution_label(f)
                    has_audio = acodec != 'none'
                    size_mb = estimate_size(f, duration)

                    # Add audio size estimate if stream is video-only
                    if not has_audio and size_mb and best_audio_size_mb:
                        size_mb = round(size_mb + best_audio_size_mb, 2)

                    height_score = min(f.get('width') or 0, f.get('height') or 0)
                    tbr_score = f.get('tbr') or 0

                    candidate = {
                        'format_id': fmt_id,
                        'resolution': res_label,
                        'ext': 'mp4',
                        'original_ext': ext,
                        'has_audio': has_audio,
                        'needs_merge': not has_audio,
                        'filesize_mb': size_mb,
                        'fps': f.get('fps'),
                        'direct_url': direct_url,
                        '_score': (100000 if has_audio else 0) + (50000 if ext == 'mp4' else 0) + tbr_score,
                        '_height': height_score
                    }

                    # Keep the best stream per resolution
                    if res_label not in video_map or candidate['_score'] > video_map[res_label]['_score']:
                        video_map[res_label] = candidate

                # Case 2: Audio-Only Formats
                elif vcodec == 'none' and acodec != 'none':
                    abr = f.get('abr') or f.get('tbr') or 128
                    size_mb = estimate_size(f, duration)
                    audio_formats.append({
                        'format_id': fmt_id,
                        'quality': f"{int(abr)}kbps" if abr else "Audio",
                        'ext': ext,
                        'filesize_mb': size_mb,
                        'direct_url': direct_url,
                        '_abr': abr
                    })

            # Sort video formats from highest resolution to lowest
            sorted_videos = sorted(video_map.values(), key=lambda x: x['_height'], reverse=True)
            for v in sorted_videos:
                v.pop('_score', None)
                v.pop('_height', None)

            # Fallback if platform only exposes a single master URL (e.g. certain TikTok/FB reels)
            if not sorted_videos and info.get('url'):
                sorted_videos.append({
                    'format_id': 'best',
                    'resolution': 'HD (Original)',
                    'ext': 'mp4',
                    'original_ext': info.get('ext', 'mp4'),
                    'has_audio': True,
                    'needs_merge': False,
                    'filesize_mb': estimate_size(info, duration),
                    'fps': info.get('fps'),
                    'direct_url': info.get('url')
                })

            # Sort audio formats and inject top MP3 conversion option
            sorted_audios = sorted(audio_formats, key=lambda x: x['_abr'], reverse=True)[:2]
            for a in sorted_audios:
                a.pop('_abr', None)

            mp3_estimated_mb = round((192 * 1000 / 8) * duration / (1024 * 1024), 2) if duration else best_audio_size_mb
            sorted_audios.insert(0, {
                'format_id': 'mp3_192',
                'quality': 'MP3 192kbps (HQ)',
                'ext': 'mp3',
                'filesize_mb': mp3_estimated_mb,
                'direct_url': None
            })

            result = {
                'success': True,
                'platform': platform,
                'id': info.get('id'),
                'title': info.get('title') or f"{platform} Media",
                'thumbnail': info.get('thumbnail'),
                'duration': duration,
                'uploader': info.get('uploader') or info.get('channel'),
                'webpage_url': info.get('webpage_url') or url,
                'video_formats': sorted_videos,
                'audio_formats': sorted_audios
            }
            print(json.dumps(result))

    except Exception as e:
        error_res = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(error_res))
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No URL provided'}))
        sys.exit(1)
    extract_media_info(sys.argv[1])
