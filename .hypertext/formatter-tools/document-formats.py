#!/usr/bin/env python3
"""Additional pinned stdin formatters; explicit setup is the only network operation."""

import base64
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
    Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    / "hypertext-formatters/extras"
)
PINS = {
    "pbxproj": (
        "nanaimo-0.4.0.gem",
        "https://rubygems.org/downloads/nanaimo-0.4.0.gem",
        "faf069551bab17f15169c1f74a1c73c220657e71b6e900919897a10d991d0723",
    ),
    "mermaid": (
        "mermaid-formatter-0.3.0.tgz",
        "https://registry.npmjs.org/mermaid-formatter/-/mermaid-formatter-0.3.0.tgz",
        "sha512:PrIZBNt0Aba9/w14GQUWDKLHy1skO+AwuRWHtIBR8duk9460LM0/djX+yj8KUU4Jh6P42lvs1Te2jSxC6tIQig==",
    ),
}
RUBY = {
    ("Darwin", "arm64"): (
        "Darwin-arm64",
        "dcd4a504d78bcb9e18e0b07976790159bfb2d035162aaf3b6c2d2883da1dca38",
    ),
    ("Linux", "aarch64"): (
        "Linux-aarch64",
        "fc429195d1315bb96b25beb6898bf2bec749e3f8d3c9b8dbb3be37c25752c3bd",
    ),
    ("Linux", "x86_64"): (
        "Linux-x86_64",
        "9590cc3b8b2ed37a250a5f7c22a542ce014f13954f613c93a72230de8a74fbbd",
    ),
}
JUST = {
    ("Darwin", "arm64"): (
        "aarch64-apple-darwin",
        "6574cea774ed4cae12e24b6aa11857de33e80dab4667cf628fd5840df96a2a9d",
    ),
    ("Darwin", "x86_64"): (
        "x86_64-apple-darwin",
        "036ead9df9bc31dbae9934ae3b4236ed124d0bafcffd33439460ae084d5c9cb7",
    ),
    ("Linux", "aarch64"): (
        "aarch64-unknown-linux-musl",
        "23871b1702bfd550fb5f901778fd4290ecf2ee034a45a889fbe96d89b188086d",
    ),
    ("Linux", "x86_64"): (
        "x86_64-unknown-linux-musl",
        "409044617b6f06517c1035e55ca38c8c856ff8b650e41bc2aa1ef82d5903a23e",
    ),
}


def pin(tool):
    if tool in PINS:
        return PINS[tool]
    target = (platform.system(), platform.machine())
    if tool == "ruby":
        suffix, digest = RUBY[target]
        name = f"rubyfmt-v0.14.1-{suffix}.tar.gz"
        return (
            name,
            "https://github.com/fables-tales/rubyfmt/releases/download/v0.14.1/" + name,
            digest,
        )
    suffix, digest = JUST[target]
    name = f"just-1.59.0-{suffix}.tar.gz"
    return (
        name,
        "https://github.com/casey/just/releases/download/1.59.0/" + name,
        digest,
    )


def verified(data, digest):
    actual = (
        base64.b64encode(hashlib.sha512(data).digest()).decode()
        if digest.startswith("sha512:")
        else hashlib.sha256(data).hexdigest()
    )
    expected = digest.removeprefix("sha512:")
    if actual != expected:
        raise ValueError("formatter archive checksum mismatch")
    return data


def archive_bytes(tool, setup=False):
    name, url, digest = pin(tool)
    path = CACHE / name
    if setup and not path.exists():
        with urllib.request.urlopen(url, timeout=120) as response:
            data = verified(response.read(), digest)
        CACHE.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=CACHE, delete=False) as output:
            output.write(data)
            temporary = output.name
        os.replace(temporary, path)
    if not path.exists():
        raise ValueError(f"formatter unavailable; run extras.py setup-{tool}")
    return verified(path.read_bytes(), digest)


def extract(data, destination):
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive:
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("unsafe formatter archive path")
            if member.isfile():
                target = destination / path
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source:
                    target.write_bytes(source.read())
                target.chmod(member.mode & 0o777)


def command(argv, source=None, cwd=ROOT, env=None):
    result = subprocess.run(argv, input=source, capture_output=True, cwd=cwd, env=env)
    if result.returncode:
        raise ValueError(
            result.stderr.decode(errors="replace")
            or result.stdout.decode(errors="replace")
        )
    return result.stdout


