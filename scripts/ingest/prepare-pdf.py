#!/usr/bin/env python3
"""Deterministically prepare one PDF for semantic ingestion.

This program owns byte hashing, PDF validation, text/layout extraction, and page
rendering. It deliberately contains no product names, section definitions,
figure crops, captions, keywords, or other semantic knowledge.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import fitz


SCHEMA_VERSION = 1
RENDER_SCALE = 2.0


def safe_id(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:80].rstrip("-")
    if not normalized:
        raise ValueError("source id must contain a letter or number")
    return normalized


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_text(value: str) -> str:
    value = value.replace("\u00ad", "")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def normalized_rect(rect: fitz.Rect, page_rect: fitz.Rect) -> dict[str, float] | None:
    if rect.is_infinite or rect.is_empty or page_rect.width <= 0 or page_rect.height <= 0:
        return None
    x1 = max(0.0, min(1.0, (rect.x0 - page_rect.x0) / page_rect.width))
    y1 = max(0.0, min(1.0, (rect.y0 - page_rect.y0) / page_rect.height))
    x2 = max(0.0, min(1.0, (rect.x1 - page_rect.x0) / page_rect.width))
    y2 = max(0.0, min(1.0, (rect.y1 - page_rect.y0) / page_rect.height))
    if x2 <= x1 or y2 <= y1 or not all(math.isfinite(value) for value in (x1, y1, x2, y2)):
        return None
    return {"x1": round(x1, 6), "y1": round(y1, 6), "x2": round(x2, 6), "y2": round(y2, 6)}


def page_regions(page: fitz.Page) -> list[dict]:
    regions: list[dict] = []
    for block in page.get_text("blocks"):
        bounds = normalized_rect(fitz.Rect(block[:4]), page.rect)
        text = clean_text(str(block[4]))
        if bounds:
            item = {"type": "text", "bounds": bounds}
            if text:
                item["text"] = text[:20000]
            regions.append(item)
    seen_images: set[tuple[float, float, float, float]] = set()
    for image in page.get_images(full=True):
        try:
            rectangles = page.get_image_rects(image[0])
        except Exception:
            rectangles = []
        for rectangle in rectangles:
            bounds = normalized_rect(rectangle, page.rect)
            if bounds:
                key = tuple(bounds.values())
                if key not in seen_images:
                    regions.append({"type": "image", "bounds": bounds})
                    seen_images.add(key)
    for drawing in page.get_drawings():
        bounds = normalized_rect(drawing["rect"], page.rect)
        if bounds:
            regions.append({"type": "drawing", "bounds": bounds})
    return regions


def prepare(input_path: Path, output: Path, source_id: str, authority: str) -> Path:
    if not input_path.is_file():
        raise FileNotFoundError(f"PDF input does not exist: {input_path}")
    if input_path.stat().st_size == 0:
        raise ValueError(f"PDF input is empty: {input_path}")
    shutil.rmtree(output, ignore_errors=True)
    pages_dir = output / "pages"
    pages_dir.mkdir(parents=True)
    try:
        document = fitz.open(input_path)
    except Exception as error:
        raise ValueError(f"Malformed PDF {input_path}: {error}") from error
    try:
        if document.needs_pass or document.is_encrypted:
            raise ValueError(f"Encrypted PDFs are not supported: {input_path}")
        if document.page_count <= 0:
            raise ValueError(f"PDF has no pages: {input_path}")
        outline = []
        for entry in document.get_toc(simple=True):
            level, title, page = entry[:3]
            if page > 0 and str(title).strip():
                outline.append({"level": int(level), "title": str(title).strip()[:500], "page": int(page)})
        pages = []
        for index, page in enumerate(document):
            number = index + 1
            stem = f"{number:04d}"
            text = clean_text(page.get_text("text"))
            text_file = f"pages/{stem}.txt"
            image_file = f"pages/{stem}.png"
            (output / text_file).write_text(text + ("\n" if text else ""), encoding="utf-8")
            pixmap = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False, colorspace=fitz.csRGB)
            pixmap.save(output / image_file)
            pages.append({
                "page": number,
                "width": round(page.rect.width, 3),
                "height": round(page.rect.height, 3),
                "rotation": int(page.rotation),
                "textFile": text_file,
                "imageFile": image_file,
                "textAvailable": bool(text),
                "regions": page_regions(page),
            })
        metadata = {str(key): str(value) for key, value in (document.metadata or {}).items() if value is not None}
        result = {
            "schemaVersion": SCHEMA_VERSION,
            "id": safe_id(source_id),
            "sourceFile": input_path.name,
            "sourcePath": str(output.resolve()),
            "sha256": sha256(input_path),
            "pageCount": document.page_count,
            "metadata": metadata,
            "outline": outline,
            "outlineAvailable": bool(outline),
            "authority": safe_id(authority),
            "pages": pages,
        }
        metadata_path = output / "document.json"
        metadata_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return metadata_path
    finally:
        document.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--authority", default="authoritative-manual")
    args = parser.parse_args()
    path = prepare(args.input.resolve(), args.output.resolve(), args.source_id, args.authority)
    print(path)


if __name__ == "__main__":
    main()
