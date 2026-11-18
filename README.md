# Imobile OCPI · Timiș

Hartă web (Next.js) cu imobilele, numerele cadastrale și construcțiile din ortoplanurile OCPI Timiș,
peste imaginea satelit Google Maps: **35 de UAT-uri** (Timișoara și comunele din jur), ~218.000 de imobile
cu număr. Merge și pe telefon.

Ce poți face:
- **caută** un număr cadastral (în toate UAT-urile; numerele se repetă între UAT-uri, așa că apare lista
  lor, cele mai apropiate de ce vezi primele), coordonate `45.7231938, 21.1586212` (ca în Google),
  Stereo 70 `201207.92, 476466.53` (E, N – ca în AutoCAD; dacă sunt invers, X topo = N, le întoarce
  singur) sau un link Google Maps lung;
- **link direct**: `/?q=447351` (sau coordonate) deschide harta pe imobil;
- **click / atingere pe un imobil**: număr cadastral, UAT, intravilan/extravilan, suprafață din desen,
  construcții, alte numere găsite în desen (vechi / din avize), centrul în Stereo 70 și GPS;
- **straturi**: imobile (în culoarea UAT-ului, vecinii au culori diferite), numere (de la zoom 16,5),
  construcții, contururi fără număr (versiuni vechi), intravilan (2021), sectoare cadastrale, limitele
  UAT (linia albă), etichetele Google;
- pe desktop, jos-dreapta: UAT-ul, intravilan/extravilan și coordonatele cursorului;
- **Street View**: omulețul Google (jos-dreapta, pe desktop) se trage pe o stradă ca în Google Maps; butonul
  cu omuleț din dreapta-sus sau „Street View” din detaliile imobilului deschid panorama Google cea mai
  apropiată (≤ 200 m), orientată spre imobil; „← Înapoi la hartă” închide;
- **3D**: butonul „3D” trece pe harta fotorealistă Google (Maps JavaScript 3D) – rotire și înclinare cu
  gesturile hărții (desktop: click dreapta / Ctrl + tragere; telefon: două degete) sau din butoanele
  ⟲ ⟳ ⦿ N; imobilele din jur, limita UAT și imobilul selectat sunt contururi pe teren, click pe teren
  selectează imobilul;
- **măsurare** (riglă): click / atingere pe hartă pune puncte – lungimea fiecărui segment, totalul și
  suprafața (≥ 3 puncte), calculate în planul Stereo 70; merge și în 3D;
- **oferte de vânzare** (Moșnița Nouă, teren extravilan, Legea 17/2014): lista din panoul din stânga
  (deschise / toate, cu €/m², preț total și termenul pentru preemptori), puncte cu prețul pe hartă (verde =
  deschisă, portocaliu = potențial cumpărător, albastru = acceptată, gri = închisă); click pe ofertă duce
  la imobil și arată detaliile, cu linkul la pagina oficială a ofertei; sub listă, linkul spre registru (sursa);
- **obiective Google** (magazine, firme, monumente): click deschide fereastra lor ca în Google Maps; în 3D
  numele apare doar dacă pe cheie e activat și „Places API (New)”, altfel rămâne linkul spre Google Maps.

Imobilele unui UAT se încarcă abia când e în vizor (zoom ≥ 13); la pornire se încarcă doar lista
UAT-urilor și limitele lor (~0,5 MB).

## Pornire

```bash
npm install
npm run dev -- -p 3110
```

`.env.local`: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza…` (Google Cloud → Maps JavaScript API → cheie).
Street View și harta 3D folosesc tot Maps JavaScript API (SKU-uri separate – Street View dinamic,
hărți 3D – fiecare cu cota lui gratuită lunară).
Cheia ajunge în codul paginii: restricționeaz-o la domeniile site-ului (Application restrictions →
Websites, ex. `https://<proiect>.vercel.app/*`, `http://localhost:3110/*`) și doar la Maps JavaScript API.

