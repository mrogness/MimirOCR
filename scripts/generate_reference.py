"""MkDocs gen-files entry point; reference output exists only during the build."""
from pathlib import Path
import sys

# MkDocs' console entry point does not put the checkout on sys.path. gen-files
# executes this file with runpy, so anchor imports to its location, not the caller.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.docs.reference import generate

generate()
