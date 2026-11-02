#!/usr/bin/env python3
"""Sync independent runtime environments from committed uv lockfiles."""
import argparse
from pathlib import Path
import os
import subprocess
import shutil

ROOT = Path(__file__).resolve().parents[1]
ROLES = ("backend", "segmenter", "recognizer")


def sync_environment(role, *, build=False, dev=False, docs=False, check=False):
    """Sync only this role; uv removes packages outside the selected groups."""
    command = [
        "uv", "sync", "--project", str(ROOT / "requirements" / role),
        "--locked", "--no-default-groups",
    ]
    if build:
        command += ["--group", "build"]
    if dev and role == "backend":
        command += ["--group", "test"]
    if docs and role == "backend":
        command += ["--group", "docs"]
    if check:
        command += ["--check"]
    env = os.environ.copy()
    env["UV_PROJECT_ENVIRONMENT"] = str(ROOT / ".venvs" / role)
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", action="append", choices=ROLES,
                        help="Sync only this role (repeatable; default: all three)")
    parser.add_argument("--build", action="store_true", help="Include PyInstaller and hooks")
    parser.add_argument("--dev", action="store_true", help="Include backend tests")
    parser.add_argument("--docs", action="store_true", help="Include backend documentation tools")
    parser.add_argument("--check", action="store_true", help="Verify without syncing")
    args = parser.parse_args()
    if shutil.which("uv") is None:
        parser.error("Install uv first: python -m pip install uv==0.13.4")
    for role in dict.fromkeys(args.role or ROLES):
        sync_environment(role, build=args.build, dev=args.dev, docs=args.docs, check=args.check)


if __name__ == "__main__":
    main()
