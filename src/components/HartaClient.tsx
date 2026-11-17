"use client";

import dynamic from "next/dynamic";

// Google Maps și deck.gl au nevoie de window: harta se încarcă doar în browser.
const Harta = dynamic(() => import("./Harta"), {
  ssr: false,
  loading: () => <p style={{ padding: 24 }}>Se încarcă harta…</p>,
});

export default function HartaClient() {
  return <Harta />;
}
