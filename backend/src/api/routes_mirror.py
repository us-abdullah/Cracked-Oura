"""Phone / Vercel mirror snapshot — pack of local Biotracker data for static hosting."""

from __future__ import annotations

import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
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


def _find_repo_root() -> Path | None:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "web" / "scripts" / "export-snapshot.mjs").is_file() and (
            parent / ".git"
        ).exists():
            return parent
    return None


def _run(cmd: list[str], cwd: Path, timeout: int = 300) -> tuple[int, str]:
    try:
        if os.name == "nt":
            # shell=True so npm.cmd / git resolve via PATH
            cmdline = subprocess.list2cmdline(cmd)
            proc = subprocess.run(
                cmdline,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout,
                shell=True,
            )
        else:
            proc = subprocess.run(
                cmd,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        out = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode, out.strip()
    except subprocess.TimeoutExpired:
        return 1, f"Timed out after {timeout}s: {' '.join(cmd)}"
    except FileNotFoundError as e:
        return 1, f"Command not found: {e}"


@router.post("/publish")
async def publish_phone_mirror():
    """
    Export desktop data → web/public/mirror-snapshot.json → git commit + push.
    Same flow as scripts/Update-Phone-Site.bat (for the Settings button).
    """
    root = _find_repo_root()
    if not root:
        raise HTTPException(
            status_code=400,
            detail=(
                "Git repo not found next to this backend. "
                "Double-click scripts\\Update-Phone-Site.bat inside your Cracked-Oura folder instead."
            ),
        )

    logs: list[str] = []
    web = root / "web"

    logs.append("Exporting snapshot…")
    code, out = _run(
        ["npm", "run", "export:snapshot"],
        cwd=web,
        timeout=300,
    )
    if out:
        logs.append(out[-4000:])
    if code != 0:
        raise HTTPException(status_code=500, detail="\n".join(logs + ["Export failed."]))

    snap = web / "public" / "mirror-snapshot.json"
    if not snap.is_file():
        raise HTTPException(status_code=500, detail="Export did not write mirror-snapshot.json")

    logs.append("Staging snapshot…")
    code, out = _run(
        ["git", "add", "--", "web/public/mirror-snapshot.json"],
        cwd=root,
        timeout=60,
    )
    if code != 0:
        raise HTTPException(status_code=500, detail="\n".join(logs + [out, "git add failed."]))

    code, status_out = _run(
        ["git", "status", "--porcelain", "--", "web/public/mirror-snapshot.json"],
        cwd=root,
        timeout=30,
    )
    if not (status_out or "").strip():
        logs.append("Snapshot unchanged — nothing to push.")
        return {"status": "ok", "pushed": False, "message": "Already up to date", "logs": logs}

    logs.append("Committing…")
    code, out = _run(
        ["git", "commit", "-m", "Update phone snapshot from desktop."],
        cwd=root,
        timeout=60,
    )
    if out:
        logs.append(out[-2000:])
    if code != 0:
        raise HTTPException(status_code=500, detail="\n".join(logs + ["git commit failed."]))

    logs.append("Pushing to GitHub (Vercel redeploy)…")
    code, out = _run(["git", "push"], cwd=root, timeout=180)
    if out:
        logs.append(out[-2000:])
    if code != 0:
        raise HTTPException(status_code=500, detail="\n".join(logs + ["git push failed."]))

    logs.append("Done. Wait ~1 minute, then hard-refresh the phone site.")
    return {
        "status": "ok",
        "pushed": True,
        "message": "Phone snapshot pushed — Vercel will redeploy.",
        "logs": logs,
    }
