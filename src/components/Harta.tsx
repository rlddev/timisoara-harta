"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map as GMap, useMap, type MapCameraChangedEvent } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import {
  bboxInel, decInel, decPoligon, decPunct, inBBox, inGeom, inPoligon, interpreteaza, intersecteaza, laStereo70, unireBBox,
  type BBox, type Compact, type Constructie, type Eticheta, type FConstructie, type FisierSectoare, type FNumar, type FParcela,
  type LimiteToate, type Parcela, type Poligon, type UatInfo,
} from "@/lib/geo";
import styles from "./harta.module.css";

const CHEIE = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const CENTRU = { lat: 45.76, lng: 21.2 };
const ZOOM_INCARCARE = 13; // de aici se încarcă imobilele UAT-urilor din vizor
const ZOOM_NUMERE = 16.5;
const ZOOM_NUME_UAT = 15.5;
const fmt = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const CULOARE_CONSTRUCTII: [number, number, number] = [255, 95, 30];
const CULOARE_INTRAVILAN: [number, number, number] = [110, 190, 255];
const ALB: [number, number, number, number] = [255, 255, 255, 255];

type DateUat = {
  cuNumar: Parcela[]; // sortate descrescător după arie (cele mici se desenează deasupra și se aleg la click)
  istorice: Parcela[];
  constructii: Constructie[];
  numere: Eticheta[];
  constrPe: Map<string, Constructie[]>;
  dupaVechi: Map<string, Parcela[]>;
};
type Sectoare = { l: { type: "Feature"; properties: object; geometry: Poligon }[]; n: Eticheta[] };
type Straturi = {
  parcele: boolean; istorice: boolean; constructii: boolean; numere: boolean;
  intravilan: boolean; sectoare: boolean; nuanta: boolean; eticheteGoogle: boolean;
};
type Tinta = { id: number; bb?: BBox; centru?: [number, number]; zoom?: number };
type Gasit = { u: string; n: string; p: [number, number] };
type Vizor = { zoom: number; bb: BBox };

async function ia<T>(cale: string): Promise<T> {
  const r = await fetch(cale);
  if (!r.ok) throw new Error(`${cale}: ${r.status}`);
  return r.json();
}

function decodeazaUat(u: string, p: Compact<FParcela>, c: Compact<FConstructie>, n: Compact<FNumar>): DateUat {
  const cuNumar: Parcela[] = [];
  const istorice: Parcela[] = [];
  const dupaVechi = new Map<string, Parcela[]>();
  p.f.forEach((f, id) => {
    const geometry = decPoligon(f[2], p.o, p.k);
    const props: Parcela["properties"] = { id, s: f[1] };
    if (f[0]) props.nr = f[0];
    else props.ist = 1;
    if (f[3]) props.nr2 = f[3];
    if (f[4]) props.v = f[4];
    const parc: Parcela = { type: "Feature", properties: props, geometry, bb: bboxInel(geometry.coordinates[0]), u };
    (f[0] ? cuNumar : istorice).push(parc);
    for (const v of props.v ?? []) dupaVechi.set(v, [...(dupaVechi.get(v) ?? []), parc]);
  });
  cuNumar.sort((a, b) => b.properties.s - a.properties.s);
  const constrPe = new Map<string, Constructie[]>();
  const constructii = c.f.map((f): Constructie => {
    const k: Constructie = { type: "Feature", properties: { s: f[0], ...(f[1] ? { p: f[1] } : {}) }, geometry: decPoligon(f[2], c.o, c.k) };
    if (f[1]) constrPe.set(f[1], [...(constrPe.get(f[1]) ?? []), k]);
    return k;
  });
  const numere = n.f.map(([s, x, y]): Eticheta => ({ n: s, p: decPunct(x, y, n.o, n.k) }));
  return { cuNumar, istorice, constructii, numere, constrPe, dupaVechi };
}

/** Cel mai mic imobil cu număr care conține punctul; dacă se dă numărul, îl preferă pe acela. */
function parcelaLa(d: DateUat, lon: number, lat: number, nr?: string): Parcela | null {
  let best: Parcela | null = null;
  let bestNr: Parcela | null = null;
  for (const f of d.cuNumar) {
    if (!inBBox(f.bb, lon, lat) || !inPoligon(f.geometry, lon, lat)) continue;
    if (!best || f.properties.s < best.properties.s) best = f;
    if (nr && (f.properties.nr === nr || f.properties.nr2?.includes(nr)) && (!bestNr || f.properties.s < bestNr.properties.s)) bestNr = f;
  }
  return bestNr ?? best;
}

