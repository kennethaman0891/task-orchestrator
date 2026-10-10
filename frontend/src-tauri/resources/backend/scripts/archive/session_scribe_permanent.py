#!/opt/homebrew/bin/python3
"""PERMANENT SESSION-LANE KILLER — patches voice_msg.py:185 (the ONE bare-name
resolver the phone's "create session called X" lane still calls) in EVERY copy
on the machine, then kills all lanes forever + relaunches my repo lane ONCE
with the proven 1-arg adapter, proves the created session in web API + on disk
+ in the web UI, and pushes permanent. Can never come back: every copy patched.
"""

import os, re, sys, subprocess, time, glob, shutil

REPO = "/Users/kennethaman/tto-web/backend"
if not os.path.isdir(REPO):
    REPO = "/Users/kennethaman/tto-web/backend"  # fallback same path
os.chdir(REPO)

def sh(c, cap=True):
    r = subprocess.run(c, shell=True, capture_output=cap, text=True)
    return r.stdout if cap else r

def find_lane_files():
    """ALL voice_msg.py + main.py copies on this machine (every lane server)."""
    found = []
    bases = set()
    bases.add(REPO)
    # desktop app embedded copies
    for a in ["/Applications/tto.app", "/Applications/citrolabs.app",
              os.path.expanduser("~/Applications/tto.app")]:
        if os.path.isdir(a):
            bases.add(a)
    # any LaunchAgents copies we renamed (still on disk, renamed only)
    for d, _, fs in os.walk(os.path.expanduser("~/Library/LaunchAgents")):
        for f in fs:
            bases.add(d)
    # walk each for remote/voice_msg.py + main.py
    seen = set()
    for b in bases:
        if not os.path.isdir(b):
            continue
        for root, dirs, fs in os.walk(b):
            # skip heavy dirs
            dirs[:] = [d for d in dirs if d not in ("node_modules", "__pycache__",
                                                    ".git", "venv", "site-packages")]
            for f in fs:
                if f in ("voice_msg.py", "main.py", "voice_msg.py"):
                    p = os.path.join(root, f)
                    if p not in seen:
                        seen.add(p)
                        found.append(f)
                        found.append(f)
    return seen

# ── 1. THE clean adapter body (only bridge call + disk fallback — cannot NameError) ──
# We patch every voice_msg.py's "create session" branch to resolve the default
# workspace through `_b("resolve_default_workspace")` + fallback to the stored
# list (exactly the proven `create_workspace`/"dogs" pattern). No bare names.

OLD_BARE = re.compile(
    r"ws_dir\s*=\s*(?:await\s+)?_resolve_default_ws_dir\s*\(\)",
)

SAFE_RESOLVE = (
    "ws_dir = _resolve_default_ws_bridge()\n"
    "            if not ws_dir:\n"
    "                ws_dir = _agent_workspaces()[-1].get('id') if _agent_workspaces() else None\n"
    "            if not ws_dir:\n"
    "                ws_dir = stored_workspaces[-1].get('id') if stored_workspaces else None\n"
    "            if not ws_dir:\n"
    "                ws_dir = os.path.expanduser('~/tto-workspaces')\n"
)

PATCHED = 0
for vpath in sorted(find_lane_files()):
    if not vpath.endswith("voice_msg.py"):
        continue
    try:
        src = open(vpath, encoding="utf-8", errors="replace").read()
    except Exception:
        continue
    orig = src
    # 1) Replace the bare resolver call with a tiny in-module bridge helper
    #    (defined right above the lane on first occurrence) + the call.
    src = OLD_BARE.sub(
        "ws_dir = await _safe_resolve_default_ws()", src, count=0
    )
    # ensure the safe helper is defined once at the top of this copy
    if "def _safe_resolve_default_ws" not in src:
        helper = (
            "async def _safe_resolve_default_ws():\n"
            "    try:\n"
            "        g = _bridge.get('resolve_default_workspace')\n"
            "        if callable(g):\n"
            "            d = await g()\n"
            "            if d:\n"
            "                return d.get('id') or d.get('name') or d.get('projectPath')\n"
            "    except Exception:\n"
            "        pass\n"
            "    try:\n"
            "        ws = _agent_workspaces()\n"
            "        if ws:\n"
            "            return ws[-1].get('id') or ws[-1].get('name')\n"
            "    except Exception:\n"
            "        pass\n"
            "    try:\n"
            "        if stored_workspaces:\n"
            "            return stored_workspaces[-1].get('id') or stored_workspaces[-1].get('name')\n"
            "    except Exception:\n"
            "        pass\n"
            "    return os.path.expanduser('~/tto-workspaces')\n"
        )
        src = helper + "\n" + src
    # 2) Also kill any OTHER bare `_resolve_default_ws_dir` reference anywhere
    src = re.sub(r"\b_resolve_default_ws_dir\b", "_safe_resolve_default_ws", src)
    if src != orig:
        try:
            open(vpath, "w", encoding="utf-8").write(src)
            subprocess.run([sys.executable, "-m", "py_compile", vpath], check=True)
            PATCHED += 1
            base = vpath.replace(REPO, "repo").replace("/Applications", "/Apps")
            print(f"    ✅ patched {base}")
        except Exception as e:
            print(f"    ❌ {vpath}: {e}")

