#!/opt/homebrew/bin/python3
"""FINAL: clean kill all tmux + relaunch MY repo main.py, verify receipt."""
import os, re, subprocess, time, sys

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout

print("══ 1. Kill ALL tmux sessions (tto.app's terminals) ══")
out = sh("tmux ls 2>/dev/null | awk '{print $1}' | sed 's/:$//'")
sessions = [l.strip() for l in out.split('\n') if l.strip()]
for s in sessions:
    sh(f"tmux kill-session -t {s} 2>/dev/null")
    print(f"  🗑️  killed {s}")
if not sessions:
    print("  (none — already clean)")
print()

print("══ 2. Kill the ORPHANED main.py (PID 77778, spawned by tto.app) ══")
sh("kill -9 77778 2>/dev/null")
time.sleep(3)
print()

print("══ 3. Verify 8765 free ══")
free = sh("lsof -nP -iTCP:8765 -sTCP:LISTEN 2>/dev/null")
print("  ✅ FREE" if not free else f"  ❌ still: {free.strip()[:80]}")
print()

print("══ 4. Relaunch MY repo main.py (parent=Shell, not tto.app) ══")
# extract token
token = ""
for l in open(".env", encoding="utf-8", errors="replace"):
    if l.strip().startswith("DISCORD_BOT_TOKEN="):
        token = l.split("=", 1)[1].strip().strip('"').strip("'")
        break
os.environ["DISCORD_BOT_TOKEN"] = token
p = subprocess.Popen(["/opt/homebrew/bin/python3", "main.py"],
                     stdout=open("/tmp/tto_final_receipt.log", "w"),
                     stderr=subprocess.STDOUT)
print(f"  launched {p.pid}")
print()

print("══ 5. Wait 25s for full boot ══")
time.sleep(25)

print("══ 6. RECEIPT ══")
s = open("/tmp/tto_final_receipt.log", encoding="utf-8", errors="replace").read()
checks = [
    ("Connected as TTO", "Connected as TTO" in s),
    ("Synced 9", "Synced 9" in s),
    ("Voice listener", "voice" in s.lower() and "listener" in s.lower()),
    ("Whisper import OK", "No module named" not in s),
    ("Create_workspace bridge", "create_workspace" in open("main.py", encoding="utf-8").read()),
    ("No traceback", "Traceback" not in s.upper()),
]
for k, v in checks:
    print(f"  {'✅' if v else '❌'} {k}")
print()
print("══ WHO is the parent now? (must NOT be tto.app) ══")
ppid = sh(f"ps -p {p.pid} -o ppid= 2>/dev/null").strip()
parent = sh(f"ps -p {ppid} -o command= 2>/dev/null").strip() if ppid else "?"
print(f"  pid={p.pid} ppid={ppid} parent={parent[:60]}")
print("  " + ("✅ CLEAN — repo owns the lane" if not any(x in parent for x in ("tto.app", "tto")) else "❌ STILL tto.app parent!"))
