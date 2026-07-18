#!/usr/bin/env python3
"""Build the committed OmniPro knowledge assets from the supplied PDFs.

This script is intentionally not part of `npm run dev`. Graders consume the
checked-in output, while maintainers can rebuild it with:

    python3 -m venv .venv-extract
    .venv-extract/bin/pip install -r scripts/extract/requirements.txt
    .venv-extract/bin/python scripts/extract/extract.py
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[2]
FILES = ROOT / "files"
KNOWLEDGE = ROOT / "knowledge"
PAGES = KNOWLEDGE / "pages"
FIGURES = KNOWLEDGE / "figures"
RENDER_SCALE = 2.0


SOURCES = {
    "owner-manual": FILES / "owner-manual.pdf",
    "quick-start": FILES / "quick-start-guide.pdf",
    "selection-chart": FILES / "selection-chart.pdf",
}


SECTIONS = [
    {"title": "Safety", "source": "owner-manual", "pages": [2, 3, 4, 5, 6], "summary": "Fumes, fire, electrical, cylinder, PPE, and equipment safety."},
    {"title": "Specifications", "source": "owner-manual", "pages": [7], "summary": "Process ranges, rated duty cycles, materials, OCV, and wire capacities."},
    {"title": "Controls", "source": "owner-manual", "pages": [8, 9], "summary": "Front panel sockets and controls; interior wire-feed components."},
    {"title": "Wire setup", "source": "owner-manual", "pages": list(range(10, 18)), "summary": "Spool, roller, gun, polarity, gas, wire feed, and tension setup."},
    {"title": "MIG and flux-cored operation", "source": "owner-manual", "pages": list(range(18, 24)), "summary": "Work preparation, LCD setup, technique, shutdown, and duty cycle."},
    {"title": "TIG setup", "source": "owner-manual", "pages": [24, 25, 26], "summary": "DCEN cable routing, argon, foot pedal, torch, and tungsten preparation."},
    {"title": "Stick setup", "source": "owner-manual", "pages": [27], "summary": "DCEP cable routing and power connection."},
    {"title": "TIG and stick operation", "source": "owner-manual", "pages": list(range(28, 34)), "summary": "Technique, LCD setup, duty cycles, and operating procedures."},
    {"title": "Weld diagnosis", "source": "owner-manual", "pages": list(range(34, 41)), "summary": "Visual examples for penetration, heat, speed, porosity, spatter, and defects."},
    {"title": "Maintenance and troubleshooting", "source": "owner-manual", "pages": [41, 42, 43, 44], "summary": "Maintenance schedule and process-specific troubleshooting matrices."},
    {"title": "Wiring and parts", "source": "owner-manual", "pages": [45, 46, 47], "summary": "Electrical schematic, parts list, and exploded assembly diagram."},
    {"title": "Cable setup quick guide", "source": "quick-start", "pages": [2], "summary": "Single-page visual hookup guide for stick, MIG, flux-cored, and TIG."},
    {"title": "Process selection", "source": "selection-chart", "pages": [1], "summary": "General comparison of flux-cored, MIG, stick, and TIG tradeoffs."},
]


@dataclass(frozen=True)
class Figure:
    id: str
    title: str
    source: str
    page: int
    crop: tuple[float, float, float, float]
    caption: str
    keywords: tuple[str, ...]
    answers: tuple[str, ...]


FIGURE_DEFS = [
    Figure("process-selection-chart", "Choosing a welding process", "selection-chart", 1, (0.0, 0.24, 1.0, 0.73), "General tradeoffs between flux-cored, MIG, stick, and TIG processes.", ("choose", "process", "mig", "flux", "stick", "tig", "material", "gas"), ("Which process should I use?",)),
    Figure("cable-setup-quick-guide", "Cable setup quick guide", "quick-start", 2, (0.03, 0.10, 0.97, 0.96), "Visual hookup guide for stick, MIG, flux-cored, and TIG.", ("cable", "socket", "terminal", "polarity", "hookup"), ("Which socket does each cable use?",)),
    Figure("stick-cable-setup", "Stick cable setup", "quick-start", 2, (0.04, 0.10, 0.96, 0.38), "Ground clamp to negative; electrode holder to positive; wire-feed power disconnected.", ("stick", "dcep", "ground", "negative", "holder", "positive"), ("How do I connect stick leads?",)),
    Figure("mig-flux-cable-setup", "MIG and flux-cored cable setup", "quick-start", 2, (0.04, 0.39, 0.96, 0.68), "MIG is DCEP. Self-shielded flux-cored reverses the ground and wire-feed power leads for DCEN.", ("mig", "flux", "dcep", "dcen", "ground", "wire feed", "polarity"), ("How do I switch between MIG and flux-cored polarity?",)),
    Figure("tig-cable-setup", "TIG cable setup", "quick-start", 2, (0.04, 0.69, 0.96, 0.96), "Ground clamp to positive, TIG torch to negative, plus argon and the foot pedal.", ("tig", "dcen", "ground", "positive", "torch", "negative", "argon", "pedal"), ("What polarity setup do I need for TIG?",)),
    Figure("front-panel-controls", "Front panel controls", "owner-manual", 8, (0.08, 0.12, 0.92, 0.88), "Labeled front panel showing the LCD, knobs, MIG/spool-gun socket, and positive and negative sockets.", ("front panel", "controls", "socket", "lcd", "knob", "positive", "negative"), ("Where is the negative socket?", "What does the front panel look like?")),
    Figure("interior-controls", "Interior controls", "owner-manual", 9, (0.08, 0.12, 0.92, 0.88), "Labeled interior showing spool, roller, tensioner, wire-feed control, and foot-pedal socket.", ("inside", "interior", "spool", "feed", "tensioner", "roller", "pedal"), ("Where is the wire feed tensioner?",)),
    Figure("feed-roller-guide", "Feed roller orientation", "owner-manual", 12, (0.08, 0.12, 0.92, 0.91), "V-groove solid-wire and knurled flux-cored roller sizes and orientation.", ("feed roller", "v groove", "knurled", "wire size", "0.030", "0.035", "0.045"), ("Which feed roller groove should I use?",)),
    Figure("solid-mig-polarity", "Solid-wire MIG DCEP setup", "owner-manual", 14, (0.07, 0.10, 0.93, 0.92), "Manual setup for gas-shielded solid wire: ground negative and wire-feed power positive.", ("mig", "solid wire", "dcep", "gas", "polarity"), ("What polarity does gas-shielded MIG use?",)),
    Figure("mig-duty-cycle", "MIG rated duty cycles", "owner-manual", 23, (0.49, 0.35, 0.91, 0.49), "MIG duty-cycle clocks for 120 V and 240 V input.", ("mig", "duty cycle", "120v", "240v", "200a", "100a"), ("What's the MIG duty cycle at 200 amps on 240 volts?",)),
    Figure("tig-stick-duty-cycle", "TIG and stick rated duty cycles", "owner-manual", 29, (0.06, 0.27, 0.92, 0.43), "Rated weld/rest periods for TIG and stick at both input voltages.", ("tig", "stick", "duty cycle", "120v", "240v", "175a"), ("How long can I weld before resting?",)),
    Figure("wire-weld-diagnosis", "Wire-weld heat and technique diagnosis", "owner-manual", 35, (0.06, 0.10, 0.94, 0.91), "Visual comparison of correct and incorrect wire weld penetration, heat, speed, and CTWD.", ("mig", "flux", "diagnosis", "penetration", "heat", "speed", "ctwd"), ("Why does my MIG bead look wrong?",)),
    Figure("wire-weld-defects-a", "Wire-weld penetration and adhesion defects", "owner-manual", 36, (0.06, 0.10, 0.94, 0.91), "Profile diagrams for penetration, non-adherence, and joint distortion.", ("penetration", "adhesion", "bend", "wire weld", "defect"), ("Why is my weld sitting on the surface?",)),
    Figure("wire-weld-defects-b", "Wire-weld porosity and spatter", "owner-manual", 37, (0.06, 0.10, 0.94, 0.91), "Manual examples and remedies for burn-through, porosity, and excessive spatter.", ("porosity", "holes", "spatter", "burn through", "flux cored", "mig"), ("I'm getting porosity in my flux-cored welds. What should I check?",)),
    Figure("stick-weld-diagnosis", "Stick weld diagnosis", "owner-manual", 38, (0.06, 0.10, 0.94, 0.91), "Visual comparison of stick-weld current, travel speed, and arc-length errors.", ("stick", "diagnosis", "current", "speed", "arc length"), ("How can I read my stick weld bead?",)),
    Figure("stick-weld-defects", "Stick weld defect guide", "owner-manual", 39, (0.06, 0.10, 0.94, 0.91), "Stick-weld penetration, adhesion, and distortion diagrams.", ("stick", "penetration", "adhesion", "defect", "distortion"), ("Why isn't my stick weld penetrating?",)),
    Figure("stick-porosity-spatter", "Stick porosity and spatter guide", "owner-manual", 40, (0.06, 0.10, 0.94, 0.91), "Stick-weld slag, porosity, wavy bead, spatter, and burn-through examples.", ("stick", "slag", "porosity", "spatter", "wavy", "burn through"), ("Are these holes in my stick weld porosity?",)),
    Figure("wiring-schematic", "Wiring schematic", "owner-manual", 45, (0.06, 0.10, 0.94, 0.91), "Owner's-manual electrical schematic. Internal service should be performed by a qualified technician.", ("wiring", "schematic", "pcb", "igbt", "fan", "solenoid"), ("Can I see the wiring schematic?",)),
    Figure("assembly-diagram", "Exploded assembly diagram", "owner-manual", 47, (0.06, 0.10, 0.94, 0.91), "Exploded assembly diagram keyed to the parts list on page 46.", ("parts", "assembly", "exploded", "diagram"), ("Where is this part in the machine?",)),
]


def clean_text(text: str) -> str:
    text = text.replace("\u00ad", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def crop_rect(page: fitz.Page, normalized: tuple[float, float, float, float]) -> fitz.Rect:
    x0, y0, x1, y1 = normalized
    bounds = page.rect
    return fitz.Rect(bounds.x0 + bounds.width * x0, bounds.y0 + bounds.height * y0, bounds.x0 + bounds.width * x1, bounds.y0 + bounds.height * y1)


def main() -> None:
    shutil.rmtree(PAGES, ignore_errors=True)
    shutil.rmtree(FIGURES, ignore_errors=True)
    PAGES.mkdir(parents=True, exist_ok=True)
    FIGURES.mkdir(parents=True, exist_ok=True)

    search_documents: list[dict[str, object]] = []
    documents: dict[str, fitz.Document] = {}

    for source, pdf_path in SOURCES.items():
        document = fitz.open(pdf_path)
        documents[source] = document
        for page_index, page in enumerate(document):
            page_number = page_index + 1
            stem = f"{source}-{page_number:02d}"
            text = clean_text(page.get_text("text"))
            (PAGES / f"{stem}.txt").write_text(text, encoding="utf-8")
            pixmap = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False)
            pixmap.save(PAGES / f"{stem}.png")
            search_documents.append({
                "id": stem,
                "source": source,
                "page": page_number,
                "title": next((section["title"] for section in SECTIONS if section["source"] == source and page_number in section["pages"]), source.replace("-", " ").title()),
                "text": text,
                "image": f"pages/{stem}.png",
            })

    figure_catalog: list[dict[str, object]] = []
    for figure in FIGURE_DEFS:
        page = documents[figure.source][figure.page - 1]
        clip = crop_rect(page, figure.crop)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2.4, 2.4), clip=clip, alpha=False)
        filename = f"{figure.id}.png"
        pixmap.save(FIGURES / filename)
        figure_catalog.append({
            "id": figure.id,
            "title": figure.title,
            "source": figure.source,
            "pages": [figure.page],
            "file": f"figures/{filename}",
            "caption": figure.caption,
            "keywords": list(figure.keywords),
            "answers": list(figure.answers),
        })

    for document in documents.values():
        document.close()

    (KNOWLEDGE / "figures.json").write_text(json.dumps(figure_catalog, indent=2) + "\n", encoding="utf-8")
    (KNOWLEDGE / "search-documents.json").write_text(json.dumps(search_documents, indent=2) + "\n", encoding="utf-8")
    (KNOWLEDGE / "index.json").write_text(json.dumps({"product": "Vulcan OmniPro 220", "item": "57812", "sections": SECTIONS}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(search_documents)} pages and {len(figure_catalog)} figures to {KNOWLEDGE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
