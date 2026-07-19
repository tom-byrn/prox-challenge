#!/usr/bin/env python3
"""Compatibility entry point for the generic video preparation command."""

from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parents[1] / "ingest" / "prepare-video.py"), run_name="__main__")
