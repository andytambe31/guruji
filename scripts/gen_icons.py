#!/usr/bin/env python3
"""Generate Guruji PWA icons as PNGs with no external dependencies.

A calm mark: a soft glowing orb (the "gently landing eye") on a deep
night background. Pure stdlib — builds raw RGBA PNGs by hand.
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (194, 112, 61)          # #c2703d terracotta tile
GLOW = (240, 205, 160)       # warm lamp light
CORE = (250, 244, 233)       # soft cream core


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size, maskable=False):
    cx = cy = size / 2.0
    # On maskable icons keep the orb smaller so it survives the safe-zone crop.
    orb_r = size * (0.30 if maskable else 0.34)
    glow_r = size * (0.46 if maskable else 0.5)
    px = bytearray()
    for y in range(size):
        px.append(0)  # PNG filter byte (none) per scanline
        for x in range(size):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            d = math.sqrt(dx * dx + dy * dy)
            if d <= orb_r:
                # solid orb with a subtle radial warmth toward the core
                t = d / orb_r
                r, g, b = lerp(CORE, GLOW, min(1.0, t * 1.1))
            elif d <= glow_r:
                # soft falloff glow into the background
                t = (d - orb_r) / (glow_r - orb_r)
                falloff = (1.0 - t) ** 2
                r, g, b = lerp(BG, GLOW, falloff * 0.55)
            else:
                r, g, b = BG
            px.extend((r, g, b, 255))
    return png_bytes(size, size, bytes(px))


def png_bytes(w, h, raw_rgba):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        return c

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(raw_rgba, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


targets = [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),
    ("favicon-32.png", 32, False),
]

for name, size, maskable in targets:
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(make(size, maskable))
    print("wrote", name, size)
