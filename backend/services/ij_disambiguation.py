import re
import sys
from functools import lru_cache
from itertools import product
from pathlib import Path
from typing import Collection


LEXICON_FILENAME = "fraktur_ij_lexicon.txt"
MAX_AMBIGUOUS_GLYPHS_PER_WORD = 8
_WORD_PATTERN = re.compile(r"[^\W\d_]+", re.UNICODE)


def _lexicon_path() -> Path:
    relative_path = Path("backend") / "resources" / LEXICON_FILENAME
    candidates: list[Path] = []

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / relative_path)

    candidates.append(Path(__file__).resolve().parents[1] / "resources" / LEXICON_FILENAME)

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    checked = ", ".join(str(candidate) for candidate in candidates)
    raise FileNotFoundError(f"Bundled Fraktur I/J lexicon was not found. Checked: {checked}")


@lru_cache(maxsize=1)
def load_ij_lexicon() -> frozenset[str]:
    words: set[str] = set()
    with _lexicon_path().open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            word = raw_line.strip()
            if not word or word.startswith("#"):
                continue
            words.add(word.casefold())

    if not words:
        raise ValueError("Bundled Fraktur I/J lexicon is empty")
    return frozenset(words)


def _resolve_word(word: str, lexicon: Collection[str]) -> str:
    ambiguous_indexes = [index for index, char in enumerate(word) if char == "I"]
    if not ambiguous_indexes or len(ambiguous_indexes) > MAX_AMBIGUOUS_GLYPHS_PER_WORD:
        return word

    matched_candidate: str | None = None
    for replacements in product(("I", "J"), repeat=len(ambiguous_indexes)):
        chars = list(word)
        for index, replacement in zip(ambiguous_indexes, replacements):
            chars[index] = replacement
        candidate = "".join(chars)

        if candidate.casefold() not in lexicon:
            continue
        if matched_candidate is not None:
            # More than one lexical spelling is valid, so the image alone is
            # insufficient to choose safely.
            return word
        matched_candidate = candidate

    return matched_candidate or word


def disambiguate_ij_text(
    text: str,
    *,
    lexicon: Collection[str] | None = None,
) -> str:
    if not text or "I" not in text:
        return text

    active_lexicon = lexicon if lexicon is not None else load_ij_lexicon()
    return _WORD_PATTERN.sub(
        lambda match: _resolve_word(match.group(0), active_lexicon),
        text,
    )
