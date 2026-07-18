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
        wlist = dash.get("widgets") or []
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
                            for L in (dash.get("layout") or [])
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
    except Exception:
        pass
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
    result = {"supplements": 0, "body": 0, "bloodwork": 0}
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
    if body.sync_minutes is not None:
        updates["health_sheets_sync_minutes"] = max(1, min(120, int(body.sync_minutes)))
    if updates:
        config_manager.update_config(**updates)
    return sheets_sync.ensure_sheet_defaults()


@router.post("/sheets/sync")
async def sync_sheets_now(db: Session = Depends(get_db)):
    try:
        return sheets_sync.sync_all(db)
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
async def supplement_rates(db: Session = Depends(get_db)):
    return health_service.adherence_rates(db)


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
