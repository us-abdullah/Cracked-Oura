"""Playwright reCAPTCHA helper for Hevy login — adapted from Hevy-Insights (MIT)."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

logger = logging.getLogger("HevyRecaptcha")

HEVY_LOGIN_URL = "https://www.hevy.com/login"
RECAPTCHA_SITE_KEY = "6LfkQG0jAAAAANTrIkVXKPfSPHyJnt4hYPWqxh0R"


async def fetch_recaptcha_token(headless: bool = True) -> str:
    """
    Open Hevy login page and execute reCAPTCHA v3 Enterprise to get a token.
    Requires Playwright + Chromium (same stack as Oura automation).
    """
    from playwright.async_api import async_playwright

    from backend.src.paths import get_user_data_dir

    browsers_path = os.path.join(get_user_data_dir(), "browsers")
    os.makedirs(browsers_path, exist_ok=True)
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", browsers_path)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        try:
            page = await browser.new_page()
            await page.goto(HEVY_LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
            # Wait for grecaptcha enterprise
            await page.wait_for_function(
                "() => window.grecaptcha && window.grecaptcha.enterprise",
                timeout=30000,
            )
            token = await page.evaluate(
                """async (siteKey) => {
                    return await window.grecaptcha.enterprise.execute(siteKey, {action: 'login'});
                }""",
                RECAPTCHA_SITE_KEY,
            )
            if not token:
                # Fallback: some builds expose window.recaptchaToken
                token = await page.evaluate("() => window.recaptchaToken || null")
            if not token:
                raise RuntimeError("Failed to obtain Hevy reCAPTCHA token")
            return str(token)
        finally:
            await browser.close()


def fetch_recaptcha_token_sync(headless: bool = True) -> str:
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Nested: run in a fresh loop via thread
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(
                    lambda: asyncio.run(fetch_recaptcha_token(headless))
                ).result(timeout=90)
        return loop.run_until_complete(fetch_recaptcha_token(headless))
    except RuntimeError:
        return asyncio.run(fetch_recaptcha_token(headless))
