"""Real staged-input formatter acceptance; no build programs may execute."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).with_name("dsl.py")
ROOT = HELPER.parents[2]
RULES = json.loads(HELPER.with_name("dsl-rules.json").read_text())["rules"]
SAMPLES = {
    "docker": b"FROM    alpine:3.22\nRUN echo hello\n",
    "make": b"VALUE:=test\nall: target\n\t@echo $(VALUE)\n",
    "proguard": b"-keep class Example {   \n public void hello();   \n}\n",
    "awk": b"BEGIN{ x=1; print x }\n",
}


class DSLFormatterTests(unittest.TestCase):
    def test_real_stdin_idempotence_and_source_preservation(self):
        for rule in RULES:
            tool = rule["argv"][-3]
            with self.subTest(tool=tool), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "source"
                path.write_bytes(b"private working draft\n")
                command = [sys.executable, str(HELPER), tool, "--path", str(path)]
                first = subprocess.run(
                    command, input=SAMPLES[tool], capture_output=True, cwd=ROOT
                )
                self.assertEqual(first.returncode, 0, first.stderr.decode())
                self.assertNotEqual(first.stdout, SAMPLES[tool])
                second = subprocess.run(
                    command, input=first.stdout, capture_output=True, cwd=ROOT
                )
                self.assertEqual(second.returncode, 0, second.stderr.decode())
                self.assertEqual(first.stdout, second.stdout)
                self.assertEqual(path.read_bytes(), b"private working draft\n")

    def test_missing_native_cache_does_not_install(self):
        for rule in RULES:
            tool = rule["argv"][-3]
            if tool == "proguard":
                continue
            with self.subTest(tool=tool), tempfile.TemporaryDirectory() as directory:
                result = subprocess.run(
                    [sys.executable, str(HELPER), tool],
                    env=dict(os.environ, XDG_CACHE_HOME=directory),
                    input=SAMPLES[tool],
                    capture_output=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, b"")
                self.assertIn(b"setup", result.stderr.lower())
                self.assertEqual(list(Path(directory).iterdir()), [])

    def test_proguard_tokens_continuations_comments_are_preserved(self):
        if not any(r["argv"][-3] == "proguard" for r in RULES):
            return
        spec = importlib.util.spec_from_file_location("dsl_under_test", HELPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = '-keep class Sample {\n  public java.lang.String text; # preserve comment\n}\n-keepattributes Signature, \\\n  InnerClasses\n-injars "path with spaces.jar"\n'
        output = module.proguard(source)
        self.assertEqual(
            module.proguard_signature(source), module.proguard_signature(output)
        )
        self.assertIn("    public java.lang.String text; # preserve comment", output)
        self.assertEqual(output, module.proguard(output))
        self.assertIn("  InnerClasses", output)

    def test_formatter_never_executes_make_or_awk_program(self):
        for rule in RULES:
            tool = rule["argv"][-3]
            if tool not in {"make", "awk"}:
                continue
            with tempfile.TemporaryDirectory() as directory:
                marker = Path(directory) / "must-not-exist"
                source = (
                    (
                        "MARKER := $(shell touch "
                        + str(marker)
                        + ")\nall:\n\ttouch "
                        + str(marker)
                        + "\n"
                    )
                    if tool == "make"
                    else ('BEGIN { system("touch ' + str(marker) + '") }\n')
                )
                result = subprocess.run(
                    [sys.executable, str(HELPER), tool],
                    input=source.encode(),
                    capture_output=True,
                    cwd=ROOT,
                )
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