## Datele

Datele (`public/data/`) nu sunt în git; se generează din ortoplanurile DWG ale OCPI (straturile eTerra).

```bash
# 1. toate DWG-urile dintr-un folder → date-sursa/uat/<nume>.dxf (AutoCAD Core Console; merge și cu
#    desenele deschise în AutoCAD, se lucrează pe copii)
python scripts/exporta_toate.py "<folder cu ortoplanurile DWG>" date-sursa/uat
# 2. ce straturi de limită are fiecare desen (ajută la completarea configurației)
python scripts/inspecteaza.py date-sursa/uat/*.dxf
# 3. datele fiecărui UAT din scripts/uaturi.json → public/data/<uat>/
python scripts/genereaza_date.py --toate          # sau --uat giroc dumbravita
# 4. lista UAT-urilor (culori diferite la vecini) și limitele de ansamblu
python scripts/combina.py
# 5. grila de altitudini pentru camera 3D (AWS Terrain Tiles, date deschise; o singură dată)
python scripts/altitudini.py
# 6. ofertele de vânzare din registrul extravilanagricol.ro (anul curent), legate de imobile după
#    numărul cadastral / CF; curs EUR de la BCE. Se schimbă zilnic: rulează din nou, apoi deploy.
python scripts/oferte.py                         # implicit Moșnița Nouă
python scripts/oferte.py --uat mosnita-noua --localitate "Mosnita Noua" --ani 2025 2026
# (opțional) alinierea pe imaginea satelit Esri
python scripts/verifica_aliniere.py timisoara 45.7231938 21.1586212 date-sursa/aliniere.png
```

Python: `shapely`, `pyproj`, `pillow`.

`scripts/uaturi.json`, pe UAT: `nume`, `dxf`, `limita` (stratul cu limita UAT – cea mai nouă
„Limită 5000…” din desen), opțional `limita_arie` (km², când stratul are și conturul de dinainte de
despărțirea comunelor, ex. Carpiniș/Iecea Mare) sau `limita_punct` [E, N], `sector`, `sector_nr`,
`intravilan`. Mai multe UAT-uri pot avea același DXF (desene cu două comune).

Straturi din DWG: `ImobileE3` (contururi eTerra, cu versiuni vechi suprapuse), `ImobileE3_IE`
(numerele), `ConstructiiE3`, `Intravilan_Iulie_2021`, `Sector_Cadastral la data de 05.05.2022`.
Reguli: un număr aparține celui mai mic contur care îl conține; contururile fără număr propriu sunt
„vechi”; imobilele al căror centru cade în afara limitei UAT sunt scoase (ar dubla UAT-ul vecin).

`public/data/oferte.json` păstrează doar datele ofertei (număr, dată, nr. cadastral/CF, tarla, suprafață,
preț, stare, termen, numărul de acceptări și prețul acceptat, linkul oficial), fără numele, telefoanele
sau e-mailurile vânzătorilor și preemptorilor.

Format (`public/data/<uat>/`): coordonate WGS84 întregi la 1e-6 grade (~10 cm), relative la o origine,
delta pe inel – `parcele.json` `{o, k, f: [[nr|0, arie, inele, nr2|0, vechi|0]]}`, `constructii.json`,
`numere.json`, `sectoare.json`, `contur.json` (GeoJSON), `info.json`. Toate cele 35 de UAT-uri: ~55 MB.

Precizie: conversia Stereo 70 → WGS84 (EPSG „Pulkovo 1942(58) to WGS 84 (19)”, aceeași în Python și în
browser) are ±1–3 m; imaginea satelit are și ea decalaj. Orientativ, nu înlocuiește extrasul de CF.

## Publicare (Vercel)

Datele nu sunt în git, deci deploy-ul se face din folderul local (Vercel CLI urcă și `public/data`,
vezi `.vercelignore`):

```bash
vercel deploy --prod
```

Variabila `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` se setează în proiectul Vercel (Production).
