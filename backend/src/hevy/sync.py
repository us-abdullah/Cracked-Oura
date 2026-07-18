"""Hevy sync + analytics."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session, joinedload

from backend.src.config import config_manager
from backend.src.models_hevy import HevyExercise, HevySet, HevyWorkout
from backend.src.hevy.client import HevyClient, HevyError

logger = logging.getLogger("HevySync")
_sync_lock = threading.Lock()


def _dt_from_unix(ts: Any) -> Optional[datetime]:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def upsert_workout(db: Session, w: dict) -> None:
    wid = str(w.get("id") or w.get("short_id"))
    if not wid:
        return
    start = _dt_from_unix(w.get("start_time"))
    end = _dt_from_unix(w.get("end_time"))
    duration = None
    if start and end:
        duration = int((end - start).total_seconds())

    existing = db.get(HevyWorkout, wid)
    if existing:
        existing.name = w.get("name") or w.get("title")
        existing.start_time = start
        existing.end_time = end
        existing.duration_sec = duration
        existing.estimated_volume_kg = w.get("estimated_volume_kg")
        existing.username = w.get("username")
        existing.raw = w  # full Hevy API payload for Insights offline cache
        # Replace children
        for ex in list(existing.exercises):
            db.delete(ex)
    else:
        existing = HevyWorkout(
            id=wid,
            name=w.get("name") or w.get("title"),
            start_time=start,
            end_time=end,
            duration_sec=duration,
            estimated_volume_kg=w.get("estimated_volume_kg"),
            username=w.get("username"),
            raw=w,
        )
        db.add(existing)

    for i, ex in enumerate(w.get("exercises") or []):
        eid = str(ex.get("id") or f"{wid}-ex-{i}")
        exercise = HevyExercise(
            id=eid,
            workout_id=wid,
            title=ex.get("title") or ex.get("exercise_template_id"),
            muscle_group=ex.get("muscle_group"),
            exercise_template_id=str(ex.get("exercise_template_id") or "") or None,
            index=ex.get("index", i),
            notes=ex.get("notes"),
        )
        db.add(exercise)
        for j, s in enumerate(ex.get("sets") or []):
            sid = str(s.get("id") or f"{eid}-set-{j}")
            db.add(
                HevySet(
                    id=sid,
                    exercise_id=eid,
                    index=s.get("index", j),
                    weight_kg=s.get("weight_kg"),
                    reps=s.get("reps"),
                    rpe=s.get("rpe"),
                    indicator=s.get("indicator") or s.get("set_type"),
                    prs=s.get("prs") or s.get("personalRecords"),
                )
            )


def get_authed_client() -> HevyClient:
    cfg = config_manager.get_config()
    access = cfg.get("hevy_access_token")
    refresh = cfg.get("hevy_refresh_token")
    if not access and not refresh:
        raise HevyError("Not logged into Hevy. Log in from Settings → Training.")
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
            # keep existing access token; may still work
            pass
    return client


def sync_all_workouts(db: Session) -> Dict[str, Any]:
    with _sync_lock:
        return _sync_all_workouts_unlocked(db)


def _sync_all_workouts_unlocked(db: Session) -> Dict[str, Any]:
    config_manager.update_config(hevy_status="Syncing")
    client = get_authed_client()
    account = client.get_user_account()
    username = account.get("username")
    if not username:
        raise HevyError("Could not resolve Hevy username from account")
    config_manager.update_config(hevy_username=username)

    total = 0
    offset = 0
    max_pages = 2000
    for _ in range(max_pages):
        data = client.get_workouts(username=username, offset=offset)
        batch = data.get("workouts") or []
        if not batch:
            break
        for w in batch:
            upsert_workout(db, w)
            total += 1
        db.commit()
        offset += 5
        if len(batch) < 5:
            break

    now = datetime.now().isoformat()
    config_manager.update_config(
        hevy_status="Idle",
        hevy_last_run=now,
        hevy_account_cache=account,
    )
    return {"imported": total, "username": username, "last_run": now}


def _unix(dt: Optional[datetime]) -> Optional[int]:
    if not dt:
        return None
    try:
        return int(dt.replace(tzinfo=timezone.utc).timestamp())
    except Exception:
        return None


def workout_to_api_dict(w: HevyWorkout) -> dict:
    """Hevy Insights expects API-shaped workouts (prefer stored raw)."""
    if isinstance(w.raw, dict) and w.raw.get("id"):
        return w.raw

    exercises = []
    for ex in sorted(w.exercises or [], key=lambda e: e.index if e.index is not None else 0):
        sets = []
        for s in sorted(ex.sets or [], key=lambda x: x.index if x.index is not None else 0):
            sets.append(
                {
                    "id": s.id,
                    "index": s.index,
                    "weight_kg": s.weight_kg,
                    "reps": s.reps,
                    "rpe": s.rpe,
                    "indicator": s.indicator,
                    "set_type": s.indicator,
                    "prs": s.prs,
                }
            )
        exercises.append(
            {
                "id": ex.id,
                "title": ex.title,
                "muscle_group": ex.muscle_group,
                "exercise_template_id": ex.exercise_template_id,
                "index": ex.index,
                "notes": ex.notes,
                "sets": sets,
            }
        )
    return {
        "id": w.id,
        "name": w.name,
        "title": w.name,
        "start_time": _unix(w.start_time),
        "end_time": _unix(w.end_time),
        "estimated_volume_kg": w.estimated_volume_kg,
        "username": w.username,
        "exercises": exercises,
    }


def workouts_page_from_db(
    db: Session, offset: int = 0, limit: int = 5
) -> Dict[str, Any]:
    """Page workouts newest-first — same shape as Hevy user_workouts_paged."""
    q = (
        db.query(HevyWorkout)
        .options(
            joinedload(HevyWorkout.exercises).joinedload(HevyExercise.sets)
        )
        .order_by(HevyWorkout.start_time.desc())
    )
    rows = q.offset(max(0, offset)).limit(max(1, limit)).all()
    return {"workouts": [workout_to_api_dict(w) for w in rows]}


def local_workout_count(db: Session) -> int:
    return db.query(HevyWorkout).count()


def login_and_store(email: str, password: str, headless: bool = True) -> Dict[str, Any]:
    from backend.src.hevy.recaptcha import fetch_recaptcha_token_sync

    config_manager.update_config(hevy_status="Logging in", hevy_email=email)
    token = fetch_recaptcha_token_sync(headless=headless)
    client = HevyClient()
    user = client.login(email, password, token)
    # Resolve username
    username = user.username
    try:
        account = client.get_user_account()
        username = account.get("username") or username
    except Exception:
        pass
    config_manager.update_config(
        hevy_email=email,
        hevy_username=username,
        hevy_access_token=user.access_token,
        hevy_refresh_token=user.refresh_token,
        hevy_token_expires_at=user.expires_at,
        hevy_status="Logged in",
    )
    return {"username": username, "email": email, "status": "Logged in"}


def login_via_browser_and_store(timeout_sec: int = 300) -> Dict[str, Any]:
    """Google / Apple / social login: user signs in in a browser window."""
    from backend.src.hevy.browser_login import login_via_browser_sync

    config_manager.update_config(hevy_status="Waiting for browser login")
    tokens = login_via_browser_sync(timeout_sec=timeout_sec)
    access = tokens["access_token"]
    refresh = tokens.get("refresh_token")
    config_manager.update_config(
        hevy_access_token=access,
        hevy_refresh_token=refresh,
        hevy_token_expires_at=tokens.get("expires_at"),
        hevy_status="Logged in",
    )

    username = None
    email = None
    try:
        client = HevyClient(access_token=access)
        account = client.get_user_account()
        username = account.get("username")
        email = account.get("email")
        if username or email:
            config_manager.update_config(
                hevy_username=username,
                hevy_email=email or "",
            )
    except Exception as e:
        logger.warning(f"Browser login OK but account fetch failed: {e}")

    return {
        "username": username,
        "email": email,
        "status": "Logged in",
        "method": "browser",
    }


# --- Analytics ---

def frequency_heatmap(db: Session, weeks: int = 26) -> List[Dict[str, Any]]:
    since = datetime.utcnow() - timedelta(weeks=weeks)
    rows = (
        db.query(HevyWorkout)
        .filter(HevyWorkout.start_time.isnot(None), HevyWorkout.start_time >= since)
        .all()
    )
    counts: Dict[str, int] = {}
    for w in rows:
        if w.start_time:
            key = w.start_time.date().isoformat()
            counts[key] = counts.get(key, 0) + 1
    return [{"date": d, "count": c} for d, c in sorted(counts.items())]


def volume_by_muscle(db: Session, days: int = 90) -> List[Dict[str, Any]]:
    since = datetime.utcnow() - timedelta(days=days)
    workouts = (
        db.query(HevyWorkout)
        .options(joinedload(HevyWorkout.exercises).joinedload(HevyExercise.sets))
        .filter(HevyWorkout.start_time.isnot(None), HevyWorkout.start_time >= since)
        .all()
    )
    # day -> muscle -> volume
    series: Dict[str, Dict[str, float]] = {}
    for w in workouts:
        day = w.start_time.date().isoformat()
        series.setdefault(day, {})
        for ex in w.exercises:
            mg = ex.muscle_group or "unknown"
            vol = 0.0
            for s in ex.sets:
                vol += (s.weight_kg or 0) * (s.reps or 0)
            series[day][mg] = series[day].get(mg, 0) + vol
    out = []
    for day in sorted(series.keys()):
        out.append({"date": day, "muscles": series[day]})
    return out


def progressive_overload(
    db: Session, exercise_title: Optional[str] = None, sessions: int = 20
) -> Dict[str, Any]:
    # Pick most-logged exercise if none specified
    if not exercise_title:
        from sqlalchemy import func

        row = (
            db.query(HevyExercise.title, func.count(HevyExercise.id))
            .group_by(HevyExercise.title)
            .order_by(func.count(HevyExercise.id).desc())
            .first()
        )
        exercise_title = row[0] if row else None
    if not exercise_title:
        return {"exercise": None, "points": []}

    exercises = (
        db.query(HevyExercise)
        .join(HevyWorkout)
        .options(joinedload(HevyExercise.sets), joinedload(HevyExercise.workout))
        .filter(HevyExercise.title == exercise_title)
        .order_by(HevyWorkout.start_time.desc())
        .limit(sessions)
        .all()
    )
    points = []
    for ex in reversed(exercises):
        if not ex.workout or not ex.workout.start_time:
            continue
        best_load = 0.0
        best_w = 0.0
        best_r = 0
        for s in ex.sets:
            w = s.weight_kg or 0
            r = s.reps or 0
            load = w * r
            if load >= best_load:
                best_load = load
                best_w = w
                best_r = r
        points.append(
            {
                "date": ex.workout.start_time.date().isoformat(),
                "weight_kg": best_w,
                "reps": best_r,
                "volume": best_load,
            }
        )
    return {"exercise": exercise_title, "points": points}


def personal_records(db: Session, limit: int = 40) -> List[Dict[str, Any]]:
    exercises = (
        db.query(HevyExercise)
        .options(joinedload(HevyExercise.sets), joinedload(HevyExercise.workout))
        .all()
    )
    best: Dict[str, Dict[str, Any]] = {}
    for ex in exercises:
        title = ex.title or "Unknown"
        for s in ex.sets:
            w = s.weight_kg or 0
            r = s.reps or 0
            epley = w * (1 + r / 30) if w and r else 0
            cur = best.get(title)
            if not cur or w > cur["max_weight"] or epley > cur["est_1rm"]:
                day = (
                    ex.workout.start_time.date().isoformat()
                    if ex.workout and ex.workout.start_time
                    else None
                )
                best[title] = {
                    "exercise": title,
                    "max_weight": w,
                    "max_reps_at_weight": r,
                    "est_1rm": round(epley, 1),
                    "date": day,
                    "muscle_group": ex.muscle_group,
                }
            # API PR flags
            if s.prs:
                best[title]["api_prs"] = s.prs
    rows = sorted(best.values(), key=lambda x: -x["est_1rm"])
    return rows[:limit]


def session_durations(db: Session, days: int = 90) -> List[Dict[str, Any]]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(HevyWorkout)
        .filter(HevyWorkout.start_time.isnot(None), HevyWorkout.start_time >= since)
        .order_by(HevyWorkout.start_time.asc())
        .all()
    )
    return [
        {
            "date": w.start_time.date().isoformat(),
            "minutes": round((w.duration_sec or 0) / 60, 1),
            "name": w.name,
        }
        for w in rows
        if w.start_time
    ]


def weekly_volume_by_muscle(db: Session, weeks: int = 12) -> List[Dict[str, Any]]:
    since = datetime.utcnow() - timedelta(weeks=weeks)
    workouts = (
        db.query(HevyWorkout)
        .options(joinedload(HevyWorkout.exercises).joinedload(HevyExercise.sets))
        .filter(HevyWorkout.start_time.isnot(None), HevyWorkout.start_time >= since)
        .all()
    )
    buckets: Dict[str, Dict[str, float]] = {}
    for w in workouts:
        # ISO week key
        iso = w.start_time.isocalendar()
        key = f"{iso[0]}-W{iso[1]:02d}"
        buckets.setdefault(key, {})
        for ex in w.exercises:
            mg = ex.muscle_group or "unknown"
            vol = sum((s.weight_kg or 0) * (s.reps or 0) for s in ex.sets)
            buckets[key][mg] = buckets[key].get(mg, 0) + vol
    return [{"week": k, "muscles": buckets[k]} for k in sorted(buckets.keys())]


def exercise_titles(db: Session) -> List[str]:
    rows = (
        db.query(HevyExercise.title)
        .filter(HevyExercise.title.isnot(None))
        .distinct()
        .order_by(HevyExercise.title.asc())
        .all()
    )
    return [r[0] for r in rows if r[0]]