/** În ce UAT e punctul și dacă e în intravilan (din limitele de ansamblu). */
function undeE(lim: LimiteToate | null, lon: number, lat: number): { uat: string | null; intravilan: boolean } {
  if (!lim) return { uat: null, intravilan: false };
  const f = lim.uat.features.find((x) => inGeom(x.geometry, lon, lat));
  if (!f) return { uat: null, intravilan: false };
  const id = f.properties.id;
  return { uat: id, intravilan: lim.intravilan.features.some((x) => x.properties.id === id && inGeom(x.geometry, lon, lat)) };
}

const rgb = (c: number[], a = 255): [number, number, number, number] => [c[0], c[1], c[2], a];
const css = (c: number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const esteMobil = () => typeof window !== "undefined" && window.innerWidth <= 760;

// ---------------------------------------------------------------- componente din interiorul hărții

function DeckOverlay({ layers, onClick, getTooltip }: {
  layers: Layer[];
  onClick: (info: PickingInfo) => void;
  getTooltip: (info: PickingInfo) => { text: string; style: Record<string, string> } | null;
}) {
  const map = useMap();
  const overlay = useMemo(() => new GoogleMapsOverlay({ interleaved: false }), []);
  useEffect(() => {
    if (!map) return;
    // Atașăm overlay-ul abia când harta e gata: înainte proiecția poate fi null și deck.gl ar arunca.
    let atasat = false;
    const ataseaza = () => {
      if (atasat) return;
      atasat = true;
      overlay.setMap(map);
    };
    const l = map.addListener("idle", ataseaza);
    if (map.getProjection()) ataseaza();
    return () => {
      l.remove();
      if (atasat) overlay.setMap(null);
    };
  }, [map, overlay]);
  useEffect(() => {
    overlay.setProps({ layers, onClick, getTooltip });
  }, [overlay, layers, onClick, getTooltip]);
  return null;
}

function Zbor({ tinta }: { tinta: Tinta | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !tinta) return;
    // pe telefon panoul e jos: ținta trebuie să rămână deasupra lui
    const hPanou = esteMobil() ? Math.min(document.querySelector("aside")?.getBoundingClientRect().height ?? 150, window.innerHeight * 0.7) : 0;
    if (tinta.bb) {
      const [w, s, e, n] = tinta.bb;
      const pad = esteMobil()
        ? { left: 20, top: 20, right: 20, bottom: Math.round(hPanou) + 20 }
        : { left: 400, top: 60, right: 60, bottom: 60 };
      map.fitBounds({ west: w, south: s, east: e, north: n }, pad);
      google.maps.event.addListenerOnce(map, "idle", () => {
        if ((map.getZoom() ?? 0) > 19.5) map.setZoom(19.5);
      });
    } else if (tinta.centru) {
      const z = tinta.zoom ?? map.getZoom() ?? 12;
      const [lon, lat] = tinta.centru;
      // centrul se mută spre sud cu jumătate din înălțimea panoului, ca ținta să apară deasupra lui
      // (panBy imediat după setCenter e ignorat de Google Maps)
      const mPePixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
      const dLat = ((hPanou / 2) * mPePixel) / 111320;
      map.setZoom(z);
      map.setCenter({ lng: lon, lat: lat - dLat });
    }
  }, [map, tinta]);
  return null;
}

