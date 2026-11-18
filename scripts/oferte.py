"""Ofertele de vânzare a terenurilor agricole din extravilan (Legea 17/2014) din registrul public
extravilanagricol.ro, legate de imobilele de pe hartă după numărul cadastral → public/data/oferte.json.

    python scripts/oferte.py                         # toate UAT-urile hărții pe care registrul le are, anul curent
    python scripts/oferte.py --uat mosnita-noua giroc --ani 2025 2026
    python scripts/oferte.py --uat mosnita-noua --localitate "Mosnita Noua"   # numele din registru, dacă diferă

Nu se păstrează date personale (nume, telefoane, e-mailuri ale vânzătorilor sau preemptorilor), doar:
număr/dată ofertă, nr. cadastral/CF, tarla/parcelă, suprafață, preț, stare, termen, numărul de
acceptări și prețul acceptat, rezoluția, linkul la pagina oficială. Cursul EUR: BCE (EUR/RON).
Datele se schimbă zilnic: rulează din nou și publică (vercel deploy --prod) ca să le actualizezi.
Ofertele închise / acceptate nu se mai schimbă: detaliile lor se țin în date-sursa/oferte_cache.json.
Dacă registrul nu răspunde pentru un UAT, rămân datele lui de la rularea anterioară.
"""
import argparse
import html
import http.cookiejar
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RADACINA = Path(__file__).resolve().parent.parent
DATA = RADACINA / "public" / "data"
CACHE = RADACINA / "date-sursa" / "oferte_cache.json"
BAZA = "https://app.extravilan-agricol.ro/timis"
UA = {"User-Agent": "Mozilla/5.0 (harta-imobile)"}

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def get(url, date=None, incercari=4):
    """GET/POST cu reîncercări (registrul dă uneori 502 / timeout)."""
    for k in range(incercari):
        req = urllib.request.Request(url, data=urllib.parse.urlencode(date).encode() if date else None, headers=UA)
        try:
            with opener.open(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if k == incercari - 1 or (isinstance(e, urllib.error.HTTPError) and e.code < 500):
                raise
            time.sleep(5 * 3 ** k)


def text(h):
    h = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", h)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


def numar(s):
    try:
        return float(s.replace(",", "."))
    except (TypeError, ValueError):
        return None


def fara_diacritice(s):
    """„Sânmihaiu Român” → „Sanmihaiu Roman” (așa apar localitățile în registru)."""
    s = unicodedata.normalize("NFKD", s.replace("ş", "ș").replace("ţ", "ț"))
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip()


def link_registru(judet, localitate):
    """Pagina publică de căutare a registrului pentru localitate (linkul „Sursa” de pe hartă)."""
    return f"{BAZA}/publicSearch.do?" + urllib.parse.urlencode({"judet": judet, "localitate": localitate})


def lista_ids(judet, localitate, an):
    get(link_registru(judet, localitate))
    rez = []
    for pag in range(1, 200):
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
        time.sleep(0.2)
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
    (ex. „A130/72” pe stratul tarla), doar în interiorul limitei UAT-ului (unele desene au două comune).
    Întoarce {text: [lon, lat]}."""
    cfg = json.loads((RADACINA / "scripts" / "uaturi.json").read_text(encoding="utf-8")).get(uat)
    if not cfg or not (RADACINA / cfg["dxf"]).exists() or not cautate:
        return {}
    sys.path.insert(0, str(Path(__file__).parent))
    from dxf_lib import citeste_dxf
    from pyproj import Transformer
    from shapely.geometry import Point, shape
    to_wgs = Transformer.from_crs("EPSG:3844", "EPSG:4326", always_xy=True)
    contur = json.loads((DATA / uat / "contur.json").read_text(encoding="utf-8"))
    limita = next((shape(f["geometry"]) for f in contur["features"] if f["properties"].get("t") == "uat"), None)
    norm = lambda s: re.sub(r"\s+", "", s).upper()  # noqa: E731
    tinte = {norm(c): c for c in cautate if c and len(norm(c)) > 2}
    rez = {}
    for _, s, x, y in citeste_dxf(RADACINA / cfg["dxf"])[1]:
        orig = tinte.get(norm(s))
        if orig and orig not in rez:
            lon, lat = to_wgs.transform(x, y)
            if limita is None or limita.contains(Point(lon, lat)):
                rez[orig] = [round(lon, 7), round(lat, 7)]
    return rez


def expirat(limita):
    """Termenul („dd.mm.yyyy”) a trecut? Unele primării lasă ofertele „deschise” în registru după termen."""
    m = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", limita or "")
    return bool(m) and (int(m[3]), int(m[2]), int(m[1])) < time.localtime()[:3]


def stare(o):
    st = (o.get("status") or "").upper()
    if o["acceptari"]:
        return "acceptata"
    if "DESCHIS" in st and not expirat(o.get("limita")):
        return "deschisa"
    if "POTENTIAL" in st and not expirat(o.get("limita")):
        return "potential"
    return "inchisa"


def oferte_uat(uat, judet, localitate, ani, cache):
    poz = coordonate(uat)
    oferte = []
    for an in ani:
        for o in lista_ids(judet, localitate, an):
            d = cache.get(str(o["id"]))
            if d is None:
                d = detalii(o["id"])
                time.sleep(0.15)
            d = {**d, **o}
            d["an"] = an
            d["url"] = f"{BAZA}/publicSearchDetail.do?idOfertaVanzare={o['id']}"
            if "s_ha" in d:
                d["s"] = round(d.pop("s_ha") * 10000) if d.get("s_ha") else None
            d["p"] = poz.get(d["nc"] or "") or poz.get(d["cf"] or "")
            d.pop("aprox", None)
            d["stare"] = stare(d)
            # în cache doar ce registrul a închis (nu și ofertele „deschise” cu termen trecut, care se pot schimba)
            if d["stare"] == "acceptata" or "INCHIS" in (o["status"] or "").upper():
                cache[str(o["id"])] = {k: v for k, v in d.items() if k not in ("p", "url", "an", "status", "limita", "stare")}
            oferte.append(d)
    rezerva = din_dxf(uat, {c for o in oferte if not o["p"] for c in (o["nc"], o["tarla"], o["cf"]) if c})
    for o in oferte:
        if not o["p"]:
            o["p"] = next((rezerva[c] for c in (o["nc"], o["tarla"], o["cf"]) if c in rezerva), None)
            o["aprox"] = bool(o["p"])  # poziția unei etichete de tarlă / aviz, nu a imobilului eTerra
    oferte.sort(key=lambda o: (o["an"], int((o["nr"] or "0").split("/")[0].strip() or 0)), reverse=True)
    return oferte


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uat", nargs="*", help="id-uri din public/data/uat.json (implicit: toate)")
    ap.add_argument("--localitate", help="numele din registru, pentru un singur --uat")
    ap.add_argument("--judet", default="Timis")
    ap.add_argument("--ani", nargs="*", type=int, default=[time.localtime().tm_year])
    a = ap.parse_args()

    uaturi = {u["id"]: u for u in json.loads((DATA / "uat.json").read_text(encoding="utf-8"))}
    alese = a.uat or list(uaturi)
    if a.localitate and len(alese) != 1:
        sys.exit("--localitate merge doar cu un singur --uat")

    fisier = DATA / "oferte.json"
    vechi = {x["uat"]: x for x in (json.loads(fisier.read_text(encoding="utf-8")) if fisier.exists() else [])}
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    curs = curs_eur()
    rezultat = dict(vechi)
    for uat in alese:
        nume = uaturi[uat]["nume"]
        # registrul n-are o listă a localităților: se caută după nume (fără diacritice); un nume greșit dă 0 oferte
        localitate = a.localitate or fara_diacritice(nume)
        try:
            oferte = oferte_uat(uat, a.judet, localitate, a.ani, cache)
        except Exception as e:  # registrul nu răspunde: rămân datele vechi
            print(f"{nume}: EROARE {e!r} – rămân datele de la rularea anterioară" if uat in vechi else f"{nume}: EROARE {e!r}")
            continue
        finally:
            CACHE.parent.mkdir(exist_ok=True)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        if not oferte:
            rezultat.pop(uat, None)
            print(f"{nume}: nicio ofertă în {a.ani}")
            continue
        rezultat[uat] = {"uat": uat, "nume": nume, "actualizat": time.strftime("%Y-%m-%d %H:%M"),
                         "sursa": "extravilanagricol.ro (registrul ofertelor, Legea 17/2014)",
                         "link": link_registru(a.judet, localitate), "curs": curs, "oferte": oferte}
        pe = {}
        for o in oferte:
            pe[o["stare"]] = pe.get(o["stare"], 0) + 1
        print(f"{nume}: {len(oferte)} oferte {pe}; pe hartă {sum(1 for o in oferte if o['p'])}; "
              f"fără localizare: {[o['nc'] or o['cf'] for o in oferte if not o['p']]}", flush=True)
        # scris după fiecare UAT: o rulare întreruptă nu pierde ce s-a adunat
        fisier.write_text(json.dumps([rezultat[k] for k in uaturi if k in rezultat], ensure_ascii=False,
                                     separators=(",", ":")), encoding="utf-8")
    for x in rezultat.values():
        x["curs"] = curs  # un singur curs pentru toate, ca prețurile să fie comparabile
    fisier.write_text(json.dumps([rezultat[k] for k in uaturi if k in rezultat], ensure_ascii=False,
                                 separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
