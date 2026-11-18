"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Map3D, Marker3D, Polygon3D, Polyline3D, Popover,
  type Map3DCameraChangedEvent, type Map3DClickEvent, type Map3DRef, type Map3DSteadyChangeEvent,
} from "@vis.gl/react-google-maps/3d";
import type { Parcela } from "@/lib/geo";
import styles from "./harta.module.css";

/** alt = altitudinea centrului (m, nivelul mării): centrul camerei 3D e în altitudine absolută. */
export type Camera3D = { lon: number; lat: number; alt: number; range: number; heading: number; tilt: number };
export type Zbor3D = { id: number; lon: number; lat: number; range: number };
type Inel = { lat: number; lng: number }[];

const inel = (c: number[][]): Inel => c.map(([lng, lat]) => ({ lat, lng }));
const rgba = (c: number[], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const TILT = 55;

/**
 * Harta 3D fotorealistă Google (Maps JavaScript, maps3d): rotire și înclinare cu gesturile hărții
 * (desktop: click dreapta / Ctrl + tragere; telefon: două degete) sau din butoanele de alături.
 * Imobilele din jur, limitele UAT și măsurătoarea sunt contururi lipite de teren.
 */
export default function Harta3D({
  start, zbor, alt, mode, parcele, selectat, culoareSelectat, limite, masura, onClickLoc, onCamera,
}: {
  start: Camera3D;
  zbor: Zbor3D | null;
  alt: (lon: number, lat: number) => number;
  mode: "HYBRID" | "SATELLITE";
  parcele: { f: Parcela; culoare: number[] }[];
  selectat: Parcela | null;
  culoareSelectat: number[];
  limite: number[][][];
  masura: [number, number][];
  onClickLoc: (lon: number, lat: number) => void;
  onCamera: (c: Camera3D) => void;
}) {
  const ref = useRef<Map3DRef | null>(null);
  const cam = useRef<Camera3D>(start);

  const onCameraChanged = useCallback((e: Map3DCameraChangedEvent) => {
    const d = e.detail;
    cam.current = { lon: d.center.lng, lat: d.center.lat, alt: d.center.altitude ?? 0, range: d.range, heading: d.heading, tilt: d.tilt };
  }, []);
  const onSteady = useCallback((e: Map3DSteadyChangeEvent) => {
    if (e.detail.isSteady) onCamera(cam.current);
  }, [onCamera]);
  // obiectiv Google (POI): fereastră cu numele (Places, dacă e activat pe cheie) și link spre Google Maps
  const [poi, setPoi] = useState<{ id: string; lat: number; lng: number; alt: number; nume?: string; adresa?: string; nota?: string; url?: string } | null>(null);
  const onClick = useCallback((e: Map3DClickEvent) => {
    const p = e.detail.position;
    const placeId = e.detail.placeId;
    if (placeId && p) {
      setPoi({ id: placeId, lat: p.lat, lng: p.lng, alt: p.altitude ?? 0 });
      (async () => {
        try {
          const { Place } = (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
          const pl = new Place({ id: placeId, requestedLanguage: "ro" });
          await pl.fetchFields({ fields: ["displayName", "formattedAddress", "rating", "userRatingCount", "googleMapsURI"] });
          setPoi((v) => (v?.id === placeId ? {
            ...v, nume: pl.displayName ?? undefined, adresa: pl.formattedAddress ?? undefined, url: pl.googleMapsURI ?? undefined,
            nota: pl.rating ? `${pl.rating.toFixed(1)} ★ (${pl.userRatingCount ?? 0})` : undefined,
          } : v));
        } catch {
          // Places API neactivat pe cheie: rămâne linkul spre Google Maps
        }
      })();
      return;
    }
    setPoi(null);
    if (p) onClickLoc(p.lng, p.lat);
  }, [onClickLoc]);

  // căutarea / „arată” mută și camera 3D
  useEffect(() => {
    if (!zbor) return;
    ref.current?.flyCameraTo({
      endCamera: {
        center: { lat: zbor.lat, lng: zbor.lon, altitude: alt(zbor.lon, zbor.lat) },
        range: zbor.range, tilt: cam.current.tilt || TILT, heading: cam.current.heading,
      },
      durationMillis: 1500,
    });
    // alt e stabil cât timp grila e aceeași; zborul pornește doar la o țintă nouă
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zbor]);

  const roteste = (dHeading: number, tilt?: number) => {
    const c = cam.current;
    ref.current?.flyCameraTo({
      endCamera: {
        center: { lat: c.lat, lng: c.lon, altitude: c.alt },
        range: c.range, tilt: tilt ?? c.tilt, heading: dHeading === 0 && tilt === undefined ? 0 : c.heading + dHeading,
      },
      durationMillis: 700,
    });
  };

  const centruSel = selectat ? { lat: (selectat.bb[1] + selectat.bb[3]) / 2, lng: (selectat.bb[0] + selectat.bb[2]) / 2 } : null;

  return (
    <>
      <Map3D
        ref={ref}
        className={styles.harta}
        mode={mode}
        gestureHandling="GREEDY"
        defaultCenter={{ lat: start.lat, lng: start.lon, altitude: start.alt }}
        defaultRange={start.range}
        defaultTilt={start.tilt}
        defaultHeading={start.heading}
        onCameraChanged={onCameraChanged}
        onSteadyChange={onSteady}
        onClick={onClick}
      >
        {limite.map((c, i) => (
          <Polyline3D key={`l${i}`} path={inel(c)} altitudeMode="CLAMP_TO_GROUND" strokeColor="#ffffff" strokeWidth={4}
            outerColor="#000000" outerWidth={0.4} drawsOccludedSegments />
        ))}
        {parcele.map(({ f, culoare }) => (
          <Polygon3D key={`${f.u}-${f.properties.id}`} path={inel(f.geometry.coordinates[0])} altitudeMode="CLAMP_TO_GROUND"
            fillColor={rgba(culoare, 0.1)} strokeColor={rgba(culoare, 0.95)} strokeWidth={2} />
        ))}
        {selectat && (
          <Polygon3D key={`sel-${selectat.u}-${selectat.properties.id}`} path={inel(selectat.geometry.coordinates[0])}
            altitudeMode="CLAMP_TO_GROUND" fillColor={rgba(culoareSelectat, 0.3)} strokeColor="#00e5ff" strokeWidth={4} drawsOccludedSegments />
        )}
        {selectat && centruSel && selectat.properties.nr && (
          <Marker3D position={{ ...centruSel, altitude: 25 }} altitudeMode="RELATIVE_TO_GROUND" extruded label={selectat.properties.nr} />
        )}
        {masura.length >= 2 && (
          <Polyline3D path={masura.map(([lng, lat]) => ({ lat, lng }))} altitudeMode="CLAMP_TO_GROUND" strokeColor="#ffffff"
            strokeWidth={4} outerColor="#000000" outerWidth={0.4} drawsOccludedSegments />
        )}
        {poi && (
          <Popover open position={{ lat: poi.lat, lng: poi.lng, altitude: poi.alt }} altitudeMode="ABSOLUTE" onClose={() => setPoi(null)}>
            <div className={styles.poi}>
              <b>{poi.nume ?? "Obiectiv Google"}</b>
              {poi.adresa && <span>{poi.adresa}</span>}
              {poi.nota && <span>{poi.nota}</span>}
              <a href={poi.url ?? `https://www.google.com/maps/place/?q=place_id:${poi.id}`} target="_blank" rel="noopener noreferrer">
                Deschide în Google Maps
              </a>
            </div>
          </Popover>
        )}
        {masura.length >= 3 && (
          <Polygon3D path={masura.map(([lng, lat]) => ({ lat, lng }))} altitudeMode="CLAMP_TO_GROUND"
            fillColor="rgba(255, 255, 255, 0.18)" strokeColor="rgba(255, 255, 255, 0)" strokeWidth={0} />
        )}
      </Map3D>
      <div className={styles.rotire} role="group" aria-label="Rotire și înclinare">
        <button type="button" onClick={() => roteste(-45)} title="Rotește la stânga" aria-label="Rotește la stânga">⟲</button>
        <button type="button" onClick={() => roteste(45)} title="Rotește la dreapta" aria-label="Rotește la dreapta">⟳</button>
        <button type="button" onClick={() => roteste(0, cam.current.tilt > 20 ? 0 : TILT)} title="Vedere de sus / înclinată"
          aria-label="Vedere de sus sau înclinată">⦿</button>
        <button type="button" onClick={() => roteste(0)} title="Nordul în sus" aria-label="Nordul în sus">N</button>
      </div>
    </>
  );
}
