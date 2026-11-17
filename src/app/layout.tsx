import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Imobile OCPI · Timiș",
  description:
    "Imobilele, numerele cadastrale și construcțiile din ortoplanurile OCPI Timiș (35 de UAT-uri) peste imaginea satelit Google",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1015",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
