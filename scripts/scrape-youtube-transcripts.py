#!/usr/bin/env python3
"""
YouTube Transcript Scraper for Content Cartel (v3 - yt-dlp + Whisper)
Pulls recent video transcripts from client YouTube channels using yt-dlp.
Optionally transcribes audio via OpenAI Whisper for higher quality.

Usage:
  python3 scripts/scrape-youtube-transcripts.py [--videos-per-client 10] [--min-duration 120]
  python3 scripts/scrape-youtube-transcripts.py --client-id 9
  python3 scripts/scrape-youtube-transcripts.py --whisper              # Use Whisper for transcription
  python3 scripts/scrape-youtube-transcripts.py --video-url "https://youtube.com/watch?v=xyz" --client-id 9

Requires:
  pip3 install yt-dlp requests
"""

import json
import urllib.request
import sys
import argparse
import re
import tempfile
import os

# --- Config ---
YT_API_KEY = os.environ.get("YOUTUBE_API_KEY", "AIzaSyDyMK22EgAoI1m1QZTsp9QT_e8Fxm8h43E")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://andcsslmnogpuntfuouh.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFuZGNzc2xtbm9ncHVudGZ1b3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMDQ2OTMsImV4cCI6MjA4Nzg4MDY5M30.3i0zOowv6SU4xWvGy506KMpzh8qp634iwfIH8FQVTgA")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

WHISPER_MAX_SIZE = 25 * 1024 * 1024  # 25MB

# Fallback client channels
FALLBACK_CLIENTS = {
    3: "granitetowersequitygroup",
    4: "DouglassLodmell",
    9: "Monetary-metals",
    12: "BuiltByBeckerMedia",
    14: "WallStreetBeatsLIVE",
    22: "LevelingUpOfficial",
}


def get_clients_from_supabase():
    """Fetch client YouTube URLs from client_dna table."""
    url = f"{SUPABASE_URL}/rest/v1/client_dna?select=client_id,youtube_url&order=client_id.asc,version.desc"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    data = json.loads(urllib.request.urlopen(req).read())

    clients = {}
    for d in data:
        cid = d['client_id']
        yt_url = d.get('youtube_url', '')
        if cid not in clients and yt_url:
            match = re.search(r'@([\w-]+)', yt_url)
            if match:
                clients[cid] = match.group(1)
            else:
                match = re.search(r'youtube\.com/(?:c/|channel/|user/|@)([\w-]+)', yt_url)
                if match:
                    clients[cid] = match.group(1)

    return clients


def get_channel_id(handle):
    """Resolve @handle to channel ID via YouTube Data API."""
    for method in ['forHandle', 'forUsername']:
        url = f"https://www.googleapis.com/youtube/v3/channels?part=id&{method}={handle}&key={YT_API_KEY}"
        try:
            resp = json.loads(urllib.request.urlopen(url).read())
            if resp.get('items'):
                return resp['items'][0]['id']
        except Exception:
            pass

    if handle.startswith('UC'):
        return handle
    return None


def get_recent_videos(channel_id, max_results=10):
    """Get recent video IDs and titles from a channel."""
    url = f"https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id={channel_id}&key={YT_API_KEY}"
    resp = json.loads(urllib.request.urlopen(url).read())
    uploads_id = resp['items'][0]['contentDetails']['relatedPlaylists']['uploads']

    url = f"https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId={uploads_id}&maxResults={max_results}&key={YT_API_KEY}"
    resp = json.loads(urllib.request.urlopen(url).read())

    videos = []
    for item in resp.get('items', []):
        vid = item['snippet']['resourceId']['videoId']
        title = item['snippet']['title']
        published = item['snippet']['publishedAt']
        videos.append({"video_id": vid, "title": title, "published": published})
    return videos


