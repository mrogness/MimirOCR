"""Exercise environment selection and failure reporting without downloading ML."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


setup = load_script("setup_backend")
audit = load_script("audit_runtimes")


class EnvironmentToolsTests(unittest.TestCase):
    def test_setup_targets_only_the_selected_managed_environment(self):
        with patch.dict(os.environ, {"UV_PROJECT_ENVIRONMENT": "/unrelated/environment"}), \
                patch.object(setup.subprocess, "run") as run:
            setup.sync_environment("segmenter", dev=True, docs=True)
        args = run.call_args
        command = args.args[0]
        self.assertIn("--locked", command)
        self.assertNotIn("--group", command)
        self.assertNotIn("--frozen", command)
        self.assertEqual(command[command.index("--project") + 1], str(ROOT / "requirements/segmenter"))
        self.assertEqual(args.kwargs["env"]["UV_PROJECT_ENVIRONMENT"], str(ROOT / ".venvs/segmenter"))
        self.assertTrue(args.kwargs["check"])

    def test_backend_tools_are_opt_in_and_can_be_checked_without_mutation(self):
        with patch.object(setup.subprocess, "run") as run:
            setup.sync_environment("backend", dev=True, docs=True, build=True, check=True)
        command = run.call_args.args[0]
        groups = [command[i + 1] for i, value in enumerate(command) if value == "--group"]
        self.assertEqual(groups, ["build", "test", "docs"])
        self.assertIn("--check", command)

    def test_setup_propagates_a_stale_lock_or_install_failure(self):
        with patch.object(setup.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "uv")):
            with self.assertRaises(subprocess.CalledProcessError):
                setup.sync_environment("recognizer")

    def test_inventory_audits_target_packages_and_keeps_tooling_out(self):
        inventory = {"python": "3.10", "packages": [{"name": "Pillow", "version": "12.3.0"}]}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch.dict(os.environ, {"MIMIR_RECOGNIZER_PYTHON": "/custom/python"}), \
                    patch.object(audit.subprocess, "check_output", return_value=json.dumps(inventory)) as read, \
                    patch.object(audit.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "finding")) as run:
                self.assertEqual(audit.audit_environment("recognizer", output), 1)
            self.assertEqual(read.call_args.args[0][0], "/custom/python")
            self.assertEqual((output / "recognizer-installed.txt").read_text(), "Pillow==12.3.0\n")
            command = run.call_args.args[0]
            self.assertEqual(command[:2], ["uvx", "--from"])
            self.assertIn("--no-deps", command)
            self.assertIn("--strict", command)
            self.assertEqual(command[command.index("--vulnerability-service") + 1], "osv")
            self.assertNotIn("--fix", command)
            self.assertEqual((output / "recognizer-audit.log").read_text(), "finding")

    def test_failed_audit_does_not_prevent_the_other_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(sys, "argv", ["audit_runtimes.py", "--output", directory]), \
                    patch.object(audit, "audit_environment", side_effect=[OSError("missing interpreter"), 1, 0]) as run:
                self.assertEqual(audit.main(), 1)
            self.assertEqual([call.args[0] for call in run.call_args_list], list(audit.ROLES))
            summary = json.loads((Path(directory) / "summary.json").read_text())
            self.assertIn("error", summary["backend"])
            self.assertEqual(summary["segmenter"]["exit_code"], 1)
            self.assertEqual(summary["recognizer"]["exit_code"], 0)


if __name__ == "__main__":
    unittest.main()
