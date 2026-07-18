"""
Hevy-Insights-compatible API shim.

Serves the same contract as vendor/Hevy-Insights/backend/fastapi_server.py
under prefix /api/hi so the Vue SPA can run embedded in Training.
Uses tokens stored by Usman Biotracker Google/browser login.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Cookie, HTTPException, Query, Response
from pydantic import BaseModel

from backend.src.config import config_manager
from backend.src.hevy.client import HevyClient, HevyError
from backend.src.hevy import sync as hevy_sync

logger = logging.getLogger("HevyInsightsShim")
router = APIRouter(prefix="/api/hi", tags=["hevy-insights"])

COOKIE_ACCESS = "hevy_access_token"
COOKIE_REFRESH = "hevy_refresh_token"
COOKIE_EXPIRES = "hevy_token_expires_at"


class AuthStatusResponse(BaseModel):
    authenticated: bool
    auth_mode: Optional[str] = None


class LoginRequest(BaseModel):
    emailOrUsername: str
    password: str


class LoginResponse(BaseModel):
    message: str
    user_id: Optional[str] = None


def _set_auth_cookies(response: Response, access: str, refresh: Optional[str], expires: Optional[str]):
    response.set_cookie(COOKIE_ACCESS, access, httponly=True, samesite="lax", max_age=3600 * 24 * 30)
    if refresh:
        response.set_cookie(COOKIE_REFRESH, refresh, httponly=True, samesite="lax", max_age=3600 * 24 * 90)
    if expires:
        response.set_cookie(COOKIE_EXPIRES, str(expires), httponly=True, samesite="lax", max_age=3600 * 24 * 30)


def _clear_auth_cookies(response: Response):
    for name in (COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_EXPIRES):
        response.delete_cookie(name)


def _tokens_from_config_or_cookies(
    access_cookie: Optional[str], refresh_cookie: Optional[str]
) -> tuple[Optional[str], Optional[str]]:
    cfg = config_manager.get_config()
    access = access_cookie or cfg.get("hevy_access_token")
    refresh = refresh_cookie or cfg.get("hevy_refresh_token")
    if access in ("csv_mode", "api_key_mode"):
        access = cfg.get("hevy_access_token")
    return access, refresh


def _client(access_cookie: Optional[str] = None, refresh_cookie: Optional[str] = None) -> HevyClient:
    access, refresh = _tokens_from_config_or_cookies(access_cookie, refresh_cookie)
    if not access and not refresh:
        raise HevyError("Not authenticated. Log in via Training Settings (Google browser).")
    client = HevyClient(access_token=access)
    if refresh:
        try:
            user = client.refresh_access_token(refresh)
            config_manager.update_config(
                hevy_access_token=user.access_token,
                hevy_refresh_token=user.refresh_token,
                hevy_token_expires_at=user.expires_at,
            )
        except HevyError:
            if not access:
                raise
    return client


def _local_workout_count() -> int:
    from backend.src.database import SessionLocal

    db = SessionLocal()
    try:
        return hevy_sync.local_workout_count(db)
    except Exception as e:
        logger.warning("local workout count failed: %s", e)
        return 0
    finally:
        db.close()


@router.get("/auth/status", response_model=AuthStatusResponse)
def auth_status(
    response: Response,
    hevy_access_token: Optional[str] = Cookie(None),
    hevy_refresh_token: Optional[str] = Cookie(None),
):
    access, refresh = _tokens_from_config_or_cookies(hevy_access_token, hevy_refresh_token)
    if access or refresh:
        # Ensure SPA cookies are set so subsequent calls work like stock Hevy-Insights
        if access:
            cfg = config_manager.get_config()
            _set_auth_cookies(
                response,
                access,
                refresh or cfg.get("hevy_refresh_token"),
                cfg.get("hevy_token_expires_at"),
            )
        return AuthStatusResponse(authenticated=True, auth_mode="oauth2")
    # No live session — still allow Insights UI when SQLite has synced workouts
    if _local_workout_count() > 0:
        return AuthStatusResponse(authenticated=True, auth_mode="local_cache")
    return AuthStatusResponse(authenticated=False, auth_mode=None)


@router.post("/login", response_model=LoginResponse)
def login(credentials: LoginRequest, response: Response):
    try:
        result = hevy_sync.login_and_store(
            credentials.emailOrUsername, credentials.password, headless=True
        )
        cfg = config_manager.get_config()
        _set_auth_cookies(
            response,
            cfg.get("hevy_access_token"),
            cfg.get("hevy_refresh_token"),
            cfg.get("hevy_token_expires_at"),
        )
        return LoginResponse(message="Login successful", user_id=result.get("username"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/logout")
def logout(response: Response):
    _clear_auth_cookies(response)
    with config_manager._lock:
        main = config_manager._load_file(config_manager.config_path)
        for k in ("hevy_access_token", "hevy_refresh_token", "hevy_token_expires_at"):
            main[k] = None
        main["hevy_status"] = "Idle"
        config_manager._save_file(config_manager.config_path, main)
    return {"message": "Logged out successfully"}


def _cached_account(cfg: dict) -> Optional[dict]:
    cached = cfg.get("hevy_account_cache")
    if isinstance(cached, dict) and cached.get("username"):
        return cached
    if cfg.get("hevy_username"):
        return {
            "username": cfg.get("hevy_username"),
            "email": cfg.get("hevy_email") or "",
        }
    return None


@router.get("/user/account")
def get_user_account(
    hevy_access_token: Optional[str] = Cookie(None),
    hevy_refresh_token: Optional[str] = Cookie(None),
):
    cfg = config_manager.get_config()
    access, refresh = _tokens_from_config_or_cookies(hevy_access_token, hevy_refresh_token)
    if not access and not refresh:
        cached = _cached_account(cfg)
        if cached:
            return cached
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        client = _client(hevy_access_token, hevy_refresh_token)
        account = client.get_user_account()
        if account.get("username"):
            config_manager.update_config(
                hevy_username=account["username"],
                hevy_account_cache=account,
            )
        return account
    except HevyError as e:
        cached = _cached_account(cfg)
        if cached:
            return cached
        raise HTTPException(
            status_code=401 if "Unauthorized" in str(e) else 500, detail=str(e)
        )


@router.get("/workouts")
def get_workouts(
    hevy_access_token: Optional[str] = Cookie(None),
    hevy_refresh_token: Optional[str] = Cookie(None),
    offset: int = Query(0, ge=0),
    username: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    refresh: bool = Query(False),
):
    """
    Serve workouts from local SQLite (like Oura).
    Live Hevy API is only used when DB is empty or refresh=1 / Sync workouts.
    """
    from backend.src.database import SessionLocal

    db = SessionLocal()
    try:
        access, refresh_tok = _tokens_from_config_or_cookies(
            hevy_access_token, hevy_refresh_token
        )
        count = hevy_sync.local_workout_count(db)

        # Offline / after restart: serve SQLite without requiring a live Hevy session
        if not access and not refresh_tok:
            if count > 0 and not refresh:
                return hevy_sync.workouts_page_from_db(db, offset=offset, limit=5)
            raise HTTPException(
                status_code=401,
                detail="Not authenticated. Sign in via Training Settings to sync.",
            )

        if refresh or count == 0:
            # First load / explicit refresh: pull from Hevy into SQLite
            try:
                hevy_sync.sync_all_workouts(db)
            except HevyError as e:
                if count == 0:
                    raise HTTPException(
                        status_code=401 if "Unauthorized" in str(e) else 500,
                        detail=str(e),
                    )
                # Keep serving stale local cache if refresh fails
                logger.warning("Hevy live refresh failed; serving local cache: %s", e)

        return hevy_sync.workouts_page_from_db(db, offset=offset, limit=5)
    finally:
        db.close()


@router.get("/body_measurements")
def get_body_measurements(
    hevy_access_token: Optional[str] = Cookie(None),
    hevy_refresh_token: Optional[str] = Cookie(None),
):
    access, refresh = _tokens_from_config_or_cookies(hevy_access_token, hevy_refresh_token)
    if not access and not refresh:
        # Local-cache mode: no live Hevy session — empty list (workouts still available)
        return []
    try:
        client = _client(hevy_access_token, hevy_refresh_token)
        return client.get_body_measurements()
    except AttributeError:
        # Method may not exist yet — add thin wrapper
        client = _client(hevy_access_token, hevy_refresh_token)
        r = client.session.get(f"{client.base_url}/body_measurements", timeout=30)
        r.raise_for_status()
        return r.json()
    except HevyError as e:
        raise HTTPException(status_code=401 if "Unauthorized" in str(e) else 500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class BodyMeasRequest(BaseModel):
    weight_kg: float
    date: str


@router.post("/body_measurements_batch")
def post_body_measurements(
    data: BodyMeasRequest,
    hevy_access_token: Optional[str] = Cookie(None),
    hevy_refresh_token: Optional[str] = Cookie(None),
):
    try:
        client = _client(hevy_access_token, hevy_refresh_token)
        body = {
            "measurementsBatch": [
                {
                    "date": data.date,
                    "weight_kg": data.weight_kg,
                    "_unsyncedObjectId": "usman_biotracker",
                }
            ]
        }
        r = client.session.post(
            f"{client.base_url}/body_measurements_batch", json=body, timeout=30
        )
        r.raise_for_status()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
def hi_health():
    return {"status": "ok", "service": "hevy-insights-shim"}


@router.get("/version/check")
def version_check():
    return {
        "current_version": "embedded",
        "latest_version": "embedded",
        "update_available": False,
    }