def get_transcript_ytdlp(video_id):
    """Get transcript using yt-dlp captions (fast, lower quality)."""
    try:
        import yt_dlp

        opts = {
            'skip_download': True,
            'writeautomaticsub': True,
            'writesubtitles': True,
            'subtitleslangs': ['en'],
            'subtitlesformat': 'json3',
            'quiet': True,
            'no_warnings': True,
        }

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f'https://youtube.com/watch?v={video_id}', download=False)
            duration = info.get('duration', 0)

            subs = info.get('subtitles', {})
            auto_subs = info.get('automatic_captions', {})

            sub_data = None
            for lang in ['en', 'en-US', 'en-GB']:
                if lang in subs:
                    for fmt in subs[lang]:
                        if fmt.get('ext') == 'json3':
                            sub_url = fmt['url']
                            sub_data = json.loads(urllib.request.urlopen(sub_url).read())
                            break
                    if sub_data:
                        break

                if not sub_data and lang in auto_subs:
                    for fmt in auto_subs[lang]:
                        if fmt.get('ext') == 'json3':
                            sub_url = fmt['url']
                            sub_data = json.loads(urllib.request.urlopen(sub_url).read())
                            break
                    if sub_data:
                        break

            if not sub_data:
                return None, duration

            events = sub_data.get('events', [])
            segments = []
            for event in events:
                segs = event.get('segs', [])
                for seg in segs:
                    text = seg.get('utf8', '').strip()
                    if text and text != '\n':
                        segments.append(text)

            full_text = ' '.join(segments)
            full_text = re.sub(r'\s+', ' ', full_text).strip()
            full_text = full_text.replace('[Music]', '').replace('[Applause]', '').strip()

            return full_text, duration

    except Exception as e:
        print(f"    yt-dlp caption error: {str(e)[:80]}")
        return None, 0


def get_transcript_whisper(video_id):
    """Download audio via yt-dlp and transcribe with OpenAI Whisper for higher quality."""
    if not OPENAI_API_KEY:
        print("    Whisper: OPENAI_API_KEY not set, falling back to captions")
        return None, 0

    try:
        import yt_dlp
        import requests

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, 'audio.m4a')

            opts = {
                'format': 'bestaudio[ext=m4a]/bestaudio[filesize<25M]/bestaudio',
                'outtmpl': audio_path,
                'quiet': True,
                'no_warnings': True,
            }

            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(f'https://youtube.com/watch?v={video_id}', download=True)
                duration = info.get('duration', 0)

            # Find the downloaded file (yt-dlp may change extension)
            actual_file = None
            for f in os.listdir(tmpdir):
                fpath = os.path.join(tmpdir, f)
                if os.path.isfile(fpath):
                    actual_file = fpath
                    break

            if not actual_file:
                print("    Whisper: no audio file downloaded")
                return None, duration

            file_size = os.path.getsize(actual_file)
            if file_size > WHISPER_MAX_SIZE:
                print(f"    Whisper: audio too large ({file_size // (1024*1024)}MB), falling back to captions")
                return None, duration

            # Send to Whisper API
            with open(actual_file, 'rb') as f:
                resp = requests.post(
                    'https://api.openai.com/v1/audio/transcriptions',
                    headers={'Authorization': f'Bearer {OPENAI_API_KEY}'},
                    files={'file': (os.path.basename(actual_file), f)},
                    data={'model': 'whisper-1', 'response_format': 'text'},
                    timeout=120,
                )

            if resp.status_code != 200:
                print(f"    Whisper API error: {resp.status_code} {resp.text[:100]}")
                return None, duration

            transcript = resp.text.strip()
            return transcript, duration

    except Exception as e:
        print(f"    Whisper error: {str(e)[:100]}")
        return None, 0


