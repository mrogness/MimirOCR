#!/usr/bin/env python3
"""Generate contributor-facing derived documentation.

Outputs:
- docs/generated/backend-openapi.json
- docs/generated/backend-openapi.md
- docs/generated/test-inventory.md
"""

from __future__ import annotations

from collections import defaultdict
import json
import os
from pathlib import Path
import re
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
DOCS_GENERATED = ROOT / "docs" / "generated"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _ensure_dirs() -> None:
    DOCS_GENERATED.mkdir(parents=True, exist_ok=True)


def _generate_openapi_docs() -> None:
    with tempfile.TemporaryDirectory(prefix="mimir-docs-runtime-") as tmp:
        tmp_path = Path(tmp)
        os.environ.setdefault("MIMIR_APP_DATA_DIR", str(tmp_path / "data"))
        os.environ.setdefault("MIMIR_CACHE_DIR", str(tmp_path / "cache"))
        os.environ.setdefault("MIMIR_TEMP_DIR", str(tmp_path / "temp"))

        from backend.main import app  # Imported after runtime env setup.

        schema = app.openapi()

    json_path = DOCS_GENERATED / "backend-openapi.json"
    json_path.write_text(json.dumps(schema, indent=2, sort_keys=True), encoding="utf-8")

    rows: list[tuple[str, str, str, str]] = []
    for path, methods in schema.get("paths", {}).items():
        for method, operation in methods.items():
            if method.startswith("x-"):
                continue
            summary = operation.get("summary") or operation.get("operationId") or ""
            tags = ", ".join(operation.get("tags", []))
            rows.append((method.upper(), path, summary, tags))

    rows.sort(key=lambda item: (item[1], item[0]))

    md_lines = [
        "# Backend OpenAPI Summary",
        "",
        "Generated from current backend routes.",
        "",
        "| Method | Path | Summary | Tags |",
        "|---|---|---|---|",
    ]
    for method, path, summary, tags in rows:
        md_lines.append(f"| {method} | {path} | {summary} | {tags} |")

    md_lines.extend(
        [
            "",
            "Raw schema: [backend-openapi.json](backend-openapi.json)",
        ]
    )

    (DOCS_GENERATED / "backend-openapi.md").write_text("\n".join(md_lines) + "\n", encoding="utf-8")


def _count_pytest_tests(file_path: Path) -> int:
    text = file_path.read_text(encoding="utf-8")
    return len(re.findall(r"^\s*def\s+test_", text, flags=re.MULTILINE))


def _count_vitest_tests(file_path: Path) -> int:
    text = file_path.read_text(encoding="utf-8")
    return len(re.findall(r"\b(it|test)\s*\(", text))


def _count_rust_tests(file_path: Path) -> int:
    text = file_path.read_text(encoding="utf-8")
    return len(re.findall(r"#\s*\[\s*test\s*\]", text))


def _generate_test_inventory() -> None:
    backend_files = sorted((ROOT / "backend" / "tests").glob("test_*.py"))
    frontend_files = sorted((ROOT / "src").glob("**/__tests__/*.spec.js"))
    rust_files = sorted((ROOT / "src-tauri" / "src").glob("**/*.rs"))

    backend_total = sum(_count_pytest_tests(path) for path in backend_files)
    frontend_total = sum(_count_vitest_tests(path) for path in frontend_files)
    rust_total = sum(_count_rust_tests(path) for path in rust_files)

    backend_by_file = [(path, _count_pytest_tests(path)) for path in backend_files]
    frontend_by_file = [(path, _count_vitest_tests(path)) for path in frontend_files]

    backend_by_area: dict[str, int] = defaultdict(int)
    for path, count in backend_by_file:
        if "worker" in path.name or "pipeline" in path.name:
            backend_by_area["workers and pipeline"] += count
        elif "export" in path.name or "reflow" in path.name:
            backend_by_area["exports"] += count
        elif "ocr" in path.name:
            backend_by_area["ocr and orchestration"] += count
        elif "runtime" in path.name:
            backend_by_area["runtime and restart"] += count
        elif "line" in path.name:
            backend_by_area["line routes and CRUD"] += count
        else:
            backend_by_area["other"] += count

    lines = [
        "# Test Inventory",
        "",
        "Generated from current test files.",
        "",
        "## Summary",
        "",
        "| Layer | Files | Approx test count |",
        "|---|---:|---:|",
        f"| Backend pytest | {len(backend_files)} | {backend_total} |",
        f"| Frontend vitest | {len(frontend_files)} | {frontend_total} |",
        f"| Rust unit tests | {len(rust_files)} | {rust_total} |",
        "",
        "## Backend by area",
        "",
        "| Area | Approx test count |",
        "|---|---:|",
    ]

    for area in sorted(backend_by_area):
        lines.append(f"| {area} | {backend_by_area[area]} |")

    lines.extend(
        [
            "",
            "## Backend files",
            "",
            "| File | Approx test count |",
            "|---|---:|",
        ]
    )
    for path, count in backend_by_file:
        rel = path.relative_to(ROOT)
        lines.append(f"| {rel.as_posix()} | {count} |")

    lines.extend(
        [
            "",
            "## Frontend files",
            "",
            "| File | Approx test count |",
            "|---|---:|",
        ]
    )
    for path, count in frontend_by_file:
        rel = path.relative_to(ROOT)
        lines.append(f"| {rel.as_posix()} | {count} |")

    (DOCS_GENERATED / "test-inventory.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    _ensure_dirs()
    _generate_openapi_docs()
    _generate_test_inventory()
    print("Generated docs in docs/generated")


if __name__ == "__main__":
    main()
