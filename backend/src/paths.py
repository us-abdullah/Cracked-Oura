import os
import sys
import logging
from pathlib import Path

logger = logging.getLogger("Paths")


def get_user_data_dir() -> Path:
    """
    Returns the platform-specific user data directory for the application.
    Override with BIOTRACKER_DATA_DIR (cloud / Docker volume).
    - Windows: %APPDATA%/CrackedOura
    - macOS: ~/Library/Application Support/CrackedOura
    - Linux: ~/.local/share/CrackedOura
    """
    override = os.getenv("BIOTRACKER_DATA_DIR") or os.getenv("CRACKED_OURA_DATA_DIR")
    if override:
        path = Path(override).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    app_name = "CrackedOura"

    if sys.platform == "win32":
        path = Path(os.getenv("APPDATA", str(Path.home()))) / app_name
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / app_name
    else:
        path = Path.home() / ".local" / "share" / app_name

    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        fallback = Path.home() / ".cracked_oura"
        logger.warning(
            f"Failed to create user data dir at {path}. Falling back to {fallback}. Error: {e}"
        )
        path = fallback
        try:
            path.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    return path
