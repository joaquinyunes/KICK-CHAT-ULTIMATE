"""
Genera el valor de PANEL_PASSWORD_HASH para el Panel de Control (Módulo 11).

El panel nunca guarda tu contraseña en texto plano: guarda solo este hash.
Corré este script una vez, elegí una contraseña, y pegá la línea que
imprime en tu archivo .env (o exportala en la terminal).

Uso:
    python generar_password.py

Requiere:
    pip install flask   (trae werkzeug, que es lo que se usa acá)
"""

import getpass
import secrets
import sys

try:
    from werkzeug.security import generate_password_hash
except ImportError:
    print("Falta werkzeug/flask. Correr: pip install flask --break-system-packages")
    sys.exit(1)


def main():
    p1 = getpass.getpass("Contraseña nueva para el panel: ")
    if len(p1) < 8:
        print("Usá al menos 8 caracteres.")
        sys.exit(1)
    p2 = getpass.getpass("Repetir contraseña: ")
    if p1 != p2:
        print("Las contraseñas no coinciden.")
        sys.exit(1)

    hash_pw = generate_password_hash(p1)
    secret = secrets.token_urlsafe(48)

    print("\nAgregá estas líneas a tu archivo .env (ajustá PANEL_USUARIO a gusto):\n")
    print("PANEL_USUARIO=admin")
    print(f'PANEL_PASSWORD_HASH="{hash_pw}"')
    print(f"PANEL_SECRET_KEY={secret}")
    print("\n(La PANEL_SECRET_KEY se generó al azar; si la cambiás, se cierran las sesiones abiertas.)")


if __name__ == "__main__":
    main()
