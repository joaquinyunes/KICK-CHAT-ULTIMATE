"""
send_to_kick_cookies.py
Envía mensajes a Kick usando requests con cookies de sesión + bearer token.
Recibe: <channel> <message> <cookies_b64> [bearer_token]
Devuelve JSON por stdout.
"""
import sys, json, base64, time
try:
    import requests
except ImportError:
    print(json.dumps({"status": 0, "body": "requests no instalado"}))
    sys.exit(1)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def parse_cookies(raw):
    try:
        data = json.loads(raw)
    except:
        return {}
    if isinstance(data, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in data.items()):
        return data
    if isinstance(data, list):
        result = {}
        for c in data:
            if isinstance(c, dict) and "name" in c and "value" in c:
                result[c["name"]] = c["value"]
        return result
    return {}

def send(channel, message, cookies_dict, bearer=None):
    session = requests.Session()
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "x-app-platform": "web",
    }
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    session.headers.update(headers)

    for name, value in cookies_dict.items():
        session.cookies.set(name, value, domain=".kick.com", path="/")

    slug = channel.strip().lower()
    ch_url = f"https://kick.com/api/v2/channels/{slug}"
    try:
        cr = session.get(ch_url, timeout=15)
        if cr.status_code != 200:
            return {"status": 0, "body": f"No se pudo obtener canal: {cr.status_code}"}
        ch_data = cr.json()
        chatroom_id = None
        if isinstance(ch_data, dict):
            chatroom_id = ch_data.get("chatroom", ch_data).get("id")
        if not chatroom_id:
            return {"status": 0, "body": "No se pudo obtener chatroom_id"}
    except Exception as e:
        return {"status": 0, "body": f"Error obteniendo canal: {str(e)}"}

    ref = str(int(time.time() * 1000))
    msg_url = f"https://kick.com/api/v2/messages/send/{chatroom_id}"
    payload = {"content": message, "type": "message", "message_ref": ref}
    try:
        r = session.post(msg_url, json=payload, timeout=15)
        return {"status": r.status_code, "body": r.text[:500]}
    except Exception as e:
        return {"status": 0, "body": f"Error enviando: {str(e)}"}

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"status": 0, "body": "Uso: script <channel> <message> <cookies_b64> [bearer]"}))
        sys.exit(1)

    channel = sys.argv[1]
    message = sys.argv[2]
    cookies_b64 = sys.argv[3]
    bearer = sys.argv[4] if len(sys.argv) > 4 else None

    try:
        raw = base64.b64decode(cookies_b64).decode("utf-8")
    except:
        print(json.dumps({"status": 0, "body": "Error decodificando base64"}))
        sys.exit(1)

    cookies = parse_cookies(raw)
    result = send(channel, message, cookies, bearer)
    print(json.dumps(result))
