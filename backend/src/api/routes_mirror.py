"""Phone / Vercel mirror snapshot — pack of local Biotracker data for static hosting."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.src.config import config_manager
from backend.src.database import get_db
from backend.src.health import service as health_service
from backend.src.hevy import sync as hevy_sync
from backend.src.models_health import HealthBloodwork, HealthBodyMetrics

router = APIRouter(prefix="/api/mirror", tags=["mirror"])


def build_mirror_snapshot(db: Session) -> Dict[str, Any]:
    cfg = config_manager.get_config()

    recovery_layout = config_manager.get_compartment_dashboard("recovery")
    if not recovery_layout.get("dashboards"):
        recovery_layout = cfg.get("dashboard") or {
            "dashboards": [],
            "activeDashboardId": None,
        }

    health_layout = config_manager.get_compartment_dashboard("health") or {
        "dashboards": [],
        "activeDashboardId": None,
    }
    training_layout = config_manager.get_compartment_dashboard("training") or {
        "dashboards": [
            {
                "id": "hevy-insights",
                "name": "Hevy Insights",
                "widgets": [],
                "layout": [],
            }
        ],
        "activeDashboardId": "hevy-insights",
    }

    workout_count = 0
    try:
        workout_count = hevy_sync.local_workout_count(db)
    except Exception:
        pass

    body = [
        {
            "date": r.date.isoformat(),
            "weight": r.weight,
            "body_fat_pct": r.body_fat_pct,
            "notes": r.notes or "",
        }
        for r in db.query(HealthBodyMetrics).order_by(HealthBodyMetrics.date.asc()).all()
    ]
    blood = []
    for r in db.query(HealthBloodwork).order_by(HealthBloodwork.date.asc()).all():
        blood.append(
            {
                "date": r.date.isoformat(),
                "total_cholesterol": r.total_cholesterol,
                "hdl": r.hdl,
                "ldl": r.ldl,
                "triglycerides": r.triglycerides,
                "fasting_glucose": r.fasting_glucose,
                "hba1c": r.hba1c,
                "vitamin_d": r.vitamin_d,
                "vitamin_b12": r.vitamin_b12,
                "iron": r.iron,
                "ferritin": r.ferritin,
                "magnesium": r.magnesium,
                "zinc": r.zinc,
                "testosterone": r.testosterone,
                "notes": r.notes or "",
            }
        )

    return {
        "version": 1,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "recovery_layout": recovery_layout,
        "health_layout": health_layout,
        "training_layout": training_layout,
        "hevy_status": {
            "status": cfg.get("hevy_status", "Idle"),
            "email": cfg.get("hevy_email", ""),
            "username": cfg.get("hevy_username", "") or "local",
            "logged_in": bool(cfg.get("hevy_access_token") or cfg.get("hevy_refresh_token")),
            "has_local_data": workout_count > 0,
            "workout_count": workout_count,
            "last_run": cfg.get("hevy_last_run"),
            "schedule_time": cfg.get("hevy_schedule_time", "11:30"),
        },
        "health_calendar": health_service.adherence_calendar(db),
        "health_rates": health_service.adherence_rates(db),
        "health_notes": health_service.notes_feed(db),
        "health_body": body,
        "health_bloodwork": blood,
        # Filled by export script (accurate DayDataResponse shape via /api/days)
        "days": {},
        "settings": {
            "email": cfg.get("email", ""),
            "daily_sync_time": cfg.get("schedule_time", "11:00"),
            "schedule_time": cfg.get("schedule_time", "11:00"),
            "llm_model": cfg.get("llm_model"),
            "llm_host": cfg.get("llm_host"),
            "llm_reasoning": cfg.get("llm_reasoning", False),
            "llm_num_ctx": cfg.get("llm_num_ctx", 4096),
            "status": cfg.get("status", "Idle"),
        },
        "sheets": {
            "supplements_url": cfg.get("health_sheets_supplements_url") or "",
            "body_url": cfg.get("health_sheets_body_url") or "",
            "bloodwork_url": cfg.get("health_sheets_bloodwork_url") or "",
            "sync_minutes": int(cfg.get("health_sheets_sync_minutes") or 5),
            "last_sync": cfg.get("health_sheets_last_sync"),
            "last_status": cfg.get("health_sheets_last_status"),
            "last_counts": cfg.get("health_sheets_last_counts"),
        },
    }


@router.get("/snapshot")
async def mirror_snapshot(db: Session = Depends(get_db)):
    return build_mirror_snapshot(db)
