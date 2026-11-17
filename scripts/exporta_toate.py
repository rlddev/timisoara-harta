"""Exportă în DXF toate ortoplanurile UAT dintr-un folder (fără copiile .bak, _recover, .tmp).

    python scripts/exporta_toate.py "<folder cu DWG-uri>" date-sursa/uat

Numele fișierului DXF = numele desenului fără „ortofoto”, cu cratime, fără diacritice
(ex. „Biled_Sandra ortofoto.dwg” → biled-sandra.dxf). Sare peste cele deja exportate.
"""
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path


def slug(nume: str) -> str:
    s = unicodedata.normalize("NFKD", nume).encode("ascii", "ignore").decode()
    s = re.sub(r"(?i)[ _]*ortofoto(_\d{4})?", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    dwg = sorted(p for p in src.glob("*.dwg") if not re.search(r"(?i)recover", p.name))
    t0 = time.time()
    for p in dwg:
        dxf = out / f"{slug(p.stem)}.dxf"
        if dxf.exists():
            print(f"exista {dxf.name}")
            continue
        r = subprocess.run([sys.executable, "-P", str(Path(__file__).with_name("dwg_in_dxf.py")), str(p), str(dxf)],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        print((r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr) else f"? {p.name}", flush=True)
    print(f"GATA în {time.time() - t0:.0f} s")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
