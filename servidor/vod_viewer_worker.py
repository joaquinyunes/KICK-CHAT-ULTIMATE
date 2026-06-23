"""
vod_viewer_worker.py
Worker que visita URLs de VODs/clips de Kick usando Playwright.
Sin proxies. Sin acceso directo a la DB (Node.js maneja los registros).
Recibe config por stdin: { "user_id": N, "hourly_limit": N, "vods": [...], "hourly_views": N }
Emite líneas JSON por stdout para que Node.js procese.
"""

import asyncio
import sys
import json
import random
import signal
import time
import os

try:
    from playwright.async_api import async_playwright
except ImportError:
    print(json.dumps({"type": "error", "message": "playwright no instalado. pip install playwright"}))
    sys.exit(1)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
COMMON_VIEWPORTS = [{"width": 1920, "height": 1080}, {"width": 1366, "height": 768}]
MAX_RETRIES = 3
NAVIGATION_TIMEOUT = 60000
MIN_VIEW_SECONDS = 60
LOOP_DELAY = (10, 30)

running = True
vod_index = 0  # round-robin index
session_views = []  # timestamps of views generated in this session
stats = {"views_generated": 0, "views_failed": 0}

def handle_sigterm(signum, frame):
    global running
    running = False

signal.signal(signal.SIGTERM, handle_sigterm)

def log(**kwargs):
    line = json.dumps(kwargs)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()

def logfile(**kwargs):
    """Fallback: write to a log file if stdout fails"""
    try:
        p = os.path.join(os.path.dirname(__file__) or ".", "data", "worker_debug.log")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "a") as f:
            f.write(json.dumps(kwargs) + "\n")
    except:
        pass

def load_config():
    raw = sys.stdin.readline().strip()
    logfile(type="config_raw", raw=raw)
    return json.loads(raw)

def get_hourly_count(initial_count):
    now = time.time()
    # Count views from this session in the last hour
    session_in_hour = sum(1 for ts in session_views if ts > now - 3600)
    return initial_count + session_in_hour

async def visit(browser, vod, hourly_limit, initial_hourly):
    global stats, session_views

    now_h = get_hourly_count(initial_hourly)
    if now_h >= hourly_limit:
        log(type="paused", reason="limite_horario", views=now_h, limit=hourly_limit)
        await asyncio.sleep(60)
        return

    viewport = random.choice(COMMON_VIEWPORTS)
    context = None
    try:
        context = await browser.new_context(
            ignore_https_errors=True, user_agent=USER_AGENT, viewport=viewport
        )
        page = await context.new_page()
        await page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        log(type="navigating", url=vod["url"])

        for attempt in range(MAX_RETRIES):
            try:
                await page.goto(vod["url"], wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT)
                await asyncio.sleep(MIN_VIEW_SECONDS)

                session_views.append(time.time())
                stats["views_generated"] += 1
                log(type="view_ok", url=vod["url"], vod_id=vod["id"], total=stats["views_generated"], failed=stats["views_failed"])
                return
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(5)
                continue

        stats["views_failed"] += 1
        log(type="view_fail", url=vod["url"], vod_id=vod["id"], error="all retries failed", total=stats["views_generated"], failed=stats["views_failed"])
    except Exception as e:
        stats["views_failed"] += 1
        log(type="view_fail", url=vod["url"], vod_id=vod["id"], error=str(e), total=stats["views_generated"], failed=stats["views_failed"])
    finally:
        if context:
            try: await context.close()
            except: pass

async def main_loop():
    config = load_config()
    user_id = config["user_id"]
    hourly_limit = config.get("hourly_limit", 50)
    vods = config.get("vods", [])
    initial_hourly = config.get("hourly_views", 0)

    log(type="start", user_id=user_id, hourly_limit=hourly_limit, vod_count=len(vods), hourly_views=initial_hourly)
    logfile(type="start", user_id=user_id, vod_count=len(vods))

    if not vods:
        log(type="warn", message="No hay VODs activos")
        logfile(type="warn", message="No hay VODs activos")
        return

    logfile(type="launching_browser")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            while running:
                vod = vods[vod_index % len(vods)]
                vod_index += 1
                await visit(browser, vod, hourly_limit, initial_hourly)
                delay = random.randint(*LOOP_DELAY)
                await asyncio.sleep(delay)
        finally:
            await browser.close()

    log(type="stopped", total=stats["views_generated"], failed=stats["views_failed"])

if __name__ == "__main__":
    logfile(type="worker_started")
    try:
        asyncio.run(main_loop())
    except Exception as e:
        log(type="error", message=str(e))
        logfile(type="fatal_error", error=str(e))
        sys.exit(1)
