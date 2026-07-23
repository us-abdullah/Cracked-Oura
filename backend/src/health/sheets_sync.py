"""Live sync from published Google Sheets into local health tables."""

from __future__ import annotations

import csv
import hashlib
import io
import logging
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.src.config import config_manager
from backend.src.health import service as health_service
from backend.src.models_health import (
    SUPPLEMENT_BOOL_COLUMNS,
    SUPPLEMENT_SHEET_TO_ATTR,
    HealthSupplementLog,
)

logger = logging.getLogger("HealthSheets")

_sync_lock = threading.Lock()

# Published endpoints (gid matches user's pubhtml tabs)
SHEETS_PUB_BASE = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vSAbprxWcVJCxwTltU7JnWPKybGburAi35dbtPJb2FADWuH7c4s34r7ebigyjRUegHPUIg5WqHF6ytB/pub"
)

# TSV avoids commas inside Notes breaking supplement columns
DEFAULT_SHEET_URLS = {
    "supplements": f"{SHEETS_PUB_BASE}?gid=0&single=true&output=tsv",
    "body": f"{SHEETS_PUB_BASE}?gid=217251520&single=true&output=tsv",
    "bloodwork": f"{SHEETS_PUB_BASE}?gid=241453671&single=true&output=tsv",
    "nutrition": f"{SHEETS_PUB_BASE}?gid=123456789&single=true&output=tsv",
}


