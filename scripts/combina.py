"""După genereaza_date.py: lista UAT-urilor (public/data/uat.json) cu culori diferite la vecini și
limitele tuturor UAT-urilor + intravilanul într-un singur fișier mic (public/data/limite.json),
pentru vederea de ansamblu și pentru „în ce UAT sunt” fără să încarci imobilele.

    python scripts/combina.py
"""
import json
import sys
from pathlib import Path

from shapely.geometry import mapping, shape

RADACINA = Path(__file__).resolve().parent.parent
DATA = RADACINA / "public" / "data"
CONFIG = RADACINA / "scripts" / "uaturi.json"
# culori ușor de deosebit pe satelit și de culorile straturilor (selecție cyan, construcții portocaliu,
# sectoare magenta, intravilan albastru)
PALETA = [[255, 214, 10], [80, 235, 120], [175, 140, 255], [255, 120, 170], [200, 240, 70],
          [240, 195, 130], [235, 235, 235], [60, 200, 160], [255, 170, 60]]
SIMPLIFICARE = 0.00002  # grade (~2 m), doar pentru limitele de ansamblu


def rotunjeste(g):
    def r(c):
        return [[round(x, 6), round(y, 6)] for x, y in c]
    m = mapping(g)
    if m["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [r(c) for c in m["coordinates"]]}
    return {"type": "MultiPolygon", "coordinates": [[r(c) for c in p] for p in m["coordinates"]]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ordine = list(json.loads(CONFIG.read_text(encoding="utf-8")))
    uaturi = []
    for uid in ordine:
        f = DATA / uid / "info.json"
        if f.exists():
            info = json.loads(f.read_text(encoding="utf-8"))
            contur = json.loads((DATA / uid / "contur.json").read_text(encoding="utf-8"))
            uaturi.append((info, contur))
    if not uaturi:
        raise SystemExit("Nu există date generate.")

    forme = {info["id"]: shape(next(f for f in c["features"] if f["properties"]["t"] == "uat")["geometry"]) for info, c in uaturi}
    vecini = {a: {b for b in forme if b != a and forme[a].distance(forme[b]) < 0.0007} for a in forme}
    culoare = {}
    for uid in sorted(forme, key=lambda u: -len(vecini[u])):
        folosite = {tuple(culoare[v]) for v in vecini[uid] if v in culoare}
        culoare[uid] = next((c for c in PALETA if tuple(c) not in folosite), PALETA[len(culoare) % len(PALETA)])

    lista, f_uat, f_intra = [], [], []
    for info, contur in uaturi:
        uid = info["id"]
        info["culoare"] = culoare[uid]
        info["vecini"] = sorted(vecini[uid])
        lista.append(info)
        for f in contur["features"]:
            g = shape(f["geometry"]).simplify(SIMPLIFICARE, preserve_topology=True)
            (f_uat if f["properties"]["t"] == "uat" else f_intra).append(
                {"type": "Feature", "properties": {"id": uid}, "geometry": rotunjeste(g)})

    (DATA / "uat.json").write_text(json.dumps(lista, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    lim = {"uat": {"type": "FeatureCollection", "features": f_uat},
           "intravilan": {"type": "FeatureCollection", "features": f_intra}}
    (DATA / "limite.json").write_text(json.dumps(lim, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tot = sum(sum(i["marimi"].values()) for i in lista)
    print(f"{len(lista)} UAT-uri, {sum(i['cu_numar'] for i in lista)} imobile cu număr, "
          f"date {tot / 1e6:.0f} MB; limite.json {(DATA / 'limite.json').stat().st_size / 1e6:.1f} MB")
    for i in lista:
        print(f"  {i['nume']:22s} culoare {i['culoare']}  vecini: {', '.join(i['vecini'])}")


if __name__ == "__main__":
    main()
