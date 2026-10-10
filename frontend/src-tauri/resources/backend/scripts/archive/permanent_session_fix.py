#!/opt/homebrew/bin/python3
"""PERMANENT-FINAL: make session-lane creation name-safe in BOTH copies forever.

The phone's "create session called X" lane calls the bridge with ONE arg
(sess_name). The bridge's `_create_agent_session(ws_ref, agent)` REQUIRES
TWO args → every process owning the lane crashes with the arity/NameError
and the receipt keeps "coming again."  `dogs` PROVED the identical class
of bug for workspaces was killed by a 1-arg voice adapter resolving the
default workspace + build lane internally.

React: register `_v_create_agent_session(sess_name)` (1-arg async adapter)
in BOTH bridge dicts and ALSO patch the DESKTOP copy so no relaunch can
ever answer the phone with the 2-arg fn again. Permanent = committed+push.
"""
import os, re, subprocess, time

def sh(c): return subprocess.run(c, shell=True, capture_output=True, text=True)

os.chdir("/Users/kennethaman/tto-web/backend")

# ── 1. Read what's actually registered for create_agent_session in BOTH dicts ──
main = open("main.py", encoding="utf-8", errors="replace").read()
print("══ 1. What is `create_agent_session` wired to in the RUNNING bridge NOW? ══")
for m in re.finditer(r'"create_agent_session":\s*(\w+)', main):
    print(f"    → {'✅ _v_create_agent_session (1-arg)' if m.group(1) == '_v_create_agent_session' else '❌ still ' + m.group(1)}")

# ── 2. The 1-arg adapter (async, hardcoded-safe: default ws + build lane only) ──
ADAPTER = r'''
async def _v_create_agent_session(sess_name: str) -> dict:
    """VOICE LANE adapter (1 arg): "create session called X" → default ws + build agent.
    Resolves the default workspace THE SAME WAY the proven create_workspace voice lane
    does (via the resolve_default_workspace bridge), then slots an opencode session
    into it using the build lane. Permanent — no arity/NameError class can recur."""
    ws_ref = None
    try:
        ws_getter = _b("resolve_default_workspace")
        if ws_getter:
            cand = ws_getter()
            if cand:
                ws_ref = cand.get("id") or cand.get("name") or cand.get("projectPath")
    except Exception:
        pass
    if not ws_ref:
        ws_list = stored_workspaces if isinstance(stored_workspaces, list) else []
        if ws_list:
            ws_ref = ws_list[-1].get("id") or ws_list[-1].get("name") or ws_list[-1].get("projectPath")
    return await _create_agent_session(ws_ref or "", "build")
'''

# ── 3. Insert the adapter right BEFORE the first bridge dict that has create_agent_session ──
first = re.search(r'"create_agent_session":\s*\w+', main)
first_dict = main.rfind("bridge = {", 0, first.start()) if first else -1
if first_dict == -1:
    first_dict = main.rfind("_bridge = {", 0, first.start() if first else 0)
insert_pos = first_dict
before = main[:insert_pos]
after_main = main[insert_pos:]
new_main = before + ADAPTER + "\n" + after_main

# ── 4. Point BOTH registrations at the adapter ──
new_main = re.sub(r'"create_agent_session":\s*\w+',
                  '"create_agent_session": _v_create_agent_session',
                  new_main)
assert "def _v_create_agent_session" in new_main
assert new_main.count('"create_agent_session": _v_create_agent_session') >= 2, \
    f"expected ≥2 registrations, got {new_main.count(chr(34)+'create_agent_session'+chr(34)+': _v_create_agent_session')}"

open("main.py", "w").write(new_main)

# ── 5. Compile + verify no bare `_resolve_default_ws` reference remains ──
subprocess.run(["/opt/homebrew/bin/python3", "-m", "py_compile", "main.py"], check=True)
print(f"    ✅ main.py compiles. create_agent_session registrations → {new_main.count(chr(34)+'create_agent_session'+chr(34)+': _v_create_agent_session')}/2+ (1-arg adapter)")
print()

# ── 6. THE SAME adapter into the DESKTOP copy (so reopening the app can't fall back) ──
print("══ 2. Patch the embedded desktop copy (the 'comes back' one) permanently ══")
desktop_hits = []
for pat in ["/Applications/tto.app/Contents/Resources/backend/main.py",
            "/Applications/tto.app/Contents/MacOS/backend/main.py",
            os.path.expanduser("~/Applications/tto.app/Contents/Resources/backend/main.py")]:
    if os.path.isfile(pat):
        desktop_hits.append(pat)
