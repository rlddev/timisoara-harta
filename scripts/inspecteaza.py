"""Pentru fiecare DXF: straturile care par limite de UAT / intravilan / sectoare, cu numărul de
contururi și aria celui mai mare, plus numele localităților (DEN_INTRAVILANE). Ajută la completarea
scripts/uaturi.json.

    python scripts/inspecteaza.py date-sursa/uat/*.dxf
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from dxf_lib import citeste_dxf, poligon  # noqa: E402

RE = re.compile(r"(?i)limit|contur_uat|intravilan|sector|imobile|constructii")

sys.stdout.reconfigure(encoding="utf-8")
for f in sys.argv[1:]:
    pl, tx = citeste_dxf(Path(f))
    st = defaultdict(list)
    for lay, pts, _ in pl:
        if lay and RE.search(lay):
            st[lay].append(pts)
    print(f"\n=== {Path(f).name}: {len(pl)} polilinii, {len(tx)} texte")
    for lay, lst in sorted(st.items()):
        if re.search(r"(?i)imobile|constructii|sector", lay):
            print(f"   {lay:70s} {len(lst):6d}")
            continue
        arii = sorted((p.area for p in (poligon(x, 100) for x in lst) if p), reverse=True)
        print(f"   {lay:70s} {len(lst):6d}  arii km²: {[round(a / 1e6, 2) for a in arii[:4]]}")
    den = sorted({s for lay, s, x, y in tx if lay and "DEN_INTRAVILANE" in lay and s})
    print("   localități:", ", ".join(den)[:300])