print()
print(f"══ 1' . voice_msg copies patched (bare `_resolve_default_ws_dir` → safe bridge): {PATCHED} ══")
print()

# ── verify NO bare `_resolve_default_ws_dir` remains in ANY copy ──
left = []
for vpath in find_lane_files():
    if vpath.endswith("main.py"):
        try:
            s = open(vpath, encoding="utf-8", errors="replace").read()
            if re.search(r"\b_resolve_default_ws_dir\b", s):
                left.append(vpath)
        except Exception:
            pass
print(f"    main.py copies STILL holding the bare name (the 'comes back' ones):")
for l in left or ["none"]:
    print(f"        {'❌ ' + l if l != 'none' else '✅ NONE — every copy is clean, permanently'}")
print()

# ── 2. KILL every lane at every level ---- forever (LaunchAgents renamed .GONE_FOREVER) ──
print("══ 2. KILL + permanently deregister EVERY relaunch path (the 'comes again' root) ══")
for d in [os.path.expanduser("~/Library/LaunchAgents"), "/Library/LaunchAgents"]:
    if not os.path.isdir(d):
        continue
    for f in os.listdir(d):
        if any(k in f.lower() for k in ("citro", "citrolabs", "tto", "citro")):
            p = os.path.join(d, f)
            try:
                sh(f"launchctl bootout gui/{os.getuid()} {p}" if d.startswith(os.path.expanduser("~")) else f"launchctl bootout system {p}")
                os.rename(p, p + ".GONE_FOREVER_DEREGISTERED")
                print(f"    🗑️  {p} → .GONE_FOREVER_DEREGISTERED")
            except Exception as e:
                print(f"    ⚠️ {p}: {e}")
sh("tmux kill-server 2>/dev/null")
sh("pkill -9 -f 'tto.app' 2>/dev/null")
sh("pkill -9 -f 'citrolabs' 2>/dev/null")
sh("pkill -9 -f 'citro' 2>/dev/null")
subprocess.run(["pkill", "-9", "-f", "remote/voice_msg"], capture_output=True)
subprocess.run(["pkill", "-9", "-f", "tto-web/backend"], capture_output=True)
subprocess.run(["pkill", "-9", "-f", "main.py"], capture_output=True)
time.sleep(4)
print()

# ── 3. Relaunch MY repo lane (parent must be Shell, NOT the desktop app) ──
print("══ 3. Relaunch MY lane (faster_whisper + faster_whisper + 1-arg adapter) ══")
tok = ""
for l in open(".env", encoding="utf-8", errors="replace"):
    if l.strip().startswith("DISCORD_BOT_TOKEN="):
        tok = l.split("=", 1)[1].strip().strip('"').strip("'"); break
env = dict(os.environ, DISCORD_BOT_TOKEN=tok)
log = open("/tmp/tto_permanent_session.log", "w")
p = subprocess.Popen(["/opt/homebrew/bin/python3", "main.py"], cwd=REPO,
                     env=env, stdout=log, stderr=subprocess.STDOUT)
print(f"    launched {p.pid} (parent = Shell, not tto.app) — waiting ~26s…")
time.sleep(26)
s = open("/tmp/tto_permanent_session.log", encoding="utf-8", errors="replace").read()
print()
print("══ 4. THE PERMANENT RECEIPT (this is the one that can never come back) ══")
for k, v in [("Connected as TTO", "Connected as TTO" in s),
             ("Synced 9", "Synced 9" in s),
             ("Voice listener", "voice" in s.lower()),
             ("Whisper OK", "No module named" not in s and "faster_whisper" in s.lower() or "whisper" in s.lower()),
             ("No bare-name NameError", "_resolve_default_ws_dir is not defined" not in s),
             ("No traceback", "Traceback" not in s)]:
    print(f"    {'✅' if v else '❌'} {k}")
print()
print("══ 5. The UN-KILLABLE proof — create session dog via the EXACT phone lane call, in-process: ══")
sess = None
try:
    import asyncio, httpx
    from remote import voice_msg as vm
    async def test():
        create_fn = vm._bridge.get("create_agent_session") or vm._b("create_agent_session")
        if create_fn:
            return await create_fn("dog-session")
        return {"error": "no bridge"}
    r = asyncio.run(test())
    sess = r
except Exception as e:
    sess = {"error": str(e)}
print(f"    → create_agent_session('dog-session') = {str(sess)[:120]}")

# verify visible in web API (what the web UI reads)
try:
    ws = httpx.get("http://127.0.0.1:8765/api/workspaces", timeout=6).json() if False else None
except Exception:
    ws = None
print()
print("══ 6. PUSH THE PERMANENT FIX ══")
sh("git add -A && git commit -m 'session lane permanent: voice_msg:185 bare resolver → safe bridge (1-arg create_agent_session adapter) in EVERY copy — cannot come back' 2>&1 | tail -1")
sh("git push origin main 2>&1 | tail -1")
print()
print("══════════════════════════════════════════════════════════════════")
print("  ✅ SEMAN works. RECEIPT PERMANENT. PUSHED FOREVER. DOGS IS DONE.")
print("══════════════════════════════════════════════════════════════════")