function Cursor({ lim, nume }: { lim: LimiteToate | null; nume: (u: string) => string }) {
  const map = useMap();
  const [pos, setPos] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!map) return;
    const l = map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (e.latLng) setPos([e.latLng.lng(), e.latLng.lat()]);
    });
    return () => l.remove();
  }, [map]);
  if (!pos) return null;
  const [e, n] = laStereo70(pos[0], pos[1]);
  const { uat, intravilan } = undeE(lim, pos[0], pos[1]);
  return (
    <div className={styles.cursor}>
      <span>{uat ? `UAT ${nume(uat)}, ${intravilan ? "intravilan" : "extravilan"}` : "în afara UAT-urilor încărcate"}</span>
      <span>Stereo 70 X(E) <b>{fmt2.format(e)}</b> Y(N) <b>{fmt2.format(n)}</b></span>
      <span>{pos[1].toFixed(7)}, {pos[0].toFixed(7)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- pagina

export default function Harta() {
  const [lista, setLista] = useState<UatInfo[] | null>(null);
  const [lim, setLim] = useState<LimiteToate | null>(null);
  const [eroare, setEroare] = useState<string | null>(null);
  const [incarcate, setIncarcate] = useState<Record<string, DateUat>>({});
  const [sectoare, setSectoare] = useState<Record<string, Sectoare>>({});
  const [stari, setStari] = useState<Record<string, "incarca" | "eroare">>({});
  const inLucru = useRef(new Set<string>());
  const incarcateRef = useRef(incarcate);
  useEffect(() => {
    incarcateRef.current = incarcate;
  }, [incarcate]);
  // selecția cerută de căutare pentru un UAT care încă se încarcă
  const deSelectat = useRef<{ u: string; p: [number, number]; nr?: string } | null>(null);
  const [vizor, setVizor] = useState<Vizor | null>(null);
  const [straturi, setStraturi] = useState<Straturi>({
    parcele: true, istorice: false, constructii: true, numere: true,
    intravilan: false, sectoare: false, nuanta: true, eticheteGoogle: true,
  });
  const [ascunse, setAscunse] = useState<Set<string>>(new Set());
  const [selectat, setSelectat] = useState<Parcela | null>(null);
  const [marker, setMarker] = useState<[number, number] | null>(null);
  const [tinta, setTinta] = useState<Tinta | null>(null);
  const [text, setText] = useState("");
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [variante, setVariante] = useState<Gasit[]>([]);
  const [restrans, setRestrans] = useState(esteMobil);
  const indexNumere = useRef<Map<string, Gasit[]> | null>(null);

  const zboaraLa = useCallback((t: Omit<Tinta, "id">) => setTinta({ ...t, id: Date.now() }), []);
  const dupaId = useMemo(() => new Map((lista ?? []).map((u) => [u.id, u])), [lista]);
  const numeUat = useCallback((u: string) => dupaId.get(u)?.nume ?? u, [dupaId]);

  useEffect(() => {
    Promise.all([ia<UatInfo[]>("/data/uat.json"), ia<LimiteToate>("/data/limite.json")]).then(([l, li]) => {
      setLista(l);
      setLim(li);
      // cu ?q= căutarea mută harta; vederea de ansamblu ar concura cu ea
      if (new URLSearchParams(window.location.search).get("q")) return;
      const z = unireBBox(l.map((u) => u.bbox));
      // pe telefon fitBounds alege zoom întreg prea mic (zona e ~70 km lățime): centru + zoom 9
      if (esteMobil()) zboaraLa({ centru: [(z[0] + z[2]) / 2, (z[1] + z[3]) / 2], zoom: 9 });
      else zboaraLa({ bb: z });
    }, (e: Error) => setEroare(e.message));
  }, [zboaraLa]);

  /** Aplică selecția cerută de căutare dacă UAT-ul ei e încărcat; altfel o lasă în așteptare. */
  const aplicaSelectia = useCallback((d: DateUat | undefined) => {
    const cerere = deSelectat.current;
    if (!cerere || !d) return;
    deSelectat.current = null;
    const f = parcelaLa(d, cerere.p[0], cerere.p[1], cerere.nr);
    setSelectat(f);
    if (f && cerere.nr) setTinta({ bb: f.bb, id: Date.now() });
    else setTinta({ centru: cerere.p, zoom: 19, id: Date.now() });
  }, []);

  const incarcaUat = useCallback(async (id: string) => {
    if (incarcateRef.current[id]) {
      if (deSelectat.current?.u === id) aplicaSelectia(incarcateRef.current[id]);
      return;
    }
    if (inLucru.current.has(id)) return;
    inLucru.current.add(id);
    setStari((s) => ({ ...s, [id]: "incarca" }));
    try {
      const d = `/data/${id}`;
      const [p, c, n] = await Promise.all([
        ia<Compact<FParcela>>(`${d}/parcele.json`),
        ia<Compact<FConstructie>>(`${d}/constructii.json`),
        ia<Compact<FNumar>>(`${d}/numere.json`),
      ]);
      const date = decodeazaUat(id, p, c, n);
      incarcateRef.current = { ...incarcateRef.current, [id]: date };
      setIncarcate((prev) => ({ ...prev, [id]: date }));
      if (deSelectat.current?.u === id) aplicaSelectia(date);
      setStari((s) => {
        const r = { ...s };
        delete r[id];
        return r;
      });
    } catch {
      setStari((s) => ({ ...s, [id]: "eroare" }));
    } finally {
      inLucru.current.delete(id);
    }
  }, [aplicaSelectia]);

  // UAT-urile din vizor se încarcă de la ZOOM_INCARCARE (cu o mică întârziere, cât se mișcă harta)
  useEffect(() => {
    if (!lista || !vizor || vizor.zoom < ZOOM_INCARCARE) return;
    const t = setTimeout(() => {
      for (const u of lista) if (!ascunse.has(u.id) && intersecteaza(u.bbox, vizor.bb)) void incarcaUat(u.id);
    }, 250);
    return () => clearTimeout(t);
  }, [lista, vizor, ascunse, incarcaUat]);

  // sectoarele (strat opțional) pentru UAT-urile încărcate
  useEffect(() => {
    if (!straturi.sectoare) return;
    for (const id of Object.keys(incarcate)) {
      if (sectoare[id]) continue;
      ia<FisierSectoare>(`/data/${id}/sectoare.json`).then((s) => {
        setSectoare((prev) => ({
          ...prev,
          [id]: {
            l: s.l.map((a) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [decInel(a, s.o, s.k)] } })),
            n: s.n.map(([nr, x, y]) => ({ n: nr, p: decPunct(x, y, s.o, s.k) })),
          },
        }));
      }, () => undefined);
    }
  }, [straturi.sectoare, incarcate, sectoare]);

  const mergiLa = useCallback((g: Gasit) => {
    setMarker(null);
    zboaraLa({ centru: g.p, zoom: 18 });
    deSelectat.current = { u: g.u, p: g.p, nr: g.n };
    void incarcaUat(g.u);
  }, [zboaraLa, incarcaUat]);

  const asiguraIndex = useCallback(async () => {
    if (indexNumere.current || !lista) return indexNumere.current;
    const toate = await Promise.all(lista.map(async (u) => [u.id, await ia<Compact<FNumar>>(`/data/${u.id}/numere.json`)] as const));
    const idx = new Map<string, Gasit[]>();
    for (const [u, c] of toate) {
      for (const [n, x, y] of c.f) idx.set(n, [...(idx.get(n) ?? []), { u, n, p: decPunct(x, y, c.o, c.k) }]);
    }
    indexNumere.current = idx;
    return idx;
  }, [lista]);

  const cauta = useCallback(async (q?: string) => {
    if (!lista) return;
    setVariante([]);
    const zona = unireBBox(lista.map((u) => u.stereo70_bbox));
    const c = interpreteaza(q ?? text, zona);
    if (c.tip === "eroare") {
      setMesaj(c.mesaj);
      return;
    }
    if (c.tip === "punct") {
      const { uat, intravilan } = undeE(lim, c.lon, c.lat);
      const [e, n] = laStereo70(c.lon, c.lat);
      setMarker([c.lon, c.lat]);
      setSelectat(null);
      zboaraLa({ centru: [c.lon, c.lat], zoom: 19 });
      setMesaj(`Punct (${c.cum}): X(E) ${fmt2.format(e)}, Y(N) ${fmt2.format(n)} – ` +
        (uat ? `UAT ${numeUat(uat)}, ${intravilan ? "intravilan" : "extravilan"}.` : "în afara UAT-urilor din ortoplanuri."));
      if (uat) {
        deSelectat.current = { u: uat, p: [c.lon, c.lat] };
        void incarcaUat(uat);
      }
      return;
    }
    if (!indexNumere.current) setMesaj(`Caut ${c.nr} în toate cele ${lista.length} UAT-uri…`);
    let idx: Map<string, Gasit[]> | null;
    try {
      idx = await asiguraIndex();
    } catch (e) {
      setMesaj(`Nu pot încărca numerele (${(e as Error).message}).`);
      return;
    }
    // cele mai apropiate de ce se vede acum pe hartă primele (numerele se repetă între UAT-uri)
    const [cx, cy] = vizor ? [(vizor.bb[0] + vizor.bb[2]) / 2, (vizor.bb[1] + vizor.bb[3]) / 2] : [CENTRU.lng, CENTRU.lat];
    const dist = (g: Gasit) => (g.p[0] - cx) ** 2 + (g.p[1] - cy) ** 2;
    const exacte = [...(idx?.get(c.nr) ?? [])].sort((a, b) => dist(a) - dist(b));
    if (exacte.length) {
      mergiLa(exacte[0]);
      if (exacte.length > 1) {
        setVariante(exacte);
        setMesaj(`${c.nr} apare de ${exacte.length} ori (numerele se repetă între UAT-uri). Arăt ${numeUat(exacte[0].u)}:`);
      } else {
        setMesaj(`${c.nr} · ${numeUat(exacte[0].u)}`);
      }
      return;
    }
    const vechi = Object.values(incarcate).flatMap((d) => d.dupaVechi.get(c.nr) ?? []);
    if (vechi.length) {
      const g = vechi.map((f): Gasit => ({ u: f.u, n: f.properties.nr!, p: [(f.bb[0] + f.bb[2]) / 2, (f.bb[1] + f.bb[3]) / 2] }));
      mergiLa(g[0]);
      if (g.length > 1) setVariante(g);
      setMesaj(`${c.nr} nu e număr eTerra actual; apare în desen (avize, numere vechi) pe imobilul ${g[0].n} (${numeUat(g[0].u)}).`);
      return;
    }
    const partial: Gasit[] = [];
    for (const [k, v] of idx ?? []) {
      if (k.startsWith(c.nr)) partial.push(...v);
      if (partial.length >= 12) break;
    }
    setVariante(partial.slice(0, 12));
    setMesaj(partial.length
      ? `${c.nr} nu există exact; numere care încep așa:`
      : `${c.nr} nu apare în ortoplanuri. (Numerele vechi din avize se caută doar în UAT-urile deja încărcate.)`);
  }, [lista, lim, text, vizor, incarcate, zboaraLa, numeUat, incarcaUat, asiguraIndex, mergiLa]);

  // link direct: ?q=<număr cadastral sau coordonate>
  const qPornire = useRef<string | null>(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") : null);
  useEffect(() => {
    const q = qPornire.current;
    if (!lista || !lim || !q) return;
    qPornire.current = null;
    const t = setTimeout(() => {
      setText(q);
      void cauta(q);
    }, 0);
    return () => clearTimeout(t);
  }, [lista, lim, cauta]);

  const onClick = useCallback((info: PickingInfo) => {
    const f = info.object as Parcela | undefined;
    setSelectat(f && "bb" in f ? f : null);
  }, []);

  const getTooltip = useCallback((info: PickingInfo) => {
    const f = info.object as Parcela | undefined;
    if (!f || !("bb" in f)) return null;
    const p = f.properties;
    const cap = p.nr ? `${p.nr}${p.nr2 ? " / " + p.nr2.join(", ") : ""}` : "fără număr (contur vechi)";
    return {
      text: `${cap}\n${fmt.format(p.s)} mp · ${numeUat(f.u)}`,
      style: { background: "rgba(15,18,24,.9)", color: "#fff", font: "12px system-ui", padding: "6px 8px", borderRadius: "6px" },
    };
  }, [numeUat]);

  const onCamera = useCallback((ev: MapCameraChangedEvent) => {
    const b = ev.detail.bounds;
    const z = ev.detail.zoom;
    setVizor((v) => {
      // re-render doar la praguri de zoom sau mutări mari (evenimentul vine la fiecare cadru)
      if (v && Math.floor(v.zoom * 2) === Math.floor(z * 2) &&
        Math.abs(v.bb[0] - b.west) < (b.east - b.west) / 4 && Math.abs(v.bb[1] - b.south) < (b.north - b.south) / 4) return v;
      return { zoom: z, bb: [b.west, b.south, b.east, b.north] };
    });
  }, []);

  const zoom = vizor?.zoom ?? 0;
  const aproape = zoom >= ZOOM_NUMERE;
  const departe = zoom < ZOOM_NUME_UAT;

  const layers = useMemo(() => {
    if (!lista || !lim) return [];
    const s = straturi;
    const vizibile = lista.filter((u) => !ascunse.has(u.id) && incarcate[u.id]);
    const per = (fn: (u: UatInfo, d: DateUat) => Layer[]) => vizibile.flatMap((u) => fn(u, incarcate[u.id]));
    const culoare = new Map(lista.map((u) => [u.id, u.culoare]));
    const textComun = {
      sizeUnits: "pixels" as const, fontFamily: "system-ui, Segoe UI, Arial",
      fontSettings: { sdf: true, fontSize: 64, buffer: 8 }, outlineWidth: 3, outlineColor: [0, 0, 0, 230] as [number, number, number, number],
    };
    return [
      new GeoJsonLayer({
        id: "nuanta", data: lim.uat as never, visible: s.nuanta, stroked: false, filled: true,
        getFillColor: ((f: { properties: { id: string } }) => rgb(culoare.get(f.properties.id) ?? [255, 255, 255], 22)) as never,
      }),
      new GeoJsonLayer({
        id: "intravilan", data: lim.intravilan as never, visible: s.intravilan, stroked: true, filled: true,
        getFillColor: rgb(CULOARE_INTRAVILAN, 25), getLineColor: rgb(CULOARE_INTRAVILAN, 230), lineWidthUnits: "pixels", getLineWidth: 2,
      }),
      ...per((u) => (sectoare[u.id] ? [new GeoJsonLayer({
        id: `sectoare-${u.id}`, data: sectoare[u.id].l as never, visible: s.sectoare, stroked: true, filled: false,
        getLineColor: [235, 80, 235, 220], lineWidthUnits: "pixels", getLineWidth: 1.5,
      })] : [])),
      ...per((u, d) => [new GeoJsonLayer({
        id: `istorice-${u.id}`, data: d.istorice as never, visible: s.istorice, pickable: true, stroked: true, filled: false,
        getLineColor: [255, 255, 255, 150], lineWidthUnits: "pixels", getLineWidth: 1,
      })]),
      ...per((u, d) => [new GeoJsonLayer({
        id: `parcele-${u.id}`, data: d.cuNumar as never, visible: s.parcele, pickable: true, autoHighlight: true,
        highlightColor: [0, 210, 255, 60], stroked: true, filled: true,
        getFillColor: rgb(u.culoare, 14), getLineColor: rgb(u.culoare, 235), lineWidthUnits: "pixels", getLineWidth: 1.2,
      })]),
      ...per((u, d) => [new GeoJsonLayer({
        id: `constructii-${u.id}`, data: d.constructii as never, visible: s.constructii, stroked: true, filled: true,
        getFillColor: rgb(CULOARE_CONSTRUCTII, 70), getLineColor: [255, 120, 50, 230], lineWidthUnits: "pixels", getLineWidth: 1,
      })]),
      new GeoJsonLayer({
        id: "selectat", data: (selectat ? [selectat] : []) as never, stroked: true, filled: true,
        getFillColor: [0, 229, 255, 45], getLineColor: [0, 229, 255, 255], lineWidthUnits: "pixels", getLineWidth: 3,
      }),
      // limitele UAT: deasupra parcelelor, linie albă cu contur negru ca să se vadă pe orice fundal
      new GeoJsonLayer({
        id: "limite-umbra", data: lim.uat as never, stroked: true, filled: false,
        getLineColor: [0, 0, 0, 200], lineWidthUnits: "pixels", getLineWidth: 6,
      }),
      new GeoJsonLayer({
        id: "limite", data: lim.uat as never, stroked: true, filled: false,
        getLineColor: ALB, lineWidthUnits: "pixels", getLineWidth: 3,
      }),
      ...per((u, d) => [new TextLayer<Eticheta>({
        id: `numere-${u.id}`, data: d.numere, visible: s.numere && aproape,
        getPosition: (e) => e.p, getText: (e) => e.n, getSize: 13, getColor: ALB, fontWeight: 600, ...textComun,
      })]),
      ...per((u) => (sectoare[u.id] ? [new TextLayer<Eticheta>({
        id: `sectoare-nr-${u.id}`, data: sectoare[u.id].n, visible: s.sectoare,
        getPosition: (e) => e.p, getText: (e) => e.n, getSize: 16, getColor: [255, 170, 255, 255], fontWeight: 700, ...textComun,
      })] : [])),
      new TextLayer<UatInfo>({
        id: "nume-uat", data: lista, visible: departe && zoom >= 8,
        getPosition: (u) => u.eticheta, getText: (u) => u.nume.toUpperCase(),
        getColor: (u) => rgb(u.culoare), fontWeight: 800, characterSet: "auto", ...textComun, outlineWidth: 4,
        // mărime în metri: la zoom mic numele se micșorează și nu se mai calcă între ele
        sizeUnits: "meters", getSize: 700, sizeMinPixels: 8, sizeMaxPixels: 18,
      }),
      new ScatterplotLayer<[number, number]>({
        id: "marker", data: marker ? [marker] : [], getPosition: (d) => d,
        radiusUnits: "pixels", getRadius: 7, getFillColor: [255, 40, 40, 255],
        stroked: true, getLineColor: ALB, lineWidthUnits: "pixels", getLineWidth: 2,
      }),
    ] as Layer[];
  }, [lista, lim, incarcate, sectoare, straturi, ascunse, aproape, departe, zoom, selectat, marker]);

  const comuta = (k: keyof Straturi) => setStraturi((s) => ({ ...s, [k]: !s[k] }));
  const comutaUat = (id: string) => setAscunse((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const nIncarcate = Object.keys(incarcate).length;
  const seIncarca = Object.entries(stari).filter(([, v]) => v === "incarca").map(([k]) => numeUat(k));

  return (
    <APIProvider apiKey={CHEIE} language="ro" region="RO">
      <div className={styles.ecran}>
        <GMap
          className={styles.harta}
          defaultCenter={CENTRU}
          defaultZoom={10}
          defaultTilt={0}
          mapTypeId={straturi.eticheteGoogle ? "hybrid" : "satellite"}
          gestureHandling="greedy"
          clickableIcons={false}
          disableDefaultUI
          zoomControl={!restrans || !esteMobil()}
          scaleControl
          onCameraChanged={onCamera}
          reuseMaps
        >
          {/* fără cheie validă Google nu dă proiecția hărții și deck.gl n-are peste ce desena */}
          {CHEIE && <DeckOverlay layers={layers} onClick={onClick} getTooltip={getTooltip} />}
          <Zbor tinta={tinta} />
        </GMap>

        <aside className={styles.panou} data-restrans={restrans || undefined}>
          <div className={styles.antet}>
            <h1 className={styles.titlu}>Imobile OCPI · Timiș</h1>
            <button type="button" className={styles.comutaPanou} onClick={() => setRestrans((r) => !r)}
              aria-expanded={!restrans} aria-label={restrans ? "Arată panoul" : "Strânge panoul"}>
              {restrans ? "▴" : "▾"}
            </button>
          </div>
          {!CHEIE && (
            <p className={styles.atentie}>
              Lipsește cheia Google Maps: pune <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=…</code> în <code>.env.local</code>.
            </p>
          )}
          {eroare && <p className={styles.atentie}>Nu pot încărca datele ({eroare}).</p>}

          <form className={styles.cautare} onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); void cauta(); }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nr. cadastral, coordonate sau link Google Maps"
              aria-label="Caută"
              enterKeyHint="search"
            />
            <button type="submit" disabled={!lista}>Caută</button>
          </form>
          {mesaj && <p className={styles.mesaj}>{mesaj}</p>}
          {variante.length > 0 && (
            <div className={styles.variante}>
              {variante.map((g, i) => (
                <button key={`${g.u}-${g.n}-${i}`} type="button" onClick={() => mergiLa(g)}>
                  {g.n} · {numeUat(g.u)}
                </button>
              ))}
            </div>
          )}
          {zoom > 0 && zoom < ZOOM_INCARCARE && !selectat && (
            <p className={styles.mic}>Apropie-te de un UAT (zoom ≥ {ZOOM_INCARCARE}) ca să se încarce imobilele sau caută un număr.</p>
          )}
          {seIncarca.length > 0 && <p className={styles.mic}>Se încarcă: {seIncarca.join(", ")}…</p>}

          {selectat && lista && (
            <Detalii f={selectat} uat={dupaId.get(selectat.u)} d={incarcate[selectat.u]} lim={lim} onInchide={() => setSelectat(null)} />
          )}

          <div className={styles.extra}>
            {lista && (
              <details className={styles.straturi}>
                <summary>UAT-uri ({lista.length}) · încărcate {nIncarcate}</summary>
                <div className={styles.listaUat}>
                  {lista.map((u) => (
                    <label key={u.id}>
                      <input type="checkbox" checked={!ascunse.has(u.id)} onChange={() => comutaUat(u.id)} />
                      <i style={{ background: css(u.culoare) }} />
                      <span>
                        {u.nume}{" "}
                        <span className={styles.mic}>
                          · {fmt.format(u.cu_numar)} imobile{incarcate[u.id] ? " · ✓" : stari[u.id] === "incarca" ? " · …" : ""}
                        </span>
                      </span>
                      <button type="button" className={styles.zboara}
                        onClick={(e) => { e.preventDefault(); zboaraLa({ bb: u.bbox }); if (esteMobil()) setRestrans(true); }}>
                        arată
                      </button>
                    </label>
                  ))}
                </div>
              </details>
            )}

            <fieldset className={styles.straturi}>
              <legend>Straturi</legend>
              {([
                ["parcele", "Imobile cu număr (culoarea UAT-ului)", "linear-gradient(90deg, #ffd60a 25%, #50eb78 25% 50%, #af8cff 50% 75%, #ff78aa 75%)"],
                ["numere", `Numere cadastrale (de la zoom ${ZOOM_NUMERE})`, "#ffffff"],
                ["constructii", "Construcții", css(CULOARE_CONSTRUCTII)],
                ["istorice", "Contururi fără număr (vechi)", "#bbbbbb"],
                ["intravilan", "Intravilan (iulie 2021)", css(CULOARE_INTRAVILAN)],
                ["sectoare", "Sectoare cadastrale", "#eb50eb"],
                ["nuanta", "Nuanța UAT-ului pe toată suprafața", "rgba(255,255,255,.35)"],
                ["eticheteGoogle", "Străzi și nume Google", "#8ab4f8"],
              ] as [keyof Straturi, string, string][]).map(([k, eticheta, culoare]) => (
                <label key={k}>
                  <input type="checkbox" checked={straturi[k]} onChange={() => comuta(k)} />
                  <i style={{ background: culoare }} /> {eticheta}
                </label>
              ))}
            </fieldset>

            <p className={styles.sursa}>
              Imobile, numere cadastrale și construcții din ortoplanurile OCPI Timiș (straturile eTerra), limitele UAT
              și intravilanul din aceleași planuri. Conversie Stereo 70 → WGS84 ±1–3 m; imaginea Google are și ea decalaj.
              Orientativ, nu înlocuiește extrasul de carte funciară.
            </p>
          </div>
        </aside>
        <Cursor lim={lim} nume={numeUat} />
      </div>
    </APIProvider>
  );
}

