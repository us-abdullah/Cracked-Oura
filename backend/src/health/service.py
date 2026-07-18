"""Health data loaders — Sheets-identical column contract."""

from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.src.models_health import (
    CORE_COLOR_SUPPLEMENTS,
    SUPPLEMENT_BOOL_COLUMNS,
    SUPPLEMENT_SHEET_TO_ATTR,
    HealthBloodwork,
    HealthBodyMetrics,
    HealthSupplementLog,
)


def _parse_bool(v: Any) -> Optional[bool]:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip()
    su = s.upper()
    if su in ("TRUE", "1", "YES", "Y", "CHECKED", "X") or s in ("✓", "✔", "☑", "✅"):
        return True
    if su in ("FALSE", "0", "NO", "N", "UNCHECKED") or s in ("☐", "✗", "✘", "❌"):
        return False
    return None


def _parse_date(v: Any) -> Optional[date]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except Exception:
        pass
    for fmt in (
        "%m/%d/%Y",
        "%m/%d/%y",
        "%d/%m/%Y",
        "%Y/%m/%d",
        "%m-%d-%Y",
        "%d-%m-%Y",
        "%b %d, %Y",
        "%B %d, %Y",
    ):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue
    return None


def _parse_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except Exception:
        return None


def _row_get(row: Dict[str, Any], *names: str) -> Any:
    for n in names:
        if n in row and row[n] is not None:
            return row[n]
    lower = {str(k).strip().lower(): v for k, v in row.items() if k is not None}
    for n in names:
        key = n.lower()
        if key in lower and lower[key] is not None:
            return lower[key]
    return None


def _looks_like_note(v: Any) -> bool:
    """True when a checkbox cell clearly contains free text (column shift / bad CSV)."""
    if v is None:
        return False
    s = str(v).strip()
    if not s:
        return False
    if _parse_bool(s) is not None:
        return False
    # Dates accidentally in a bool column
    if _parse_date(s) is not None:
        return False
    return (" " in s) or (len(s) > 8) or ("," in s)


def row_to_supplement(row: Dict[str, Any]) -> Optional[HealthSupplementLog]:
    d = _parse_date(_row_get(row, "Date", "date"))
    if not d:
        return None

    notes_parts: List[str] = []
    base_notes = _row_get(row, "Notes", "notes", "Note", "note")
    if base_notes is not None and str(base_notes).strip():
        notes_parts.append(str(base_notes).strip())

    kwargs: Dict[str, Any] = {
        "date": d,
        "day": _row_get(row, "Day", "day") or d.strftime("%A"),
    }
    for sheet_col, attr in SUPPLEMENT_SHEET_TO_ATTR.items():
        raw = _row_get(row, sheet_col, attr)
        if raw is not None and _looks_like_note(raw):
            notes_parts.append(str(raw).strip())
            kwargs[attr] = None
        else:
            kwargs[attr] = _parse_bool(raw)

    kwargs["notes"] = " | ".join(notes_parts) if notes_parts else None
    return HealthSupplementLog(**kwargs)



def supplement_to_sheet_row(obj: HealthSupplementLog) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "Date": obj.date.isoformat(),
        "Day": obj.day or obj.date.strftime("%A"),
    }
    for sheet_col, attr in SUPPLEMENT_SHEET_TO_ATTR.items():
        val = getattr(obj, attr, None)
        out[sheet_col] = True if val is True else (False if val is False else None)
    out["Notes"] = obj.notes or ""
    return out


def upsert_supplement_rows(
    db: Session, rows: List[Dict[str, Any]], *, replace: bool = False
) -> Dict[str, int]:
    """Upsert sheet rows. If replace=True, delete local dates not present in the sheet."""
    count = 0
    incoming_dates = set()
    for row in rows:
        obj = row_to_supplement(row)
        if not obj:
            continue
        incoming_dates.add(obj.date)
        existing = db.get(HealthSupplementLog, obj.date)
        if existing:
            for sheet_col, attr in SUPPLEMENT_SHEET_TO_ATTR.items():
                setattr(existing, attr, getattr(obj, attr))
            existing.day = obj.day
            existing.notes = obj.notes
        else:
            db.add(obj)
        count += 1

    deleted = 0
    if replace:
        q = db.query(HealthSupplementLog)
        if incoming_dates:
            deleted = (
                q.filter(~HealthSupplementLog.date.in_(incoming_dates)).delete(
                    synchronize_session=False
                )
                or 0
            )
        elif count == 0 and len(rows) == 0:
            # Truly empty sheet (header only) → clear all
            deleted = q.delete(synchronize_session=False) or 0

    db.commit()
    return {"upserted": count, "deleted": int(deleted)}


