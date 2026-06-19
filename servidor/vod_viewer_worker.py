"""
vod_viewer_worker.py
Adaptado de KickerzViews.py para trabajar con la base de datos SQLite.
Lee URLs de VODs y proxies desde la DB, registra cada vista en view_log.
Recibe config por stdin: { "user_id": N, "hourly_limit": N, "db_path": "..." }
Emite líneas JSON por stdout para que Node.js lea el estado.
"""

import asyncio
import sys
import json
import time
import random
import signal
import sqlite3
import os

try:
    from playwright.async_api import async_playwright
except ImportError:
    print(json.dumps({"type": "error", "message": "playwright no instalado. pip install playwright"}))
    sys.exit(1)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
COMMON_VIEWPORTS = [{"width": 1920, "height": 1080}, {"width": 1366, "height": 768}]
MAX_RETRIES = 3
NAVIGATION_TIMEOUT = 90000
LOOP_DELAY_SECONDS = (30, 60)

running = True
stats = {"views_generated": 0, "views_failed": 0, "hourly_views": 0, "hour_start": time.time()}

def handle_sigterm(signum, frame):
    global running
    running = False
    print(json.dumps({"type": "status", "message": "deteniendo..."}))

signal.signal(signal.SIGTERM, handle_sigterm)

def log_status(**kwargs):
    """Emite una línea JSON por stdout para que Node.js la lea."""
    line = json.dumps(kwargs)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()

def load_config():
    """Lee la config desde stdin (primera línea JSON)."""
    raw = sys.stdin.readline().strip()
    return json.loads(raw)

def get_db_connection(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def get_vod_urls(conn, user_id):
    cursor = conn.execute("SELECT id, url, type FROM client_vods WHERE user_id = ? AND is_active = 1", (user_id,))
    return [{"id": row["id"], "url": row["url"], "type": row["type"]} for row in cursor.fetchall()]

def get_proxies(conn):
    cursor = conn.execute("SELECT id, host, port, username, password, protocol FROM proxies WHERE is_active = 1")
    proxies = []
    for row in cursor.fetchall():
        proxies.append({
            "id": row["id"],
            "url": f"http://{row['username']}:{row['password']}@{row['host']}:{row['port']}",
        })
    return proxies

def get_hourly_count(conn, user_id):
    cursor = conn.execute(
        "SELECT COUNT(*) as cnt FROM view_log WHERE user_id = ? AND success = 1 AND created_at > (unixepoch() - 3600)",
        (user_id,)
    )
    row = cursor.fetchone()
    return row["cnt"] if row else 0

def record_view(conn, user_id, vod_id, proxy_id, success, error=None):
    conn.execute(
        "INSERT INTO view_log (user_id, vod_id, proxy_id, success, error) VALUES (?, ?, ?, ?, ?)",
        (user_id, vod_id, proxy_id, 1 if success else 0, error)
    )
    if success and vod_id:
        conn.execute("UPDATE client_vods SET views_count = views_count + 1 WHERE id = ?", (vod_id,))
    conn.commit()

def build_proxy_config(proxy):
    if not proxy:
        return None
    return {
        "server": proxy["url"],
        "ignore_https_errors": True,
    }

async def visit_vod(browser, vods, proxies, conn, user_id, hourly_limit):
    global stats
    if not vods:
        log_status(type="warn", message="No hay VODs activos")
        await asyncio.sleep(30)
        return

    # Check hourly limit
    now_hourly = get_hourly_count(conn, user_id)
    if now_hourly >= hourly_limit:
        log_status(type="paused", reason="limite_horario", views=now_hourly, limit=hourly_limit)
        await asyncio.sleep(60)
        return

    vod = random.choice(vods)
    proxy = random.choice(proxies) if proxies else None

    context = None
    try:
        viewport = random.choice(COMMON_VIEWPORTS)
        proxy_cfg = build_proxy_config(proxy)
        context = await browser.new_context(
            ignore_https_errors=True,
            user_agent=USER_AGENT,
            viewport=viewport,
            proxy=proxy_cfg,
        )
        page = await context.new_page()
        await page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        log_status(type="navigating", url=vod["url"], proxy_id=proxy["id"] if proxy else None)

        for attempt in range(MAX_RETRIES):
            try:
                await page.goto(vod["url"], wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT)
                # Simular vista: esperar en la pagina
                visit_duration = random.randint(30, 90)
                await asyncio.sleep(visit_duration)

                proxy_id = proxy["id"] if proxy else None
                record_view(conn, user_id, vod["id"], proxy_id, True)
                stats["views_generated"] += 1
                log_status(type="view_ok", url=vod["url"], total=stats["views_generated"], failed=stats["views_failed"])
                return
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(5)
                continue

        # All retries failed
        record_view(conn, user_id, vod["id"], proxy["id"] if proxy else None, False, "all retries failed")
        stats["views_failed"] += 1
        log_status(type="view_fail", url=vod["url"], total=stats["views_generated"], failed=stats["views_failed"])
    except Exception as e:
        stats["views_failed"] += 1
        log_status(type="view_fail", url=vod["url"], error=str(e), total=stats["views_generated"], failed=stats["views_failed"])
    finally:
        if context:
            try:
                await context.close()
            except:
                pass

async def main_loop():
    config = load_config()
    user_id = config["user_id"]
    hourly_limit = config.get("hourly_limit", 50)
    db_path = config["db_path"]

    if not os.path.exists(db_path):
        log_status(type="error", message=f"DB no encontrada: {db_path}")
        return

    conn = get_db_connection(db_path)

    log_status(type="start", user_id=user_id, hourly_limit=hourly_limit)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            while running:
                vods = get_vod_urls(conn, user_id)
                proxies = get_proxies(conn)
                if not vods:
                    log_status(type="warn", message="No hay VODs activos")
                    await asyncio.sleep(30)
                    continue
                await visit_vod(browser, vods, proxies, conn, user_id, hourly_limit)
                delay = random.randint(*LOOP_DELAY_SECONDS)
                await asyncio.sleep(delay)
        finally:
            await browser.close()
            conn.close()

    log_status(type="stopped", total=stats["views_generated"], failed=stats["views_failed"])

if __name__ == "__main__":
    try:
        asyncio.run(main_loop())
    except Exception as e:
        log_status(type="error", message=str(e))
        sys.exit(1)
