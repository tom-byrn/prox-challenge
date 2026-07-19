#!/usr/bin/env python3
"""Compatibility entry point for the generic PDF preparation command."""

from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parents[1] / "ingest" / "prepare-pdf.py"), run_name="__main__")
