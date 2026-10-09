#!/usr/bin/env python3
"""Create independent development/build environments without changing package pins."""
import argparse
from pathlib import Path
import os
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
ROLES = ("backend", "segmenter", "recognizer")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dev", action="store_true", help="Also install tests in the backend environment")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 10):
        parser.error("Run with Python 3.10 (CI uses 3.10.11); dependency versions are intentionally unchanged")
    for role in ROLES:
        target = ROOT / ".venvs" / role
        venv.EnvBuilder(with_pip=True, symlinks=os.name != "nt").create(target)
        python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        subprocess.run([str(python), "-m", "pip", "install", "-r", f"requirements/{role}.txt",
                        "-r", "requirements/build.txt"], cwd=ROOT, check=True)
        if args.dev and role == "backend":
            subprocess.run([str(python), "-m", "pip", "install", "-r", "requirements-test.txt"],
                           cwd=ROOT, check=True)
        subprocess.run([str(python), "-m", "pip", "check"], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
