"""Din ortoplanurile OCPI (DXF, Stereo 70) generează datele hărții în public/data/<uat>/, compacte
(coordonate WGS84 întregi, la 1e-6 grade ≈ 10 cm, relative la o origine, delta pe inel).

    python scripts/genereaza_date.py --toate            # toate UAT-urile din scripts/uaturi.json
    python scripts/genereaza_date.py --uat giroc dumbravita
    python scripts/combina.py                           # apoi: lista UAT-urilor, limite, culori

Configurația (scripts/uaturi.json), pe UAT:
  nume, dxf (calea DXF-ului), limita (stratul cu limita UAT – cea mai nouă „Limită 5000”),
  opțional limita_punct [E, N] (Stereo 70) când stratul are mai multe contururi (desene cu două
  comune), sector_nr, intravilan.
Straturi comune: ImobileE3 (contururi eTerra, cu versiuni vechi suprapuse), ImobileE3_IE (numerele),
ConstructiiE3, Intravilan_Iulie_2021, Sector_Cadastral la data de 05.05.2022.

Regula pentru imobilele suprapuse: un număr din ImobileE3_IE aparține celui mai mic contur care îl
conține; contururile fără număr propriu sunt „istorice” (parcela-mamă, duplicate). Imobilele și
construcțiile al căror centru cade în afara limitei UAT sunt scoase (ar dubla UAT-ul vecin).
Numerele vechi / din avize (straturi ca „nr cad NOU”, AVIZAT) se atașează imobilului ca „alte numere”.

Formate (o = origine [lon, lat], k = 1e6):
  parcele.json     {o, k, f: [[nr|0, arie, inele, nr2|0, vechi|0], …]}   inel = [x0, y0, dx1, dy1, …]
  constructii.json {o, k, f: [[arie, nr imobil|0, inele], …]}
  numere.json      {o, k, f: [[nr, x, y], …]}
  sectoare.json    {o, k, l: [inel, …], n: [[nr, x, y], …]}
  contur.json      GeoJSON: limita UAT (t=uat) și intravilanul (t=intravilan), 6 zecimale
  info.json        nume, număr de imobile, bbox, eticheta, sursa
"""
import argparse
import json
import math
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import shapely
import shapely.prepared
from pyproj import Transformer
from shapely.geometry import Point
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).parent))
from dxf_lib import citeste_dxf, poligon  # noqa: E402

RADACINA = Path(__file__).resolve().parent.parent
L_IMOBILE, L_NUMERE, L_CONSTR = "ImobileE3", "ImobileE3_IE", "ConstructiiE3"
L_INTRAVILAN = ("Intravilan_Iulie_2021", "limita_intravilan_5000")
L_SECTOR = "Sector_Cadastral la data de 05.05.2022"
L_VECHI = {"nr cad NOU", "AVIZAT", "avizata", "AC avizat", "_AC avizate", "INREGISTRAT", "inregistrata",
           "RESPINGERE", "respinse", "REPOZITIONARE", "repozitionat", "Anulare operatiuni CAD.",
           "nr cad anulate (neoperat la CF)", "nr cad noi anulate", "Anulare nr. Cadastrale"}
RE_CAD = re.compile(r"(?i)(?:cad|c\.?\s*f\.?)[^0-9]{0,12}(\d{4,6})\b")
RE_NUMAI_NR = re.compile(r"^\s*(?:nou\s*)?(\d{5,6})\s*$", re.I)

TO_WGS = Transformer.from_crs("EPSG:3844", "EPSG:4326", always_xy=True)
K = 1_000_000


class Codor:
    """Coordonate Stereo 70 → întregi WGS84 relativi la origine."""

    def __init__(self, bounds):
        lon, lat = TO_WGS.transform(bounds[0], bounds[1])
        self.o = [math.floor(lon * 100) / 100 - 0.01, math.floor(lat * 100) / 100 - 0.01]

    def puncte(self, coords):
        xs, ys = zip(*coords)
        lon, lat = TO_WGS.transform(xs, ys)
        return [(round((a - self.o[0]) * K), round((b - self.o[1]) * K)) for a, b in zip(lon, lat)]

    def inel(self, coords):
        pts = self.puncte(list(coords))
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        out, px, py = [], 0, 0
        for x, y in pts:
            out += [x - px, y - py]
            px, py = x, y
        return out

    def poligon(self, pg):
        return [self.inel(pg.exterior.coords)] + [self.inel(r.coords) for r in pg.interiors]

    def punct(self, x, y):
        return list(self.puncte([(x, y)])[0])


