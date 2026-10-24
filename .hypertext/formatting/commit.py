#!/usr/bin/env python3
"""Run the locked shared staged-blob formatter, independently of commit scopes."""

import os
import sys

if not sys.flags.isolated or not sys.flags.no_site:
    os.execv(
        sys.executable, [sys.executable, "-I", "-S", "-B", __file__, *sys.argv[1:]]
    )

import hashlib
import json
from pathlib import Path
import types

root = Path(__file__).resolve().parent
repo = root.parents[1]
try:
    expected = ("__init__", "gate", "runner", "setup_files", "formatting", "git_policy")
    lock = json.loads((root / "LOCK.json").read_text())
    if set(lock) != {name + ".py" for name in expected}:
        raise ValueError("Invalid formatter engine lock")
    sources = {}
    for name in expected:
        path = root / "core" / (name + ".py")
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError("Unsafe formatter engine lock input")
        sources[name] = path.read_bytes()
        if hashlib.sha256(sources[name]).hexdigest() != lock[name + ".py"]:
            raise ValueError("Formatter engine lock mismatch: " + name)
    package = types.ModuleType("core")
    package.__path__ = []
    sys.modules["core"] = package
    for name in expected:
        module = package if name == "__init__" else types.ModuleType("core." + name)
        module.__file__ = str(root / "core" / (name + ".py"))
        module.__package__ = "core"
        if name != "__init__":
            sys.modules[module.__name__] = module
            setattr(package, name, module)
        exec(compile(sources[name], module.__file__, "exec"), module.__dict__)
    changed = package.formatting.format_staged(repo)
    if changed:
        print("Automatically formatted " + str(len(changed)) + " staged file(s).")
except Exception as error:
    print("Commit formatting blocked: " + str(error), file=sys.stderr)
    raise SystemExit(1)
