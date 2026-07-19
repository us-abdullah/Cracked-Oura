"""Offline unit checks for supplement sheet consensus (no network)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.src.health.sheets_sync import (  # noqa: E402
    _normalize_sheet_rows,
    _pick_winning_snapshot,
    _rows_fingerprint,
    parse_csv_rows,
)


def _row(date: str, creatine: str, notes: str = "", **extra) -> dict:
    base = {
        "Date": date,
        "Day": "Monday",
        "Creatine": creatine,
        "Omega3": "TRUE",
        "Multivitamin": "TRUE",
        "D3K2": "TRUE",
        "Taurine": "TRUE",
        "Magnesium Glycinate": "TRUE",
        "Glycine": "TRUE",
        "Ashwagandha KSM66": "TRUE",
        "L-Theanine": "TRUE",
        "Apigenin": "TRUE",
        "Caffeine": "FALSE",
        "L-Citrulline": "FALSE",
        "NAC": "FALSE",
        "Beta-Alanine": "FALSE",
        "Lion's Mane": "FALSE",
        "Collagen Peptides": "FALSE",
        "Astaxanthin": "FALSE",
        "Notes": notes,
    }
    base.update(extra)
    return base


def test_uncheck_wins_over_stale_true():
    stale = [_row("2026-07-17", "TRUE", "old long note that should not stick forever")]
    fresh = [_row("2026-07-17", "FALSE", "short")]
    # Recent window is second half: stale,stale,fresh,fresh,fresh → fresh wins
    samples = [stale, stale, fresh, fresh, fresh]
    out = _pick_winning_snapshot(samples, force=True)
    assert len(out) == 1
    assert out[0]["Creatine"] == "FALSE"
    assert out[0]["Notes"] == "short"


def test_deleted_row_removed():
    fat = [_row("2026-07-16", "TRUE"), _row("2026-07-17", "TRUE")]
    thin = [_row("2026-07-16", "TRUE")]  # 17 deleted
    samples = [fat, fat, thin, thin, thin, thin]
    out = _pick_winning_snapshot(samples, force=True)
    dates = {r["Date"] for r in out}
    assert dates == {"2026-07-16"}


def test_new_row_appears():
    old = [_row("2026-07-16", "TRUE")]
    neu = [_row("2026-07-16", "TRUE"), _row("2026-07-18", "TRUE", "new day")]
    samples = [old, old, neu, neu, neu]
    out = _pick_winning_snapshot(samples, force=True)
    dates = {r["Date"] for r in out}
    assert "2026-07-18" in dates
    assert next(r for r in out if r["Date"] == "2026-07-18")["Notes"] == "new day"


def test_note_clear():
    with_note = [_row("2026-07-17", "TRUE", "had a note")]
    cleared = [_row("2026-07-17", "TRUE", "")]
    samples = [with_note, with_note, cleared, cleared, cleared]
    out = _pick_winning_snapshot(samples, force=True)
    assert out[0]["Notes"] == ""


def test_parse_tsv_notes_with_tabs_overflow():
    text = (
        "Date\tDay\tCreatine\tNotes\n"
        "7/17/2026\tThursday\tTRUE\thello world extra\n"
    )
    rows = parse_csv_rows(text)
    assert len(rows) == 1
    assert "Creatine" in rows[0]
    assert "hello" in str(rows[0].get("Notes") or "")


def test_fingerprint_stable():
    a = _normalize_sheet_rows([_row("2026-07-17", "FALSE", "x")])
    b = _normalize_sheet_rows([_row("2026-07-17", "FALSE", "x")])
    assert _rows_fingerprint(a) == _rows_fingerprint(b)


if __name__ == "__main__":
    tests = [
        test_uncheck_wins_over_stale_true,
        test_deleted_row_removed,
        test_new_row_appears,
        test_note_clear,
        test_parse_tsv_notes_with_tabs_overflow,
        test_fingerprint_stable,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"OK  {fn.__name__}")
        except Exception as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
    sys.exit(1 if failed else 0)
