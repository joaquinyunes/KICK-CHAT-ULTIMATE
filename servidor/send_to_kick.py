"""Send message to Kick via tls_client (bypass Cloudflare)."""
import sys, json, time, tls_client

session = tls_client.Session(client_identifier="chrome_120", random_tls_extension_order=True)

def send(bearer, chatroom_id, message):
    ref = str(int(time.time() * 1000))
    url = f"https://kick.com/api/v2/messages/send/{chatroom_id}"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "x-app-platform": "web",
    }
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    payload = {"content": message, "type": "message", "message_ref": ref}
    res = session.post(url, headers=headers, json=payload)
    print(json.dumps({"status": res.status_code, "body": res.text}))

def chatroom(bearer, channel):
    url = f"https://kick.com/api/v2/channels/{channel}"
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    res = session.get(url, headers=headers)
    print(json.dumps({"status": res.status_code, "body": res.text}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": 0, "body": "Uso incorrecto"}))
        sys.exit(1)
    mode = sys.argv[1]
    if mode == "send":
        send(sys.argv[2], sys.argv[3], sys.argv[4])
    elif mode == "chatroom":
        chatroom(sys.argv[2], sys.argv[3])
    else:
        print(json.dumps({"status": 0, "body": "Modo desconocido"}))
