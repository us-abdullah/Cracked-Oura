import json
import os
import threading
import logging
from typing import Dict, Any, Optional

from .paths import get_user_data_dir

CONFIG_FILE = "oura_config.json"
DASHBOARD_FILE = "oura_dashboard.json"
HEVY_DASHBOARD_FILE = "hevy_dashboard.json"
HEALTH_DASHBOARD_FILE = "health_dashboard.json"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ConfigManager")


def _empty_dashboard():
    return {"dashboard": {"dashboards": [], "activeDashboardId": None}}


class ConfigManager:
    """
    Manages application configuration and per-compartment dashboard state.
    """

    def __init__(self):
        self.data_dir = get_user_data_dir()
        self.config_path = os.path.join(self.data_dir, CONFIG_FILE)
        self.dashboard_path = os.path.join(self.data_dir, DASHBOARD_FILE)
        self.hevy_dashboard_path = os.path.join(self.data_dir, HEVY_DASHBOARD_FILE)
        self.health_dashboard_path = os.path.join(self.data_dir, HEALTH_DASHBOARD_FILE)
        self._lock = threading.Lock()
        self._ensure_config()

    def _ensure_config(self):
        if not os.path.exists(self.config_path):
            default_config = {
                "email": "",
                "schedule_time": "11:00",
                "last_run": None,
                "next_run": None,
                "status": "Idle",
                "is_active": True,
                "headless": True,
                "llm_model": "llama3.2:3b",
                "llm_host": "http://localhost:11434",
                "llm_reasoning": False,
                "llm_num_ctx": 4096,
                "sync_interval_days": 7,
                # Hevy
                "hevy_email": "",
                "hevy_username": "",
                "hevy_access_token": None,
                "hevy_refresh_token": None,
                "hevy_token_expires_at": None,
                "hevy_last_run": None,
                "hevy_status": "Idle",
                "hevy_schedule_time": "11:30",
            }
            self._save_file(self.config_path, default_config)

        if not os.path.exists(self.dashboard_path):
            self._save_file(self.dashboard_path, _empty_dashboard())
        if not os.path.exists(self.hevy_dashboard_path):
            self._save_file(self.hevy_dashboard_path, _empty_dashboard())
        if not os.path.exists(self.health_dashboard_path):
            self._save_file(self.health_dashboard_path, _empty_dashboard())

    def _load_file(self, path: str) -> Dict[str, Any]:
        try:
            if not os.path.exists(path):
                return {}
            with open(path, "r", encoding="utf-8-sig") as f:
                content = f.read().strip()
                if not content:
                    return {}
                return json.loads(content)
        except Exception as e:
            logger.error(f"Error loading config from {path}: {e}")
            return {}

    def _save_file(self, path: str, data: Dict[str, Any]):
        import uuid

        tmp_path = f"{path}.{uuid.uuid4()}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, path)
        except Exception as e:
            logger.error(f"Error saving config to {path}: {e}")
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            main_conf = self._load_file(self.config_path)
            dash_conf = self._load_file(self.dashboard_path)
            return {**main_conf, **dash_conf}

    def get_compartment_dashboard(self, compartment: str) -> Dict[str, Any]:
        path = self._dashboard_path_for(compartment)
        with self._lock:
            data = self._load_file(path)
            return data.get("dashboard", {"dashboards": [], "activeDashboardId": None})

    def save_compartment_dashboard(self, compartment: str, dashboard: Dict[str, Any]):
        path = self._dashboard_path_for(compartment)
        with self._lock:
            self._save_file(path, {"dashboard": dashboard})

    def _dashboard_path_for(self, compartment: str) -> str:
        if compartment == "training":
            return self.hevy_dashboard_path
        if compartment == "health":
            return self.health_dashboard_path
        return self.dashboard_path

    def update_config(self, **kwargs):
        with self._lock:
            main_conf = self._load_file(self.config_path)
            dash_conf = self._load_file(self.dashboard_path)

            main_changed = False
            dash_changed = False

            for key, value in kwargs.items():
                if value is None:
                    continue

                if key == "dashboard":
                    dash_conf["dashboard"] = value
                    dash_changed = True
                else:
                    main_conf[key] = value
                    main_changed = True

            if main_changed:
                self._save_file(self.config_path, main_conf)
            if dash_changed:
                self._save_file(self.dashboard_path, dash_conf)

    def update_status(self, status: str, **kwargs):
        self.update_config(status=status, **kwargs)


config_manager = ConfigManager()
