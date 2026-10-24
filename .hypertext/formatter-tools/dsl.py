#!/usr/bin/env python3
"""Pinned Docker/Make/AWK formatters and token-preserving ProGuard whitespace."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = (
    Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache")))
    / "hypertext-formatters/dsl"
)
DOCKER = {
    "darwin-arm64": (
        "dockerfmt-v0.5.4-darwin-arm64.tar.gz",
        "161b00d14c9b8851e601b665412ae2e9229aa2754e329ce632d60df3d0661c9e",
    ),
    "linux-x86_64": (
        "dockerfmt-v0.5.4-linux-amd64.tar.gz",
        "0a0f5eafd81a76c8a5d04be8d9b5a5fc00c0054a0ea5cc0512377c13c86859bc",
    ),
    "linux-arm64": (
        "dockerfmt-v0.5.4-linux-arm64.tar.gz",
        "f8b37047f35a24fe09df7c7341b826acd7f25917f5757fd72c3e8eef17b66e5d",
    ),
}
MBAKE_URL = "https://files.pythonhosted.org/packages/84/83/0ecabd3c6afca46387adf212289867327b77afa973584c3dac9b913aac36/mbake-1.4.6-py3-none-any.whl"
MBAKE_SHA = "8c7055b0961769a53b0e401ea2dee9f9096e63d7f58149bb29d6757fd52dbbf0"
GAWK_SHA = "07f6f7342b7febe4313fc2c2542ad93d64fe20ad8717200109f105a826f5fd37"
TOKENS = re.compile(r""""(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\#[^\n]*|[^\s]+""")


def key():
    machine = {"aarch64": "arm64"}.get(platform.machine(), platform.machine())
    return platform.system().lower() + "-" + machine


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".dsl-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def artifact(path, url, digest, setup=False):
    if not path.is_file():
        if not setup:
            raise ValueError(
                "Formatter is missing; run dsl.py setup-TOOL before committing"
            )
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read(128 * 1024 * 1024 + 1)
        if len(data) > 128 * 1024 * 1024 or sha(data) != digest:
            raise ValueError("Formatter download does not match its reviewed pin")
        write(path, data)
    data = path.read_bytes()
    if sha(data) != digest:
        raise ValueError(
            "Formatter checksum changed; inspect the shared cache and rerun setup"
        )
    return data


def docker(setup=False):
    if key() not in DOCKER:
        raise ValueError(
            "Pinned dockerfmt setup supports Darwin arm64 and Linux arm64/x86_64"
        )
    name, digest = DOCKER[key()]
    directory = CACHE / "dockerfmt/0.5.4" / key()
    archive = artifact(
        directory / name,
        "https://github.com/reteps/dockerfmt/releases/download/v0.5.4/" + name,
        digest,
        setup,
    )
    with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
        member = next(
            m for m in bundle if m.isfile() and Path(m.name).name == "dockerfmt"
        )
        with bundle.extractfile(member) as source:
            expected = source.read()
    binary = directory / "dockerfmt"
    if not binary.is_file():
        if not setup:
            raise ValueError("dockerfmt executable missing; run dsl.py setup-docker")
        write(binary, expected, 0o755)
    if binary.read_bytes() != expected:
        raise ValueError("dockerfmt executable differs from its reviewed archive")
    return binary


def gawk(setup=False):
    directory = CACHE / "gawk/5.4.1"
    archive = artifact(
        directory / "gawk-5.4.1.tar.xz",
        "https://ftp.gnu.org/gnu/gawk/gawk-5.4.1.tar.xz",
        GAWK_SHA,
        setup,
    )
    prefix = directory / key()
    binary, record = prefix / "bin/gawk", prefix / "formatter-build.json"
    if setup and not binary.is_file():
        with tempfile.TemporaryDirectory(prefix="studio-gawk-") as folder:
            build = Path(folder)
            with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
                for member in bundle:
                    relative = Path(member.name)
                    if relative.is_absolute() or ".." in relative.parts:
                        raise ValueError("Unsafe gawk source archive path")
                    if member.isfile():
                        target = build / relative
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with bundle.extractfile(member) as source:
                            target.write_bytes(source.read())
                        target.chmod(member.mode & 0o777)
            source = build / "gawk-5.4.1"
            for command in [
                [
                    str(source / "configure"),
                    "--prefix=" + str(prefix),
                    "--disable-nls",
                    "--without-readline",
                    "--without-mpfr",
                ],
                ["make", "-j2"],
                ["make", "install"],
            ]:
                result = subprocess.run(
                    command, cwd=source, capture_output=True, timeout=180
                )
                if result.returncode:
                    raise ValueError(
                        "Pinned gawk setup build failed: "
                        + result.stderr.decode(errors="replace")[-1500:]
                    )
    if setup:
        version = subprocess.check_output(
            [str(binary), "--version"], text=True
        ).splitlines()[0]
        if not version.startswith("GNU Awk 5.4.1"):
            raise ValueError("Expected GNU Awk 5.4.1")
        if not record.exists():
            write(
                record,
                json.dumps(
                    {
                        "source_sha256": GAWK_SHA,
                        "binary_sha256": sha(binary.read_bytes()),
                    }
                ).encode(),
            )
    if not binary.is_file() or not record.is_file():
        raise ValueError("gawk formatter missing; run dsl.py setup-awk")
    pins = json.loads(record.read_text())
    if pins != {"source_sha256": GAWK_SHA, "binary_sha256": sha(binary.read_bytes())}:
        raise ValueError("gawk binary differs from its pinned-source setup record")
    return binary


