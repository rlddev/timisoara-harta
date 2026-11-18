"""Ofertele de vânzare a terenurilor agricole din extravilan (Legea 17/2014) din registrul public
extravilanagricol.ro, legate de imobilele de pe hartă după numărul cadastral → public/data/oferte.json.

    python scripts/oferte.py                              # Moșnița Nouă, anul curent
    python scripts/oferte.py --uat mosnita-noua --localitate "Mosnita Noua" --ani 2025 2026

Nu se păstrează date personale (nume, telefoane, e-mailuri ale vânzătorilor sau preemptorilor), doar:
număr/dată ofertă, nr. cadastral/CF, tarla/parcelă, suprafață, preț, stare, termen, numărul de
acceptări și prețul acceptat, rezoluția, linkul la pagina oficială. Cursul EUR: BCE (EUR/RON).
Datele se schimbă zilnic: rulează din nou și publică (vercel deploy --prod) ca să le actualizezi.
"""
import argparse
import html
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

RADACINA = Path(__file__).resolve().parent.parent
DATA = RADACINA / "public" / "data"
BAZA = "https://app.extravilan-agricol.ro/timis"
UA = {"User-Agent": "Mozilla/5.0 (harta-imobile)"}

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def get(url, date=None):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(date).encode() if date else None, headers=UA)
    with opener.open(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def text(h):
    h = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", h)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


def numar(s):
    try:
        return float(s.replace(",", "."))
    except (TypeError, ValueError):
        return None


def link_registru(judet, localitate):
    """Pagina publică de căutare a registrului pentru localitate (linkul „Sursa” de pe hartă)."""
    return f"{BAZA}/publicSearch.do?" + urllib.parse.urlencode({"judet": judet, "localitate": localitate})


def lista_ids(judet, localitate, an):
    get(link_registru(judet, localitate))
    rez = []
    for pag in range(1, 40):
        h = get(f"{BAZA}/publicSearch1.do", {
            "anulInregistrare": an, "nrOfertaVanzare": "", "numeVanzator": "", "nrCadastral": "", "carteFunciara": "",
            "nrTarla": "", "nrParcela": "", "orderBy": "dataExpirare", "pagenr": pag,
            "localitateProcedura": localitate, "judetProcedura": judet})
        parti = re.split(r"idOfertaVanzare=(\d+)", h)
        noi = 0
        # parti: [text0, id1, text1, id2, …]; starea și termenul sunt în textul dinaintea linkului „Detalii”
        for k in range(1, len(parti), 2):
            oid = int(parti[k])
            if any(o["id"] == oid for o in rez):
                continue
            bloc = text(parti[k - 1])[-700:]
            m = re.findall(r"Status (.+?) Data limita ([\d.]+)", bloc)
            st, lim = m[-1] if m else (None, None)
            rez.append({"id": oid, "status": st, "limita": lim})
            noi += 1
        if not noi:
            break
    return rez


def detalii(oid):
    t = text(get(f"{BAZA}/publicSearchDetail.do?idOfertaVanzare={oid}"))
    g = lambda re_: (re.search(re_, t) or [None, None])[1]  # noqa: E731

    def camp(eticheta, urmatoarea):
        """Valoarea dintre două etichete (câmpurile goale nu „fură” eticheta următoare)."""
        v = (g(re.escape(eticheta) + r" : (.*?) " + re.escape(urmatoarea)) or "").strip()
        return None if v in ("", "-", ":") else v
    pre = re.findall(r"Rang : (\d+) Nr si data oferta de cumparare : (.*?) Pret oferit : ([\d.]+)", t)
    acc = [float(p) for _, nd, p in pre if float(p) > 0 or nd.replace("/", "").strip()]
    i_rez = t.find("Rezolutie procedura")
    rez = t[i_rez + 20:t.rfind("Parteneri")].strip() if i_rez >= 0 else ""
    return {
        "nr": g(r"oferta (\d+ / [\d.]+)"),
        "s_ha": numar(g(r"Suprafata : ([\d.,]+) Ha")),
        "nc": camp("Nr Cadastral", "Nr Carte Funciara"),
        "cf": camp("Nr Carte Funciara", "Nr Tarla / Lot"),
        "tarla": camp("Nr Tarla / Lot", "Nr Parcela"),
        "parcela": camp("Nr Parcela", "Categoria de folosinta"),
        "categorie": camp("Categoria de folosinta", "Pret/Suprafata"),
        "pret": numar(g(r"Pret/Suprafata : ([\d.,]+)")),
        "moneda": g(r"Pret/Suprafata : [\d.,]+ (\w+)"),
        "preemptori": int(g(r"TOTAL : (\d+) preemptori") or 0),
        "acceptari": len(acc),
        "pret_acceptat": max(acc) if acc else None,
        "potentiali": int(g(r"TOTAL : (\d+) potentiali") or 0),
        "rezolutie": rez or None,
    }


def curs_eur():
    # curl (Schannel pe Windows) completează singur lanțul de certificate al BCE; urllib nu
    import subprocess
    x = subprocess.run(["curl", "-s", "-m", "30", "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"],
                       capture_output=True, text=True, check=True).stdout
    return {"eur": float(re.search(r"currency='RON' rate='([\d.]+)'", x)[1]),
            "data": re.search(r"time='([\d-]+)'", x)[1], "sursa": "BCE"}


def coordonate(uat):
    """nr cadastral → [lon, lat] din etichetele imobilelor (numere.json)."""
    c = json.loads((DATA / uat / "numere.json").read_text(encoding="utf-8"))
    o, k = c["o"], c["k"]
    rez = {}
    for n, x, y in c["f"]:
        rez.setdefault(n, [round(o[0] + x / k, 7), round(o[1] + y / k, 7)])
    return rez


def din_dxf(uat, cautate):
    """Rezervă: numere/tarlale care nu sunt etichete eTerra, căutate în toate textele DXF-ului UAT-ului
    (ex. „A130/72” pe stratul tarla). Întoarce {text: [lon, lat]}."""
    cfg = json.loads((RADACINA / "scripts" / "uaturi.json").read_text(encoding="utf-8")).get(uat)
    if not cfg or not (RADACINA / cfg["dxf"]).exists() or not cautate:
        return {}
    sys.path.insert(0, str(Path(__file__).parent))
    from dxf_lib import citeste_dxf
    from pyproj import Transformer
    to_wgs = Transformer.from_crs("EPSG:3844", "EPSG:4326", always_xy=True)
    norm = lambda s: re.sub(r"\s+", "", s).upper()  # noqa: E731
    tinte = {norm(c): c for c in cautate if c and len(norm(c)) > 2}
    rez = {}
    for _, s, x, y in citeste_dxf(RADACINA / cfg["dxf"])[1]:
        orig = tinte.get(norm(s))
        if orig and orig not in rez:
            lon, lat = to_wgs.transform(x, y)
            rez[orig] = [round(lon, 7), round(lat, 7)]
    return rez


def stare(o):
    st = (o.get("status") or "").upper()
    if o["acceptari"]:
        return "acceptata"
    if "DESCHIS" in st:
        return "deschisa"
    if "POTENTIAL" in st:
        return "potential"
    return "inchisa"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uat", default="mosnita-noua")
    ap.add_argument("--localitate", default="Mosnita Noua")
    ap.add_argument("--judet", default="Timis")
    ap.add_argument("--ani", nargs="*", type=int, default=[time.localtime().tm_year])
    a = ap.parse_args()

    uat_info = {u["id"]: u for u in json.loads((DATA / "uat.json").read_text(encoding="utf-8"))}[a.uat]
    poz = coordonate(a.uat)
    oferte = []
    for an in a.ani:
        for o in lista_ids(a.judet, a.localitate, an):
            d = detalii(o["id"])
            time.sleep(0.15)
            d.update(o)
            d["an"] = an
            d["url"] = f"{BAZA}/publicSearchDetail.do?idOfertaVanzare={o['id']}"
            d["s"] = round(d.pop("s_ha") * 10000) if d.get("s_ha") else None
            d["p"] = poz.get(d["nc"] or "") or poz.get(d["cf"] or "")
            d["stare"] = stare(d)
            oferte.append(d)
    rezerva = din_dxf(a.uat, {c for o in oferte if not o["p"] for c in (o["nc"], o["tarla"], o["cf"]) if c})
    for o in oferte:
        if not o["p"]:
            o["p"] = next((rezerva[c] for c in (o["nc"], o["tarla"], o["cf"]) if c in rezerva), None)
            o["aprox"] = bool(o["p"])  # poziția unei etichete de tarlă / aviz, nu a imobilului eTerra
    oferte.sort(key=lambda o: (o["an"], int((o["nr"] or "0").split("/")[0].strip() or 0)), reverse=True)

    fisier = DATA / "oferte.json"
    toate = [x for x in (json.loads(fisier.read_text(encoding="utf-8")) if fisier.exists() else []) if x["uat"] != a.uat]
    toate.append({"uat": a.uat, "nume": uat_info["nume"], "actualizat": time.strftime("%Y-%m-%d %H:%M"),
                  "sursa": "extravilanagricol.ro (registrul ofertelor, Legea 17/2014)",
                  "link": link_registru(a.judet, a.localitate), "curs": curs_eur(), "oferte": oferte})
    fisier.write_text(json.dumps(toate, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pe = {}
    for o in oferte:
        pe[o["stare"]] = pe.get(o["stare"], 0) + 1
    print(f"{uat_info['nume']}: {len(oferte)} oferte {pe}; pe hartă {sum(1 for o in oferte if o['p'])}; "
          f"fără localizare: {[o['nc'] for o in oferte if not o['p']]}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