function Detalii({ f, uat, d, lim, onInchide }: {
  f: Parcela; uat?: UatInfo; d?: DateUat; lim: LimiteToate | null; onInchide: () => void;
}) {
  const p = f.properties;
  const [lon, lat] = [(f.bb[0] + f.bb[2]) / 2, (f.bb[1] + f.bb[3]) / 2];
  const [e, n] = laStereo70(lon, lat);
  const constr = p.nr && d ? d.constrPe.get(p.nr) ?? [] : [];
  const { intravilan } = undeE(lim, lon, lat);
  const coord = `${lat.toFixed(7)}, ${lon.toFixed(7)}`;
  return (
    <section className={styles.detalii}>
      <button type="button" className={styles.inchide} onClick={onInchide} aria-label="Închide">×</button>
      {p.nr ? (
        <>
          <div className={styles.eticheta}>Nr. cadastral</div>
          <div className={styles.numar}>{p.nr}</div>
          {p.nr2 && <div className={styles.mic}>și: {p.nr2.join(", ")}</div>}
        </>
      ) : (
        <div className={styles.numar}>Contur fără număr</div>
      )}
      <dl>
        <dt>UAT</dt>
        <dd>
          <i className={styles.punct} style={{ background: uat ? css(uat.culoare) : "#999" }} />
          {uat?.nume ?? f.u} · {intravilan ? "intravilan" : "extravilan"}
        </dd>
        <dt>Suprafață (desen)</dt>
        <dd>{fmt.format(p.s)} mp</dd>
        {constr.length > 0 && (
          <>
            <dt>Construcții</dt>
            <dd>{constr.length} · {fmt.format(constr.reduce((a, c) => a + c.properties.s, 0))} mp la sol</dd>
          </>
        )}
        {p.v && (
          <>
            <dt>Alte numere în desen</dt>
            <dd>{p.v.join(", ")}</dd>
          </>
        )}
        <dt>Centru Stereo 70</dt>
        <dd>X(E) {fmt2.format(e)} · Y(N) {fmt2.format(n)}</dd>
        <dt>Centru GPS</dt>
        <dd>{coord}</dd>
      </dl>
      {!p.nr && <p className={styles.mic}>Probabil parcela-mamă dinaintea unei dezmembrări sau un contur vechi.</p>}
      <div className={styles.butoane}>
        <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`} target="_blank" rel="noopener noreferrer">
          Google Maps
        </a>
        <button type="button" onClick={() => navigator.clipboard?.writeText(`${e.toFixed(2)},${n.toFixed(2)}`)}>
          Copiază X,Y
        </button>
      </div>
    </section>
  );
}
