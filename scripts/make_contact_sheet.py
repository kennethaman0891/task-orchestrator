#!/usr/bin/env python3
"""
Render one frame per scene and stitch into a contact sheet.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from tto_spec_ad import get_renderer, TOTAL_FRAMES, FPS
from PIL import Image, ImageDraw, ImageFont
import os

KEYFRAMES = [
    (40,   "S1 · The Slam"),
    (220,  "S2 · The Grid"),
    (330,  "S3 · One Command"),
    (500,  "S4 · The City"),
    (680,  "S5 · The Notch"),
    (870,  "S6 · 1 to ∞"),
    (1030, "S7 · Hero"),
    (1180, "S8 · End Card"),
]

THUMB_W, THUMB_H = 480, 270
COLS = 4
ROWS = 2
PAD  = 16
SHEET_W = COLS * THUMB_W + (COLS + 1) * PAD
SHEET_H = ROWS * THUMB_H + (ROWS + 1) * PAD + 50

sheet = Image.new("RGB", (SHEET_W, SHEET_H), (8, 9, 11))
d     = ImageDraw.Draw(sheet)

try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    font_title = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
except:
    font = ImageFont.load_default()
    font_title = font

d.text((PAD, PAD//2), "TASK ORCHESTRATOR — Spec Ad Contact Sheet  «From 1 to ∞»",
       font=font_title, fill=(0, 210, 255))

for idx, (frame_n, label) in enumerate(KEYFRAMES):
    col = idx % COLS
    row = idx // COLS
    ox  = PAD + col * (THUMB_W + PAD)
    oy  = 40 + PAD + row * (THUMB_H + PAD)

    renderer = get_renderer(frame_n)
    img      = renderer(frame_n)
    thumb    = img.resize((THUMB_W, THUMB_H), Image.LANCZOS)

    sheet.paste(thumb, (ox, oy))
    # Label band
    d.rectangle([ox, oy + THUMB_H - 24, ox + THUMB_W, oy + THUMB_H],
                fill=(10, 12, 15))
    d.text((ox + 6, oy + THUMB_H - 20), f"[{frame_n:04d}]  {label}",
           font=font, fill=(0, 210, 255))

out = Path(__file__).parent.parent / "motion_assets" / "contact_sheet.png"
out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out, "PNG")
print(f"Contact sheet → {out}")