def proguard_signature(source):
    """Track every line's lexical text, comments and physical continuation state."""
    source = source.replace("\r\n", "\n")
    return (
        [
            (tuple(TOKENS.findall(line)), line.endswith("\\"))
            for line in source.splitlines()
        ],
        tuple(TOKENS.findall(source.replace("\\\n", ""))),
    )


def proguard(source):
    original = source.replace("\r\n", "\n")
    depth, lines, continued = 0, [], False
    for line in original.splitlines():
        stripped = line.lstrip(" \t")
        # Quoted arguments and comments cannot contribute structural braces.
        code = re.sub(r""""(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\#.*""", "", stripped)
        indentation = max(0, depth - (1 if code.startswith("}") else 0))
        # Trimming space after a backslash would create a continuation that the
        # input did not have. Preserve that tail verbatim instead.
        tail = (
            stripped
            if stripped.rstrip(" \t").endswith("\\")
            else stripped.rstrip(" \t")
        )
        lines.append(
            line if continued else ("    " * indentation + tail if tail else "")
        )
        continued = line.endswith("\\")
        depth += code.count("{") - code.count("}")
        if depth < 0:
            raise ValueError("Unbalanced ProGuard class specification")
    if depth:
        raise ValueError("Unbalanced ProGuard class specification")
    output = "\n".join(lines) + ("\n" if lines else "")
    if proguard_signature(original) != proguard_signature(output):
        raise ValueError(
            "ProGuard formatting would change tokens, comments or continuations"
        )
    return output


def makefile(source, setup=False):
    wheel = CACHE / "mbake/1.4.6/mbake-1.4.6-py3-none-any.whl"
    artifact(wheel, MBAKE_URL, MBAKE_SHA, setup)
    if setup:
        return b""
    # Import only the pure formatter API, never CLI validation or update code.
    # In particular, do not invoke make: $(shell ...) can execute even under -n.
    sys.path.insert(0, str(wheel))
    from mbake.config import Config, FormatterConfig
    from mbake.core.formatter import MakefileFormatter

    configuration = Config(formatter=FormatterConfig(ensure_final_newline=True))
    local = ROOT / ".bake.toml"
    if local.is_file():
        configuration = Config.load(local)
    formatter = MakefileFormatter(configuration)
    lines, errors, warnings = formatter.format_lines(
        source.decode().splitlines(), original_content=source.decode()
    )
    if errors:
        raise ValueError("Makefile formatting failed: " + "; ".join(errors))
    return ("\n".join(lines) + ("\n" if lines else "")).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "tool",
        choices=[
            "docker",
            "make",
            "awk",
            "proguard",
            "setup-docker",
            "setup-make",
            "setup-awk",
        ],
    )
    parser.add_argument("--path", default="input")
    args = parser.parse_args()
    setup = args.tool.startswith("setup-")
    tool = args.tool.removeprefix("setup-")
    if tool == "docker":
        binary = docker(setup)
    elif tool == "awk":
        binary = gawk(setup)
    elif tool == "make":
        output = makefile(b"" if setup else sys.stdin.buffer.read(), setup)
        if not setup:
            sys.stdout.buffer.write(output)
        return 0
    else:
        sys.stdout.buffer.write(proguard(sys.stdin.buffer.read().decode()).encode())
        return 0
    if setup:
        return 0
    command = (
        [str(binary), "--newline"]
        if tool == "docker"
        else [str(binary), "--sandbox", "--pretty-print=-", "-f", "-"]
    )
    return subprocess.call(command, cwd=ROOT)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        OSError,
        ValueError,
        KeyError,
        ImportError,
        StopIteration,
        tarfile.TarError,
        subprocess.SubprocessError,
    ) as error:
        print("DSL formatter blocked: " + str(error), file=sys.stderr)
        raise SystemExit(1)
