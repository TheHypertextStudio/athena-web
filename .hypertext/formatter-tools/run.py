#!/usr/bin/env python3
"""Use the prepared pinned Python formatter with filename/config context."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys

TOOLS = Path(__file__).resolve().parent
runtime = json.loads((TOOLS / "runtime.json").read_text())
spec = json.loads((TOOLS / "tools.json").read_text())
if runtime["spec"] != spec:
    raise SystemExit("Formatter pins changed; rerun hook setup")
if (
    subprocess.check_output([runtime["ruff"], "--version"]).strip()
    != ("ruff " + spec["ruff"]).encode()
):
    raise SystemExit("Pinned Ruff is unavailable; rerun hook setup")
raise SystemExit(
    subprocess.call([runtime["ruff"], "format", "--stdin-filename", sys.argv[1], "-"])
)