def _prefer_tsv(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return u
    if "output=csv" in u:
        return u.replace("output=csv", "output=tsv")
    if "output=tsv" in u:
        return u
    sep = "&" if "?" in u else "?"
    return f"{u}{sep}output=tsv"


def ensure_sheet_defaults() -> Dict[str, Any]:
    """Write default published URLs into config if missing; prefer TSV."""
    cfg = config_manager.get_config()
    updates: Dict[str, Any] = {}
    mapping = {
        "health_sheets_supplements_url": DEFAULT_SHEET_URLS["supplements"],
        "health_sheets_body_url": DEFAULT_SHEET_URLS["body"],
        "health_sheets_bloodwork_url": DEFAULT_SHEET_URLS["bloodwork"],
        "health_sheets_nutrition_url": DEFAULT_SHEET_URLS["nutrition"],
    }
    for key, default in mapping.items():
        current = cfg.get(key) or ""
        preferred = _prefer_tsv(current) if current else default
        if not current or preferred != current:
            updates[key] = preferred or default
    if cfg.get("health_sheets_sync_minutes") is None:
        updates["health_sheets_sync_minutes"] = 5
    if updates:
        config_manager.update_config(**updates)
        cfg = config_manager.get_config()
    return {
        "supplements_url": cfg.get("health_sheets_supplements_url") or "",
        "body_url": cfg.get("health_sheets_body_url") or "",
        "bloodwork_url": cfg.get("health_sheets_bloodwork_url") or "",
        "nutrition_url": cfg.get("health_sheets_nutrition_url") or "",
        "sync_minutes": int(cfg.get("health_sheets_sync_minutes") or 5),
        "last_sync": cfg.get("health_sheets_last_sync"),
        "last_status": cfg.get("health_sheets_last_status"),
        "last_counts": cfg.get("health_sheets_last_counts"),
    }


def _fetch_text_once(url: str, timeout: int = 45) -> str:
    sep = "&" if "?" in url else "?"
    # Multiple cache-bust params — Google's publish CDN is aggressive
    busted = (
        f"{url}{sep}_cb={uuid.uuid4().hex}"
        f"&_t={int(time.time() * 1000)}"
        f"&r={uuid.uuid4().hex[:8]}"
    )
    req = urllib.request.Request(
        busted,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36 UsmanBiotracker/1.0"
            ),
            "Accept": "text/tab-separated-values,text/csv,text/plain,*/*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return raw.decode("utf-8-sig")


def _supplement_score(text: str) -> Tuple[int, int, int]:
    """notes cells, FALSE checkboxes, row count."""
    rows = parse_csv_rows(text)
    notes = 0
    falses = 0
    for r in rows:
        if str(r.get("Notes") or r.get("notes") or "").strip():
            notes += 1
        for col in SUPPLEMENT_BOOL_COLUMNS:
            if str(r.get(col) or "").strip().upper() == "FALSE":
                falses += 1
    return (notes, falses, len(rows))


def parse_csv_rows(text: str) -> List[Dict[str, Any]]:
    """Parse CSV or TSV. Finds Date header; merges overflow cells into Notes.

    Tolerates:
    - Renamed first header cell (e.g. email typed over \"Date\") when Day + supplements present
    - Leading blank columns (macro sheet publishes `\\tDate\\tCalories...`)
    - Title/summary rows above the real header
    """
    if not text or not str(text).strip():
        return []

    sample = text.lstrip("\ufeff")
    first_line = sample.splitlines()[0] if sample.splitlines() else ""
    delimiter = "\t" if first_line.count("\t") >= max(1, first_line.count(",")) else ","

    grid = [list(r) for r in csv.reader(io.StringIO(sample), delimiter=delimiter)]
    header_idx = None
    headers: List[str] = []
    date_offset = 0
    supp_names_lower = {c.lower() for c in SUPPLEMENT_BOOL_COLUMNS}
    nutrition_names_lower = {
        "calories",
        "protein",
        "carbs",
        "fat",
        "fiber",
        "sugar",
        "water",
    }

    for i, row in enumerate(grid):
        if not row:
            continue
        cells = [str(h or "").strip().strip('"') for h in row]
        while cells and not cells[-1]:
            cells.pop()
        if not cells:
            continue

        lowered = [c.lower() for c in cells]
        date_at = next((j for j, c in enumerate(lowered) if c == "date"), None)

        def _nutr_hit(label: str) -> bool:
            # "water (oz)", "protein (g)", etc.
            if label in nutrition_names_lower:
                return True
            return any(
                label.startswith(n + " ") or label.startswith(n + "(")
                for n in nutrition_names_lower
            )

        is_header = date_at is not None and date_at == 0

        # Date not in col A — still a header if Date appears with macros or Day+supplements
        if date_at is not None and not is_header:
            has_day = "day" in lowered
            supp_hits = sum(1 for c in lowered if c in supp_names_lower)
            nutr_hits = sum(1 for c in lowered if _nutr_hit(c))
            if has_day and supp_hits >= 3:
                is_header = True
            elif nutr_hits >= 3:
                is_header = True

        # Email/name overwrote Date but Day + supplements remain
        if not is_header and len(cells) >= 4:
            has_day = "day" in lowered
            supp_hits = sum(1 for c in lowered if c in supp_names_lower)
            if has_day and supp_hits >= 3:
                is_header = True
                cells[0] = "Date"
                date_at = 0

        if is_header:
            offset = int(date_at or 0)
            if offset > 0:
                cells = cells[offset:]
            elif cells and cells[0].lower() != "date":
                cells[0] = "Date"
            headers = cells
            header_idx = i
            date_offset = offset
            break

    if header_idx is None or not headers:
        return []

    if headers[0].lower() != "date":
        headers[0] = "Date"

    out: List[Dict[str, Any]] = []
    for row in grid[header_idx + 1 :]:
        if not row or not any(str(c).strip() for c in row if c is not None):
            continue
        values = [("" if c is None else str(c)).strip() for c in row]
        if date_offset > 0:
            if len(values) <= date_offset:
                continue
            values = values[date_offset:]
        if len(values) > len(headers):
            head = values[: len(headers) - 1]
            overflow = values[len(headers) - 1 :]
            joiner = "," if delimiter == "," else " "
            values = head + [joiner.join(overflow).strip()]
        elif len(values) < len(headers):
            values = values + [""] * (len(headers) - len(values))

        cleaned: Dict[str, Any] = {}
        for h, v in zip(headers, values):
            if not h:
                continue
            cleaned[h] = v
        if not any(str(v).strip() for v in cleaned.values()):
            continue
        date_cell = str(cleaned.get("Date") or "").strip()
        if not date_cell or date_cell.lower() in ("date", "calories", "protein"):
            continue
        if str(cleaned.get("Day") or "").strip().lower() == "day":
            continue
        out.append(cleaned)
    return out


def _cell_bool_token(raw: Any) -> Optional[str]:
    """Normalize sheet checkbox to TRUE / FALSE / None."""
    b = health_service._parse_bool(raw)
    if b is True:
        return "TRUE"
    if b is False:
        return "FALSE"
    return None


def _normalize_sheet_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Canonicalize one parsed snapshot: ISO dates, explicit TRUE/FALSE/blank."""
    by_iso: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        d = health_service._parse_date(r.get("Date") or r.get("date"))
        if not d:
            continue
        iso = d.isoformat()
        rebuilt: Dict[str, Any] = {
            "Date": iso,
            "Day": str(r.get("Day") or r.get("day") or "").strip() or d.strftime("%A"),
            "Notes": str(r.get("Notes") or r.get("notes") or "").strip(),
        }
        for col in SUPPLEMENT_BOOL_COLUMNS:
            tok = _cell_bool_token(r.get(col))
            rebuilt[col] = tok if tok else ""
        # Last occurrence of a date wins within a single snapshot
        by_iso[iso] = rebuilt
    return [by_iso[k] for k in sorted(by_iso.keys())]


def _rows_fingerprint(rows: List[Dict[str, Any]]) -> str:
    """Stable hash of dates + checkboxes + notes — identical snapshots cluster together."""
    parts: List[str] = []
    for r in _normalize_sheet_rows(rows):
        bools = ",".join(str(r.get(c) or "") for c in SUPPLEMENT_BOOL_COLUMNS)
        parts.append(f"{r['Date']}|{r.get('Notes') or ''}|{bools}")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _rows_stats(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    norm = _normalize_sheet_rows(rows)
    falses = 0
    notes = 0
    for r in norm:
        if str(r.get("Notes") or "").strip():
            notes += 1
        for col in SUPPLEMENT_BOOL_COLUMNS:
            if str(r.get(col) or "").upper() == "FALSE":
                falses += 1
    return {"rows": len(norm), "falses": falses, "notes": notes}


def _pick_winning_snapshot(
    samples: List[List[Dict[str, Any]]], *, force: bool
) -> List[Dict[str, Any]]:
    """
    Google Publish CDN serves mixed old/new snapshots.

    Strategy: fingerprint each fetch, then pick ONE winning snapshot so we never
    mix stale TRUE votes with fresh FALSE (or keep long stale notes forever).
    Prefer fingerprints that appear multiple times in the *recent* half of fetches.
    On ties, prefer more FALSE checkboxes / fewer rows (typical after unchecks/deletes).
    """
    if not samples:
        return []

    indexed = list(enumerate(samples))
    # Recent window is where fresh publishes show up first
    start = len(indexed) // 2 if len(indexed) >= 4 else 0
    window = indexed[start:]

    scored: List[Tuple[int, str, List[Dict[str, Any]], Dict[str, int]]] = []
    for i, rows in window:
        fp = _rows_fingerprint(rows)
        stats = _rows_stats(rows)
        scored.append((i, fp, rows, stats))

    fp_counts = Counter(fp for _, fp, _, _ in scored)
    # Fingerprints seen at least twice in the window (agreement)
    agreed = [fp for fp, c in fp_counts.items() if c >= 2]

    def rank(fp: str) -> Tuple:
        members = [(i, rows, st) for i, f, rows, st in scored if f == fp]
        latest_i = max(m[0] for m in members)
        # Use stats from latest member of this fingerprint
        latest_st = max(members, key=lambda m: m[0])[2]
        return (
            fp_counts[fp],
            latest_st["falses"],
            -latest_st["rows"],  # prefer deletions / smaller sheet
            latest_st["notes"],
            latest_i,
        )

    if agreed:
        best_fp = max(agreed, key=rank)
    elif force:
        # Manual Sync: trust the latest fetch if nothing agrees yet
        best_fp = scored[-1][1]
        logger.info(
            "Supplement consensus: no duplicate fingerprint in window; using latest sample"
        )
    else:
        # Background: need at least some agreement — fall back to most common in full set
        all_fps = [_rows_fingerprint(s) for s in samples]
        best_fp = Counter(all_fps).most_common(1)[0][0]

    # Canonical = latest sample matching winning fingerprint (freshest CDN copy of that version)
    canonical = None
    for i, fp, rows, _st in scored:
        if fp == best_fp:
            canonical = rows
    if canonical is None:
        canonical = samples[-1]

    out = _normalize_sheet_rows(canonical)
    logger.info(
        "Supplement consensus samples=%s window=%s fp_counts=%s picked_rows=%s falses=%s notes=%s force=%s",
        len(samples),
        len(window),
        dict(fp_counts.most_common(5)),
        len(out),
        _rows_stats(out)["falses"],
        _rows_stats(out)["notes"],
        force,
    )
    return out


def _fetch_supplement_consensus(
    url: str,
    attempts: int = 11,
    delay_s: float = 0.45,
    *,
    force: bool = False,
) -> List[Dict[str, Any]]:
    """Fetch multiple CDN snapshots and pick one coherent winning sheet state."""
    samples: List[List[Dict[str, Any]]] = []
    for i in range(max(3, attempts)):
        text = _fetch_text_once(url)
        rows = parse_csv_rows(text)
        if rows:
            samples.append(rows)
        if i < attempts - 1:
            time.sleep(delay_s)

    if not samples:
        return []
    return _pick_winning_snapshot(samples, force=force)


def _fetch_stable(url: str, attempts: int = 7, delay_s: float = 0.4) -> str:
    """Best single snapshot for body/bloodwork (smaller tables, less CDN flip)."""
    samples: List[str] = []
    for i in range(max(1, attempts)):
        samples.append(_fetch_text_once(url))
        if i < attempts - 1:
            time.sleep(delay_s)

    scored = [(_supplement_score(t), t) for t in samples]
    # Prefer most rows, then most notes (body/blood use notes more than FALSEs)
    _, best = max(scored, key=lambda st: (st[0][2], st[0][0], st[0][1]))
    logger.info(
        "Sheet fetch row_counts=%s picked=%s",
        [s[2] for s, _ in scored],
        _supplement_score(best),
    )
    return best


def _db_supplement_fingerprint(db: Session) -> Dict[str, int]:
    rows = db.query(HealthSupplementLog).all()
    falses = 0
    notes = 0
    for r in rows:
        if r.notes and str(r.notes).strip():
            notes += 1
        for attr in SUPPLEMENT_SHEET_TO_ATTR.values():
            if getattr(r, attr, None) is False:
                falses += 1
    return {"rows": len(rows), "falses": falses, "notes": notes}


def _incoming_supplement_fingerprint(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    return _rows_stats(rows)


def _looks_like_stale_all_green(
    incoming: Dict[str, int], current: Dict[str, int]
) -> bool:
    """Refuse classic CDN 'all TRUE again' regression."""
    if current["rows"] < 10:
        return False
    if (
        current["falses"] >= 5
        and incoming["falses"] == 0
        and incoming["rows"] >= max(10, int(current["rows"] * 0.9))
    ):
        return True
    return False


def sync_all(db: Session, *, force: bool = False) -> Dict[str, Any]:
    """Fetch all configured sheet tables and upsert into SQLite.

    force=True (manual Sync button): more fetch attempts; still refuses all-green CDN regression.
    """
    if not _sync_lock.acquire(blocking=False):
        meta = ensure_sheet_defaults()
        return {
            "supplements": 0,
            "body": 0,
            "bloodwork": 0,
            "nutrition": 0,
            "supplements_deleted": 0,
            "body_deleted": 0,
            "bloodwork_deleted": 0,
            "nutrition_deleted": 0,
            "notes_imported": 0,
            "errors": ["Sync already in progress — wait for it to finish."],
            "status": "busy",
            "last_sync": meta.get("last_sync"),
            "skipped": True,
        }

    try:
        return _sync_all_unlocked(db, force=force)
    finally:
        _sync_lock.release()


def _sync_all_unlocked(db: Session, *, force: bool = False) -> Dict[str, Any]:
    meta = ensure_sheet_defaults()
    result: Dict[str, Any] = {
        "supplements": 0,
        "body": 0,
        "bloodwork": 0,
        "nutrition": 0,
        "supplements_deleted": 0,
        "body_deleted": 0,
        "bloodwork_deleted": 0,
        "nutrition_deleted": 0,
        "notes_imported": 0,
        "errors": [],
        "skipped_stale": False,
        "force": force,
        "applied": False,
    }

    jobs: List[Tuple[str, str, str]] = [
        ("supplements", meta["supplements_url"], "supplements"),
        ("body", meta["body_url"], "body"),
        ("bloodwork", meta["bloodwork_url"], "bloodwork"),
        ("nutrition", meta["nutrition_url"], "nutrition"),
    ]

    for key, url, sheet in jobs:
        if not url or not str(url).strip():
            continue
        try:
            tsv_url = _prefer_tsv(str(url).strip())

            if sheet == "supplements":
                attempts = 16 if force else 10
                rows = _fetch_supplement_consensus(
                    tsv_url, attempts=attempts, delay_s=0.5 if force else 0.4, force=force
                )
                incoming_fp = _incoming_supplement_fingerprint(rows)
                current_fp = _db_supplement_fingerprint(db)
                result["notes_imported"] = incoming_fp["notes"]

                if not rows:
                    result["errors"].append("supplements: empty fetch — nothing applied")
                    continue

                if _looks_like_stale_all_green(incoming_fp, current_fp):
                    # One hard retry with longer gaps (CDN often catches up within seconds)
                    logger.warning(
                        "All-green CDN snapshot detected; retrying consensus once…"
                    )
                    time.sleep(2.0)
                    rows = _fetch_supplement_consensus(
                        tsv_url, attempts=12, delay_s=0.7, force=force
                    )
                    incoming_fp = _incoming_supplement_fingerprint(rows)
                    result["notes_imported"] = incoming_fp["notes"]

                if not rows:
                    result["errors"].append("supplements: empty after retry")
                    continue

                if _looks_like_stale_all_green(incoming_fp, current_fp):
                    result["skipped_stale"] = True
                    result["errors"].append(
                        "Google publish CDN still serving an old all-checked snapshot. "
                        "Wait ~30s after editing the sheet, then Sync again."
                    )
                    logger.warning(
                        "Refusing stale supplements snapshot incoming=%s current=%s",
                        incoming_fp,
                        current_fp,
                    )
                    continue

                stats = health_service.upsert_supplement_rows(db, rows, replace=True)
                result["supplements"] = stats["upserted"]
                result["supplements_deleted"] = stats["deleted"]
                result["applied"] = True
                dated = []
                for r in rows:
                    d = health_service._parse_date(r.get("Date") or r.get("date"))
                    if d:
                        dated.append(d.isoformat())
                dated.sort()
                result["latest_dates"] = dated[-5:]
                result["supplement_fingerprint"] = incoming_fp
                recent = []
                by_iso = {r["Date"]: r for r in rows if r.get("Date")}
                for d_iso in dated[-3:]:
                    match = by_iso.get(d_iso)
                    if not match:
                        continue
                    t = sum(
                        1
                        for c in SUPPLEMENT_BOOL_COLUMNS
                        if str(match.get(c) or "").upper() == "TRUE"
                    )
                    f = sum(
                        1
                        for c in SUPPLEMENT_BOOL_COLUMNS
                        if str(match.get(c) or "").upper() == "FALSE"
                    )
                    note = str(match.get("Notes") or "").strip()
                    note_bit = f" · note:{note[:40]}" if note else ""
                    recent.append(f"{d_iso}: {t} taken / {f} missed{note_bit}")
                result["recent_days"] = recent
            else:
                text = _fetch_stable(tsv_url, attempts=9 if force else 5)
                rows = parse_csv_rows(text)
                if sheet == "body":
                    stats = health_service.upsert_body_rows(db, rows, replace=True)
                    result["body"] = stats["upserted"]
                    result["body_deleted"] = stats["deleted"]
                    result["applied"] = True
                elif sheet == "nutrition":
                    stats = health_service.upsert_nutrition_rows(db, rows, replace=True)
                    result["nutrition"] = stats["upserted"]
                    result["nutrition_deleted"] = stats["deleted"]
                    result["applied"] = True
                else:
                    stats = health_service.upsert_bloodwork_rows(db, rows, replace=True)
                    result["bloodwork"] = stats["upserted"]
                    result["bloodwork_deleted"] = stats["deleted"]
                    result["applied"] = True

            logger.info(
                "Sheets sync %s: upserted=%s deleted=%s notes=%s force=%s",
                key,
                result.get(key),
                result.get(f"{key}_deleted"),
                result.get("notes_imported"),
                force,
            )
        except urllib.error.HTTPError as e:
            msg = f"{key}: HTTP {e.code}"
            result["errors"].append(msg)
            logger.error("Sheets sync failed %s", msg)
        except Exception as e:
            msg = f"{key}: {e}"
            result["errors"].append(msg)
            logger.exception("Sheets sync failed for %s", key)

    if result.get("skipped_stale") and not result.get("applied"):
        status = "stale_snapshot_skipped"
    elif result["errors"] and result.get("applied"):
        status = f"partial: {'; '.join(result['errors'])}"
    elif result["errors"]:
        status = f"error: {'; '.join(result['errors'])}"
    else:
        status = "ok"

    # Only advance last_sync when we actually wrote data — so background retry
    # keeps trying after a stale skip instead of waiting the full interval.
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if result.get("applied"):
        config_manager.update_config(
            health_sheets_last_sync=now,
            health_sheets_last_status=status,
            health_sheets_last_counts={
                "supplements": result["supplements"],
                "body": result["body"],
                "bloodwork": result["bloodwork"],
                "nutrition": result["nutrition"],
                "notes_imported": result["notes_imported"],
                "supplements_deleted": result["supplements_deleted"],
                "body_deleted": result["body_deleted"],
                "bloodwork_deleted": result["bloodwork_deleted"],
                "nutrition_deleted": result["nutrition_deleted"],
            },
        )
        result["last_sync"] = now
    else:
        config_manager.update_config(health_sheets_last_status=status)
        result["last_sync"] = meta.get("last_sync")

    result["status"] = status
    return result


def maybe_due(now: Optional[datetime] = None) -> bool:
    """True if enough minutes have passed since last sync (or never synced)."""
    meta = ensure_sheet_defaults()
    minutes = max(1, int(meta.get("sync_minutes") or 5))
    last = meta.get("last_sync")
    if not last:
        return True
    now = now or datetime.now()
    try:
        last_dt = datetime.strptime(str(last), "%Y-%m-%d %H:%M:%S")
    except Exception:
        return True
    return (now - last_dt).total_seconds() >= minutes * 60