def wgs_ring(coords):
    xs, ys = zip(*coords)
    lon, lat = TO_WGS.transform(xs, ys)
    return [[round(a, 6), round(b, 6)] for a, b in zip(lon, lat)]


def geom_wgs(pg):
    return {"type": "Polygon", "coordinates": [wgs_ring(pg.exterior.coords)] + [wgs_ring(r.coords) for r in pg.interiors]}


def scrie(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path.stat().st_size


def alege_limita(polilinii, cfg):
    cand = [p for p in (poligon(pts, 1e5) for lay, pts, _ in polilinii if lay == cfg["limita"]) if p]
    if not cand:
        raise SystemExit(f"Nu găsesc limita UAT pe stratul {cfg['limita']!r}")
    if cfg.get("limita_arie"):  # km²: stratul are și conturul vechi (de dinainte de despărțirea comunelor)
        return min(cand, key=lambda p: abs(p.area / 1e6 - cfg["limita_arie"]))
    if cfg.get("limita_punct"):
        pt = Point(*cfg["limita_punct"])
        cont = [p for p in cand if p.contains(pt)]
        if not cont:
            raise SystemExit(f"Niciun contur de pe {cfg['limita']!r} nu conține {cfg['limita_punct']}")
        return min(cont, key=lambda p: p.area)
    return max(cand, key=lambda p: p.area)


def genereaza(uid, cfg, polilinii, texte, out_root: Path):
    t0 = time.time()
    out = out_root / uid
    out.mkdir(parents=True, exist_ok=True)
    limita = alege_limita(polilinii, cfg)
    lim = shapely.prepared.prep(limita)
    cod = Codor(limita.bounds)

    # --- imobile (fără duplicate exacte)
    imobile, chei = [], set()
    for lay, pts, _ in polilinii:
        if lay != L_IMOBILE:
            continue
        pg = poligon(pts)
        if pg is None:
            continue
        k = shapely.set_precision(pg, 0.01).normalize().wkb
        if k not in chei:
            chei.add(k)
            imobile.append(pg)
    arbore = STRtree(imobile) if imobile else None
    arii = [pg.area for pg in imobile]

    def cel_mai_mic(x, y, doar=None):
        if arbore is None:
            return None
        idx = [i for i in arbore.query(Point(x, y), predicate="within") if doar is None or i in doar]
        return min(idx, key=lambda i: arii[i]) if idx else None

    numere = defaultdict(list)
    etichete = []
    for lay, s, x, y in texte:
        if lay != L_NUMERE or not s:
            continue
        i = cel_mai_mic(x, y)
        if i is not None and s not in numere[i]:
            numere[i].append(s)
        if lim.contains(Point(x, y)):
            etichete.append([s, *cod.punct(x, y)])
    cu_numar = set(numere)

    alte = defaultdict(set)
    for lay, s, x, y in texte:
        if lay not in L_VECHI or not s:
            continue
        gasite = RE_CAD.findall(s)
        if not gasite and lay == "nr cad NOU":
            m = RE_NUMAI_NR.match(s)
            gasite = [m.group(1)] if m else []
        i = cel_mai_mic(x, y, cu_numar) if gasite else None
        if i is not None:
            alte[i].update(g for g in gasite if g not in numere[i])

    parcele, n_nr = [], 0
    for i, pg in enumerate(imobile):
        if not lim.contains(pg.representative_point()):
            continue
        nr = numere[i][0] if i in numere else 0
        n_nr += 1 if nr else 0
        f = [nr, round(pg.area, 1), cod.poligon(pg)]
        nr2 = numere[i][1:] if i in numere else []
        vechi = sorted(alte.get(i, ()))
        if nr2 or vechi:
            f += [nr2 or 0, vechi or 0]
        parcele.append(f)

    constructii = []
    for lay, pts, _ in polilinii:
        if lay != L_CONSTR:
            continue
        pg = poligon(pts)
        if pg is None:
            continue
        c = pg.representative_point()
        if not lim.contains(c):
            continue
        i = cel_mai_mic(c.x, c.y, cu_numar)
        constructii.append([round(pg.area, 1), numere[i][0] if i is not None else 0, cod.poligon(pg)])

    # --- sectoare, intravilan
    sect_nr = [lay for lay in {t[0] for t in texte if t[0]} if lay.startswith("Nr") and "Sector_Cadastral" in lay]
    sect_nr_layer = cfg.get("sector_nr") or (sect_nr[0] if sect_nr else None)
    sectoare = {"o": cod.o, "k": K,
                "l": [cod.inel(p.exterior.coords) for p in (poligon(pts, 100) for lay, pts, _ in polilinii if lay == cfg.get("sector", L_SECTOR))
                      if p is not None and lim.contains(p.representative_point())],
                "n": [[s, *cod.punct(x, y)] for lay, s, x, y in texte if lay == sect_nr_layer and s and lim.contains(Point(x, y))]}
    straturi = {t[0] for t in polilinii}
    l_intra = cfg.get("intravilan") or next((l for l in L_INTRAVILAN if l in straturi), None)
    intravilan = [p for p in (poligon(pts, 100) for lay, pts, _ in polilinii if lay == l_intra)
                  if p is not None and lim.contains(p.representative_point())]

    rp = limita.representative_point()
    xs, ys = limita.exterior.xy
    lon, lat = TO_WGS.transform(list(xs), list(ys))
    info = {
        "id": uid, "nume": cfg["nume"], "sursa": Path(cfg["dxf"]).name, "generat": time.strftime("%Y-%m-%d %H:%M"),
        "imobile": len(parcele), "cu_numar": n_nr, "constructii": len(constructii),
        "suprafata_km2": round(limita.area / 1e6, 2),
        "stereo70_bbox": [round(v, 1) for v in limita.bounds],
        "bbox": [round(min(lon), 6), round(min(lat), 6), round(max(lon), 6), round(max(lat), 6)],
        "eticheta": [round(v, 6) for v in TO_WGS.transform(rp.x, rp.y)],
        "limita": cfg["limita"], "intravilan": l_intra,
    }
    marimi = {
        "parcele": scrie(out / "parcele.json", {"o": cod.o, "k": K, "f": parcele}),
        "constructii": scrie(out / "constructii.json", {"o": cod.o, "k": K, "f": constructii}),
        "numere": scrie(out / "numere.json", {"o": cod.o, "k": K, "f": etichete}),
        "sectoare": scrie(out / "sectoare.json", sectoare),
        "contur": scrie(out / "contur.json", {"type": "FeatureCollection", "features":
                        [{"type": "Feature", "properties": {"t": "uat"}, "geometry": geom_wgs(limita)}]
                        + [{"type": "Feature", "properties": {"t": "intravilan"}, "geometry": geom_wgs(p)} for p in intravilan]}),
    }
    info["marimi"] = marimi
    scrie(out / "info.json", info)
    print(f"  {cfg['nume']:22s} {limita.area / 1e6:7.2f} km²  imobile {len(parcele):6d} (cu nr {n_nr:6d})  "
          f"constr {len(constructii):6d}  intravilan {len(intravilan):3d}  "
          f"{sum(marimi.values()) / 1e6:5.1f} MB  {time.time() - t0:4.1f} s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uat", nargs="*", default=[])
    ap.add_argument("--toate", action="store_true")
    ap.add_argument("--config", default=str(RADACINA / "scripts" / "uaturi.json"))
    ap.add_argument("--out", default=str(RADACINA / "public" / "data"))
    a = ap.parse_args()
    config = json.loads(Path(a.config).read_text(encoding="utf-8"))
    ids = list(config) if a.toate else a.uat
    if not ids:
        ap.error("--uat <id> … sau --toate")
    # DXF-urile cu mai multe UAT-uri se citesc o singură dată
    pe_dxf = defaultdict(list)
    for uid in ids:
        if uid not in config:
            raise SystemExit(f"UAT necunoscut: {uid}")
        pe_dxf[config[uid]["dxf"]].append(uid)
    for dxf, lista in pe_dxf.items():
        t0 = time.time()
        polilinii, texte = citeste_dxf(RADACINA / dxf)
        print(f"{dxf}: {len(polilinii)} polilinii, {len(texte)} texte ({time.time() - t0:.0f} s)")
        for uid in lista:
            genereaza(uid, config[uid], polilinii, texte, Path(a.out))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
