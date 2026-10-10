"""TTO Remote Control — command classification.

A structured safety policy (not a naive blacklist):

- `classify_shell(command)` returns SAFE | DANGEROUS | BLOCKED.
- SAFE commands execute immediately.
- DANGEROUS commands require a confirmation (with the exact command shown).
- BLOCKED commands are refused outright (never executed, never confirmed).

The policy is deny-by-default for known-bad patterns plus an explicit
allowlist of common safe prefixes; anything unrecognized but non-destructive
falls into SAFE (a working dev tool should not fight the user on every npm
script).  Destructive patterns are matched on TOKENS, not substrings, so
`echo rm -rf` is safe while `rm -rf x` is blocked.
"""
from __future__ import annotations

import re
import shlex
from enum import Enum
from typing import List


class SafetyLevel(Enum):
    SAFE = "safe"
    DANGEROUS = "dangerous"
    BLOCKED = "blocked"


# Commands that are refused outright, no confirmation offered.
BLOCKED_PREFIXES = (
    "rm -rf", "rm -fr", "rm -f -r", "rm -r -f",
    "sudo ", "shutdown", "reboot", "poweroff", "mkfs", "fdisk", "dd ",
    "diskutil erase", "chmod -r", "chown -r", "chmod -R", "chown -R",
    "curl -fsSL", "wget -q -O -", "wget | sh", "curl | sh",
    "> /dev/sda", "pvcreate", "vgremove", "git push --force", "git push -f",
)

# Dangerous but confirmable (single file / non-recursive destructive ops).
DANGEROUS_PREFIXES = (
    "rm ", "rmdir ", "kill ", "pkill ", "killall ", "kill -9", "pkill -9",
    "git clean", "git reset --hard", "drop database", "truncate ", "mv ",
)

# Explicitly safe — these always run without confirmation.
SAFE_PREFIXES = (
    "npm ", "pnpm ", "yarn ", "bun ", "npx ", "node ", "python", "pip ",
    "uv ", "cargo ", "go ", "rustc ", "git status", "git diff", "git log",
    "git add", "git commit", "git branch", "git checkout", "git stash",
    "ls", "pwd", "cat ", "head ", "tail ", "grep ", "find .", "echo ",
    "make ", "cmake ", "terraform ", "docker ps", "docker compose ps",
    "kubectl get", "ps ", "df -h", "du -sh", "top", "htop", "which ",
    "curl -I", "curl -sS", "wget ",
)

_BLOCK_RE = re.compile(r"\b(rm\s+-[a-z]*r|rm\s+-[a-z]*f|sudo|shutdown|reboot|poweroff|mkfs|fdisk|dd\s+|diskutil\s+erase|chmod\s+-[a-z]*r|chown\s+-[a-z]*r|git\s+push\s+(-f|--force)|curl\s+.*\|\s*(ba)?sh|wget\s+.*\|\s*(ba)?sh)\b", re.I)

# Severity ordering so the worst segment of a chained command wins.
_ORDER = {SafetyLevel.SAFE: 0, SafetyLevel.DANGEROUS: 1, SafetyLevel.BLOCKED: 2}

# Shell control operators that chain/compose commands. When present we must
# classify EACH segment, not just the leading token — otherwise a benign prefix
# (`echo ok && rm -rf ~`) hides a destructive tail behind the print-only path.
_SPLIT_RE = re.compile(r"\|\||&&|;|\||`|\$\(|\n|&")

# Piping ANY command into a shell is the classic remote-code pattern
# (`curl … | sh`, `cat script | bash`). Matched on the whole line before split.
_PIPE_TO_SHELL_RE = re.compile(r"\|\s*(?:sudo\s+)?(?:ba|z|k|tc|c|da)?sh\b", re.I)

# Wrappers that execute arbitrary code from a string arg. They must not be
# waved through just because the program name (python/node/…) is "safe" — a
# confirmation is required (DANGEROUS), or BLOCKED if the payload is destructive.
_CODE_EXEC_RE = re.compile(
    r"\b(?:python[0-9.]*|node|deno|bun|ruby|perl|php|osascript)\b[^\n]*\s-(?:c|e|eval)\b"
    r"|\b(?:ba|z|k|c|tc|da)?sh\b[^\n]*\s-c\b"
    r"|\beval\b",
    re.I,
)


