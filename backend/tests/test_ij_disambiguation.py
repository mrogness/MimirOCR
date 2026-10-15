import pytest

from backend.workers.recognizer import ij_disambiguation as ij


@pytest.mark.parametrize("text,lexicon,expected", [
    ("Ieg saa Iohan.", {"jeg", "johan"}, "Jeg saa Johan."),
    ("Iord! (Ieg), 123", {"jord", "jeg"}, "Jord! (Jeg), 123"),
    ("Iris", {"iris", "jris"}, "Iris"),  # Ambiguous lexical choices stay unchanged.
    ("Ingen", {"other"}, "Ingen"),
    ("Intet", {"intet"}, "Intet"),
    ("ingen i jeg", {"jngen"}, "ingen i jeg"),
    ("I" * 9, {"j" * 9}, "I" * 9),  # Bound combinatorial work.
    ("", {"jeg"}, ""),
])
def test_disambiguation_changes_only_uniquely_resolved_capital_i(text, lexicon, expected):
    assert ij.disambiguate_ij_text(text, lexicon=lexicon) == expected


def test_lexicon_parsing_is_case_insensitive_cached_and_ignores_comments(tmp_path, monkeypatch):
    lexicon = tmp_path / "lexicon.txt"
    lexicon.write_text("# comment\n\nJeg\nJEG\n Jørgen \n", encoding="utf-8")
    monkeypatch.setattr(ij, "_lexicon_path", lambda: lexicon)
    ij.load_ij_lexicon.cache_clear()
    try:
        assert ij.load_ij_lexicon() == frozenset({"jeg", "jørgen"})
        lexicon.unlink()
        assert ij.disambiguate_ij_text("Iørgen") == "Jørgen"
    finally:
        ij.load_ij_lexicon.cache_clear()


def test_empty_lexicon_reports_a_configuration_error(tmp_path, monkeypatch):
    lexicon = tmp_path / "empty.txt"
    lexicon.write_text("# no entries\n", encoding="utf-8")
    monkeypatch.setattr(ij, "_lexicon_path", lambda: lexicon)
    ij.load_ij_lexicon.cache_clear()
    try:
        with pytest.raises(ValueError, match="empty"):
            ij.load_ij_lexicon()
    finally:
        ij.load_ij_lexicon.cache_clear()
