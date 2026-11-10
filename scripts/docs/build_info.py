"""Identify the source used to build documentation without guessing a branch."""
from dataclasses import dataclass
import json
from pathlib import Path
import subprocess


@dataclass(frozen=True)
class BuildInfo:
    """Application version, checkout commit, and local modification status."""

    version: str = "unknown"
    revision: str | None = None
    dirty: bool = True

    def source_link(self, source: str, line: int = 1) -> str:
        """Link only clean, identifiable source; local line numbers may differ."""
        if self.revision and not self.dirty:
            return f"https://github.com/mrogness/MimirOCR/blob/{self.revision}/{source}#L{line}"
        return ""

    def markdown(self) -> str:
        """Render deterministic provenance and explain unavailable source links."""
        revision = f"`{self.revision}`" if self.revision else "unavailable (no Git metadata)"
        lines = [f"**Documentation build:** MimirOCR `{self.version}` · revision {revision}."]
        if self.dirty:
            lines.append("This checkout has local changes or cannot be verified as clean. "
                         "GitHub source links are disabled because its code and line numbers may differ.")
        return "\n\n".join(lines)


def build_info(root: Path) -> BuildInfo:
    """Read the actual checkout rather than assuming main or a release tag."""
    try:
        version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        version = "unknown"
    try:
        revision = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL,
        ).strip()
        status = subprocess.check_output(
            ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=normal"],
            text=True, stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        return BuildInfo(version=version)
    return BuildInfo(version=version, revision=revision, dirty=bool(status.strip()))
