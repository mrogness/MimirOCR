"""Regression checks for source-only discovery and reference rendering."""
import ast
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.docs.reference import frontend_page, python_page, python_sources
from scripts.docs.build_info import BuildInfo, build_info
from scripts.docs.openapi import render_openapi


class ReferenceTests(unittest.TestCase):
    def test_production_python_modules_and_named_interfaces_have_docstrings(self):
        root = Path(__file__).resolve().parents[2]
        missing = []
        for path in python_sources(root):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            if not ast.get_docstring(tree):
                missing.append(f"{path.relative_to(root)}: module")
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    if not ast.get_docstring(node):
                        missing.append(f"{path.relative_to(root)}:{node.lineno}: {node.name}")
        self.assertEqual(missing, [], "Missing source descriptions:\n" + "\n".join(missing))

    def test_python_discovery_and_rename_exclude_tests_and_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("backend/first.py", "backend/tests/hidden.py", "backend/ml/model.py"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("")
            self.assertEqual(python_sources(root), [root / "backend/first.py"])
            (root / "backend/first.py").rename(root / "backend/renamed.py")
            self.assertEqual(python_sources(root), [root / "backend/renamed.py"])

    def test_python_inventory_does_not_execute_imports_or_hide_undocumented_symbols(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "backend/example.py"
            path.parent.mkdir()
            path.write_text('raise RuntimeError("must never execute")\n'
                            'def public(value): return value\n'
                            'def _helper(): pass\n'
                            'class Reader:\n    def read(self): pass\n')
            destination, content = python_page(path, root)
            self.assertEqual(destination, "backend/example.md")
            self.assertIn("backend.example.public", content)
            self.assertIn("backend.example.Reader", content)
            self.assertIn("Description not yet written", content)
            self.assertIn("Internal helpers", content)
            self.assertIn('::: backend.example._helper', content)

    def test_vue_empty_component_and_internal_helpers_are_still_browsable(self):
        destination, content = frontend_page({
            "source": "src/Empty.vue", "description": "",
            "component": {"props": [], "events": [], "slots": [], "methods": []},
            "symbols": [{"name": "helper", "owner": "component", "kind": "function",
                         "line": 4, "internal": True, "description": "",
                         "parameterNames": ["value"], "params": [], "returns": [],
                         "type": [], "async": False}],
        }, BuildInfo(version="2.0.2", revision="a" * 40, dirty=False))
        self.assertEqual(destination, "frontend/Empty.vue.md")
        self.assertIn("helper(value)", content)
        self.assertIn("#L4", content)
        self.assertIn("#symbol-0", content)

    def test_source_links_pin_clean_revision_and_disable_dirty_or_unknown_links(self):
        clean = BuildInfo(version="2.0.2", revision="a" * 40, dirty=False)
        self.assertIn("/blob/" + "a" * 40 + "/src/example.js#L7", clean.source_link("src/example.js", 7))
        self.assertNotIn("/main/", clean.source_link("src/example.js"))
        self.assertEqual(BuildInfo(revision="a" * 40).source_link("src/example.js"), "")
        self.assertEqual(BuildInfo().source_link("src/example.js"), "")

    def test_build_info_reads_checkout_status_and_handles_source_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text('{"version":"2.0.2"}')
            with patch("scripts.docs.build_info.subprocess.check_output", side_effect=["a" * 40, " M src/example.js\n"]):
                info = build_info(root)
            self.assertEqual(info.version, "2.0.2")
            self.assertTrue(info.dirty)
            with patch("scripts.docs.build_info.subprocess.check_output", side_effect=FileNotFoundError):
                info = build_info(root)
            self.assertIsNone(info.revision)
            self.assertIn("no Git metadata", info.markdown())

    def test_openapi_renders_nullable_references_uploads_constraints_and_errors(self):
        schema = {
            "paths": {"/examples/{id}": {"parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "integer"}}],
                "post": {"description": "Create an example.",
                    "requestBody": {"required": True, "content": {"multipart/form-data": {"schema": {"$ref": "#/components/schemas/Example"}}}},
                    "responses": {"201": {"description": "Created", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Example"}}}},
                                  "422": {"description": "Invalid | input"}, "204": {"description": "No content"}}}}},
            "components": {"schemas": {"Example": {"type": "object", "required": ["count"], "properties": {
                "count": {"type": "integer", "minimum": 1, "default": 3},
                "label": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "items": {"type": "array", "items": {"$ref": "#/components/schemas/Example"}},
                "file": {"type": "string", "format": "binary"}}}}},
        }
        content = render_openapi(schema)
        for expected in ("Create an example.", "multipart/form-data", "#schema-example", "`string` or `null`",
                         "minimum: `1`", "default: `3`", "binary", "Invalid &#124; input", "| 204 |", "array of"):
            self.assertIn(expected, content)
        self.assertIn("| `count` | True |", content)
        self.assertIn("| `label` | False |", content)

    def test_frontend_renders_examples_and_rejection_contracts(self):
        _, content = frontend_page({"source": "src/example.js", "description": "Example.", "symbols": [{
            "name": "save", "owner": None, "kind": "function", "line": 1, "internal": False,
            "description": "Save changes.", "parameterNames": [], "params": [], "type": [], "async": True,
            "returns": [{"type": {"names": ["Promise.<void>"]}, "description": "Saved."}],
            "exceptions": [{"type": {"names": ["Error"]}, "description": "Save failed."}],
            "examples": ["await save()"],
        }]}, BuildInfo())
        self.assertIn("```javascript\nawait save()\n```", content)
        self.assertIn("Throws `Error`: Save failed.", content)
        self.assertIn("(local checkout)", content)
        self.assertNotIn("/blob/main/", content)


if __name__ == "__main__":
    unittest.main()
