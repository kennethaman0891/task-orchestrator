#!/usr/bin/env python3
"""
project_floor_scanner.py — Deterministic Project Architecture & 3D Floor Plan Scanner.

Can be run standalone:
    python3 scripts/project_floor_scanner.py [project_path]
"""

import sys
import json
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from backend.project_scanner import scan_project

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "."
    plan = scan_project(target)
    print(json.dumps(plan, indent=2))
