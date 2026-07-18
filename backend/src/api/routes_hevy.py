"""Training (Hevy) API routes — login/sync for Biotracker Settings.

Full analytics UI is the embedded Hevy-Insights Vue app (see routes_hevy_insights).
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.src.config import config_manager
from backend.src.database import get_db, SessionLocal
from backend.src.hevy import sync as hevy_sync
from backend.src.hevy.client import HevyError

logger = logging.getLogger("HevyAPI")
router = APIRouter(prefix="/api/hevy", tags=["hevy"])


class HevyLoginRequest(BaseModel):
    email: str
    password: str
    headless: bool = True


class DashboardSave(BaseModel):
    dashboards: list
    activeDashboardId: Optional[str] = None


@router.get("/dashboard")
async def get_training_dashboard():
    # Training UI is Hevy-Insights embed — keep a stub so old clients don't 404
    return {
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


@router.post("/dashboard")
async def save_training_dashboard(body: DashboardSave):
    return {"message": "ignored — Training uses Hevy Insights embed"}


def _has_hevy_tokens(cfg: dict) -> bool:
    access = cfg.get("hevy_access_token")
    refresh = cfg.get("hevy_refresh_token")
    return bool(access) or bool(refresh)


@router.get("/status")
async def hevy_status():
    cfg = config_manager.get_config()
    workout_count = 0
    db = SessionLocal()
    try:
        workout_count = hevy_sync.local_workout_count(db)
    except Exception as e:
        logger.warning("Could not count local Hevy workouts: %s", e)
    finally:
        db.close()

    return {
        "status": cfg.get("hevy_status", "Idle"),
        "email": cfg.get("hevy_email", ""),
        "username": cfg.get("hevy_username", ""),
        "logged_in": _has_hevy_tokens(cfg),
        # Synced SQLite cache — browse Training after restart without re-login (like Oura)
        "has_local_data": workout_count > 0,
        "workout_count": workout_count,
        "last_run": cfg.get("hevy_last_run"),
        "schedule_time": cfg.get("hevy_schedule_time", "11:30"),
    }


@router.post("/login")
async def hevy_login(req: HevyLoginRequest):
    import asyncio

    try:
        result = await asyncio.to_thread(
            hevy_sync.login_and_store, req.email, req.password, req.headless
        )
        return result
    except Exception as e:
        logger.exception("Hevy login failed")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login-browser")
async def hevy_login_browser():
    import asyncio

    try:
        result = await asyncio.to_thread(hevy_sync.login_via_browser_and_store, 300)
        return result
    except Exception as e:
        logger.exception("Hevy browser login failed")
        config_manager.update_config(hevy_status=f"Error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sync")
async def hevy_sync_now():
    import asyncio

    db = SessionLocal()
    try:
        result = await asyncio.to_thread(hevy_sync.sync_all_workouts, db)
        return result
    except HevyError as e:
        config_manager.update_config(hevy_status=f"Error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        config_manager.update_config(hevy_status=f"Error: {e}")
        logger.exception("Hevy sync failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.post("/logout")
async def hevy_logout():
    with config_manager._lock:
        main = config_manager._load_file(config_manager.config_path)
        for k in (
            "hevy_access_token",
            "hevy_refresh_token",
            "hevy_token_expires_at",
        ):
            main[k] = None
        main["hevy_status"] = "Idle"
        config_manager._save_file(config_manager.config_path, main)
    return {"message": "logged out"}


# Keep lightweight analytics endpoints for optional use; Insights UI is primary
@router.get("/analytics/heatmap")
async def analytics_heatmap(weeks: int = 26, db: Session = Depends(get_db)):
    return hevy_sync.frequency_heatmap(db, weeks=weeks)


@router.get("/exercises")
async def list_exercises(db: Session = Depends(get_db)):
    return hevy_sync.exercise_titles(db)
