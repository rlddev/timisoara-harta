"""Copiază un DWG (chiar dacă e deschis în AutoCAD) și îl exportă în DXF cu AutoCAD Core Console.

    python scripts/dwg_in_dxf.py "<cale>/Timisoara ortofoto.dwg" date-sursa/ortoplan.dxf

Originalul nu e atins: se lucrează pe o copie lângă DXF-ul de ieșire.
"""
import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ACCORE_CANDIDATES = [
    r"C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe",
    r"C:\Program Files\Autodesk\AutoCAD 2026\accoreconsole.exe",
    r"C:\Program Files\Autodesk\AutoCAD 2025\accoreconsole.exe",
]


def find_accore(explicit: str | None) -> str:
    for c in ([explicit] if explicit else []) + ACCORE_CANDIDATES:
        if c and Path(c).exists():
            return c
    sys.exit("Nu găsesc accoreconsole.exe (dă calea cu --accore).")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dwg")
    ap.add_argument("dxf")
    ap.add_argument("--accore")
    a = ap.parse_args()

    dxf = Path(a.dxf).resolve()
    dxf.parent.mkdir(parents=True, exist_ok=True)
    copie = dxf.with_suffix(".dwg")
    # Python deschide fișierele cu partajare read/write, deci merge și cu DWG-ul deschis în AutoCAD.
    with open(a.dwg, "rb") as src, open(copie, "wb") as dst:
        shutil.copyfileobj(src, dst, 16 << 20)
    if dxf.exists():
        dxf.unlink()

    scr = dxf.with_suffix(".scr")
    scr.write_text(f"FILEDIA 0\n_.DXFOUT\n{dxf}\n16\n_.QUIT\n_Y\n", encoding="ascii")
    t = time.time()
    subprocess.run(
        [find_accore(a.accore), "/i", str(copie), "/s", str(scr), "/l", "en-US"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600, check=False,
        cwd=dxf.parent,  # AutoCAD își scrie ErrorReports/ în directorul curent
    )
    copie.unlink(missing_ok=True)
    if not dxf.exists():
        sys.exit("Exportul DXF a eșuat.")
    os.remove(scr)
    print(f"{dxf} ({dxf.stat().st_size / 1e6:.0f} MB) în {time.time() - t:.0f} s")


if __name__ == "__main__":
    main()
