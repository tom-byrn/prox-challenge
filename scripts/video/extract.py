#!/usr/bin/env python3
"""Extract the reviewed product-video transcript, semantic segments, and frames.

Every stage is fail-fast. Transcript extraction uses youtube-transcript-api only;
there is deliberately no alternate caption or transcription provider.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg
from youtube_transcript_api import YouTubeTranscriptApi
from yt_dlp import YoutubeDL


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "knowledge" / "video"
VIDEO_ID = "kxGDoGcnhBw"
VIDEO_URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"
SOURCE_ID = "setup-demo"
VIDEO_TITLE = "Vulcan OmniPro 220 multi-process setup demonstration"

# Boundaries and labels were reviewed against the timestamped caption track.
SEGMENTS = [
    {
        "slug": "synergic-overview",
        "title": "Synergic setup overview",
        "startSeconds": 0,
        "endSeconds": 36,
        "frameSeconds": 18,
        "summary": "The presenter explains selecting a welding process and material thickness before testing setup time for each process.",
        "keywords": ["synergic", "process selection", "material thickness", "LCD settings"],
    },
    {
        "slug": "flux-core-setup",
        "title": "Flux-cored setup and test welds",
        "startSeconds": 36,
        "endSeconds": 108,
        "frameSeconds": 44,
        "summary": "A flux-cored setup is timed from an empty spool and disconnected leads, followed by test welds using 0.035-inch wire.",
        "keywords": ["flux core", "wire spool", "0.035 wire", "fillet weld", "setup"],
    },
    {
        "slug": "mig-setup",
        "title": "MIG roller, gas, and lead changes",
        "startSeconds": 108,
        "endSeconds": 167,
        "frameSeconds": 120,
        "summary": "The presenter changes from the knurled roller to the V-groove, connects shielding gas, switches the leads, and tests 0.035-inch solid wire.",
        "keywords": ["MIG", "V-groove", "knurled roller", "shielding gas", "CO2", "polarity", "solid wire"],
    },
    {
        "slug": "stick-setup",
        "title": "Stick setup and 7018 examples",
        "startSeconds": 167,
        "endSeconds": 249,
        "frameSeconds": 174,
        "summary": "Stick setup is shown as a quick ground-clamp and electrode-holder connection, followed by 7018 weld examples.",
        "keywords": ["stick", "SMAW", "electrode holder", "7018", "rod selection", "T-joint"],
    },
    {
        "slug": "tig-setup",
        "title": "TIG setup, foot pedal, and lift start",
        "startSeconds": 249,
        "endSeconds": 334,
        "frameSeconds": 260,
        "summary": "The presenter covers torch preparation, tungsten grinding, gas, optional foot-pedal control, and the machine's lift-start TIG sequence.",
        "keywords": ["TIG", "lift start", "foot pedal", "tungsten", "argon", "amperage control"],
    },
    {
        "slug": "weld-results",
        "title": "Preset results and conclusion",
        "startSeconds": 334,
        "endSeconds": 349,
        "frameSeconds": 339,
        "summary": "The presenter concludes that the presets produced useful test welds quickly.",
        "keywords": ["preset settings", "weld results", "conclusion"],
    },
]


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def extract_transcript() -> tuple[dict, list[dict]]:
    try:
        transcript = YouTubeTranscriptApi().fetch(VIDEO_ID, languages=["en"])
    except Exception as error:
        raise RuntimeError(f"youtube-transcript-api failed for {VIDEO_ID}: {error}") from error

    captions = [
        {
            "startSeconds": round(item.start, 3),
            "durationSeconds": round(item.duration, 3),
            "text": item.text,
        }
        for item in transcript
    ]
    duration = max((item["startSeconds"] + item["durationSeconds"] for item in captions), default=0)
    document = {
        "sourceId": SOURCE_ID,
        "videoId": VIDEO_ID,
        "title": VIDEO_TITLE,
        "url": VIDEO_URL,
        "language": transcript.language_code,
        "isGenerated": transcript.is_generated,
        "durationSeconds": round(duration, 3),
        "captions": captions,
    }
    return document, captions


def build_segments(captions: list[dict]) -> list[dict]:
    output = []
    for definition in SEGMENTS:
        start = definition["startSeconds"]
        end = definition["endSeconds"]
        matching = [
            caption
            for caption in captions
            if caption["startSeconds"] < end
            and caption["startSeconds"] + caption["durationSeconds"] > start
        ]
        transcript = " ".join(caption["text"] for caption in matching).strip()
        output.append(
            {
                "id": f"video:{SOURCE_ID}@{start}-{end}",
                "sourceId": SOURCE_ID,
                "videoId": VIDEO_ID,
                "title": definition["title"],
                "startSeconds": start,
                "endSeconds": end,
                "frameSeconds": definition["frameSeconds"],
                "frame": f"video/frames/{definition['slug']}.jpg",
                "summary": definition["summary"],
                "keywords": definition["keywords"],
                "transcript": transcript,
                "url": f"https://www.youtube.com/watch?v={VIDEO_ID}&t={start}s",
                "authority": "supplemental-demonstration",
            }
        )
    return output


def download_video(destination: Path) -> None:
    options = {
        "format": "18",
        "outtmpl": str(destination),
        "quiet": True,
        "no_warnings": True,
    }
    try:
        with YoutubeDL(options) as downloader:
            downloader.download([VIDEO_URL])
    except Exception as error:
        raise RuntimeError(f"yt-dlp frame-source download failed for format 18: {error}") from error


def extract_frames(video_path: Path, segments: list[dict]) -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    frames_dir = OUTPUT / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for segment in segments:
        destination = ROOT / "knowledge" / segment["frame"]
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            str(segment["frameSeconds"]),
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-vf",
            "scale=960:-2",
            "-q:v",
            "3",
            "-y",
            str(destination),
        ]
        try:
            subprocess.run(command, check=True)
        except subprocess.CalledProcessError as error:
            raise RuntimeError(f"ffmpeg failed while extracting {destination.name}") from error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-frames", action="store_true", help="Extract captions and segments without downloading the video.")
    args = parser.parse_args()

    transcript, captions = extract_transcript()
    segments = build_segments(captions)
    write_json(OUTPUT / "transcript.json", transcript)
    write_json(
        OUTPUT / "segments.json",
        {
            "sourceId": SOURCE_ID,
            "videoId": VIDEO_ID,
            "title": VIDEO_TITLE,
            "url": VIDEO_URL,
            "captionType": "auto-generated" if transcript["isGenerated"] else "manual",
            "authority": "supplemental-demonstration",
            "segments": segments,
        },
    )

    if not args.skip_frames:
        with tempfile.TemporaryDirectory(prefix="arcwell-video-") as temporary:
            video_path = Path(temporary) / "source.mp4"
            download_video(video_path)
            extract_frames(video_path, segments)

    print(f"Extracted {len(captions)} captions and {len(segments)} segments to {OUTPUT}")


if __name__ == "__main__":
    main()
