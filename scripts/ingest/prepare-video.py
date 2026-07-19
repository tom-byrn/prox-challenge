#!/usr/bin/env python3
"""Deterministically prepare captions/video bytes or extract an on-demand frame."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import imageio_ffmpeg
from youtube_transcript_api import YouTubeTranscriptApi
from yt_dlp import YoutubeDL


SCHEMA_VERSION = 1


def safe_id(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:80].rstrip("-")
    if not normalized:
        raise ValueError("source id must contain a letter or number")
    return normalized


def video_id_from_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("video URL must use HTTPS")
    if parsed.hostname in {"youtu.be", "www.youtu.be"}:
        value = parsed.path.strip("/").split("/")[0]
    elif parsed.hostname and parsed.hostname.endswith("youtube.com"):
        value = parse_qs(parsed.query).get("v", [""])[0]
        if not value and parsed.path.startswith(("/embed/", "/shorts/")):
            value = parsed.path.split("/")[2]
    else:
        raise ValueError("prepare-video currently supports YouTube URLs")
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,20}", value or ""):
        raise ValueError("could not derive a valid YouTube video id")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_transcript(video_id: str, languages: list[str]):
    try:
        return YouTubeTranscriptApi().fetch(video_id, languages=languages)
    except Exception as error:
        raise RuntimeError(f"youtube-transcript-api failed for {video_id}: {error}") from error


def download_video(url: str, destination: Path) -> dict:
    options = {
        "format": "best[ext=mp4]/best",
        "outtmpl": str(destination),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
    except Exception as error:
        raise RuntimeError(f"yt-dlp video preparation failed: {error}") from error
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError("yt-dlp did not produce the expected video file")
    return info


def prepare(url: str, output: Path, source_id: str, authority: str, languages: list[str]) -> Path:
    video_id = video_id_from_url(url)
    output.mkdir(parents=True, exist_ok=True)
    transcript = fetch_transcript(video_id, languages)
    captions = [
        {"startSeconds": round(float(item.start), 3), "durationSeconds": round(float(item.duration), 3), "text": item.text.strip()}
        for item in transcript if item.text.strip() and item.duration > 0
    ]
    if not captions:
        raise RuntimeError(f"caption track for {video_id} was empty")
    source_path = output / "source.mp4"
    info = download_video(url, source_path)
    caption_duration = max(item["startSeconds"] + item["durationSeconds"] for item in captions)
    duration = float(info.get("duration") or caption_duration)
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "id": safe_id(source_id),
        "videoId": video_id,
        "title": str(info.get("title") or video_id)[:300],
        "url": url,
        "sourcePath": str(source_path.resolve()),
        "language": transcript.language_code,
        "isGenerated": bool(transcript.is_generated),
        "durationSeconds": round(max(duration, caption_duration), 3),
        "sha256": sha256(source_path),
        "authority": safe_id(authority),
        "captions": captions,
    }
    metadata_path = output / "video.json"
    metadata_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return metadata_path


def extract_frame(video: Path, seconds: float, output: Path) -> None:
    if not video.is_file():
        raise FileNotFoundError(f"video frame source does not exist: {video}")
    if seconds < 0:
        raise ValueError("frame timestamp cannot be negative")
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
        "-ss", str(seconds), "-i", str(video), "-frames:v", "1",
        "-vf", "scale=1280:-2", "-q:v", "2", "-y", str(output),
    ]
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"ffmpeg failed to extract frame at {seconds}s") from error
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"ffmpeg produced no frame at {seconds}s")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--url", required=True)
    prepare_parser.add_argument("--output", required=True, type=Path)
    prepare_parser.add_argument("--source-id", required=True)
    prepare_parser.add_argument("--authority", default="supplemental-demonstration")
    prepare_parser.add_argument("--caption-language", action="append", dest="languages")
    frame_parser = subparsers.add_parser("frame")
    frame_parser.add_argument("--video", required=True, type=Path)
    frame_parser.add_argument("--seconds", required=True, type=float)
    frame_parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        print(prepare(args.url, args.output.resolve(), args.source_id, args.authority, args.languages or ["en"]))
    else:
        extract_frame(args.video.resolve(), args.seconds, args.output.resolve())
        print(args.output.resolve())


if __name__ == "__main__":
    main()
