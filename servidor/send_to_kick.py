"""Send message to Kick via tls_client. Single invocation = single session."""
import sys, json, time, tls_client

session = tls_client.Session(client_identifier="chrome_120", random_tls_extension_order=True)
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

def make_auth(bearer):
    if not bearer:
        return None
    if bearer.startswith("Bearer "):
        return bearer
    return f"Bearer {bearer}"

def send(bearer, chatroom_id, message):
    headers = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
    }
    auth = make_auth(bearer)
    if auth:
        headers["Authorization"] = auth
    ref = str(int(time.time() * 1000))
    payload = {"content": message, "type": "message", "message_ref": ref}
    url = f"https://kick.com/api/v2/messages/send/{chatroom_id}"
    res = session.post(url, headers=headers, json=payload)
    print(json.dumps({"status": res.status_code, "body": res.text}))

def chatroom(bearer, channel_slug):
    headers = {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }
    auth = make_auth(bearer)
    if auth:
        headers["Authorization"] = auth
    url = f"https://kick.com/api/v2/channels/{channel_slug}"
    res = session.get(url, headers=headers)
    if res.status_code != 200:
        print(json.dumps({"status": res.status_code, "body": res.text}))
        return
    data = res.json()
    cr_id = data.get("chatroom", data).get("id") if isinstance(data, dict) else None
    print(json.dumps({"status": 200, "chatroom_id": cr_id, "body": res.text[:200]}))

def send_to_channel(bearer, channel_slug, message):
    """Lookup channel + send in one session."""
    headers = {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }
    auth = make_auth(bearer)
    if auth:
        headers["Authorization"] = auth

    # Step 1: get chatroom_id
    ch_url = f"https://kick.com/api/v2/channels/{channel_slug}"
    cr = session.get(ch_url, headers=headers)
    if cr.status_code != 200:
        print(json.dumps({"status": 0, "body": f"Channel lookup failed: {cr.status_code}"}))
        return
    data = cr.json()
    chatroom_id = data.get("chatroom", data).get("id") if isinstance(data, dict) else None
    if not chatroom_id:
        print(json.dumps({"status": 0, "body": "No chatroom_id in response"}))
        return

    # Step 2: send (reuse same session)
    send_headers = {**headers, "Content-Type": "application/json"}
    ref = str(int(time.time() * 1000))
    payload = {"content": message, "type": "message", "message_ref": ref}
    send_url = f"https://kick.com/api/v2/messages/send/{chatroom_id}"
    res = session.post(send_url, headers=send_headers, json=payload)
    print(json.dumps({"status": res.status_code, "body": res.text}))

if __name__ == "__main__":
    # Read args from stdin as JSON (avoids cmd.exe quoting issues)
    try:
        args = json.loads(sys.stdin.read())
    except:
        # Fallback: read from argv
        args = sys.argv[1:] if len(sys.argv) > 1 else []
    if len(args) < 1:
        print(json.dumps({"status": 0, "body": "Uso incorrecto"}))
        sys.exit(1)
    mode = args[0]
    if mode == "send":
        send(args[1], args[2], args[3])
    elif mode == "chatroom":
        chatroom(args[1], args[2])
    elif mode == "send_to_channel":
        send_to_channel(args[1], args[2], args[3])
    else:
        print(json.dumps({"status": 0, "body": "Modo desconocido"}))
