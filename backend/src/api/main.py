from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from backend.src.api.routes import router
from backend.src.api.routes_hevy import router as hevy_router
from backend.src.api.routes_health import router as health_router
from backend.src.api.routes_hevy_insights import router as hevy_insights_router
from backend.src.api.routes_mirror import router as mirror_router
from backend.src.database import init_db, SessionLocal

import asyncio
import logging
import sys
from datetime import datetime, timedelta
from backend.src.automation import automator
from backend.src.ingestion import OuraParser
from backend.src.database import SessionLocal
from backend.src.config import config_manager
import os
from pydantic import BaseModel

from contextlib import asynccontextmanager

# Playwright needs ProactorEventLoop subprocess support on Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

# Configure logging
from backend.src.paths import get_user_data_dir
import logging
import os

log_dir = get_user_data_dir()
log_file = os.path.join(log_dir, "backend_debug.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("API")
logger.info(f"API Starting... Logging to {log_file}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    
    # Reset status on startup in case it was stuck
    cfg = config_manager.get_config()
    if cfg.get("status") not in ["Idle", "Error"]:
        logger.info("Startup: Resetting stuck status to Idle.")
        config_manager.update_status("Idle")

    # Warm the local LLM so the first chat isn't a multi-minute cold start
    async def _warm_llm():
        try:
            def _ping():
                from backend.src.llm import DataAnalyst
                DataAnalyst().llm.invoke("Reply with OK")
            await asyncio.to_thread(_ping)
            logger.info("LLM warmup complete.")
        except Exception as e:
            logger.warning(f"LLM warmup skipped: {e}")

    asyncio.create_task(_warm_llm())

    # Pull Health Google Sheets once on startup (non-blocking)
    async def _warm_health_sheets():
        try:
            from backend.src.health import sheets_sync as health_sheets

            def _run():
                health_sheets.ensure_sheet_defaults()
                db = SessionLocal()
                try:
                    return health_sheets.sync_all(db)
                finally:
                    db.close()

            result = await asyncio.to_thread(_run)
            logger.info("Health sheets startup sync: %s", result.get("status"))
        except Exception as e:
            logger.warning("Health sheets startup sync skipped: %s", e)

    asyncio.create_task(_warm_health_sheets())
        
    # Start background worker
    task = asyncio.create_task(background_worker())
    
    yield
    
    # Shutdown (optional cleanup)
    # task.cancel()

app = FastAPI(
    title="Usman Biotracker API",
    description="API for Recovery (Oura), Training (Hevy), and Health data.",
    version="0.1.0",
    lifespan=lifespan
)

# Configure CORS
origins = [
    "http://localhost",
    "http://localhost:3000", # Frontend
    "http://localhost:8000", # Backend
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(router)
app.include_router(hevy_router)
app.include_router(health_router)
app.include_router(hevy_insights_router)
app.include_router(mirror_router)

# --- API Models for Automation ---
class AutomationConfig(BaseModel):
    email: str
    schedule_time: str
    is_active: bool
    headless: bool = True

# --- Endpoints ---

@app.get("/api/automation/status")
async def get_automation_status():
    """Returns the current automation configuration and status."""
    return config_manager.get_config()

@app.post("/api/automation/config")
async def update_automation_config(config: AutomationConfig):
    """Updates automation settings."""
    config_manager.update_config(
        email=config.email, 
        schedule_time=config.schedule_time,
        is_active=config.is_active,
        headless=config.headless
    )
    # Configure automator with new email settings immediately
    automator.email = config.email
        
    return {"status": "success", "message": "Configuration updated."}

class OTPRequest(BaseModel):
    otp: str
    action: str = "run" # run, download, test

@app.post("/api/automation/submit-otp")
async def submit_otp(request: OTPRequest, background_tasks: BackgroundTasks):
    """
    Submits OTP code to the running automation session.
    """
    logger.info(f"Received OTP: {request.otp}, Action: {request.action}")
    config_manager.update_status("Submitting OTP...")
    
    try:
        result = await automator.submit_otp(request.otp)
        if result["status"] == "success":
            if request.action == "run":
                config_manager.update_status("Login Successful! Resuming Full Run...")
                background_tasks.add_task(run_ingestion_task, force=True)
                return {"status": "success", "message": "OTP Accepted. Resuming full automation."}
            
            elif request.action == "download":
                config_manager.update_status("Login Successful! Resuming Download...")
                background_tasks.add_task(run_download_existing_task)
                return {"status": "success", "message": "OTP Accepted. Resuming download."}
            
            elif request.action == "test":
                config_manager.update_status("Login Successful! Session saved.")
                await automator.cleanup()
                return {"status": "success", "message": "OTP Accepted. Login verified."}
            
            else:
                # Default fallback
                config_manager.update_status("Login Successful!")
                return {"status": "success", "message": "OTP Accepted."}

        else:
            config_manager.update_status(f"OTP Error: {result['message']}")
            return {"status": "error", "message": result['message']}
    except Exception as e:
        config_manager.update_status(f"OTP Error: {str(e)}")
        return {"status": "error", "message": str(e)}

@app.post("/api/automation/run-now")
async def run_automation(background_tasks: BackgroundTasks):
    """
    Manually triggers the full "Request New + Download" flow.
    """
    logger.info("Manual automation trigger received.")
    config_manager.update_status("Starting manual run...")
    
    try:
        # Initialize if needed
        cfg = config_manager.get_config()
        await automator.initialize(headless=cfg.get("headless", False))
        automator.email = cfg.get("email", "")

        background_tasks.add_task(run_ingestion_task, force=True)
        return {"status": "started", "message": "Automation started."}

    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/automation/clear-session")
async def clear_session():
    """Clears the current automation session."""
    try:
        if await automator.clear_session():
            config_manager.update_status("Session cleared.")
            return {"status": "success", "message": "Session cleared. Please login again."}
        return {"status": "info", "message": "No session found to clear."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/automation/test-login")
async def test_login():
    """Tests the login functionality with current credentials."""
    try:
        config_manager.update_status("Testing Login...")
        cfg = config_manager.get_config()
        await automator.initialize(headless=cfg.get("headless", False))
        automator.email = cfg.get("email", "")
        res = await automator.login()
        if res and res.get("status") == "otp_required":
             config_manager.update_status("Waiting for OTP...")
             return {"status": "otp_required", "message": "OTP Required"}
        
        config_manager.update_status("Login Check Complete.")
        await automator.cleanup() # Close browser if successful
        return res
    except Exception as e:
        config_manager.update_status(f"Login Error: {str(e)}")
        return {"status": "error", "message": str(e)}

async def run_download_existing_task():
    """
    Standalone task for downloading existing export.
    """
    logger.info("Starting download existing task...")
    try:
        cfg = config_manager.get_config()
        # Ensure automator is initialized and configured
        if not automator._is_initialized:
            await automator.initialize(headless=cfg.get("headless", True))
        
        automator.email = cfg.get("email", "")
        
        # Use user data dir for downloads
        from backend.src.paths import get_user_data_dir
        save_dir = str(get_user_data_dir())
        
        result = await automator.download_existing_export(save_dir=save_dir)
        
        if isinstance(result, dict) and result.get("status") == "otp_required":
            config_manager.update_status("Waiting for OTP...")
            return

        file_path = result
        
        if file_path:
            logger.info(f"Export downloaded to {file_path}. Starting ingestion...")
            await process_ingestion(file_path)
        else:
            logger.info("No existing export found.")
        
        # Cleanup on success (if not waiting for OTP)
        await automator.cleanup()

    except Exception as e:
        logger.error(f"Download task failed: {e}")
        await automator.cleanup() # Cleanup on error


@app.post("/api/automation/download-latest")
async def download_latest_existing(background_tasks: BackgroundTasks):
    """Downloads the latest EXISTING export (if any). Does NOT request new."""
    background_tasks.add_task(run_download_existing_task)
    return {"status": "started", "message": "Checking for existing downloads..."}


# --- Background Logic ---

async def run_ingestion_task(force=False):
    """
    The core logic for checking, requesting, and downloading data.
    """
    cfg = config_manager.get_config()
    if not force and not cfg.get("is_active", True):
        return

    logger.info("Background worker: Starting ingestion task...")
    config_manager.update_status("Starting...")
    
    try:
        # 1. Initialize
        config_manager.update_status("Initializing...")
        headless_mode = cfg.get("headless", True)
        await automator.initialize(headless=headless_mode)
        
        # Configure credentials
        automator.email = cfg.get("email", "")
        
        # Check login first
        login_res = await automator.login()
        if login_res and login_res.get("status") == "otp_required":
             logger.info("Background worker: OTP Required.")
             config_manager.update_status("Waiting for OTP...")
             return
        
        # 2. Run Full Automation (Request -> Wait -> Download)
        config_manager.update_status("Running Automation...")
        
        # Use user data dir for downloads
        from backend.src.paths import get_user_data_dir
        save_dir = str(get_user_data_dir())

        # This function handles login, requesting, waiting, and downloading
        result = await automator.request_new_export_and_download(save_dir=save_dir)
        
        if isinstance(result, dict) and result.get("status") == "otp_required":
             config_manager.update_status("Waiting for OTP...")
             return

        file_path = result
        
        if file_path:
            logger.info(f"Background worker status: Downloaded to {file_path}")
            config_manager.update_status("Downloading...")
            
            # 3. Ingest
            await process_ingestion(file_path)
        else:
            logger.info("Background worker: No file downloaded (Timeout or Error).")
            config_manager.update_status("Failed to download export.")
        
        # Cleanup on success
        await automator.cleanup()

    except Exception as e:
        logger.error(f"Background worker error: {e}")
        config_manager.update_status(f"Error: {str(e)}")
        await automator.cleanup() # Cleanup on error

async def process_ingestion(zip_path):
    logger.info(f"Background worker: Downloaded to {zip_path}")
    
    # Ingest
    config_manager.update_status("Ingesting...")
    db = SessionLocal()
    try:
        parser = OuraParser(db)
        parser.parse_zip(zip_path)
        logger.info("Background worker: Ingestion successful.")
        
        # Success!
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        config_manager.update_status("Idle", last_run=now_str)
        
    except Exception as e:
        logger.error(f"Background worker: Ingestion failed: {e}")
        config_manager.update_status(f"Ingestion Failed: {str(e)}")
    finally:
        db.close()


async def background_worker():
    logger.info("Background worker started.")
    while True:
        try:
            # Check every minute if it's time to run
            now = datetime.now()
            cfg = config_manager.get_config()
            
            # Calculate next run time for display
            schedule_time_str = cfg.get("schedule_time", "11:00")
            # Oura exports often take ~7 days; default to weekly auto-requests
            sync_interval_days = int(cfg.get("sync_interval_days", 7) or 7)
            try:
                sh, sm = map(int, schedule_time_str.split(":"))
                run_today = now.replace(hour=sh, minute=sm, second=0, microsecond=0)

                last_run_dt = None
                last_run_raw = cfg.get("last_run")
                if last_run_raw:
                    try:
                        last_run_dt = datetime.strptime(str(last_run_raw), "%Y-%m-%d %H:%M:%S")
                    except Exception:
                        last_run_dt = None

                if last_run_dt:
                    next_run = last_run_dt + timedelta(days=sync_interval_days)
                    next_run = next_run.replace(hour=sh, minute=sm, second=0, microsecond=0)
                    if next_run <= now:
                        next_run = run_today if now <= run_today else run_today + timedelta(days=1)
                else:
                    next_run = run_today if now <= run_today else run_today + timedelta(days=1)

                config_manager.update_status(cfg.get("status", "Idle"), next_run=next_run.strftime("%Y-%m-%d %H:%M:%S"))

                due_by_interval = True
                if last_run_dt:
                    due_by_interval = (now - last_run_dt) >= timedelta(days=sync_interval_days)

                if now.hour == sh and now.minute == sm and due_by_interval:
                     await run_ingestion_task()
                
                # If in "Waiting" state, poll every 5 minutes            
                elif "Waiting" in cfg.get("status", ""):
                    if now.minute % 5 == 0:
                        logger.info("Background worker: Polling for export status...")
                        await run_ingestion_task()

                # --- Hevy weekly sync (independent of Oura) ---
                hevy_schedule = cfg.get("hevy_schedule_time", "11:30")
                try:
                    hh, hm = map(int, str(hevy_schedule).split(":"))
                except Exception:
                    hh, hm = 11, 30
                hevy_last_raw = cfg.get("hevy_last_run")
                hevy_last_dt = None
                if hevy_last_raw:
                    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
                        try:
                            hevy_last_dt = datetime.strptime(str(hevy_last_raw)[:26], fmt)
                            break
                        except Exception:
                            continue
                hevy_due = True
                if hevy_last_dt:
                    hevy_due = (now - hevy_last_dt) >= timedelta(days=sync_interval_days)
                hevy_logged_in = bool(cfg.get("hevy_access_token") or cfg.get("hevy_refresh_token"))
                if (
                    hevy_logged_in
                    and now.hour == hh
                    and now.minute == hm
                    and hevy_due
                    and cfg.get("hevy_status") not in ("Syncing", "Logging in")
                ):
                    logger.info("Background worker: starting Hevy weekly sync...")
                    def _hevy_sync():
                        from backend.src.hevy import sync as hevy_sync
                        db = SessionLocal()
                        try:
                            return hevy_sync.sync_all_workouts(db)
                        finally:
                            db.close()
                    try:
                        await asyncio.to_thread(_hevy_sync)
                    except Exception as he:
                        logger.error(f"Hevy auto-sync failed: {he}")
                        config_manager.update_config(hevy_status=f"Error: {he}")

                # --- Health Google Sheets sync (every N minutes) ---
                try:
                    from backend.src.health import sheets_sync as health_sheets

                    if health_sheets.maybe_due(now):
                        def _health_sync():
                            db = SessionLocal()
                            try:
                                return health_sheets.sync_all(db)
                            finally:
                                db.close()

                        logger.info("Background worker: syncing Health Google Sheets...")
                        await asyncio.to_thread(_health_sync)
                except Exception as hs:
                    logger.error(f"Health sheets auto-sync failed: {hs}")
                     
            except Exception as e:
                logger.error(f"Scheduler error: {e}")

            # Sleep 60 seconds
            await asyncio.sleep(60)
                    
        except Exception as e:
            logger.error(f"Background worker loop error: {e}")
            await asyncio.sleep(60)

# Mount Static Files
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
import sys
_hi_candidates = []
if getattr(sys, "frozen", False):
    meipass = getattr(sys, "_MEIPASS", "")
    exe_dir = os.path.dirname(sys.executable)
    _hi_candidates.extend(
        [
            os.path.join(exe_dir, "hevy_insights_ui"),
            os.path.join(meipass, "backend", "src", "hevy_insights_ui"),
            os.path.join(meipass, "hevy_insights_ui"),
        ]
    )
_hi_candidates.extend(
    [
        os.path.join(current_dir, "../hevy_insights_ui"),
        os.path.join(current_dir, "../../../vendor/Hevy-Insights/frontend/dist"),
        os.path.join(current_dir, "../../../frontend/public/hevy-insights"),
    ]
)
hevy_insights_dist = next((p for p in _hi_candidates if os.path.isdir(p)), None)

if hevy_insights_dist:
    logger.info(f"Serving Hevy-Insights UI from {hevy_insights_dist}")

    @app.get("/hevy-insights")
    @app.get("/hevy-insights/")
    async def hevy_insights_index():
        return FileResponse(os.path.join(hevy_insights_dist, "index.html"))

    @app.get("/hevy-insights/{full_path:path}")
    async def hevy_insights_spa(full_path: str):
        # Never allow path escape
        candidate = os.path.normpath(os.path.join(hevy_insights_dist, full_path))
        if not candidate.startswith(os.path.normpath(hevy_insights_dist)):
            return FileResponse(os.path.join(hevy_insights_dist, "index.html"))
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(hevy_insights_dist, "index.html"))

# Robustly find the frontend/dist directory relative to this file
dist_dir = os.path.join(current_dir, "../../../frontend/dist")

if os.path.exists(dist_dir):
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="static")
else:
    pass


if __name__ == "__main__":
    import uvicorn
    import sys
    
    # Check if running as a PyInstaller bundle
    if getattr(sys, 'frozen', False):
        try:
            # Production (Frozen)
            uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
        except Exception as e:
            # Emergency logging if startup fails
            from backend.src.paths import get_user_data_dir
            import os
            import traceback
            
            try:
                log_path = os.path.join(get_user_data_dir(), "startup_crash.log")
                with open(log_path, "w", encoding="utf-8") as f:
                    f.write(f"Startup Crash: {e}\n")
                    f.write(traceback.format_exc())
            except:
                pass # Failed to write log
            raise e
    else:
        # Development
        # Run the server with auto-reload
        uvicorn.run("backend.src.api.main:app", host="0.0.0.0", port=8000, reload=True, reload_dirs=["backend"])
