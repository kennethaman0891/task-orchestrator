#!/usr/bin/env bash
# ==============================================================================
# TTO — Motion Graphics Video Generator
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================================================="
echo "🎬 TTO (Task Orchestrator) Motion Graphics Generator"
echo "=================================================================="

# Run the Python motion graphics renderer
if command -v python3 &> /dev/null; then
    echo "▶ Rendering 1080p 60fps/24fps motion graphics video via pipeline..."
    python3 scripts/generate_motion_graphics_video.py
    echo "✅ Motion graphics generation complete!"
    echo "   • Promo video: frontend/public/videos/promo.mp4"
    echo "   • Intro video: frontend/public/videos/login.mp4"
else
    echo "Error: Python 3 is required to render the video."
    exit 1
fi
