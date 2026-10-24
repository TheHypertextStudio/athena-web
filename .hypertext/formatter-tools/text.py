#!/usr/bin/env python3
"""Canonical whitespace for line-oriented HTTP metadata; preserve order and values."""

import sys

source = sys.stdin.buffer.read().decode("utf-8")
if "\x00" in source:
    raise ValueError("Expected UTF-8 HTTP metadata")
# These grammars do not assign meaning to trailing horizontal whitespace.
lines = [line.rstrip(" \t\r") for line in source.split("\n")]
while lines and not lines[-1]:
    lines.pop()
sys.stdout.buffer.write(("\n".join(lines) + "\n").encode())
