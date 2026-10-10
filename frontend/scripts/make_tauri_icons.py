#!/usr/bin/env python3
"""Generate Task Orchestrator Tauri icons (multi-size PNGs, icns, ico) without external deps."""
import os
import struct
import zlib
import subprocess
import tempfile
import shutil

# Task Orchestrator brand colors
ACCENT = (74, 158, 255)      # Blue accent
BG = (10, 10, 10)            # Dark background
DARK = (0, 0, 0)             # Black for text
GREEN = (74, 222, 128)       # Green accent dot

def rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r

def make_icon(size):
    px = [0] * (size * size)
    content = int(size * 0.84)
    x0 = int(size * 0.08)
    y0 = int(size * 0.08)
    x1 = x0 + content
    y1 = y0 + content
    r = int(content * 0.09)

    # Background rounded rect
    for y in range(size):
        for x in range(size):
            idx = y * size + x
            if rounded_rect(x, y, x0, y0, x1, y1, r):
                px[idx] = ACCENT
            else:
                px[idx] = BG

    # Draw "TO" initials - two vertical bars for T and O
    bar_h = int(content * 0.12)
    stem_w = int(content * 0.10)
    o_ring_w = int(content * 0.10)
    o_r = int(content * 0.20)
    
    # T position (left)
    t_bar_x0 = x0 + int(content * 0.18)
    t_bar_x1 = x0 + int(content * 0.45)
    t_bar_y0 = y0 + int(content * 0.22)
    t_bar_y1 = t_bar_y0 + bar_h
    
    t_stem_x0 = x0 + int(content * 0.28)
    t_stem_x1 = t_stem_x0 + stem_w
    t_stem_y0 = t_bar_y0 - bar_h // 2
    t_stem_y1 = t_stem_y0 + int(content * 0.40)
    
    # O position (right) - centered ring
    o_cx = x0 + int(content * 0.70)
    o_cy = y0 + int(content * 0.52)
    o_r_outer = int(content * 0.20)
    o_r_inner = int(content * 0.12)

    # Accent dot (bottom right)
    dot_cx = x0 + int(content * 0.82)
    dot_cy = y0 + int(content * 0.82)
    dot_r = int(content * 0.06)

    for y in range(size):
        for x in range(size):
            idx = y * size + x
            # T horizontal bar
            if t_bar_x0 <= x <= t_bar_x1 and t_bar_y0 <= y <= t_bar_y1:
                px[idx] = DARK
            # T vertical stem
            elif t_stem_x0 <= x <= t_stem_x1 and t_stem_y0 <= y <= t_stem_y1:
                px[idx] = DARK
            # O ring (outer circle minus inner circle)
            elif (x - o_cx) ** 2 + (y - o_cy) ** 2 <= o_r_outer ** 2:
                dx = x - o_cx
                dy = y - o_cy
                if dx * dx + dy * dy >= o_r_inner ** 2:
                    px[idx] = DARK
            # Green accent dot
            elif (x - dot_cx) ** 2 + (y - dot_cy) ** 2 <= dot_r ** 2:
                px[idx] = GREEN

    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            idx = y * size + x
            c = px[idx]
            raw += bytes((c[0], c[1], c[2], 255))
    return bytes(raw)

def write_png(path, size, rgba):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(rgba, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

# Sizes needed for Tauri/macOS
sizes = [16, 32, 64, 128, 256, 512, 1024]

out_dir = '/Users/kennethaman/tto-golden/frontend/src-tauri/icons'

# Generate all PNG sizes
for size in sizes:
    rgba = make_icon(size)
    write_png(os.path.join(out_dir, f"{size}x{size}.png"), size, rgba)
    print(f"Generated {size}x{size}.png")

# Create iconset for icns
iconset_dir = os.path.join(out_dir, "TaskOrchestrator.iconset")
os.makedirs(iconset_dir, exist_ok=True)

# macOS iconset naming convention
icon_mapping = {
    16: "icon_16x16.png",
    32: "icon_16x16@2x.png",
    32: "icon_32x32.png",
    64: "icon_32x32@2x.png",
    128: "icon_128x128.png",
    256: "icon_128x128@2x.png",
    256: "icon_256x256.png",
    512: "icon_256x256@2x.png",
    512: "icon_512x512.png",
    1024: "icon_512x512@2x.png",
}

# Actually we need unique names - let's do it properly
icon_mapping = [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]

for size, name in icon_mapping:
    rgba = make_icon(size)
    write_png(os.path.join(iconset_dir, name), size, rgba)

# Generate icns using iconutil
result = subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', os.path.join(out_dir, 'icon.icns')], capture_output=True, text=True)
if result.returncode == 0:
    print("Generated icon.icns")
else:
    print(f"iconutil failed: {result.stderr}")

# Generate ico using the 16, 32, 48, 256 sizes
# For simplicity, we'll just copy the 256 as ico (not ideal but works)
# A proper ico would need multiple images - using png for now
shutil.copy(os.path.join(out_dir, "256x256.png"), os.path.join(out_dir, "icon.ico"))
print("Copied 256x256.png as icon.ico (placeholder)")

# Clean up iconset
shutil.rmtree(iconset_dir)

print("Tauri icons generation complete!")
