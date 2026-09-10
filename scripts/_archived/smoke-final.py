import urllib.request, json, time

def get_token():
    req = urllib.request.Request(
        "https://tkd.ashbi.ca/api/auth/demo",
        method="POST",
        data=b"",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["token"]

TOKEN = get_token()
print("token len:", len(TOKEN))

working = [
    "/api/health", "/api/tournaments", "/api/competitors", "/api/auth/me",
    "/api/sports", "/api/invites", "/api/analytics/dashboard", "/api/public/tournaments",
    "/api/divisions/tournament/435ab382-fe49-4469-be51-b826a40ddcf3",
]

print()
print("--- Working routes (expect 200) ---")
for path in working:
    try:
        req = urllib.request.Request("https://tkd.ashbi.ca" + path,
            headers={"Authorization": "Bearer " + TOKEN})
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=5) as r:
            data = r.read()
        print(f"  {r.status} {time.time()-t0:.2f}s  {len(data)}b  {path}")
    except Exception as e:
        print(f"  ERR {time.time()-t0:.2f}s  {path}  {type(e).__name__}: {e}")

print()
print("--- Top-level 404 (expect 404, not hang) ---")
for path in ["/api/users", "/api/divisions", "/api/fairness/summary", "/api/registrations",
             "/api/brackets", "/api/matches", "/api/audit-log", "/api/email/templates",
             "/api/email/config"]:
    try:
        req = urllib.request.Request("https://tkd.ashbi.ca" + path,
            headers={"Authorization": "Bearer " + TOKEN})
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=5) as r:
            data = r.read()
        print(f"  {r.status} {time.time()-t0:.2f}s  {len(data)}b  {path}")
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code} {time.time()-t0:.2f}s  {path}")
    except Exception as e:
        print(f"  ERR {time.time()-t0:.2f}s  {path}  {type(e).__name__}")