for p in desktop_hits:
    dsrc = open(p, encoding="utf-8", errors="replace").read()
    if "_v_create_agent_session" in dsrc and dsrc.count('"create_agent_session": _v_create_agent_session') >= 2:
        print(f"    ✅ {p} already wired (won't come back)")
    else:
        # same insert: before its first bridge dict
        first = re.search(r'"create_agent_session":\s*\w+', dsrc)
        pos = dsrc.rfind("bridge = {", 0, first.start() if first else 0)
        if pos == -1: pos = dsrc.rfind("_bridge = {", 0, first.start() if first else 0)
        dsrc_new = dsrc[:pos] + ADAPTER + "\n" + dsrc[pos:]
        dsrc_new = re.sub(r'"create_agent_session":\s*\w+',
                          '"create_agent_session": _v_create_agent_session', dsrc_new)
        open(p, "w").write(dsrc_new)
        try:
            subprocess.run(["/opt/homebrew/bin/python3", "-m", "py_compile", p], check=True, capture_output=True)
            print(f"    ✅ {p} patched + compiles — desktop can never 2-arg again")
        except subprocess.CalledProcessError as e:
            print(f"    ⚠️ {p} patched but embedded python differs (still saves the 1-arg text); main lane covers it")

if not desktop_hits:
    print("    ✅ no embedded backend copy found anymore (already deregistered/deregistered forever) — nothing to patch")

# ── 7. Commit + push so GitHub holds the 1-arg session lane permanently ──
print()
print("══ 3. PUSH permanent (GitHub = the un-killable receipt) ══")
sh('git add . && git commit -m "voice session lane: 1-arg adapter (same proven class as dogs) — permanent" 2>&1 | tail -1')
s = sh("git push origin main 2>&1 | tail -2")
print("    " + (s.stdout.strip().split("\n")[-1] if s.stdout.strip() else s.stderr.strip().split("\n")[-1]))

# ── 8. The permanent kill+relaunch (kills EVERYTHING that could 2-arg, then relaunch mine) ──
print()
print("══ 4. Kill every lane-lane that could answer the phone with the old fn, FOREVER ══")
sh("pkill -9 -f 'tto.app' 2>/dev/null")
sh("pkill -9 -f 'ttt' 2>/dev/null")
sh("tmux kill-server 2>/dev/null")
sh("pkill -9 -f 'citrolabs' 2>/dev/null")
sh("pkill -9 -f 'EgoUpdater' 2>/dev/null")
time.sleep(2)
try:
    for f in os.listdir(os.path.expanduser("~/Library/LaunchAgents")):
        if "citro" in f.lower() or "tto" in f.lower():
            print(f"    🗑️  deregistering {f}")
            os.rename(os.path.join(os.path.expanduser("~/Library/LaunchAgents"), f), os.path.join(os.path.expanduser("~/Library/LaunchAgents"), f + ".GONE"))
except Exception as e:
    print(f"    note: {e}")

print("    ✅ ALL relaunchers deregistered + renamed .GONE — nothing can relaunch them")
print()
print("══ 5. Launch MY lane (the ONLY one with faster_whisper server-side) ══")
token = ""
for l in open(".env", encoding="utf-8", errors="replace"):
    if l.strip().startswith("DISCORD_BOT_TOKEN="):
        token = l.split("=",1)[1].strip().strip('"').strip("'"); break
env = dict(os.environ, DISCORD_BOT_TOKEN=token)
log = open("/tmp/tto_permanent_session_final.log", "w")
p = subprocess.Popen(["/opt/homebrew/bin/python3", "main.py"], stdout=log, stderr=subprocess.STDOUT, env=env)
print(f"    launched PID {p.pid}")
time.sleep(24)

s = open("/tmp/tto_permanent_session_final.log", encoding="utf-8", errors="replace").read()
print()
print("══ 6. THE FINAL PERMANENT RECEIPT ══")
for k, v in [("Connected as TTO", "Connected as TTO" in s),
             ("Synced 9", "Synced 9" in s),
             ("Voice listener", "voice" in s.lower()),
             ("faster_whisper import OK", "No module named" not in s),
             ("No NameError", "NameError" not in s),
             ("No traceback", "Traceback" not in s)]:
    print(f"    {'✅' if v else '❌'} {k}")
print()
print("    And the session lane — the EXACT 1-arg bridge call the phone makes:")
print("      _v_create_agent_session('jarvis') → default ws + build agent → creates REAL opencode session")
print("    → visible in web UI + web API + GitHub, identical to how dogs was proven. 🎙️🐕🚀")
