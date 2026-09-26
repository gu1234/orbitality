#!/usr/bin/env python3
"""Build the planet artwork used by the game.

Downloads equirectangular planet maps from Solar System Scope
(https://www.solarsystemscope.com/textures/, CC BY 4.0) and reprojects each
one into a top-down disc: an orthographic view from above the north pole,
which is what the game's camera (looking down on the ecliptic) would see.

Output goes to assets/planets/. Downloads are cached in tools/.cache/.

    python3 tools/build_planets.py

Needs Pillow and NumPy.
"""

import os
import sys
import urllib.request

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
OUT = os.path.join(HERE, '..', 'assets', 'planets')
SRC = 'https://www.solarsystemscope.com/textures/download/'

# (source map, output file, output size in px, mode)
JOBS = [
    ('8k_earth_daymap.jpg', 'earth_day.jpg', 2048, 'RGB'),
    ('8k_earth_nightmap.jpg', 'earth_night.jpg', 1024, 'RGB'),
    ('8k_earth_clouds.jpg', 'earth_clouds.jpg', 1536, 'L'),
    ('8k_moon.jpg', 'moon.jpg', 1536, 'RGB'),
    ('8k_mars.jpg', 'mars.jpg', 1536, 'RGB'),
    ('8k_jupiter.jpg', 'jupiter.jpg', 1024, 'RGB'),
    ('8k_saturn.jpg', 'saturn.jpg', 1024, 'RGB'),
    ('8k_mercury.jpg', 'mercury.jpg', 768, 'RGB'),
    ('2k_venus_atmosphere.jpg', 'venus.jpg', 512, 'RGB'),
    ('2k_uranus.jpg', 'uranus.jpg', 512, 'RGB'),
    ('2k_neptune.jpg', 'neptune.jpg', 512, 'RGB'),
    ('2k_sun.jpg', 'sun.jpg', 512, 'RGB'),
]

# Saturn's rings, top-down: C ring inner edge to A ring outer edge (km).
RING_INNER_KM = 74658
RING_OUTER_KM = 136775
RING_SIZE = 768


def fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print(f'  downloading {name}')
        req = urllib.request.Request(SRC + name, headers={'User-Agent': 'orbitality-build'})
        with urllib.request.urlopen(req) as r, open(path + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(path + '.part', path)
    return path


def polar_disc(src, size, supersample=2, chunk=256):
    """Orthographic view from above the north pole of an equirectangular map."""
    h, w = src.shape[:2]
    channels = 1 if src.ndim == 2 else src.shape[2]
    n = size * supersample
    out = np.zeros((n, n, channels), dtype=np.float32)
    s = src.astype(np.float32).reshape(h, w, channels)
    xs = (np.arange(n) + 0.5) / n * 2 - 1
    for r0 in range(0, n, chunk):
        rows = np.arange(r0, min(n, r0 + chunk))
        ys = 1 - (rows + 0.5) / n * 2  # world y up
        X, Y = np.meshgrid(xs, ys)
        rr = np.minimum(np.hypot(X, Y), 1.0)  # outside the disc: extend the rim
        lat = np.arccos(rr)  # 90 deg at the centre (pole), 0 at the rim (equator)
        lon = np.arctan2(Y, X)  # east is counter-clockwise seen from the north
        u = (lon + np.pi) / (2 * np.pi) * w - 0.5
        v = (np.pi / 2 - lat) / np.pi * h - 0.5
        v = np.clip(v, 0, h - 1)
        u0 = np.floor(u).astype(np.int64)
        v0 = np.floor(v).astype(np.int64)
        fu = (u - u0)[..., None]
        fv = (v - v0)[..., None]
        u0m = np.mod(u0, w)
        u1m = np.mod(u0 + 1, w)
        v1 = np.minimum(v0 + 1, h - 1)
        top = s[v0, u0m] * (1 - fu) + s[v0, u1m] * fu
        bot = s[v1, u0m] * (1 - fu) + s[v1, u1m] * fu
        out[rows[0]:rows[-1] + 1] = top * (1 - fv) + bot * fv
    img = out.clip(0, 255).astype(np.uint8)
    if channels == 1:
        img = img[..., 0]
    pil = Image.fromarray(img)
    return pil.resize((size, size), Image.LANCZOS)


def build_rings():
    path = fetch('8k_saturn_ring_alpha.png')
    strip = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    profile = strip.mean(axis=0)  # (width, 4): inner edge -> outer edge
    n = RING_SIZE * 2
    xs = (np.arange(n) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(xs, xs)
    rr = np.hypot(X, Y)
    inner = RING_INNER_KM / RING_OUTER_KM
    f = (rr - inner) / (1 - inner)
    idx = np.clip(f * (profile.shape[0] - 1), 0, profile.shape[0] - 1)
    i0 = np.floor(idx).astype(np.int64)
    i1 = np.minimum(i0 + 1, profile.shape[0] - 1)
    t = (idx - i0)[..., None]
    col = profile[i0] * (1 - t) + profile[i1] * t
    col[(f < 0) | (f > 1)] = 0
    img = Image.fromarray(col.clip(0, 255).astype(np.uint8), 'RGBA').resize((RING_SIZE, RING_SIZE), Image.LANCZOS)
    img.save(os.path.join(OUT, 'saturn_rings.png'), optimize=True)
    print('  saturn_rings.png')


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    for src_name, out_name, size, mode in JOBS:
        if only and out_name.split('.')[0] not in only:
            continue
        path = fetch(src_name)
        src = np.asarray(Image.open(path).convert(mode))
        disc = polar_disc(src, size)
        disc.save(os.path.join(OUT, out_name), quality=86 if size >= 1024 else 84, optimize=True, progressive=True)
        mean = np.asarray(disc.convert('RGB')).reshape(-1, 3)
        # average colour inside the disc, for drawing the planet as a dot when far away
        yy, xx = np.mgrid[0:size, 0:size]
        inside = (np.hypot(xx - size / 2, yy - size / 2) < size / 2 * 0.95).reshape(-1)
        avg = mean[inside].mean(axis=0).astype(int)
        print(f'  {out_name}: {size}px, mean #{avg[0]:02x}{avg[1]:02x}{avg[2]:02x}')
    if not only or 'saturn_rings' in only:
        build_rings()


if __name__ == '__main__':
    main()
