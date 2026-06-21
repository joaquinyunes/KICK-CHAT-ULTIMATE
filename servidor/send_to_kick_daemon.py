"""
send_to_kick_daemon.py
Daemon persistente que mantiene una sesion tls_client abierta.
Lee comandos JSON por stdin (una linea por comando):
  {"type":"send","channel_id":20548413,"bearer":"...","message":"..."}
  {"type":"ping"}
Escribe respuestas JSON por stdout:
  {"type":"result","status":200,"body":"..."}
  {"type":"pong"}
"""
import sys, json, time, threading

try:
    import tls_client
except ImportError:
    print(json.dumps({"type": "error", "message": "tls_client no instalado"}))
    sys.exit(1)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
session = tls_client.Session(client_identifier="chrome_120", random_tls_extension_order=True)

def send_message(channel_id, bearer, message, message_ref=None):
    headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
    }
    if bearer:
        if bearer.startswith("Bearer "):
            headers["Authorization"] = bearer
        else:
            headers["Authorization"] = f"Bearer {bearer}"
    ref = message_ref or str(int(time.time() * 1000))
    payload = {"content": message, "type": "message", "message_ref": ref}
    url = f"https://kick.com/api/v2/messages/send/{channel_id}"
    try:
        res = session.post(url, headers=headers, json=payload, timeout=15)
        return {"type": "result", "status": res.status_code, "body": res.text[:500]}
    except Exception as e:
        return {"type": "result", "status": 0, "body": str(e)}

def main():
    # Signal that daemon is ready
    print(json.dumps({"type": "ready", "message": "Daemon iniciado"}))
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"type": "error", "message": f"JSON invalido: {e}"}))
            sys.stdout.flush()
            continue

        if cmd.get("type") == "ping":
            print(json.dumps({"type": "pong"}))
        elif cmd.get("type") == "send":
            result = send_message(
                cmd.get("channel_id"),
                cmd.get("bearer"),
                cmd.get("message"),
                cmd.get("message_ref"),
            )
            print(json.dumps(result))
        elif cmd.get("type") == "stop":
            break
        else:
            print(json.dumps({"type": "error", "message": f"Comando desconocido: {cmd.get('type')}"}))
        sys.stdout.flush()

if __name__ == "__main__":
    main()