def upsert_body_rows(
    db: Session, rows: List[Dict[str, Any]], *, replace: bool = False
) -> Dict[str, int]:
    count = 0
    incoming_dates = set()
    for row in rows:
        d = _parse_date(row.get("Date") or row.get("date"))
        if not d:
            continue
        incoming_dates.add(d)
        weight = _parse_float(row.get("Weight") or row.get("weight"))
        bf = _parse_float(
            row.get("Body Fat %") or row.get("body_fat_pct") or row.get("Body Fat")
        )
        notes_raw = row.get("Notes") or row.get("notes")
        notes = str(notes_raw).strip() if notes_raw is not None and str(notes_raw).strip() else None
        existing = db.get(HealthBodyMetrics, d)
        if existing:
            existing.weight = weight
            existing.body_fat_pct = bf
            existing.notes = notes
        else:
            db.add(
                HealthBodyMetrics(
                    date=d, weight=weight, body_fat_pct=bf, notes=notes
                )
            )
        count += 1

    deleted = 0
    if replace:
        q = db.query(HealthBodyMetrics)
        if incoming_dates:
            deleted = (
                q.filter(~HealthBodyMetrics.date.in_(incoming_dates)).delete(
                    synchronize_session=False
                )
                or 0
            )
        elif count == 0 and len(rows) == 0:
            deleted = q.delete(synchronize_session=False) or 0

    db.commit()
    return {"upserted": count, "deleted": int(deleted)}


BLOODWORK_SHEET_TO_ATTR = {
    "Total Cholesterol": "total_cholesterol",
    "HDL": "hdl",
    "LDL": "ldl",
    "Triglycerides": "triglycerides",
    "Fasting Glucose": "fasting_glucose",
    "HbA1c": "hba1c",
    "Vitamin D": "vitamin_d",
    "Vitamin B12": "vitamin_b12",
    "Iron": "iron",
    "Ferritin": "ferritin",
    "Magnesium": "magnesium",
    "Zinc": "zinc",
    "Testosterone": "testosterone",
}


def upsert_bloodwork_rows(
    db: Session, rows: List[Dict[str, Any]], *, replace: bool = False
) -> Dict[str, int]:
    count = 0
    incoming_dates = set()
    for row in rows:
        d = _parse_date(row.get("Date") or row.get("date"))
        if not d:
            continue
        incoming_dates.add(d)
        kwargs: Dict[str, Any] = {
            "date": d,
            "notes": (str(row.get("Notes") or row.get("notes") or "").strip() or None),
        }
        for sheet_col, attr in BLOODWORK_SHEET_TO_ATTR.items():
            kwargs[attr] = _parse_float(row.get(sheet_col) or row.get(attr))
        existing = db.get(HealthBloodwork, d)
        if existing:
            for k, v in kwargs.items():
                if k != "date":
                    setattr(existing, k, v)
        else:
            db.add(HealthBloodwork(**kwargs))
        count += 1

    deleted = 0
    if replace:
        q = db.query(HealthBloodwork)
        if incoming_dates:
            deleted = (
                q.filter(~HealthBloodwork.date.in_(incoming_dates)).delete(
                    synchronize_session=False
                )
                or 0
            )
        elif count == 0 and len(rows) == 0:
            deleted = q.delete(synchronize_session=False) or 0

    db.commit()
    return {"upserted": count, "deleted": int(deleted)}


def parse_csv_rows(text: str) -> List[Dict[str, Any]]:
    """Parse CSV; skip junk rows until a Date header (Sheets sometimes prepend blank rows)."""
    from backend.src.health.sheets_sync import parse_csv_rows as _smart

    return _smart(text)


def seed_placeholder_supplements(db: Session) -> int:
    """Seed Jan 1 – Jul 17 2026 with all TRUE (placeholder until Sheets import)."""
    existing = db.query(HealthSupplementLog).count()
    if existing > 0:
        return 0

    start = date(2026, 1, 1)
    end = date(2026, 7, 17)
    rows = []
    d = start
    while d <= end:
        row = {"Date": d.isoformat(), "Day": d.strftime("%A"), "Notes": ""}
        for col in SUPPLEMENT_BOOL_COLUMNS:
            row[col] = True
        rows.append(row)
        d += timedelta(days=1)

    # Empty body metrics starter row
    if db.get(HealthBodyMetrics, date(2026, 7, 17)) is None:
        db.add(HealthBodyMetrics(date=date(2026, 7, 17), weight=None, body_fat_pct=None, notes=None))
        db.commit()

    return upsert_supplement_rows(db, rows).get("upserted", 0)


def adherence_calendar(db: Session) -> List[Dict[str, Any]]:
    rows = db.query(HealthSupplementLog).order_by(HealthSupplementLog.date.asc()).all()
    out = []
    for r in rows:
        vals = []
        core_vals = []
        taken = {}
        for sheet_col, attr in SUPPLEMENT_SHEET_TO_ATTR.items():
            v = getattr(r, attr, None)
            taken[sheet_col] = 1 if v is True else (0 if v is False else None)
            if v is True:
                vals.append(1)
            elif v is False:
                vals.append(0)
            if sheet_col in CORE_COLOR_SUPPLEMENTS:
                if v is True:
                    core_vals.append(1)
                elif v is False:
                    core_vals.append(0)
        # Overall % still includes every tracked supplement
        pct = (sum(vals) / len(vals) * 100) if vals else 0
        # Day color only from core stack (green when all logged core were taken)
        core_pct = (sum(core_vals) / len(core_vals) * 100) if core_vals else 0
        if core_vals and all(v == 1 for v in core_vals):
            color = "green"
        elif core_pct >= 50:
            color = "yellow"
        else:
            color = "red"
        out.append(
            {
                "date": r.date.isoformat(),
                "day": r.day,
                "pct": round(pct, 1),
                "color": color,
                "taken": taken,
                "notes": r.notes or "",
            }
        )
    return out


