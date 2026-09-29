#!/usr/bin/env python3
"""Build the planet artwork used by the game.

Downloads equirectangular planet maps from Solar System Scope
(https://www.solarsystemscope.com/textures/, CC BY 4.0) and reprojects each
one into a top-down disc: an orthographic view from above the north pole,
which is what the game's camera (looking down on the ecliptic) would see.

Moons, dwarf planets and asteroids use public-domain spacecraft maps from
NASA/JPL, USGS and the Cassini, Galileo, Voyager, Dawn and New Horizons teams
(fetched from Wikimedia Commons), Solar System Scope's artist's impressions
for the far dwarf planets, and generated cratered surfaces for the few bodies
never mapped (Pallas, Hygiea, Deimos).

Output goes to assets/planets/. Downloads are cached in tools/.cache/.

    python3 tools/build_planets.py

Needs Pillow and NumPy.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageFilter

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


def polar_disc(src, size, supersample=2, chunk=256, south=False):
    """Orthographic view from above the north pole (or below the south pole) of an equirectangular map."""
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
        if south:
            lat, lon = -lat, -lon  # ...and clockwise seen from the south
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


# Moons, dwarf planets and asteroids.
#   src: 'commons:<file page>' (public domain), 'sss:<file>' or 'craters'
#   shift: fraction of the map's width to roll so longitude 0 (for a moon, the point facing
#          its planet) lands in the middle, where the game expects it
#   south: view from below the south pole. Uranus's moons, Triton and Vesta: the Voyager and
#          Dawn maps only cover the south, and for the moons of Uranus and Triton that is
#          also the side really facing the ecliptic's north (their poles are tipped over)
#   tint: for a grey map, the average colour to give it
#   levels: (low, high) percentiles to stretch the contrast between
#   contrast: scale the detail around the average (below 1 softens a harsh map)
#   fill: patch the unmapped (black) parts of the map from their surroundings
#   blur: soften the map (px)
#   polar: from this latitude on, fade the map toward an even tone at the pole
#   haze: (colour, amount) veil over the surface (Titan's smog)
COMMONS = 'commons:File:'
SMALL = [
    dict(out='phobos', size=384, src=COMMONS + 'Phobos Viking Mosaic DLRcontrol 7200.jpg', tint='#8a7d70'),
    dict(out='deimos', size=256, src='craters', seed=4, tint='#9c8c7a', craters=110, smooth=0.35),
    dict(out='io', size=768, src=COMMONS + 'Io modest scale map Io SSI-only color SIMP0 med.cub.jpg', polar=78),
    dict(out='europa', size=768, src=COMMONS + 'Europa Voyager GalileoSSI global mosaic.jpg', tint='#d6c7a9', contrast=1.15, polar=70),
    dict(out='ganymede', size=768, src=COMMONS + 'Ganymede map NASA JPL Voyager.jpg', tint='#9a8f80', contrast=0.65, polar=70),
    dict(out='callisto', size=768, src=COMMONS + 'Callisto USGS global small.jpg', tint='#6f6558', levels=(1, 99.7), contrast=0.55, polar=72),
    dict(out='mimas', size=512, src=COMMONS + 'Map of Mimas colorized 2014-04 PIA18437.jpg', shift=0.5),
    dict(out='enceladus', size=512, src=COMMONS + 'Enceladus Color Map.jpg', shift=0.5),
    dict(out='tethys', size=512, src=COMMONS + 'Tethys Color Map.jpg', shift=0.5),
    dict(out='dione', size=512, src=COMMONS + 'Dione Color Map.jpg', shift=0.5),
    dict(out='rhea', size=512, src=COMMONS + 'Rhea Color Map.jpg', shift=0.5),
    dict(out='iapetus', size=512, src=COMMONS + 'Iapetus Color Map.jpg', shift=0.5),
    dict(out='titan', size=768, src=COMMONS + 'Titan map April 2011 full.png', tint='#c4903f', blur=28, polar=65, haze=('#d9a650', 0.78)),
    dict(out='miranda', size=512, src=COMMONS + 'Miranda map.jpg', tint='#b8b5b0', south=True, fill=True),
    dict(out='ariel', size=512, src=COMMONS + 'Ariel map JPL USGS.jpg', tint='#c6c2bb', south=True, fill=True),
    dict(out='umbriel', size=512, src=COMMONS + 'Umbriel map JPL USGS.jpg', tint='#817d77', south=True, fill=True),
    dict(out='titania', size=512, src=COMMONS + 'Titania map JPL USGS.jpg', tint='#b5a99c', south=True, fill=True),
    dict(out='oberon', size=512, src=COMMONS + 'Oberon map JPL USGS.jpg', tint='#a39588', south=True, fill=True, contrast=0.7),
    dict(out='triton', size=768, src=COMMONS + 'Triton map no grid.jpg', south=True, fill=True),
    dict(out='ceres', size=512, src=COMMONS + 'PIA20354-Ceres-DwarfPlanet-MercatorMap-HAMO-20160322-0DegreeLongitude.jpg', tint='#8e8a84', polar=80),
    dict(out='vesta', size=512, src=COMMONS + 'Vesta map for GeoHack.png', tint='#aaa49c', south=True, fill=True),
    dict(out='pallas', size=384, src='craters', seed=2, tint='#918d87', craters=260),
    dict(out='hygiea', size=384, src='craters', seed=3, tint='#716d68', craters=200),
    dict(out='pluto', size=768, src=COMMONS + 'Pluto color mapmosaic.jpg', shift=0.5, fill=True),
    dict(out='charon', size=512, src=COMMONS + 'Charon map iau1803c.jpg', fill=True),
    # never seen up close: Solar System Scope's artist's impressions (CC BY 4.0)
    dict(out='haumea', size=384, src='sss:2k_haumea_fictional.jpg'),
    dict(out='makemake', size=384, src='sss:2k_makemake_fictional.jpg'),
    dict(out='eris', size=384, src='sss:2k_eris_fictional.jpg'),
]
COMMONS_API = 'https://commons.wikimedia.org/w/api.php?'
UA = 'orbitality-build/1.0 (https://github.com/gu1234/orbitality)'


def fetch_commons(title, name):
    """A Commons file, scaled down to at most 4096 px wide."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        return path
    print(f'  downloading {title}')
    q = urllib.parse.urlencode(dict(action='query', titles=title, prop='imageinfo', iiprop='url|size',
                                    iiurlwidth=4096, format='json'))
    with urllib.request.urlopen(urllib.request.Request(COMMONS_API + q, headers={'User-Agent': UA})) as r:
        info = next(iter(json.load(r)['query']['pages'].values()))['imageinfo'][0]
    url = info.get('thumburl') or info['url']
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA})) as r, open(path + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(path + '.part', path)
    return path


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def resize_f(a, w, h):
    """Resize a float image (H x W x C) with PIL, channel by channel."""
    return np.stack([np.asarray(Image.fromarray(np.ascontiguousarray(a[..., c]), 'F').resize((w, h), Image.BILINEAR))
                     for c in range(a.shape[2])], axis=-1)


def inpaint(a, valid):
    """Fill the invalid pixels with ever blurrier averages of the valid ones around them."""
    h, w = valid.shape
    out = a.copy()
    done = valid.copy()
    num = a * valid[..., None]
    den = valid.astype(np.float32)[..., None]
    f = 2
    while not done.all() and f <= max(w, h):
        sw, sh = max(1, w // f), max(1, h // f)
        n = resize_f(resize_f(num, sw, sh), w, h)
        d = resize_f(resize_f(den, sw, sh), w, h)[..., 0]
        ok = ~done & (d > 0.02)
        out[ok] = n[ok] / d[ok][:, None]
        done |= ok
        f *= 2
    out[~done] = a[valid].mean(axis=0)
    # a little grain, so the patches don't look airbrushed
    rng = np.random.default_rng(1)
    grain = resize_f(rng.normal(0, 1, (h // 4, w // 4, 1)).astype(np.float32), w, h)
    out[~valid] += grain[~valid] * 10
    return out


def blotches(rng, P, octaves=5):
    """Seamless blotchy noise on the sphere (P: unit vectors), from soft spots of many sizes."""
    total = np.zeros(P.shape[:2], np.float32)
    amp, r, n = 1.0, 0.8, 12
    for _ in range(octaves):
        for _ in range(n):
            c = rng.normal(0, 1, 3)
            c /= np.linalg.norm(c)
            d2 = 2 - 2 * (P @ c)  # squared chord distance
            total += amp * rng.normal() * np.exp(-d2 / (r * r))
        amp *= 0.6
        r *= 0.5
        n *= 2
    return total / 3


def polar_smooth(a, from_deg):
    """Blend the rows near the poles toward their average, hiding the smears maps have there."""
    h = a.shape[0]
    lat = 90 - (np.arange(h) + 0.5) / h * 180
    s = np.clip((np.abs(lat) - from_deg) / (90 - from_deg), 0, 1)
    k = (s * s * (3 - 2 * s))[:, None, None]
    return a * (1 - k) + a.mean(axis=1, keepdims=True) * k


def cratered(job, w=1024):
    """A made-up cratered surface: blotchy albedo, dark crater floors and bright rims."""
    rng = np.random.default_rng(job['seed'])
    h = w // 2
    lon = (np.arange(w) + 0.5) / w * 2 * np.pi - np.pi
    lat = np.pi / 2 - (np.arange(h) + 0.5) / h * np.pi
    LON, LAT = np.meshgrid(lon, lat)
    P = np.stack([np.cos(LAT) * np.cos(LON), np.cos(LAT) * np.sin(LON), np.sin(LAT)], -1)
    alb = 1 + 0.18 * blotches(rng, P)
    k = 1 - job.get('smooth', 0)
    for _ in range(job['craters']):
        c = rng.normal(0, 1, 3)
        c /= np.linalg.norm(c)
        r = min(0.5, 0.025 * rng.uniform(0.02, 1) ** -0.55)  # angular radius: many small, few big
        d = np.arccos(np.clip(P @ c, -1, 1)) / r
        near = d < 2.2
        dd = d[near]
        depth = k * rng.uniform(0.5, 1)
        alb[near] += depth * (-0.13 * (dd < 0.85) * (1 - (dd / 0.85) ** 4)
                              + 0.16 * np.exp(-((dd - 1) / 0.13) ** 2)
                              + 0.05 * np.clip(2.2 - dd, 0, 1.2) * (dd > 1))
    return (alb[..., None] * hex_rgb(job['tint'])).clip(0, 255)


def build_small(job):
    src = job['src']
    if src == 'craters':
        a = cratered(job)
    else:
        if src.startswith('sss:'):
            path = fetch(src[4:])
        else:
            path = fetch_commons(src[len('commons:'):], 'commons_' + job['out'] + os.path.splitext(src)[1].lower())
        a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
        h, w = a.shape[:2]
        if w > 4096:
            a = resize_f(a, 4096, 2048)
        elif abs(w - 2 * h) > 2:
            a = resize_f(a, w, w // 2)
    lum = a.mean(axis=2)
    valid = lum > 10
    if job.get('fill'):
        valid = lum > 24
        m = Image.fromarray((valid * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(11))
        valid = np.asarray(m) > 0  # drop the ragged, dimmed edge of the mapped area too
    if 'blur' in job:
        img = Image.fromarray(a.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(job['blur']))
        a = np.asarray(img).astype(np.float32)
        lum = a.mean(axis=2)
    if 'levels' in job:
        lo, hi = np.percentile(lum[valid], job['levels'])
        a = (a - lo) / (hi - lo) * 200
        lum = a.mean(axis=2)
    if 'tint' in job:
        a = (lum / lum[valid].mean())[..., None] * hex_rgb(job['tint'])
    if 'contrast' in job:
        mean = a[valid].mean(axis=0)
        a = mean + (a - mean) * job['contrast']
    if job.get('fill'):
        a = inpaint(a, valid)
    if 'polar' in job:
        a = polar_smooth(a, job['polar'])
    if 'haze' in job:
        col, amt = job['haze']
        a = a * (1 - amt) + hex_rgb(col) * amt
    if job.get('shift'):
        a = np.roll(a, int(round(job['shift'] * a.shape[1])), axis=1)
    disc = polar_disc(a.clip(0, 255).astype(np.uint8), job['size'], south=job.get('south', False))
    name = job['out'] + '.jpg'
    disc.save(os.path.join(OUT, name), quality=84, optimize=True, progressive=True)
    size = job['size']
    yy, xx = np.mgrid[0:size, 0:size]
    inside = np.hypot(xx - size / 2, yy - size / 2) < size / 2 * 0.95
    avg = np.asarray(disc)[inside].mean(axis=0).astype(int)
    print(f'  {name}: {size}px, mean #{avg[0]:02x}{avg[1]:02x}{avg[2]:02x}')


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
    for job in SMALL:
        if not only or job['out'] in only:
            build_small(job)


if __name__ == '__main__':
    main()
