"""Citire minimală DXF (ASCII): polilinii (LWPOLYLINE și POLYLINE/VERTEX) și texte (TEXT/MTEXT)
din secțiunea ENTITIES. Mult mai rapid decât ezdxf pe fișiere de sute de MB."""
import re
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon


def curata_mtext(t: str) -> str:
    t = re.sub(r"\\[A-Za-z][^;\\]*;", "", t)
    return t.replace("\\P", " ").replace("{", "").replace("}", "").strip()


def citeste_dxf(path: Path):
    """Întoarce (polilinii, texte): polilinii = [(layer, [(x, y)], închis)], texte = [(layer, text, x, y)]."""
    polilinii, texte = [], []
    section = None
    cur = None
    poly_vechi = None  # POLYLINE + VERTEX... + SEQEND

    def flush(e):
        nonlocal poly_vechi
        if not e or section != "ENTITIES":
            return
        t = e["type"]
        if t == "LWPOLYLINE":
            polilinii.append((e.get("8"), [tuple(p) for p in e["pts"] if p[1] is not None], e.get("closed", 0)))
        elif t == "POLYLINE":
            poly_vechi = (e.get("8"), [], e.get("closed", 0))
        elif t == "VERTEX" and poly_vechi is not None and "x" in e:
            poly_vechi[1].append((e["x"], e["y"]))
        elif t == "SEQEND" and poly_vechi is not None:
            polilinii.append(poly_vechi)
            poly_vechi = None
        elif t in ("TEXT", "MTEXT") and "x" in e:
            x, y = e["x"], e["y"]
            if t == "TEXT" and (e.get("72", 0) or e.get("73", 0)) and "x11" in e:
                x, y = e["x11"], e["y11"]
            texte.append((e.get("8"), curata_mtext(e.get("1", "") + e.get("3", "")), x, y))

    with open(path, encoding="utf-8", errors="replace") as f:
        while True:
            code = f.readline()
            if not code:
                break
            val = f.readline().rstrip("\r\n")
            code = code.strip()
            if code == "0":
                flush(cur)
                if val in ("SECTION", "ENDSEC"):
                    cur = None
                    if val == "ENDSEC":
                        section = None
                    continue
                cur = {"type": val, "pts": []}
                continue
            if code == "2" and cur is None:
                section = val
                continue
            if cur is None:
                continue
            ty = cur["type"]
            if code == "8":
                cur["8"] = val
            elif code == "70" and ty in ("LWPOLYLINE", "POLYLINE"):
                cur["closed"] = int(val) & 1
            elif code == "10":
                if ty == "LWPOLYLINE":
                    cur["pts"].append([float(val), None])
                elif "x" not in cur:
                    cur["x"] = float(val)
            elif code == "20":
                if ty == "LWPOLYLINE":
                    if cur["pts"]:
                        cur["pts"][-1][1] = float(val)
                elif "y" not in cur:
                    cur["y"] = float(val)
            elif code == "11" and ty == "TEXT":
                cur["x11"] = float(val)
            elif code == "21" and ty == "TEXT":
                cur["y11"] = float(val)
            elif code in ("72", "73") and ty == "TEXT":
                cur[code] = int(val)
            elif code in ("1", "3") and ty in ("TEXT", "MTEXT"):
                cur[code] = cur.get(code, "") + val
        flush(cur)
    return polilinii, texte


def poligon(pts, arie_min=0.5):
    """Poligon valid din puncte (cea mai mare parte dacă se rupe la reparare) sau None."""
    if len(pts) < 3:
        return None
    try:
        pg = Polygon(pts)
    except Exception:
        return None
    if not pg.is_valid:
        pg = pg.buffer(0)
        if isinstance(pg, MultiPolygon):
            pg = max(pg.geoms, key=lambda g: g.area)
    if pg.is_empty or pg.area < arie_min or not isinstance(pg, Polygon):
        return None
    return pg
