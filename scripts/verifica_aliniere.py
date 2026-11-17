"""Verifică alinierea datelor generate pe imaginea satelit Esri World Imagery (georeferențiată ca
Google, în Web Mercator). Desenează imobilele și construcțiile unui UAT peste dale z19.

    python scripts/verifica_aliniere.py timisoara 45.7231938 21.1586212 aliniere.png [--z 19] [--n 3]
"""
import argparse
import io
import json
import math
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

TILE = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
DATA = Path(__file__).resolve().parent.parent / "public" / "data"


def px(lon, lat, z):
    n = 256 * 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def inele(fisier, idx):
    c = json.loads(fisier.read_text(encoding="utf-8"))
    o, k = c["o"], c["k"]
    for f in c["f"]:
        a = f[idx][0]
        x = y = 0
        pts = []
        for i in range(0, len(a), 2):
            x += a[i]
            y += a[i + 1]
            pts.append((o[0] + x / k, o[1] + y / k))
        yield pts + pts[:1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("uat")
    ap.add_argument("lat", type=float)
    ap.add_argument("lon", type=float)
    ap.add_argument("out")
    ap.add_argument("--z", type=int, default=19)
    ap.add_argument("--n", type=int, default=3, help="dale pe latură")
    a = ap.parse_args()

    cx, cy = px(a.lon, a.lat, a.z)
    tx0, ty0 = int(cx // 256) - a.n // 2, int(cy // 256) - a.n // 2
    img = Image.new("RGB", (256 * a.n, 256 * a.n))
    for i in range(a.n):
        for j in range(a.n):
            req = urllib.request.Request(TILE.format(z=a.z, x=tx0 + i, y=ty0 + j), headers={"User-Agent": "harta-verificare/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                img.paste(Image.open(io.BytesIO(r.read())).convert("RGB"), (256 * i, 256 * j))
    ox, oy = tx0 * 256, ty0 * 256
    w, h = img.size
    d = ImageDraw.Draw(img)
    for fisier, idx, culoare in ((DATA / a.uat / "parcele.json", 2, (255, 214, 10)),
                                 (DATA / a.uat / "constructii.json", 2, (255, 90, 30))):
        for inel in inele(fisier, idx):
            pts = [(x - ox, y - oy) for x, y in (px(lon, lat, a.z) for lon, lat in inel)]
            if any(0 <= p[0] <= w and 0 <= p[1] <= h for p in pts):
                d.line(pts, fill=culoare, width=2)
    d.ellipse((cx - ox - 6, cy - oy - 6, cx - ox + 6, cy - oy + 6), outline=(255, 0, 0), width=3)
    img.save(a.out)
    print(a.out, img.size)


if __name__ == "__main__":
    main()
