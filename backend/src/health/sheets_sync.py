"""Live sync from published Google Sheets into local health tables."""

from __future__ import annotations

import csv
import io
import logging
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter, defaultdict
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
    """Parse CSV or TSV. Finds Date header; merges overflow cells into Notes."""
    if not text or not str(text).strip():
        return []

    sample = text.lstrip("\ufeff")
    first_line = sample.splitlines()[0] if sample.splitlines() else ""
    delimiter = "\t" if first_line.count("\t") >= max(1, first_line.count(",")) else ","

    grid = [list(r) for r in csv.reader(io.StringIO(sample), delimiter=delimiter)]
    header_idx = None
    headers: List[str] = []
    for i, row in enumerate(grid):
        if not row:
            continue
        first = str(row[0]).strip().strip('"').lower()
        if first == "date":
            headers = [str(h or "").strip() for h in row]
            while headers and not headers[-1]:
                headers.pop()
            header_idx = i
            break
    if header_idx is None or not headers:
        return []

    out: List[Dict[str, Any]] = []
    for row in grid[header_idx + 1 :]:
        if not row or not any(str(c).strip() for c in row if c is not None):
            continue
        values = [("" if c is None else str(c)).strip() for c in row]
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


def _fetch_supplement_consensus(
    url: str, attempts: int = 11, delay_s: float = 0.45
) -> List[Dict[str, Any]]:
    """
    Google 'Publish to web' returns inconsistent CDN snapshots for the same sheet
    (same day can flip TRUE/FALSE across requests). Rebuild rows by majority vote
    per date + column so Sync matches the live spreadsheet.
    """
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

    # date_iso -> list of row dicts across samples
    by_date: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    row_counts = [len(s) for s in samples]
    max_rows = max(row_counts)
    for rows in samples:
        for r in rows:
            d = health_service._parse_date(r.get("Date") or r.get("date"))
            if not d:
                continue
            by_date[d.isoformat()].append(r)

    # Include a date if it appears often enough, or in any max-size snapshot (new day)
    min_appear = max(2, (len(samples) + 2) // 3)  # ~ceil(n/3) but at least 2
    max_sample_dates = set()
    for rows in samples:
        if len(rows) < max_rows:
            continue
        for r in rows:
            d = health_service._parse_date(r.get("Date") or r.get("date"))
            if d:
                max_sample_dates.add(d.isoformat())

    kept_dates = sorted(
        d
        for d, rows in by_date.items()
        if len(rows) >= min_appear or d in max_sample_dates
    )

    out: List[Dict[str, Any]] = []
    for d_iso in kept_dates:
        rows = by_date[d_iso]
        rebuilt: Dict[str, Any] = {"Date": d_iso}

        # Day name: most common non-empty
        days = [str(r.get("Day") or r.get("day") or "").strip() for r in rows]
        days = [x for x in days if x]
        rebuilt["Day"] = Counter(days).most_common(1)[0][0] if days else ""

        # Notes: prefer longest non-empty (avoid blank CDN winning)
        notes = [
            str(r.get("Notes") or r.get("notes") or "").strip() for r in rows
        ]
        notes = [n for n in notes if n]
        rebuilt["Notes"] = max(notes, key=len) if notes else ""

        for col in SUPPLEMENT_BOOL_COLUMNS:
            votes = [_cell_bool_token(r.get(col)) for r in rows]
            votes = [v for v in votes if v is not None]
            if not votes:
                rebuilt[col] = ""
                continue
            # Majority; ties → prefer FALSE (safer miss) then TRUE
            tallies = Counter(votes)
            best, _ = max(
                tallies.items(),
                key=lambda kv: (kv[1], 1 if kv[0] == "FALSE" else 0),
            )
            rebuilt[col] = best

        out.append(rebuilt)

    logger.info(
        "Supplement consensus samples=%s row_counts=%s dates=%s min_appear=%s",
        len(samples),
        row_counts,
        len(out),
        min_appear,
    )
    return out


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
    falses = 0
    notes = 0
    for r in rows:
        if str(r.get("Notes") or r.get("notes") or "").strip():
            notes += 1
        for col in SUPPLEMENT_BOOL_COLUMNS:
            if str(r.get(col) or "").strip().upper() == "FALSE":
                falses += 1
    return {"rows": len(rows), "falses": falses, "notes": notes}


def _looks_like_stale_all_green(
    incoming: Dict[str, int], current: Dict[str, int]
) -> bool:
    """Refuse classic CDN 'all TRUE again' regression (background sync only)."""
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

    force=True (manual Sync button): skip soft stale-guards; always apply consensus.
    """
    if not _sync_lock.acquire(blocking=False):
        meta = ensure_sheet_defaults()
        return {
            "supplements": 0,
            "body": 0,
            "bloodwork": 0,
            "supplements_deleted": 0,
            "body_deleted": 0,
            "bloodwork_deleted": 0,
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
        "supplements_deleted": 0,
        "body_deleted": 0,
        "bloodwork_deleted": 0,
        "notes_imported": 0,
        "errors": [],
        "skipped_stale": False,
        "force": force,
    }

    jobs: List[Tuple[str, str, str]] = [
        ("supplements", meta["supplements_url"], "supplements"),
        ("body", meta["body_url"], "body"),
        ("bloodwork", meta["bloodwork_url"], "bloodwork"),
    ]

    for key, url, sheet in jobs:
        if not url or not str(url).strip():
            continue
        try:
            tsv_url = _prefer_tsv(str(url).strip())

            if sheet == "supplements":
                # Consensus rebuild — handles CDN flipping checkboxes
                attempts = 13 if force else 9
                rows = _fetch_supplement_consensus(tsv_url, attempts=attempts)
                incoming_fp = _incoming_supplement_fingerprint(rows)
                current_fp = _db_supplement_fingerprint(db)
                result["notes_imported"] = incoming_fp["notes"]

                if not rows:
                    result["errors"].append("supplements: empty fetch")
                    continue

                if (not force) and _looks_like_stale_all_green(incoming_fp, current_fp):
                    result["skipped_stale"] = True
                    result["errors"].append(
                        "Skipped stale Google publish snapshot (all-green regression). "
                        "Click Sync again in a minute."
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
                dated = []
                for r in rows:
                    d = health_service._parse_date(r.get("Date") or r.get("date"))
                    if d:
                        dated.append(d.isoformat())
                dated.sort()
                result["latest_dates"] = dated[-5:]
                result["supplement_fingerprint"] = incoming_fp
                recent = []
                by_iso = {}
                for r in rows:
                    d = health_service._parse_date(r.get("Date") or r.get("date"))
                    if d:
                        by_iso[d.isoformat()] = r
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
                    recent.append(f"{d_iso}: {t} taken / {f} missed")
                result["recent_days"] = recent
            else:
                text = _fetch_stable(tsv_url, attempts=7 if force else 5)
                rows = parse_csv_rows(text)
                if sheet == "body":
                    stats = health_service.upsert_body_rows(db, rows, replace=True)
                    result["body"] = stats["upserted"]
                    result["body_deleted"] = stats["deleted"]
                else:
                    stats = health_service.upsert_bloodwork_rows(db, rows, replace=True)
                    result["bloodwork"] = stats["upserted"]
                    result["bloodwork_deleted"] = stats["deleted"]

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

    if result.get("skipped_stale"):
        status = "stale_snapshot_skipped"
    elif result["errors"]:
        status = f"partial: {'; '.join(result['errors'])}"
    else:
        status = "ok"

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    config_manager.update_config(
        health_sheets_last_sync=now,
        health_sheets_last_status=status,
        health_sheets_last_counts={
            "supplements": result["supplements"],
            "body": result["body"],
            "bloodwork": result["bloodwork"],
            "notes_imported": result["notes_imported"],
            "supplements_deleted": result["supplements_deleted"],
            "body_deleted": result["body_deleted"],
            "bloodwork_deleted": result["bloodwork_deleted"],
        },
    )
    result["last_sync"] = now
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