def xcconfig_format(source):
    # xcconfig values are opaque build-setting expressions. Normalize only the
    # separator around an assignment outside directives, comments and continued
    # values; never tokenize or rewrite the value expression itself.
    lines = source.decode("utf-8").splitlines()
    output = []
    continued = False
    block = False
    for line in lines:
        stripped = line.lstrip()
        continuation = bool(re.search(r"\\[ \t]*$", line))
        preserve = (
            continued or continuation or block or stripped.startswith(("#", "//", "/*"))
        )
        if not preserve:
            match = re.fullmatch(
                r"([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]\r\n]*\])*)[ \t]*(\+=|\?=|=)[ \t]*(.*)",
                stripped,
            )
            if match:
                line = match[1] + " " + match[2] + " " + match[3]
            elif not stripped:
                line = ""
        output.append(line)
        # Track block comments while preserving quoted literals and // comments.
        index = 0
        quote = None
        while index < len(line):
            pair = line[index : index + 2]
            char = line[index]
            if block:
                if pair == "*/":
                    block = False
                    index += 2
                    continue
            elif quote:
                if char == "\\":
                    index += 2
                    continue
                if char == quote:
                    quote = None
            elif pair == "//":
                break
            elif pair == "/*":
                block = True
                index += 2
                continue
            elif char in ['"', "'"]:
                quote = char
            index += 1
        continued = continuation
    return ("\n".join(output) + ("\n" if output else "")).encode("utf-8")


def main():
    tool = sys.argv[1]
    setup = tool.startswith("setup-")
    tool = tool.removeprefix("setup-")
    if tool == "xcconfig":
        if not setup:
            sys.stdout.buffer.write(xcconfig_format(sys.stdin.buffer.read()))
        return
    if tool == "csharp":
        with tempfile.TemporaryDirectory() as folder:
            temporary = Path(folder)
            # SDK selection is exact and never rolls forward or installs on commit.
            (temporary / "global.json").write_text(
                json.dumps({"sdk": {"version": "10.0.402", "rollForward": "disable"}})
            )
            env = {
                **os.environ,
                "DOTNET_NOLOGO": "1",
                "DOTNET_SKIP_FIRST_TIME_EXPERIENCE": "1",
                "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
                "DOTNET_GENERATE_ASPNET_CERTIFICATE": "false",
            }
            version = command(["dotnet", "--version"], cwd=temporary, env=env).strip()
            if version != b"10.0.402":
                raise ValueError("Install .NET SDK10.0.402 before formatter setup")
            if setup:
                return
            path = temporary / "Input.cs"
            path.write_bytes(sys.stdin.buffer.read())
            command(
                [
                    "dotnet",
                    "format",
                    "whitespace",
                    str(temporary),
                    "--folder",
                    "--include",
                    "Input.cs",
                    "--verbosity",
                    "quiet",
                ],
                cwd=temporary,
                env=env,
            )
            sys.stdout.buffer.write(path.read_bytes())
        return
    data = archive_bytes(tool, setup)
    if setup:
        return
    source = sys.stdin.buffer.read()
    with tempfile.TemporaryDirectory() as folder:
        temporary = Path(folder)
        if tool == "pbxproj":
            with tarfile.open(fileobj=io.BytesIO(data)) as gem:
                with gem.extractfile("data.tar.gz") as package:
                    extract(package.read(), temporary)
            script = "print Nanaimo::Writer::PBXProjWriter.new(Nanaimo::Reader.new(STDIN.read).parse!).write"
            output = command(
                ["ruby", "-I" + str(temporary / "lib"), "-rnanaimo", "-e", script],
                source,
            )
            # Verify the complete OpenStep data tree is unchanged by formatting.
            before = command(
                ["/usr/bin/plutil", "-convert", "json", "-o", "-", "--", "-"], source
            )
            after = command(
                ["/usr/bin/plutil", "-convert", "json", "-o", "-", "--", "-"], output
            )
            if json.loads(before) != json.loads(after):
                raise ValueError("pbxproj formatter changed project data")
        else:
            extract(data, temporary)
            if tool == "ruby":
                output = command([str(next(temporary.rglob("rubyfmt")))], source)
            elif tool == "mermaid":
                output = command(
                    ["node", str(temporary / "package/dist/cli.js")], source
                )
            else:
                path = temporary / "justfile"
                path.write_bytes(source)
                command(
                    [
                        str(temporary / "just"),
                        "--unstable",
                        "--justfile",
                        str(path),
                        "--fmt",
                    ],
                    cwd=temporary,
                )
                output = path.read_bytes()
        sys.stdout.buffer.write(output)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        print(f"format: {error}", file=sys.stderr)
        sys.exit(1)
