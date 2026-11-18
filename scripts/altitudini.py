"""Grilă de altitudini (m, față de nivelul mării) pentru zona UAT-urilor, ca harta 3D să centreze
camera pe teren (centrul camerei Google 3D e în altitudine absolută). Sursa: AWS Terrain Tiles
(Terrarium, date deschise: SRTM, EU-DEM etc.), o singură dată, offline – pagina nu cheamă servicii
externe pentru asta.

    python scripts/altitudini.py            # → public/data/altitudini.json
"""
import io
import json
import math
import sys
import urllib.request
from pathlib import Path

from PIL import Image

RADACINA = Path(__file__).resolve().parent.parent
DATA = RADACINA / "public" / "data"
PAS = 0.0025  # grade (~195 m pe longitudine, ~280 m pe latitudine)
Z = 11
TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def main():
    lista = json.loads((DATA / "uat.json").read_text(encoding="utf-8"))
    w = min(u["bbox"][0] for u in lista) - PAS
    s = min(u["bbox"][1] for u in lista) - PAS
    e = max(u["bbox"][2] for u in lista) + PAS
    n = max(u["bbox"][3] for u in lista) + PAS
    x0, y0 = (int(v) for v in tile_xy(w, n, Z))
    x1, y1 = (int(v) for v in tile_xy(e, s, Z))
    dale = {}
    for tx in range(x0 - 1, x1 + 2):
        for ty in range(y0 - 1, y1 + 2):
            req = urllib.request.Request(TILE.format(z=Z, x=tx, y=ty), headers={"User-Agent": "harta-imobile/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                dale[(tx, ty)] = Image.open(io.BytesIO(r.read())).convert("RGB").load()
    print(f"{len(dale)} dale z{Z}")

    def alt(lon, lat):
        fx, fy = tile_xy(lon, lat, Z)
        tx, ty = int(fx), int(fy)
        px, py = min(255, int((fx - tx) * 256)), min(255, int((fy - ty) * 256))
        r, g, b = dale[(tx, ty)][px, py]
        return r * 256 + g + b / 256 - 32768

    nx, ny = int((e - w) / PAS) + 2, int((n - s) / PAS) + 2
    z = [round(alt(w + i * PAS, s + j * PAS)) for j in range(ny) for i in range(nx)]
    out = {"o": [round(w, 6), round(s, 6)], "pas": PAS, "n": [nx, ny], "z": z,
           "sursa": "AWS Terrain Tiles (Terrarium), z11"}
    (DATA / "altitudini.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"grilă {nx} × {ny}; altitudini.json {(DATA / 'altitudini.json').stat().st_size / 1e3:.0f} kB, {min(z)}–{max(z)} m")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
