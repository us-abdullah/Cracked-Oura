"""Interactive browser login for Google/Apple Hevy accounts.

Opens hevy.com headed so the user can Sign in with Google, then reads the
`auth2.0-token` cookie (access_token + refresh_token).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import urllib.parse
from typing import Any, Dict, Optional

logger = logging.getLogger("HevyBrowserLogin")

HEVY_LOGIN_URL = "https://www.hevy.com/login"
COOKIE_NAME = "auth2.0-token"
DEFAULT_TIMEOUT_SEC = 300  # 5 minutes for Google account picker


def _parse_auth_cookie(raw: str) -> Dict[str, Any]:
    """Cookie value is URL-encoded JSON with access_token / refresh_token."""
    decoded = urllib.parse.unquote(raw)
    data = json.loads(decoded)
    access = data.get("access_token") or data.get("auth_token")
    refresh = data.get("refresh_token")
    if not access:
        raise RuntimeError("Hevy auth cookie missing access_token")
    return {
        "access_token": access,
        "refresh_token": refresh,
        "expires_at": data.get("expires_at"),
        "user_id": data.get("user_id"),
        "raw": data,
    }


async def login_via_browser(timeout_sec: int = DEFAULT_TIMEOUT_SEC) -> Dict[str, Any]:
    """
    Launch a visible Chromium window on Hevy login.
    User completes Google (or any) sign-in; we wait for auth2.0-token.
    """
    from playwright.async_api import async_playwright

    from backend.src.paths import get_user_data_dir

    browsers_path = os.path.join(get_user_data_dir(), "browsers")
    os.makedirs(browsers_path, exist_ok=True)
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", browsers_path)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            viewport={"width": 1100, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()
        try:
            await page.goto(HEVY_LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
            logger.info(
                "Hevy browser login open — sign in with Google in the window "
                "(waiting up to %ss)...",
                timeout_sec,
            )

            deadline = time.monotonic() + timeout_sec
            tokens: Optional[Dict[str, Any]] = None

            while time.monotonic() < deadline:
                cookies = await context.cookies()
                for c in cookies:
                    if c.get("name") == COOKIE_NAME and c.get("value"):
                        try:
                            tokens = _parse_auth_cookie(c["value"])
                            break
                        except Exception as e:
                            logger.warning(f"Bad auth cookie parse: {e}")
                if tokens:
                    break
                # Also succeed if already past login (home) with cookie on hevy.com
                await asyncio.sleep(1.5)

            if not tokens:
                raise TimeoutError(
                    "Timed out waiting for Hevy login. "
                    "Click 'Sign in with Google' in the browser window and finish login, then try again."
                )

            return tokens
        finally:
            await browser.close()


def login_via_browser_sync(timeout_sec: int = DEFAULT_TIMEOUT_SEC) -> Dict[str, Any]:
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(
                    lambda: asyncio.run(login_via_browser(timeout_sec))
                ).result(timeout=timeout_sec + 60)
        return loop.run_until_complete(login_via_browser(timeout_sec))
    except RuntimeError:
        return asyncio.run(login_via_browser(timeout_sec))
