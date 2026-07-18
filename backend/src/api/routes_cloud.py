"""
Cloud mirror API — keep a hosted copy of local SQLite + dashboards
so the phone companion works with the laptop closed.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel

from backend.src.config import config_manager
from backend.src.database import DB_PATH, rebind_engine
from backend.src.paths import get_user_data_dir

logger = logging.getLogger("CloudMirror")
router = APIRouter(prefix="/api/cloud", tags=["cloud"])

MIRROR_FILES = (
    "oura_database.db",
    "oura_config.json",
    "oura_dashboard.json",
    "health_dashboard.json",
    "hevy_dashboard.json",
)


def _expected_token() -> str:
    return (os.getenv("BIOTRACKER_CLOUD_TOKEN") or "").strip()


def _check_token(authorization: Optional[str], x_token: Optional[str]) -> None:
    expected = _expected_token()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Cloud mirror disabled (set BIOTRACKER_CLOUD_TOKEN on the server).",
        )
    provided = (x_token or "").strip()
    if not provided and authorization:
        auth = authorization.strip()
        if auth.lower().startswith("bearer "):
            provided = auth[7:].strip()
        else:
            provided = auth
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Invalid cloud sync token")


@router.get("/status")
def cloud_status():
    data_dir = get_user_data_dir()
    db = Path(DB_PATH)
    return {
        "cloud_mode": bool(os.getenv("BIOTRACKER_CLOUD")),
        "mirror_enabled": bool(_expected_token()),
        "data_dir": str(data_dir),
        "database_exists": db.is_file(),
        "database_bytes": db.stat().st_size if db.is_file() else 0,
        "database_mtime": (
            datetime.fromtimestamp(db.stat().st_mtime, tz=timezone.utc).isoformat()
            if db.is_file()
            else None
        ),
        "files": {name: (data_dir / name).is_file() for name in MIRROR_FILES},
    }


@router.post("/mirror")
async def receive_mirror(
    authorization: Optional[str] = Header(None),
    x_biotracker_token: Optional[str] = Header(None, alias="X-Biotracker-Token"),
    database: UploadFile = File(...),
    oura_config: Optional[UploadFile] = File(None),
    oura_dashboard: Optional[UploadFile] = File(None),
    health_dashboard: Optional[UploadFile] = File(None),
    hevy_dashboard: Optional[UploadFile] = File(None),
):
    """Replace cloud data files with a desktop push (multipart)."""
    _check_token(authorization, x_biotracker_token)
    data_dir = get_user_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    uploads = {
        "oura_database.db": database,
        "oura_config.json": oura_config,
        "oura_dashboard.json": oura_dashboard,
        "health_dashboard.json": health_dashboard,
        "hevy_dashboard.json": hevy_dashboard,
    }

    saved = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for name, upload in uploads.items():
            if upload is None:
                continue
            content = await upload.read()
            if name == "oura_database.db" and len(content) < 100:
                raise HTTPException(status_code=400, detail="Database upload too small")
            (tmp_path / name).write_bytes(content)

        from backend.src import database as dbmod

        dbmod.engine.dispose()

        for name, upload in uploads.items():
            if upload is None:
                continue
            src = tmp_path / name
            if not src.is_file():
                continue
            shutil.copy2(str(src), str(data_dir / name))
            saved.append(name)

        rebind_engine()

    logger.info("Cloud mirror updated: %s", ", ".join(saved))
    return {
        "ok": True,
        "saved": saved,
        "at": datetime.now(timezone.utc).isoformat(),
        "database_bytes": Path(DB_PATH).stat().st_size if Path(DB_PATH).is_file() else 0,
    }


class PushRemoteBody(BaseModel):
    remote_url: str
    token: str


@router.post("/client-settings")
def save_client_cloud_settings(body: PushRemoteBody):
    """Remember cloud URL + token on the desktop (local oura_config.json)."""
    remote = body.remote_url.strip().rstrip("/")
    token = body.token.strip()
    config_manager.update_config(
        cloud_remote_url=remote or "",
        cloud_sync_token=token or "",
    )
    return {"ok": True, "remote_url": remote}


@router.post("/push-to-remote")
async def push_to_remote(body: PushRemoteBody):
    """
    Desktop helper: pack local AppData files and POST them to a cloud host.
    Call this on the laptop (local backend), not on the cloud server.
    """
    remote = body.remote_url.strip().rstrip("/")
    token = body.token.strip()
    if not remote or not token:
        raise HTTPException(status_code=400, detail="remote_url and token required")

    data_dir = get_user_data_dir()
    db_file = data_dir / "oura_database.db"
    if not db_file.is_file():
        raise HTTPException(status_code=400, detail="Local database not found")

    open_handles = []
    try:
        multipart = {}
        mapping = {
            "oura_database.db": "database",
            "oura_config.json": "oura_config",
            "oura_dashboard.json": "oura_dashboard",
            "health_dashboard.json": "health_dashboard",
            "hevy_dashboard.json": "hevy_dashboard",
        }
        for fname, field in mapping.items():
            path = data_dir / fname
            if not path.is_file():
                continue
            fh = open(path, "rb")
            open_handles.append(fh)
            multipart[field] = (fname, fh, "application/octet-stream")

        async with httpx.AsyncClient(timeout=180.0) as client:
            res = await client.post(
                f"{remote}/api/cloud/mirror",
                files=multipart,
                headers={"X-Biotracker-Token": token},
            )
        if res.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Cloud rejected push ({res.status_code}): {res.text[:400]}",
            )
        config_manager.update_config(
            cloud_remote_url=remote,
            cloud_sync_token=token,
            cloud_last_push=datetime.now(timezone.utc).isoformat(),
        )
        payload = {}
        try:
            payload = res.json()
        except Exception:
            payload = {"raw": res.text[:200]}
        return {"ok": True, "remote": remote, "response": payload}
    finally:
        for fh in open_handles:
            try:
                fh.close()
            except Exception:
                pass
