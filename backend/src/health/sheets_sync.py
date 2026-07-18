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
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.src.config import config_manager
from backend.src.health import service as health_service
from backend.src.models_health import (
    SUPPLEMENT_BOOL_COLUMNS,
    SUPPLEMENT_SHEET_TO_ATTR,
    HealthBloodwork,
    HealthBodyMetrics,
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
    busted = f"{url}{sep}_cb={uuid.uuid4().hex}"
    req = urllib.request.Request(
        busted,
        headers={
            "User-Agent": "UsmanBiotracker/1.0",
            "Accept": "text/tab-separated-values,text/csv,text/plain,*/*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
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


def _fetch_stable(url: str, attempts: int = 7, delay_s: float = 0.4) -> str:
    """
    Google published sheets return inconsistent CDN snapshots.
    Prefer the newest sheet (most rows) so newly added days win.
    Within a chosen size, prefer richest Notes + FALSE checkboxes so
    checklist edits beat stale all-TRUE copies.
    """
    samples: List[str] = []
    for i in range(max(1, attempts)):
        samples.append(_fetch_text_once(url))
        if i < attempts - 1:
            time.sleep(delay_s)

    scored = [(_supplement_score(t), t) for t in samples]
    row_counts = [s[2] for s, _ in scored]
    counts = Counter(row_counts)
    max_rows = max(row_counts)
    majority_rows, majority_n = counts.most_common(1)[0]

    use_rows = max_rows
    # Lone oversized snapshot that is poorer than a solid majority → CDN glitch
    if (
        counts[max_rows] == 1
        and majority_n >= 3
        and 0 < (max_rows - majority_rows) <= 3
    ):
        max_best = max(
            (s for s, _ in scored if s[2] == max_rows),
            key=lambda s: (s[0], s[1]),
        )
        maj_best = max(
            (s for s, _ in scored if s[2] == majority_rows),
            key=lambda s: (s[0], s[1]),
        )
        if max_best[0] <= maj_best[0] and max_best[1] < maj_best[1]:
            use_rows = majority_rows

    candidates = [(s, t) for s, t in scored if s[2] == use_rows]
    if not candidates:
        candidates = scored

    _, best = max(candidates, key=lambda st: (st[0][0], st[0][1], st[0][2]))
    logger.info(
        "Sheet fetch row_counts=%s use_rows=%s picked=%s",
        row_counts,
        use_rows,
        _supplement_score(best),
    )
    return best


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
    """
    Refuse only the classic CDN 'all TRUE again' regression.
    Intentional deletes (fewer rows / cleared notes) are allowed.
    """
    if current["rows"] < 10:
        return False
    # Same-size (or larger) sheet but every miss vanished → stale all-green
    if (
        current["falses"] >= 5
        and incoming["falses"] == 0
        and incoming["rows"] >= max(10, int(current["rows"] * 0.9))
    ):
        return True
    return False


def sync_all(db: Session) -> Dict[str, Any]:
    """Fetch all configured sheet tables and upsert into SQLite."""
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
        return _sync_all_unlocked(db)
    finally:
        _sync_lock.release()


def _sync_all_unlocked(db: Session) -> Dict[str, Any]:
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
            text = _fetch_stable(_prefer_tsv(str(url).strip()))
            rows = parse_csv_rows(text)

            # Guard: never wipe a full table from a totally empty fetch (CDN glitch)
            if sheet == "supplements":
                incoming_fp = _incoming_supplement_fingerprint(rows)
                current_fp = _db_supplement_fingerprint(db)
                result["notes_imported"] = incoming_fp["notes"]
                if _looks_like_stale_all_green(incoming_fp, current_fp):
                    result["skipped_stale"] = True
                    result["errors"].append(
                        "Skipped stale Google publish snapshot (all-green regression). Try Sync again."
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
                # Helpful sync feedback for the UI
                dated = []
                for r in rows:
                    d = health_service._parse_date(r.get("Date") or r.get("date"))
                    if d:
                        dated.append(d.isoformat())
                dated.sort()
                result["latest_dates"] = dated[-5:]
                result["supplement_fingerprint"] = incoming_fp
            elif sheet == "body":
                stats = health_service.upsert_body_rows(db, rows, replace=True)
                result["body"] = stats["upserted"]
                result["body_deleted"] = stats["deleted"]
            else:
                stats = health_service.upsert_bloodwork_rows(db, rows, replace=True)
                result["bloodwork"] = stats["upserted"]
                result["bloodwork_deleted"] = stats["deleted"]

            logger.info(
                "Sheets sync %s: upserted=%s deleted=%s notes=%s",
                key,
                result.get(key),
                result.get(f"{key}_deleted"),
                result.get("notes_imported"),
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
