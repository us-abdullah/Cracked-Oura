"""Health (supplements / biomarkers) API routes — isolated from Oura."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.src.config import config_manager
from backend.src.database import get_db
from backend.src.health.defaults import DEFAULT_HEALTH_DASHBOARD
from backend.src.health import service as health_service
from backend.src.health import sheets_sync

logger = logging.getLogger("HealthAPI")
router = APIRouter(prefix="/api/health", tags=["health"])


class DashboardSave(BaseModel):
    dashboards: list
    activeDashboardId: Optional[str] = None


class ImportPayload(BaseModel):
    """Sheets-shaped import. Provide one or more worksheets."""

    supplement_log: Optional[List[Dict[str, Any]]] = None
    body_metrics: Optional[List[Dict[str, Any]]] = None
    bloodwork: Optional[List[Dict[str, Any]]] = None
    csv_text: Optional[str] = None  # supplement CSV
    sheet: Optional[str] = "supplements"  # supplements | body | bloodwork


def _ensure_health_dashboard():
    existing = config_manager.get_compartment_dashboard("health")
    widgets = sum(len(d.get("widgets") or []) for d in (existing.get("dashboards") or []))
    if widgets == 0:
        config_manager.save_compartment_dashboard("health", DEFAULT_HEALTH_DASHBOARD)
        return DEFAULT_HEALTH_DASHBOARD
    # Migrate placeholder body/bloodwork widgets + short layouts to analytics layout
    try:
        dash = (existing.get("dashboards") or [None])[0] or {}
        wlist = list(dash.get("widgets") or [])
        layout = list(dash.get("layout") or [])
        types = {w.get("type") for w in wlist}
        needs = (
            "health_body_empty" in types
            or "health_bloodwork_empty" in types
            or any(
                w.get("type") in ("health_body", "health_body_empty")
                and int(
                    next(
                        (
                            L.get("h") or 0
                            for L in layout
                            if L.get("i") == w.get("id")
                        ),
                        0,
                    )
                )
                < 8
                for w in wlist
            )
        )
        if needs:
            existing = DEFAULT_HEALTH_DASHBOARD
            config_manager.save_compartment_dashboard("health", existing)
            return existing

        # Soft-add nutrition widgets for existing dashboards
        nutrition_types = {
            "health_nutrition_calendar",
            "health_nutrition_chart",
            "health_nutrition_notes",
        }
        if not nutrition_types.intersection(types):
            max_y = 0
            for L in layout:
                max_y = max(max_y, int(L.get("y") or 0) + int(L.get("h") or 0))
            new_widgets = [
                {
                    "id": "nutrition-cal",
                    "type": "health_nutrition_calendar",
                    "title": "Nutrition Calendar",
                    "width": "col-span-8",
                    "height": "h-80",
                    "config": {},
                },
                {
                    "id": "nutrition-notes",
                    "type": "health_nutrition_notes",
                    "title": "Nutrition Notes",
                    "width": "col-span-4",
                    "height": "h-80",
                    "config": {},
                },
                {
                    "id": "nutrition-chart",
                    "type": "health_nutrition_chart",
                    "title": "Macro Trends",
                    "width": "col-span-12",
                    "height": "h-64",
                    "config": {},
                },
            ]
            new_layout = [
                {"i": "nutrition-cal", "x": 0, "y": max_y, "w": 8, "h": 14},
                {"i": "nutrition-notes", "x": 8, "y": max_y, "w": 4, "h": 14},
                {"i": "nutrition-chart", "x": 0, "y": max_y + 14, "w": 12, "h": 10},
            ]
            dash["widgets"] = wlist + new_widgets
            dash["layout"] = layout + new_layout
            existing = {
                "dashboards": [dash] + (existing.get("dashboards") or [])[1:],
                "activeDashboardId": existing.get("activeDashboardId"),
            }
            config_manager.save_compartment_dashboard("health", existing)
    except Exception:
        logger.exception("Health dashboard migrate failed")
    return existing


@router.get("/dashboard")
async def get_health_dashboard():
    return _ensure_health_dashboard()


@router.post("/dashboard")
async def save_health_dashboard(body: DashboardSave):
    incoming_widgets = sum(len(d.get("widgets") or []) for d in body.dashboards)
    existing = config_manager.get_compartment_dashboard("health")
    existing_widgets = sum(
        len(d.get("widgets") or []) for d in (existing.get("dashboards") or [])
    )
    if incoming_widgets == 0 and existing_widgets > 0:
        return {"message": "Ignored empty dashboard save", **existing}
    payload = {
        "dashboards": body.dashboards,
        "activeDashboardId": body.activeDashboardId
        or existing.get("activeDashboardId"),
    }
    config_manager.save_compartment_dashboard("health", payload)
    return {"message": "saved"}


@router.post("/seed")
async def seed_placeholder(db: Session = Depends(get_db)):
    n = health_service.seed_placeholder_supplements(db)
    return {"seeded_rows": n}


@router.post("/import")
async def import_health(payload: ImportPayload, db: Session = Depends(get_db)):
    result = {"supplements": 0, "body": 0, "bloodwork": 0, "nutrition": 0}
    try:
        if payload.csv_text:
            rows = health_service.parse_csv_rows(payload.csv_text)
            sheet = payload.sheet or "supplements"
            if sheet == "body":
                result["body"] = health_service.upsert_body_rows(db, rows)["upserted"]
            elif sheet == "bloodwork":
                result["bloodwork"] = health_service.upsert_bloodwork_rows(db, rows)[
                    "upserted"
                ]
            elif sheet == "nutrition":
                result["nutrition"] = health_service.upsert_nutrition_rows(db, rows)[
                    "upserted"
                ]
            else:
                result["supplements"] = health_service.upsert_supplement_rows(db, rows)[
                    "upserted"
                ]
        if payload.supplement_log:
            result["supplements"] += health_service.upsert_supplement_rows(
                db, payload.supplement_log
            )["upserted"]
        if payload.body_metrics:
            result["body"] += health_service.upsert_body_rows(
                db, payload.body_metrics
            )["upserted"]
        if payload.bloodwork:
            result["bloodwork"] += health_service.upsert_bloodwork_rows(
                db, payload.bloodwork
            )["upserted"]
        return result
    except Exception as e:
        logger.exception("Health import failed")
        raise HTTPException(status_code=400, detail=str(e))


class SheetsConfigBody(BaseModel):
    supplements_url: Optional[str] = None
    body_url: Optional[str] = None
    bloodwork_url: Optional[str] = None
    nutrition_url: Optional[str] = None
    sync_minutes: Optional[int] = None


@router.get("/sheets")
async def get_sheets_config():
    return sheets_sync.ensure_sheet_defaults()


@router.post("/sheets")
async def save_sheets_config(body: SheetsConfigBody):
    updates: Dict[str, Any] = {}
    if body.supplements_url is not None:
        updates["health_sheets_supplements_url"] = body.supplements_url.strip()
    if body.body_url is not None:
        updates["health_sheets_body_url"] = body.body_url.strip()
    if body.bloodwork_url is not None:
        updates["health_sheets_bloodwork_url"] = body.bloodwork_url.strip()
    if body.nutrition_url is not None:
        updates["health_sheets_nutrition_url"] = body.nutrition_url.strip()
    if body.sync_minutes is not None:
        updates["health_sheets_sync_minutes"] = max(1, min(120, int(body.sync_minutes)))
    if updates:
        config_manager.update_config(**updates)
    return sheets_sync.ensure_sheet_defaults()


@router.post("/sheets/sync")
async def sync_sheets_now(db: Session = Depends(get_db)):
    """Manual Sync — force=True skips soft CDN guards and uses deeper consensus."""
    try:
        return sheets_sync.sync_all(db, force=True)
    except Exception as e:
        logger.exception("Sheets sync failed")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/supplements/calendar")
async def supplement_calendar(db: Session = Depends(get_db)):
    # Prefer live sheet sync over placeholder seed when URLs are configured
    if not health_service.adherence_calendar(db):
        try:
            sheets_sync.ensure_sheet_defaults()
            sheets_sync.sync_all(db)
        except Exception:
            logger.exception("Auto sheets sync on calendar load failed")
        if not health_service.adherence_calendar(db):
            health_service.seed_placeholder_supplements(db)
    return health_service.adherence_calendar(db)


@router.get("/supplements/rates")
async def supplement_rates(
    year: int | None = None,
    month: int | None = None,
    db: Session = Depends(get_db),
):
    if (year is None) ^ (month is None):
        raise HTTPException(
            status_code=400, detail="Provide both year and month, or neither"
        )
    if month is not None and not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="month must be 1-12")
    return health_service.adherence_rates(db, year=year, month=month)


@router.get("/supplements/notes")
async def supplement_notes(db: Session = Depends(get_db)):
    return health_service.notes_feed(db)


@router.get("/body/status")
async def body_status(db: Session = Depends(get_db)):
    return health_service.body_status(db)


@router.get("/body")
async def body_series(db: Session = Depends(get_db)):
    return {
        "series": health_service.body_series(db),
        "summary": health_service.body_summary(db),
    }


@router.get("/bloodwork/status")
async def bloodwork_status(db: Session = Depends(get_db)):
    return health_service.bloodwork_status(db)


@router.get("/bloodwork")
async def bloodwork_series(db: Session = Depends(get_db)):
    return {
        "series": health_service.bloodwork_series(db),
        "latest": health_service.bloodwork_latest(db),
    }


@router.get("/nutrition/calendar")
async def nutrition_calendar(db: Session = Depends(get_db)):
    return health_service.nutrition_calendar(db)


@router.get("/nutrition")
async def nutrition_series(db: Session = Depends(get_db)):
    return {
        "series": health_service.nutrition_series(db),
        "summary": health_service.nutrition_summary(db),
    }


@router.get("/nutrition/notes")
async def nutrition_notes(db: Session = Depends(get_db)):
    return health_service.nutrition_notes(db)
