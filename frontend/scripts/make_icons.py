#!/usr/bin/env python3
"""Generate tto PWA icons (192, 512, maskable-512) as PNGs without external deps."""
import os
import struct
import zlib

ACCENT = (74, 158, 255)
BG = (10, 10, 10)
DARK = (0, 0, 0)
GREEN = (74, 222, 128)


def rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


def make_icon(size, safe_padding=0.0):
    """safe_padding 0..0.5 shrinks content into center for maskable icons."""
    px = [0] * (size * size)
    content = int(size * (1.0 - 2.0 * safe_padding))
    x0 = int(size * safe_padding)
    y0 = int(size * safe_padding)
    x1 = x0 + content
    y1 = y0 + content
    r = int(content * 0.09)

    for y in range(size):
        for x in range(size):
            idx = y * size + x
            if rounded_rect(x, y, x0, y0, x1, y1, r):
                px[idx] = ACCENT
            else:
                px[idx] = BG

    t_bar_w = int(content * 0.22)
    t_bar_h = int(content * 0.13)
    t_stem_w = int(content * 0.11)
    t_stem_h = int(content * 0.32)

    bar_x0 = x0 + int(content * 0.30)
    bar_x1 = x0 + int(content * 0.70)
    bar_y0 = y0 + int(content * 0.28)
    bar_y1 = bar_y0 + t_bar_h

    stem_x0 = x0 + (content - t_stem_w) // 2
    stem_x1 = stem_x0 + t_stem_w
    stem_y0 = y0 + int(content * 0.28) - t_bar_h // 2
    stem_y1 = stem_y0 + t_stem_h

    dot_cx = x0 + int(content * 0.74)
    dot_cy = y0 + int(content * 0.74)
    dot_r = int(content * 0.07)

    for y in range(size):
        for x in range(size):
            idx = y * size + x
            if bar_x0 <= x <= bar_x1 and bar_y0 <= y <= bar_y1:
                px[idx] = DARK
            elif stem_x0 <= x <= stem_x1 and stem_y0 <= y <= stem_y1:
                px[idx] = DARK
            elif (x - dot_cx) ** 2 + (y - dot_cy) ** 2 <= dot_r * dot_r:
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


out = os.path.join(os.path.dirname(__file__), "..", "public")
os.makedirs(out, exist_ok=True)
write_png(os.path.join(out, "icon-192.png"), 192, make_icon(192))
write_png(os.path.join(out, "icon-512.png"), 512, make_icon(512))
write_png(os.path.join(out, "icon-maskable-512.png"), 512, make_icon(512, safe_padding=0.1))
print("icons written to", os.path.abspath(out))