def adherence_rates(db: Session) -> List[Dict[str, Any]]:
    rows = db.query(HealthSupplementLog).all()
    rates = []
    for sheet_col, attr in SUPPLEMENT_SHEET_TO_ATTR.items():
        tracked = [getattr(r, attr) for r in rows if getattr(r, attr) is not None]
        if not tracked:
            rates.append({"name": sheet_col, "pct": None, "taken": 0, "total": 0})
            continue
        taken = sum(1 for v in tracked if v is True)
        rates.append(
            {
                "name": sheet_col,
                "pct": round(taken / len(tracked) * 100, 1),
                "taken": taken,
                "total": len(tracked),
            }
        )
    rates.sort(key=lambda x: -(x["pct"] or 0))
    return rates


def notes_feed(db: Session) -> List[Dict[str, Any]]:
    """Notes from supplements, body, and bloodwork sheets (newest first)."""
    items: List[Dict[str, Any]] = []

    for r in (
        db.query(HealthSupplementLog)
        .filter(HealthSupplementLog.notes.isnot(None))
        .all()
    ):
        if r.notes and str(r.notes).strip():
            items.append(
                {
                    "date": r.date.isoformat(),
                    "notes": str(r.notes).strip(),
                    "source": "supplements",
                }
            )

    for r in (
        db.query(HealthBodyMetrics).filter(HealthBodyMetrics.notes.isnot(None)).all()
    ):
        if r.notes and str(r.notes).strip():
            items.append(
                {
                    "date": r.date.isoformat(),
                    "notes": str(r.notes).strip(),
                    "source": "body",
                }
            )

    for r in (
        db.query(HealthBloodwork).filter(HealthBloodwork.notes.isnot(None)).all()
    ):
        if r.notes and str(r.notes).strip():
            items.append(
                {
                    "date": r.date.isoformat(),
                    "notes": str(r.notes).strip(),
                    "source": "bloodwork",
                }
            )

    items.sort(key=lambda x: x["date"], reverse=True)
    return items


def body_status(db: Session) -> Dict[str, Any]:
    n = db.query(HealthBodyMetrics).filter(HealthBodyMetrics.weight.isnot(None)).count()
    return {"rows_with_weight": n, "ready": n > 0}


def bloodwork_status(db: Session) -> Dict[str, Any]:
    n = db.query(HealthBloodwork).count()
    return {"rows": n, "ready": n > 0}


def body_series(db: Session) -> List[Dict[str, Any]]:
    rows = (
        db.query(HealthBodyMetrics)
        .order_by(HealthBodyMetrics.date.asc())
        .all()
    )
    out: List[Dict[str, Any]] = []
    for r in rows:
        if r.weight is None and r.body_fat_pct is None and not (r.notes or "").strip():
            continue
        out.append(
            {
                "date": r.date.isoformat(),
                "weight": r.weight,
                "body_fat_pct": r.body_fat_pct,
                "notes": r.notes or "",
            }
        )
    return out


def body_summary(db: Session) -> Dict[str, Any]:
    series = body_series(db)
    weights = [r for r in series if r.get("weight") is not None]
    fats = [r for r in series if r.get("body_fat_pct") is not None]
    latest = series[-1] if series else None
    prev_w = weights[-2]["weight"] if len(weights) >= 2 else None
    latest_w = weights[-1]["weight"] if weights else None
    delta_w = (
        round(float(latest_w) - float(prev_w), 2)
        if latest_w is not None and prev_w is not None
        else None
    )
    # trailing average of last up to 7 weight points
    trail = [float(w["weight"]) for w in weights[-7:]]
    avg7 = round(sum(trail) / len(trail), 2) if trail else None
    return {
        "latest": latest,
        "points": len(series),
        "weight_points": len(weights),
        "body_fat_points": len(fats),
        "delta_weight": delta_w,
        "avg7_weight": avg7,
        "min_weight": min((float(w["weight"]) for w in weights), default=None),
        "max_weight": max((float(w["weight"]) for w in weights), default=None),
    }


def bloodwork_series(db: Session) -> List[Dict[str, Any]]:
    rows = (
        db.query(HealthBloodwork).order_by(HealthBloodwork.date.asc()).all()
    )
    out: List[Dict[str, Any]] = []
    for r in rows:
        item: Dict[str, Any] = {
            "date": r.date.isoformat(),
            "notes": r.notes or "",
        }
        for sheet_col, attr in BLOODWORK_SHEET_TO_ATTR.items():
            item[attr] = getattr(r, attr, None)
        # keep sheet-friendly aliases for chart labels
        item["total_cholesterol"] = r.total_cholesterol
        out.append(item)
    return out


def bloodwork_latest(db: Session) -> Optional[Dict[str, Any]]:
    series = bloodwork_series(db)
    return series[-1] if series else None