def _tokens(command: str) -> List[str]:
    try:
        return shlex.split(command)
    except ValueError:
        return command.split()


# Print-only commands: the rest of the line is data, never executed.
_PRINT_ONLY = ("echo", "printf", "cat", "head", "tail", "grep", "ls", "pwd", "which", "env", "printenv", "tree", "file ")


def _classify_segment(seg: str) -> SafetyLevel:
    """Classify a SINGLE (already-split) command segment."""
    cmd = (seg or "").strip()
    if not cmd:
        return SafetyLevel.SAFE
    lowered = cmd.lower()
    toks = _tokens(lowered)
    first = toks[0] if toks else ""
    code_exec = bool(_CODE_EXEC_RE.search(lowered))
    # Print-only commands never execute their arguments — but only when this
    # segment is not itself an arbitrary-code wrapper.
    if not code_exec and (first in _PRINT_ONLY or lowered.startswith("echo ")):
        return SafetyLevel.SAFE
    for p in BLOCKED_PREFIXES:
        if lowered.startswith(p):
            return SafetyLevel.BLOCKED
    if _BLOCK_RE.search(lowered):
        return SafetyLevel.BLOCKED
    # Arbitrary-code wrappers with a non-destructive payload still need a
    # confirmation (they can run anything).
    if code_exec:
        return SafetyLevel.DANGEROUS
    for p in DANGEROUS_PREFIXES:
        if lowered.startswith(p):
            return SafetyLevel.DANGEROUS
    for p in SAFE_PREFIXES:
        if lowered.startswith(p):
            return SafetyLevel.SAFE
    # Unknown command — allow (SAFE) since it is not obviously destructive;
    # known-dangerous leading tokens still trip the check above.
    if first in ("kill", "pkill", "killall", "rm", "rmdir", "mv", "shutdown", "reboot", "sudo", "mkfs"):
        return SafetyLevel.DANGEROUS
    return SafetyLevel.SAFE


def classify_shell(command: str) -> SafetyLevel:
    """Classify a shell command string (structured policy, not naive).

    When a command chains multiple commands (via ``; && || | &`` backticks or
    ``$( )``), EACH segment is classified and the most severe level wins, so a
    benign prefix like ``echo ok && rm -rf ~`` cannot smuggle a destructive tail
    past the leading-token checks.  Piping into a shell and arbitrary-code
    wrappers (``python -c``, ``node -e``, ``sh -c``) are handled explicitly.
    """
    cmd = (command or "").strip()
    if not cmd:
        return SafetyLevel.SAFE
    lowered_full = cmd.lower()
    # Piping anything into a shell is an RCE pattern — refuse outright.
    if _PIPE_TO_SHELL_RE.search(lowered_full):
        return SafetyLevel.BLOCKED
    if _SPLIT_RE.search(cmd):
        worst = SafetyLevel.SAFE
        for seg in _SPLIT_RE.split(cmd):
            lvl = _classify_segment(seg)
            if _ORDER[lvl] > _ORDER[worst]:
                worst = lvl
        # A chained command hiding a code-exec wrapper is at least DANGEROUS.
        if worst == SafetyLevel.SAFE and _CODE_EXEC_RE.search(lowered_full):
            worst = SafetyLevel.DANGEROUS
        return worst
    return _classify_segment(cmd)


def is_read_only_path(path: str) -> bool:
    """True when a /files path is allowed (no traversal, no secret files)."""
    from .config import BLOCKED_PATH_FRAGMENTS
    p = (path or "").strip().lstrip("/")
    if p in ("..", ".") or p.startswith("../") or ".." in p.split("/"):
        return False
    if p.startswith(("etc/", "private/", "System/", "Library/", "usr/", "bin/", "sbin/", "dev/")):
        return False
    low = p.lower()
    for frag in BLOCKED_PATH_FRAGMENTS:
        if frag.lower() in low:
            return False
    return True