def transcript_exists(client_id, video_id):
    """Check if transcript already exists in Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/client_transcripts?client_id=eq.{client_id}&source=eq.youtube&source_id=eq.{video_id}&select=id"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    resp = json.loads(urllib.request.urlopen(req).read())
    return len(resp) > 0


def save_transcript(client_id, video_id, title, text, duration, published, source_method='caption'):
    """Save transcript to Supabase with source_method tracking."""
    data = json.dumps({
        "client_id": client_id,
        "source": "youtube",
        "source_id": video_id,
        "title": title,
        "transcript_text": text,
        "word_count": len(text.split()),
        "duration_seconds": duration,
        "recorded_at": published,
        "relevance_tag": "general",
        "metadata": json.dumps({"source_method": source_method}),
    }).encode()

    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/client_transcripts",
        data=data,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="POST",
    )

    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return False
        body = e.read().decode()
        print(f"    ERROR saving: {e.code} {body[:200]}")
        return False


def scrape_single_video(video_url, client_id, use_whisper=False):
    """Scrape a single video by URL."""
    match = re.search(r'(?:v=|youtu\.be/)([\w-]+)', video_url)
    if not match:
        print(f"Could not extract video ID from: {video_url}")
        return False

    video_id = match.group(1)
    print(f"Scraping video: {video_id}")

    if transcript_exists(client_id, video_id):
        print(f"  Already exists, skipping")
        return False

    text, duration = None, 0
    source_method = 'caption'

    if use_whisper:
        print(f"  Trying Whisper transcription...")
        text, duration = get_transcript_whisper(video_id)
        if text:
            source_method = 'whisper'
            print(f"  Whisper: {len(text.split())} words")

    if not text:
        print(f"  Using yt-dlp captions...")
        text, duration = get_transcript_ytdlp(video_id)
        source_method = 'caption'

    if not text:
        print(f"  No transcript available")
        return False

    words = len(text.split())
    if words < 50:
        print(f"  Too few words ({words}), skipping")
        return False

    if save_transcript(client_id, video_id, f"Video {video_id}", text, duration, None, source_method):
        print(f"  SAVED ({source_method}): {words} words, {duration // 60}m")
        return True

    return False


def main():
    parser = argparse.ArgumentParser(description="Scrape YouTube transcripts (yt-dlp + optional Whisper)")
    parser.add_argument("--videos-per-client", type=int, default=10)
    parser.add_argument("--min-duration", type=int, default=120)
    parser.add_argument("--client-id", type=int, help="Only scrape specific client")
    parser.add_argument("--whisper", action="store_true", help="Use OpenAI Whisper for higher quality transcription")
    parser.add_argument("--video-url", type=str, help="Scrape a single video by URL (requires --client-id)")
    args = parser.parse_args()

    # Single video mode
    if args.video_url:
        if not args.client_id:
            print("--video-url requires --client-id")
            sys.exit(1)
        success = scrape_single_video(args.video_url, args.client_id, args.whisper)
        sys.exit(0 if success else 1)

    # Get clients from Supabase, fall back to hardcoded
    try:
        all_clients = get_clients_from_supabase()
        if not all_clients:
            all_clients = FALLBACK_CLIENTS
        else:
            for cid, handle in FALLBACK_CLIENTS.items():
                if cid not in all_clients:
                    all_clients[cid] = handle
    except Exception:
        all_clients = FALLBACK_CLIENTS

    if args.client_id:
        if args.client_id in all_clients:
            clients = {args.client_id: all_clients[args.client_id]}
        else:
            print(f"Client {args.client_id} not found. Available: {list(all_clients.keys())}")
            return
    else:
        clients = all_clients

    total_saved = 0
    total_skipped = 0

    for client_id, handle in clients.items():
        print(f"\n{'='*60}")
        print(f"Client {client_id}: @{handle}")
        print(f"{'='*60}")

        channel_id = get_channel_id(handle)
        if not channel_id:
            print(f"  Could not resolve channel. Skipping.")
            continue

        videos = get_recent_videos(channel_id, args.videos_per_client)
        print(f"  Found {len(videos)} recent videos")

        for v in videos:
            vid = v["video_id"]
            title = v["title"]

            if transcript_exists(client_id, vid):
                print(f"  SKIP (exists): {title[:50]}")
                total_skipped += 1
                continue

            text, duration = None, 0
            source_method = 'caption'

            # Try Whisper first if enabled
            if args.whisper:
                text, duration = get_transcript_whisper(vid)
                if text:
                    source_method = 'whisper'

            # Fall back to captions
            if not text:
                text, duration = get_transcript_ytdlp(vid)
                source_method = 'caption'

            if not text:
                print(f"  SKIP (no captions): {title[:50]}")
                total_skipped += 1
                continue

            if duration < args.min_duration:
                print(f"  SKIP (too short: {duration}s): {title[:50]}")
                total_skipped += 1
                continue

            words = len(text.split())
            if words < 50:
                print(f"  SKIP (too few words: {words}): {title[:50]}")
                total_skipped += 1
                continue

            if save_transcript(client_id, vid, title, text, duration, v["published"], source_method):
                print(f"  SAVED ({source_method}): {title[:50]} ({words} words, {duration//60}m)")
                total_saved += 1
            else:
                total_skipped += 1

    print(f"\n{'='*60}")
    print(f"DONE: {total_saved} saved, {total_skipped} skipped")
    if args.whisper:
        print(f"Mode: Whisper (with caption fallback)")
    else:
        print(f"Mode: Captions only (use --whisper for higher quality)")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
