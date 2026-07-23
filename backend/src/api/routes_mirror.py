"""Phone / Vercel mirror snapshot — pack of local Biotracker data for static hosting."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.src.config import config_manager
from backend.src.database import get_db
from backend.src.health import service as health_service
from backend.src.hevy import sync as hevy_sync
from backend.src.models_health import HealthBloodwork, HealthBodyMetrics

logger = logging.getLogger("MirrorAPI")
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
        "health_nutrition_calendar": health_service.nutrition_calendar(db),
        "health_nutrition": {
            "series": health_service.nutrition_series(db),
            "summary": health_service.nutrition_summary(db),
        },
        "health_nutrition_notes": health_service.nutrition_notes(db),
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
            "nutrition_url": cfg.get("health_sheets_nutrition_url") or "",
            "sync_minutes": int(cfg.get("health_sheets_sync_minutes") or 5),
            "last_sync": cfg.get("health_sheets_last_sync"),
            "last_status": cfg.get("health_sheets_last_status"),
            "last_counts": cfg.get("health_sheets_last_counts"),
        },
    }


@router.get("/snapshot")
async def mirror_snapshot(db: Session = Depends(get_db)):
    return build_mirror_snapshot(db)


def _is_repo_root(path: Path) -> bool:
    try:
        return (path / "web" / "scripts" / "export-snapshot.mjs").is_file() and (
            (path / ".git").exists()
        )
    except OSError:
        return False


def _walk_roots_from(start: Path) -> List[Path]:
    try:
        start = start.resolve()
    except OSError:
        return []
    cur = start if start.is_dir() else start.parent
    return [cur, *list(cur.parents)]


def _find_repo_root() -> Optional[Path]:
    """
    Locate the Cracked-Oura git checkout (needs web/scripts/export-snapshot.mjs).
    Works for source uvicorn and packaged backend.exe under frontend/dist/...
    """
    starts: List[Path] = []

    cfg = config_manager.get_config()
    for key in ("phone_repo_path", "mirror_repo_root", "repo_root"):
        raw = cfg.get(key)
        if raw:
            starts.append(Path(str(raw)))

    for env_key in ("BIO_REPO_ROOT", "CRACKED_OURA_ROOT", "CRACKED_OURA_REPO"):
        val = os.environ.get(env_key)
        if val:
            starts.append(Path(val))

    if getattr(sys, "frozen", False):
        starts.append(Path(sys.executable))
    starts.append(Path(__file__).resolve())
    starts.append(Path.cwd())
    starts.append(Path.home() / ".cursor" / "Cracked-Oura")
    starts.append(Path.home() / "Documents" / "Cracked-Oura")

    seen: set[str] = set()
    for start in starts:
        for parent in _walk_roots_from(start):
            key = str(parent).lower()
            if key in seen:
                continue
            seen.add(key)
            if _is_repo_root(parent):
                try:
                    if cfg.get("phone_repo_path") != str(parent):
                        config_manager.update_config(phone_repo_path=str(parent))
                except Exception:
                    pass
                return parent
    return None


def _augment_path_env() -> Dict[str, str]:
    """Ensure npm/git are visible when Electron-spawned backend has a thin PATH."""
    env = os.environ.copy()
    extras: List[str] = []
    if os.name == "nt":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        local = os.environ.get("LOCALAPPDATA", "")
        extras.extend(
            [
                str(Path(pf) / "nodejs"),
                str(Path(pf86) / "nodejs"),
                str(Path(pf) / "Git" / "cmd"),
                str(Path(pf) / "Git" / "bin"),
                str(Path(local) / "Programs" / "Git" / "cmd") if local else "",
                str(Path(local) / "Microsoft" / "WindowsApps") if local else "",
            ]
        )
    else:
        extras.extend(["/usr/local/bin", "/opt/homebrew/bin"])

    parts = [p for p in extras if p and Path(p).is_dir()]
    if parts:
        env["PATH"] = os.pathsep.join(parts + [env.get("PATH", "")])
    return env


def _resolve_tool(name: str) -> Optional[str]:
    path_env = _augment_path_env().get("PATH")
    found = shutil.which(name, path=path_env)
    if found:
        return found
    if os.name == "nt":
        found = shutil.which(f"{name}.cmd", path=path_env) or shutil.which(
            f"{name}.exe", path=path_env
        )
        if found:
            return found
    return None


def _run(cmd: list[str], cwd: Path, timeout: int = 300) -> tuple[int, str]:
    env = _augment_path_env()
    try:
        resolved = list(cmd)
        tool = _resolve_tool(resolved[0])
        if tool:
            resolved[0] = tool

        if os.name == "nt":
            cmdline = subprocess.list2cmdline(resolved)
            proc = subprocess.run(
                cmdline,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout,
                shell=True,
                env=env,
            )
        else:
            proc = subprocess.run(
                resolved,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
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
    Same flow as scripts/Update-Phone-Site.bat (for the Settings / header button).

    Runs in a worker thread so the event loop stays free — export:snapshot
    calls back into this same backend and would deadlock otherwise.
    """
    import asyncio

    return await asyncio.to_thread(_publish_phone_mirror_sync)


