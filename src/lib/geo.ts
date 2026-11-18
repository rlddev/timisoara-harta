import proj4 from "proj4";

// Stereo 70 (EPSG:3844) cu aceeași transformare ca pyproj în scripts/genereaza_date.py
// (EPSG „Pulkovo 1942(58) to WGS 84 (19)”, ±3 m; rotațiile au semnul schimbat: proj4 folosește
// convenția position vector, EPSG dă coordinate frame).
proj4.defs(
  "EPSG:3844",
  "+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass " +
    "+towgs84=2.329,-147.042,-92.08,-0.309,0.325,0.497,5.69 +units=m +no_defs",
);

export type BBox = [number, number, number, number]; // [vest, sud, est, nord]
export type Poligon = { type: "Polygon"; coordinates: number[][][] };
export type PoligonMulti = Poligon | { type: "MultiPolygon"; coordinates: number[][][][] };
export type ParcelaProps = { id: number; s: number; nr?: string; nr2?: string[]; v?: string[]; ist?: 1 };
/** `u` = id-ul UAT-ului, `bb` = bbox lon/lat. */
export type Parcela = { type: "Feature"; properties: ParcelaProps; geometry: Poligon; bb: BBox; u: string };
export type Constructie = { type: "Feature"; properties: { s: number; p?: string }; geometry: Poligon };
export type Eticheta = { n: string; p: [number, number] };
export type ColectieLimite = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { id: string }; geometry: PoligonMulti }[];
};
/** public/data/limite.json: limitele tuturor UAT-urilor și intravilanul (simplificate). */
export type LimiteToate = { uat: ColectieLimite; intravilan: ColectieLimite };
export type UatInfo = {
  id: string;
  nume: string;
  culoare: [number, number, number];
  sursa: string;
  generat: string;
  imobile: number;
  cu_numar: number;
  constructii: number;
  suprafata_km2: number;
  stereo70_bbox: BBox;
  bbox: BBox;
  eticheta: [number, number];
  marimi: Record<string, number>;
  vecini: string[];
};

/** public/data/oferte.json (scripts/oferte.py): ofertele de vânzare teren extravilan (Legea 17/2014). */
export type StareOferta = "deschisa" | "potential" | "acceptata" | "inchisa";
export type Oferta = {
  id: number; an: number; nr: string; nc: string | null; cf: string | null; tarla: string | null; parcela: string | null;
  categorie: string | null; s: number | null; pret: number | null; moneda: string | null; status: string | null;
  limita: string | null; stare: StareOferta; preemptori: number; acceptari: number; pret_acceptat: number | null;
  potentiali: number; rezolutie: string | null; url: string; p: [number, number] | null; aprox?: boolean;
};
export type OferteUat = {
  uat: string; nume: string; actualizat: string; sursa: string;
  /** pagina publică a registrului pentru localitate */
  link?: string;
  curs: { eur: number; data: string; sursa: string }; oferte: Oferta[];
};

/** Fișierele compacte din scripts/genereaza_date.py: o = origine [lon, lat], k = 1e6, inel delta. */
export type Compact<T> = { o: [number, number]; k: number; f: T[] };
export type FParcela = [string | 0, number, number[][], (string[] | 0)?, (string[] | 0)?];
export type FConstructie = [number, string | 0, number[][]];
export type FNumar = [string, number, number];
export type FisierSectoare = { o: [number, number]; k: number; l: number[][]; n: FNumar[] };

export function decInel(a: number[], o: [number, number], k: number): number[][] {
  const r: number[][] = [];
  let x = 0, y = 0;
  for (let i = 0; i < a.length; i += 2) {
    x += a[i];
    y += a[i + 1];
    r.push([o[0] + x / k, o[1] + y / k]);
  }
  if (r.length) r.push(r[0]);
  return r;
}

export function decPoligon(inele: number[][], o: [number, number], k: number): Poligon {
  return { type: "Polygon", coordinates: inele.map((a) => decInel(a, o, k)) };
}

export function decPunct(x: number, y: number, o: [number, number], k: number): [number, number] {
  return [o[0] + x / k, o[1] + y / k];
}

export function inGeom(g: PoligonMulti, lon: number, lat: number): boolean {
  if (g.type === "Polygon") return inPoligon(g, lon, lat);
  return g.coordinates.some((c) => inPoligon({ type: "Polygon", coordinates: c }, lon, lat));
}

export function intersecteaza(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Măsurare în planul Stereo 70 (ca la cadastru): lungimile segmentelor, totalul și aria (≥ 3 puncte). */
export function masoara(puncte: [number, number][]): { segmente: number[]; total: number; arie: number | null } {
  const s = puncte.map(([lon, lat]) => laStereo70(lon, lat));
  const segmente = s.slice(1).map((p, i) => Math.hypot(p[0] - s[i][0], p[1] - s[i][1]));
  let arie: number | null = null;
  if (s.length >= 3) {
    let a = 0;
    for (let i = 0; i < s.length; i++) {
      const [x1, y1] = s[i];
      const [x2, y2] = s[(i + 1) % s.length];
      a += x1 * y2 - x2 * y1;
    }
    arie = Math.abs(a) / 2;
  }
  return { segmente, total: segmente.reduce((a, b) => a + b, 0), arie };
}

/** Direcția (grade față de nord, în sensul acelor de ceas) de la punctul 1 la punctul 2. */
export function directie(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dx = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180);
  const dy = lat2 - lat1;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** public/data/altitudini.json (scripts/altitudini.py): grilă regulată, rânduri de la sud la nord. */
export type GrilaAltitudini = { o: [number, number]; pas: number; n: [number, number]; z: number[] };

/** Altitudinea terenului (m, nivelul mării), interpolare biliniară; 90 m în afara grilei. */
export function altitudine(g: GrilaAltitudini | null, lon: number, lat: number): number {
  if (!g) return 90;
  const fx = (lon - g.o[0]) / g.pas;
  const fy = (lat - g.o[1]) / g.pas;
  const [nx, ny] = g.n;
  if (fx < 0 || fy < 0 || fx >= nx - 1 || fy >= ny - 1) return 90;
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const z = (a: number, b: number) => g.z[b * nx + a];
  return (z(i, j) * (1 - tx) + z(i + 1, j) * tx) * (1 - ty) + (z(i, j + 1) * (1 - tx) + z(i + 1, j + 1) * tx) * ty;
}

/** Metri pe pixel la un zoom Web Mercator. */
export const metriPePixel = (zoom: number, lat: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
/** Distanța camerei 3D echivalentă unui zoom 2D, pentru o fereastră de înălțime h px. */
export const distantaDinZoom = (zoom: number, lat: number, h: number) => metriPePixel(zoom, lat) * h;
export const zoomDinDistanta = (range: number, lat: number, h: number) =>
  Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180) * h) / Math.max(range, 1));

