"""Hevy API client — ported from casudo/Hevy-Insights (MIT)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import requests

logger = logging.getLogger("HevyClient")

# Static client key used by Hevy's free/web API (same as Hevy-Insights)
DEFAULT_X_API_KEY = "klean_kanteen_insulated"


@dataclass
class HevyUser:
    access_token: str
    user_id: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    refresh_token: Optional[str] = None
    expires_at: Optional[str] = None


class HevyError(Exception):
    pass


class HevyClient:
    def __init__(
        self,
        access_token: Optional[str] = None,
        x_api_key: str = DEFAULT_X_API_KEY,
    ):
        self.base_url = "https://api.hevyapp.com"
        self.x_api_key = x_api_key
        self.access_token = access_token
        self.session = requests.Session()
        if access_token:
            self._update_headers()

    def _update_headers(self) -> None:
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "x-api-key": self.x_api_key,
                "Authorization": f"Bearer {self.access_token}",
            }
        )

    def login(
        self, email_or_username: str, password: str, recaptcha_token: str
    ) -> HevyUser:
        headers = {
            "x-api-key": self.x_api_key,
            "Content-Type": "application/json",
            "Hevy-Platform": "web",
        }
        body = {
            "emailOrUsername": email_or_username,
            "password": password,
            "recaptchaToken": recaptcha_token,
            "useAuth2_0": True,
        }
        try:
            response = self.session.post(
                f"{self.base_url}/login", headers=headers, json=body, timeout=30
            )
            response.raise_for_status()
            data = response.json()
            access_token = data.get("access_token") or data.get("auth_token")
            refresh_token = data.get("refresh_token")
            if not access_token or not refresh_token:
                raise HevyError("Login response missing access/refresh token")
            self.access_token = access_token
            self._update_headers()
            return HevyUser(
                access_token=access_token,
                user_id=data.get("user_id"),
                username=email_or_username if "@" not in email_or_username else None,
                email=email_or_username if "@" in email_or_username else None,
                refresh_token=refresh_token,
                expires_at=data.get("expires_at"),
            )
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 401:
                raise HevyError("Invalid credentials") from e
            raise HevyError(f"Login failed: {e}") from e

    def refresh_access_token(self, refresh_token: str) -> HevyUser:
        headers = {
            "x-api-key": self.x_api_key,
            "Content-Type": "application/json",
            "Hevy-Platform": "web",
        }
        body = {"refresh_token": refresh_token}
        try:
            response = self.session.post(
                f"{self.base_url}/refresh_token",
                headers=headers,
                json=body,
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            access_token = data.get("access_token") or data.get("auth_token")
            new_refresh = data.get("refresh_token")
            if not access_token or not new_refresh:
                raise HevyError("Refresh response missing tokens")
            self.access_token = access_token
            self._update_headers()
            return HevyUser(
                access_token=access_token,
                user_id=data.get("user_id"),
                refresh_token=new_refresh,
                expires_at=data.get("expires_at"),
            )
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 401:
                raise HevyError("Invalid or expired refresh token") from e
            raise HevyError(f"Token refresh failed: {e}") from e

    def get_user_account(self) -> dict:
        if not self.access_token:
            raise HevyError("No access token")
        response = self.session.get(f"{self.base_url}/user/account", timeout=30)
        response.raise_for_status()
        return response.json()

    def get_workouts(self, username: str, offset: int = 0) -> dict:
        if not self.access_token:
            raise HevyError("No access token")
        response = self.session.get(
            f"{self.base_url}/user_workouts_paged",
            params={"offset": offset, "username": username},
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def get_body_measurements(self) -> list:
        if not self.access_token:
            raise HevyError("No access token")
        response = self.session.get(f"{self.base_url}/body_measurements", timeout=30)
        response.raise_for_status()
        return response.json()
