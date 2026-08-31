"""
Login OAuth 2.1 (PKCE) con Kick — se corre UNA sola vez.

Abre el navegador para que autorices tu propia app, captura el `code` en
un servidor local, lo intercambia por access_token + refresh_token, y
guarda todo en /data/metadata/kick_token_state.json. A partir de ahí el
Módulo 6 se encarga solo de renovar el token.

Uso:
    python login_kick.py

Antes necesitás registrar una app en el portal de desarrolladores de Kick
(https://kick.com/settings/developer o https://dev.kick.com) y completar
en el .env:
    KICK_CLIENT_ID
    KICK_CLIENT_SECRET
    KICK_REDIRECT_URI      (tiene que coincidir EXACTO con el registrado;
                            usá  http://localhost:8080/callback )

Nota: los endpoints/scopes de Kick pueden cambiar. Si algo falla, revisá
https://docs.kick.com y ajustá AUTH_ENDPOINT / SCOPES abajo.
"""

import base64
import hashlib
import os
import secrets
import sys
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "common"))
import config  # noqa: E402

AUTH_ENDPOINT = "https://id.kick.com/oauth/authorize"
TOKEN_ENDPOINT = "https://id.kick.com/oauth/token"
# chat:write es necesario para el Módulo 12 (comentarista que postea en el chat).
SCOPES = "user:read channel:read chat:write"
TOKEN_STATE_PATH = config.METADATA_DIR / "kick_token_state.json"

_code_holder = {}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.rstrip("/") not in ("/callback", ""):
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        _code_holder["code"] = params.get("code", [None])[0]
        _code_holder["state"] = params.get("state", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write("<h2>Listo. Ya podés cerrar esta pestaña.</h2>".encode("utf-8"))

    def log_message(self, *_):
        pass


def main():
    client_id = os.environ.get("KICK_CLIENT_ID")
    client_secret = os.environ.get("KICK_CLIENT_SECRET")
    redirect_uri = os.environ.get("KICK_REDIRECT_URI", "http://localhost:8080/callback")
    if not client_id or not client_secret:
        print("Faltan KICK_CLIENT_ID / KICK_CLIENT_SECRET en el .env.")
        sys.exit(1)

    try:
        import requests
    except ImportError:
        print("Falta 'requests'. Correr: pip install requests")
        sys.exit(1)

    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    state = secrets.token_urlsafe(16)

    qs = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    })
    auth_url = f"{AUTH_ENDPOINT}?{qs}"

    parsed = urllib.parse.urlparse(redirect_uri)
    server = HTTPServer((parsed.hostname or "localhost", parsed.port or 8080), _Handler)

    print("Abriendo el navegador para autorizar...\n", auth_url, "\n")
    webbrowser.open(auth_url)
    print(f"Esperando el callback en {redirect_uri} ...")

    deadline = time.time() + 300
    while "code" not in _code_holder and time.time() < deadline:
        server.handle_request()

    code = _code_holder.get("code")
    if not code:
        print("No llegó el código de autorización (timeout o denegado).")
        sys.exit(1)
    if _code_holder.get("state") != state:
        print("El 'state' no coincide — posible CSRF, abortando.")
        sys.exit(1)

    resp = requests.post(TOKEN_ENDPOINT, data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
        "code_verifier": verifier,
    }, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    config.ensure_dirs()
    estado = {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token", ""),
        "expira_en": int(time.time()) + int(data.get("expires_in", 3600)),
    }
    config.escribir_json(TOKEN_STATE_PATH, estado)
    print(f"\nOK. Tokens guardados en {TOKEN_STATE_PATH}")
    print("Ya podés arrancar el Módulo 6.")


if __name__ == "__main__":
    main()