export function unireBBox(lista: BBox[]): BBox {
  return [
    Math.min(...lista.map((b) => b[0])), Math.min(...lista.map((b) => b[1])),
    Math.max(...lista.map((b) => b[2])), Math.max(...lista.map((b) => b[3])),
  ];
}

/** lon/lat → Stereo 70 [E, N] (în AutoCAD: X = E, Y = N). */
export function laStereo70(lon: number, lat: number): [number, number] {
  return proj4("EPSG:4326", "EPSG:3844", [lon, lat]) as [number, number];
}

/** Stereo 70 [E, N] → [lon, lat]. */
export function dinStereo70(e: number, n: number): [number, number] {
  return proj4("EPSG:3844", "EPSG:4326", [e, n]) as [number, number];
}

export function bboxInel(inel: number[][]): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of inel) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export function inBBox(bb: BBox, lon: number, lat: number): boolean {
  return lon >= bb[0] && lon <= bb[2] && lat >= bb[1] && lat <= bb[3];
}

export function inPoligon(p: Poligon, lon: number, lat: number): boolean {
  let inside = false;
  p.coordinates.forEach((inel, k) => {
    let c = false;
    for (let i = 0, j = inel.length - 1; i < inel.length; j = i++) {
      const [xi, yi] = inel[i];
      const [xj, yj] = inel[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    if (k === 0) inside = c;
    else if (c) inside = false; // în gaură
  });
  return inside;
}

export type Cautare =
  | { tip: "punct"; lon: number; lat: number; cum: string }
  | { tip: "numar"; nr: string }
  | { tip: "eroare"; mesaj: string };

const RO_LAT: [number, number] = [43.5, 48.4];
const RO_LON: [number, number] = [20.2, 29.8];
const intre = (v: number, [a, b]: [number, number]) => v >= a && v <= b;

/**
 * Ce a scris utilizatorul în căutare:
 *  - link Google Maps (ia ultimul „!3d…!4d…”, altfel „@lat,lon”)
 *  - „45.7231938, 21.1586212” (ordinea din Google: lat, lon)
 *  - Stereo 70 „201207.92, 476466.53” (E, N) sau invers (X topo = N), după zona datelor
 *  - număr cadastral (eventual cu „CF”, „cad”, „-C1”)
 */
export function interpreteaza(text: string, zona: BBox): Cautare {
  const t = text.trim();
  if (!t) return { tip: "eroare", mesaj: "Scrie un număr cadastral sau coordonate." };

  if (/goo\.gl|google\.[a-z.]+\/maps|maps\.google/i.test(t)) {
    const pin = [...t.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)].pop();
    if (pin) return { tip: "punct", lat: +pin[1], lon: +pin[2], cum: "pinul din linkul Google Maps" };
    const at = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) return { tip: "punct", lat: +at[1], lon: +at[2], cum: "centrul hărții din linkul Google Maps" };
    return {
      tip: "eroare",
      mesaj: "Linkul nu are coordonate. Dacă e un link scurt (maps.app.goo.gl), deschide-l și copiază linkul lung din bara de adrese.",
    };
  }

  const nums = t.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length === 2 && /[.]/.test(t)) {
    const [a, b] = nums;
    if (Math.abs(a) <= 180 && Math.abs(b) <= 180) {
      if (intre(a, RO_LAT) && intre(b, RO_LON)) return { tip: "punct", lat: a, lon: b, cum: "lat, lon (ca în Google)" };
      if (intre(b, RO_LAT) && intre(a, RO_LON)) return { tip: "punct", lat: b, lon: a, cum: "lon, lat" };
      return { tip: "eroare", mesaj: "Coordonatele nu sunt în România." };
    }
    if (a > 1000 && b > 1000) {
      const m = 30000;
      const okE = (v: number) => v >= zona[0] - m && v <= zona[2] + m;
      const okN = (v: number) => v >= zona[1] - m && v <= zona[3] + m;
      const [e, n, cum] =
        okE(b) && okN(a) && !(okE(a) && okN(b))
          ? [b, a, "Stereo 70, X(N) apoi Y(E), ca la topografi"]
          : [a, b, "Stereo 70, E apoi N (X, Y din AutoCAD)"];
      const [lon, lat] = dinStereo70(e, n);
      return { tip: "punct", lon, lat, cum };
    }
  }

  const nr = t.match(/^\D*?(\d{3,7})(?:\s*-\s*C\d+)?\D*$/i);
  if (nr) return { tip: "numar", nr: nr[1] };
  return { tip: "eroare", mesaj: "Nu înțeleg. Exemple: 447351 · 45.72319, 21.15862 · 201207.92, 476466.53 · link Google Maps." };
}
