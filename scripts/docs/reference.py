"""Build a source reference in MkDocs' virtual filesystem, never in docs/generated.

Python is parsed by AST/Griffe and frontend sources by JSDoc/vue-docgen. Only the
existing OpenAPI generator imports the API; reference extraction needs no ML
runtime, model files, browser, or application process.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
import subprocess

from scripts.docs.build_info import BuildInfo, build_info

ROOT = Path(__file__).resolve().parents[2]
EXCLUDED = {"tests", "test", "__tests__", "__pycache__", "ml", "resources"}


def python_sources(root: Path) -> list[Path]:
    """Discover production modules without importing any package."""
    return sorted(path for path in (root / "backend").rglob("*.py")
                  if not EXCLUDED.intersection(path.relative_to(root).parts))


def source_label(source: str, line: int, info: BuildInfo) -> str:
    """Keep local source locations useful even when GitHub cannot match them."""
    url = info.source_link(source, line)
    label = f"Source: {source}, line {line}"
    return f"[{label}]({url})" if url else f"{label} (local checkout)"


def cell(value: object) -> str:
    """Keep extracted source text inside a Markdown table cell."""
    return str(value).replace("|", "&#124;").replace("\n", "<br>")


def python_page(path: Path, root: Path, info: BuildInfo | None = None) -> tuple[str, str]:
    """Render an inventory and live mkdocstrings directives for one module."""
    info = info or build_info(root)
    relative = path.relative_to(root)
    module_parts = list(relative.with_suffix("").parts)
    if module_parts[-1] == "__init__":
        module_parts.pop()
    module = ".".join(module_parts)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    symbols = [node for node in tree.body
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
    # Select source-owned names explicitly: do not expand imports or dependency APIs.
    attributes = []
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            attributes.append(node.target.id)
        elif isinstance(node, ast.Assign):
            attributes.extend(target.id for target in node.targets if isinstance(target, ast.Name))
    public = [node.name for node in symbols if not node.name.startswith("_")]
    public += [name for name in attributes if not name.startswith("_")]
    internal = [node.name for node in symbols if node.name.startswith("_")]
    source = relative.as_posix()
    lines = [f"# `{module}`", "", info.markdown(), "", source_label(source, 1, info), ""]
    if not ast.get_docstring(tree):
        lines += ["*Module description has not been written yet.*", ""]
    if symbols:
        lines += ["## Symbol inventory", "", "| Symbol | Kind | Description |",
                  "|---|---|---|"]
        for node in symbols:
            description = ast.get_docstring(node) or "Description not yet written."
            kind = "class" if isinstance(node, ast.ClassDef) else "function"
            lines.append(f"| [`{node.name}`](#{module}.{node.name}) | {kind} | {cell(description.splitlines()[0])} |")
        lines.append("")

    def directive(names: list[str], *, show_root: bool) -> list[str]:
        return [f"::: {module}", "    options:",
                f"      members: {json.dumps(names)}",
                f"      show_root_heading: {str(show_root).lower()}",
                "      show_root_toc_entry: false", ""]

    lines += directive(public, show_root=False)
    if internal:
        lines += ['<details markdown="1">', "<summary>Internal helpers</summary>", ""]
        for name in internal:
            lines += [f"::: {module}.{name}", "    options:",
                      "      show_root_heading: true", "      heading_level: 3", ""]
        lines += ["</details>", ""]
    destination = "backend/" + "/".join(relative.with_suffix("").parts[1:]) + ".md"
    return destination, "\n".join(lines)


def frontend_page(page: dict, info: BuildInfo | None = None) -> tuple[str, str]:
    """Render JSDoc doclets and component contracts in the same searchable site."""
    info = info or build_info(ROOT)
    source = page["source"]
    lines = [f"# `{source}`", "", info.markdown(), "", source_label(source, 1, info), "",
             page["description"] or "*Module description has not been written yet.*", ""]
    component = page.get("component")
    if component is not None:
        for key, title in (("props", "Props"), ("events", "Events"), ("slots", "Slots"), ("methods", "Exposed methods")):
            entries = component[key]
            if not entries:
                continue
            lines += [f"## {title}", "", "| Name | Type | Default / required | Description |", "|---|---|---|---|"]
            for entry in entries:
                default = entry.get("defaultValue", {}).get("value", "")
                if entry.get("required"):
                    default = f"{default} (required)"
                lines.append(f"| `{cell(entry['name'])}` | {cell(entry.get('type', {}).get('name', ''))} | {cell(default)} | {cell(entry.get('description') or 'Description not yet written.')} |")
            lines.append("")
    symbols = page["symbols"]
    if symbols:
        lines += ["## Symbol inventory", "", "| Symbol | Kind | Scope |", "|---|---|---|"]
        for index, symbol in enumerate(symbols):
            lines.append(f"| [`{cell(symbol['name'])}`](#symbol-{index}) | {symbol['kind']} | {'internal' if symbol['internal'] else 'exported / member'} |")
        lines.append("")
    for internal in (False, True):
        selected = [(i, symbol) for i, symbol in enumerate(symbols) if symbol["internal"] == internal]
        if not selected:
            continue
        if internal:
            lines += ['<details markdown="1">', "<summary>Internal helpers and state</summary>", ""]
        for index, symbol in selected:
            lines += [f"### `{symbol['name']}` {{ #symbol-{index} }}", "",
                      source_label(source, symbol['line'], info), ""]
            if symbol["owner"]:
                lines += [f"Declared in: `{symbol['owner']}`", ""]
            if symbol["kind"] == "function":
                params = symbol["parameterNames"] or [param["name"] for param in symbol["params"] if "." not in param["name"]]
                signature = f"{'async ' if symbol['async'] else ''}{symbol['name']}({', '.join(params)})"
                lines += ["```javascript", signature, "```", ""]
            elif symbol["type"]:
                lines += [f"Type: `{', '.join(symbol['type'])}`", ""]
            lines += [symbol["description"] or "*Description not yet written.*", ""]
            if symbol["params"]:
                lines += ["| Parameter | Type | Description |", "|---|---|---|"]
                for param in symbol["params"]:
                    name = param["name"]
                    if param.get("optional"):
                        name += " (optional)"
                    if "defaultvalue" in param:
                        name += f" = {param['defaultvalue']}"
                    lines.append(f"| `{cell(name)}` | {cell(', '.join(param.get('type', {}).get('names', [])))} | {cell(param.get('description', ''))} |")
                lines.append("")
            for result in symbol["returns"]:
                lines += [f"Returns `{', '.join(result.get('type', {}).get('names', []))}`: {result.get('description', '')}", ""]
            for error in symbol.get("exceptions", []):
                lines += [f"Throws `{', '.join(error.get('type', {}).get('names', []))}`: {error.get('description', '')}", ""]
            for example in symbol.get("examples", []):
                lines += ["Example:", "", "```javascript", example, "```", ""]
            if symbol.get("returnedMembers"):
                lines += ["Returned object members: " + ", ".join(f"`{name}`" for name in symbol["returnedMembers"]), ""]
        if internal:
            lines += ["</details>", ""]
    destination = "frontend/" + source.removeprefix("src/") + ".md"
    return destination, "\n".join(lines)


def generate(root: Path = ROOT) -> None:
    """Create virtual pages and navigation afresh on each build or serve reload."""
    import mkdocs_gen_files

    nav = mkdocs_gen_files.Nav()
    nav["Overview"] = "index.md"
    nav["HTTP behavior and errors"] = "http-behavior.md"
    info = build_info(root)
    for page in ("index.md", "reference/index.md"):
        original = (root / "docs" / page).read_text(encoding="utf-8")
        with mkdocs_gen_files.open(page, "w") as output:
            output.write(original + "\n\n---\n\n" + info.markdown() + "\n")
    with mkdocs_gen_files.open("reference/build.json", "w") as output:
        json.dump({"version": info.version, "revision": info.revision, "dirty": info.dirty}, output)
    examples = json.loads((root / "docs/contracts/examples/worker-exchanges.json").read_text(encoding="utf-8"))
    lines = ["# Complete worker exchanges", "",
             "These are illustrative, schema-checked messages, not recorded inference results.",
             "Download [worker-exchanges.json](examples/worker-exchanges.json). Its page paths",
             "must be replaced with absolute paths to real images before sending messages to workers.",
             "Text, geometry, and scores are illustrative. JSON blocks each show one message;",
             "on the wire, encode each as one JSON line and wait for its reply before sending another.", "",
             "| Field | Meaning |", "|---|---|",
             "| `version`, `id` | Protocol version and matching integer request ID |",
             "| `config` | ProjectConfig; DPI is pixels/inch and threshold is a grayscale cutoff |",
             "| `page_number` | Zero-based input PDF page index |",
             "| `width`, `height`, `bbox` | Rasterized page pixel dimensions and line bounds |",
             "| `image_path` | Absolute page image or line-crop path on the shared filesystem |",
             "| `source_order` | One-based line ordering assigned by the segmenter |",
             "| `ocr_text`, confidence fields | Model output and optional line/character scores |",
             "| `correct_text` | Domain correction field; HTTP uses corrected_text instead |", ""]
    for role, exchanges in examples.items():
        lines += [f"## {role.title()}", ""]
        for exchange in exchanges:
            lines += [f"### {exchange['request']['op'].title()}", ""]
            for direction, message in exchange.items():
                lines += [f"**{direction.title()}**", "", "```json",
                          json.dumps(message, indent=2, ensure_ascii=False), "```", ""]
    with mkdocs_gen_files.open("contracts/worker-examples.md", "w") as output:
        output.write("\n".join(lines))
    mkdocs_gen_files.set_edit_path("contracts/worker-examples.md", "docs/contracts/examples/worker-exchanges.json")

    def write(destination: str, content: str, source: str, section: str) -> None:
        with mkdocs_gen_files.open(f"reference/{destination}", "w") as output:
            output.write(content)
        mkdocs_gen_files.set_edit_path(f"reference/{destination}", source)
        parts = Path(destination).parts[1:]
        nav[(section, *parts[:-1], parts[-1].removesuffix(".md"))] = destination

    for path in python_sources(root):
        destination, content = python_page(path, root, info)
        write(destination, content, path.relative_to(root).as_posix(), "Backend")
    result = subprocess.run(["node", str(root / "scripts/docs/frontend.mjs")], cwd=root,
                            capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"Frontend reference extraction failed:\n{result.stderr}")
    for page in json.loads(result.stdout):
        destination, content = frontend_page(page, info)
        write(destination, content, page["source"], "Frontend")
    with mkdocs_gen_files.open("reference/SUMMARY.md", "w") as output:
        output.writelines(nav.build_literate_nav())
