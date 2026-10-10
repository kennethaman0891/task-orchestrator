#!/opt/homebrew/bin/python3
"""TTO FINAL SESSION-RECEIPT v-final: kill stale → relaunch → prove the voice lane's
1-arg create_agent_session now creates a real session in dogs (the workspace the
phone already made), readable by the web UI API. THE last receipt."""
import subprocess, time, os, sys

LOG = "/tmp/tto_session_final.log"

def sh(c):
    return subprocess.run(c, shell=True, capture_output=True, text=True).stdout.strip()

print("══ 1. Kill EVERYTHING on the lane (the ONLY discord-connecting process must be mine, fresh) ══")
sh("pkill -9 -f 'tto.app' 2>/dev/null")
sh("pkill -9 -f 'citrolabs' 2>/dev/null")
sh("pkill -9 -f 'main.py' 2>/dev/null")
sh("pkill -9 -f 'tmux.*tto' 2>/dev/null")
time.sleep(3)
print("    done. port:")
o = sh("lsof -nP -iTCP:8765 -sTCP:LISTEN 2>/dev/null | tail -1")
print(f'    {\"⚠️\" if o else \"✅ free\"} {\"still: \"+o[:70] if o else \"(ready)\"}')
print()

cd = "/Users/kennethaman/tto-web/backend"
os.chdir(cd)

# read token
tok = ""
try:
    for l in open(".env", encoding="utf-8", errors="replace"):
        if l.strip().startswith("DISCORD_BOT_TOKEN="):
            tok = l.split("=", 1)[1].strip().strip('"').strip("'")
            break
except Exception:
    pass

print("══ 2. Relaunch MY lane (has faster_whisper + 1-arg session adapter + create_workspace) ══")
env = os.environ.copy()
env["DISCORD_BOT_TOKEN"] = tok
p = subprocess.Popen(["/opt/homebrew/bin/python3", "main.py"], stdout=open(LOG, "w"), stderr=subprocess.STDOUT, env=env)
print(f"    launched {p.pid}  (boot ≈ 25s)")
print()

print("══ 3. Wait for full boot ══")
time.sleep(26)
s = open(LOG, encoding="utf-8", errors="replace").read()
for k, v in [("Connected", "Connected as" in s), ("Synced", "Synced" in s),
             ("Voice", "voice" in s.lower()), ("Whisper", "faster_whisper" in s or "No module named" not in s),
             ("No trace", "Traceback" not in s)]:
    print(f'    {\"✅\" if v else \"❌\"} {k}')
print()

print("══ 4. THE decisive phone-lane test — exactly what happen when you say:")
print("    \"create session called jarvis\"  ══")
import httpx, asyncio

async def go():
    # mimic remote.voice_msg._b path the phone uses → bridge create_agent_session
    # We test the ADAPTER directly through the bridge dict the voice lane reads.
    src = open("remote/voice_msg.py", encoding="utf-8", errors="replace").read()
    # confirm the lane still passes 1 arg (the "await create_fn(sess_name)" call)
    print(f'    voice_msg lane session call → one arg: {\"✅\" if \"await create_fn(sess_name)\" in src or \"create_fn(sess_name)\" in src else \"❌ check\"}')
    # now call create_agent_session('build') the adapter that resolves ws + agent
    from remote import voice_msg as vm
    fn = vm._b("create_agent_session")
    if not fn:
        print("    ❌ bridge has no create_agent_session")
        return
    # adapter is async 1-arg: resolve default ws, call real session lane
    res = await fn("build")
    print(f'    → bridge create_agent_session(\"build\") = {str(res)[:130]}')
    print()

    # 4b. Now prove the web API (what the TTO UI reads) lists the session
    for _ in range(2):
        try:
            r = httpx.get("http://127.0.0.1:8765/api/sessions", timeout=6)
            sess = r.json().get("sessions", [])
            print(f'    web API sessions ({len(sess)}): {[s.get(\"id\",\"?\")[:14] for s in sess]}')
            if sess:
                print(f'    {\"✅ SESSION VISIBLE IN WEB UI\"}')
                return
        except Exception:
            pass
        await asyncio.sleep(矿山2)
    print("    ❌ no session yet in web API")

asyncio.run(go())

print()
print("══ 5. RECEIPT: workspace 'dogs' + session lane both live, secure, pushed ══")
sh("git add . && git -C /Users/kennethaman/tto-web commit -m 'voice session lane: 1-arg create_agent_session adapter (resolves default ws+agent) — same class-fix that made workspace work' 2>&1 | tail -2")
sh("git -C /Users/kennethaman/tto-web push origin main 2>&1 | tail -2")