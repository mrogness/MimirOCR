#!/usr/bin/env python3
"""Inventory and audit installed runtimes without installing audit tools in them."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ROLES = ("backend", "segmenter", "recognizer")
AUDITOR = "pip-audit==2.9.0"

INVENTORY_CODE = """
import importlib.metadata as metadata
import json
import platform
import sys
packages = sorted(
    ({'name': item.metadata['Name'], 'version': item.version}
     for item in metadata.distributions()), key=lambda item: item['name'].lower())
print(json.dumps({'python': sys.version, 'executable': sys.executable,
                  'platform': platform.platform(), 'packages': packages}))
"""


def audit_environment(role, output):
    key = "MIMIR_PYTHON" if role == "backend" else f"MIMIR_{role.upper()}_PYTHON"
    relative = "Scripts/python.exe" if os.name == "nt" else "bin/python"
    python = os.environ.get(key) or str(ROOT / ".venvs" / role / relative)
    inventory = json.loads(subprocess.check_output([python, "-c", INVENTORY_CODE], text=True))
    inventory["role"] = role
    (output / f"{role}-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    requirements = output / f"{role}-installed.txt"
    requirements.write_text("".join(f"{p['name']}=={p['version']}\n" for p in inventory["packages"]), encoding="utf-8")
    result = subprocess.run([
        "uvx", "--from", AUDITOR, "pip-audit", "--requirement", str(requirements),
        "--no-deps", "--disable-pip", "--strict", "--progress-spinner", "off",
        "--format", "json", "--output", str(output / f"{role}-audit.json"),
    ], cwd=ROOT, capture_output=True, text=True)
    (output / f"{role}-audit.log").write_text(result.stdout + result.stderr, encoding="utf-8")
    print(f"{role}: audit exit code {result.returncode}; reports in {output}", flush=True)
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", action="append", choices=ROLES)
    parser.add_argument("--output", type=Path, default=ROOT / "test-results" / "dependencies")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    failed = False
    summary = {}
    for role in dict.fromkeys(args.role or ROLES):
        try:
            code = audit_environment(role, args.output)
            summary[role] = {"exit_code": code}
            failed |= code != 0
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            summary[role] = {"error": str(exc)}
            print(f"{role}: {exc}", file=sys.stderr)
            failed = True
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