def _publish_phone_mirror_sync() -> Dict[str, Any]:
    root = _find_repo_root()
    if not root:
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not find your Cracked-Oura git folder "
                "(needs web/scripts/export-snapshot.mjs). "
                "Keep the repo at %USERPROFILE%\\.cursor\\Cracked-Oura, "
                "or run scripts\\Update-Phone-Site.bat."
            ),
        )

    logs: list[str] = [f"Repo: {root}"]
    web = root / "web"

    if not _resolve_tool("npm"):
        raise HTTPException(
            status_code=500,
            detail="\n".join(
                logs
                + [
                    "npm not found on PATH. Install Node.js, then retry — "
                    "or run scripts\\Update-Phone-Site.bat from a terminal where npm works."
                ]
            ),
        )
    if not _resolve_tool("git"):
        raise HTTPException(
            status_code=500,
            detail="\n".join(
                logs
                + [
                    "git not found on PATH. Install Git for Windows, then retry — "
                    "or run scripts\\Update-Phone-Site.bat from Git Bash."
                ]
            ),
        )

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
        raise HTTPException(
            status_code=500, detail="Export did not write mirror-snapshot.json"
        )

    logs.append("Staging snapshot…")
    code, out = _run(
        ["git", "add", "--", "web/public/mirror-snapshot.json"],
        cwd=root,
        timeout=60,
    )
    if code != 0:
        raise HTTPException(
            status_code=500, detail="\n".join(logs + [out, "git add failed."])
        )

    code, status_out = _run(
        ["git", "status", "--porcelain", "--", "web/public/mirror-snapshot.json"],
        cwd=root,
        timeout=30,
    )
    if not (status_out or "").strip():
        logs.append("Snapshot unchanged — nothing to push.")
        return {
            "status": "ok",
            "pushed": False,
            "message": "Already up to date",
            "logs": logs,
        }

    logs.append("Committing…")
    code, out = _run(
        ["git", "commit", "-m", "Update phone snapshot from desktop."],
        cwd=root,
        timeout=60,
    )
    if out:
        logs.append(out[-2000:])
    if code != 0:
        raise HTTPException(
            status_code=500, detail="\n".join(logs + ["git commit failed."])
        )

    logs.append("Pushing to GitHub (Vercel redeploy)…")
    code, out = _run(["git", "push"], cwd=root, timeout=180)
    if out:
        logs.append(out[-2000:])
    if code != 0:
        raise HTTPException(
            status_code=500, detail="\n".join(logs + ["git push failed."])
        )

    logs.append("Done. Wait ~1 minute, then hard-refresh the phone site.")
    return {
        "status": "ok",
        "pushed": True,
        "message": "Phone snapshot pushed — Vercel will redeploy.",
        "logs": logs,
    }
