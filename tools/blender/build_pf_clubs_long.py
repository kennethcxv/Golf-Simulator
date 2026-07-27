"""Prime Fairways long clubs: 4 drivers (R10/R18), 4 fairway woods (R22),
4 hybrids (R23).  Standing orientation, origin at grip butt."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import proshop_lib as P
import pf_club_lib as C

DRIVERS = {
    "pf_driver_aero_max": ("AERO MAX", "x", True),
    "pf_driver_forge_tour": ("FORGE TOUR", "v", True),
    "pf_driver_vantage_pro": ("VANTAGE PRO", "y", False),
    "pf_driver_elevate_lite": ("ELEVATE LITE", "wing", False),
}
WOODS = {
    "pf_wood_aero_max_3": ("AERO MAX 3", "x", 1.09),
    "pf_wood_forge_pro_5": ("FORGE PRO 5", "v", 1.07),
    "pf_wood_vantage_xlt_7": ("VANTAGE XLT 7", "y", 1.05),
    "pf_wood_elevate_tour_3": ("ELEVATE TOUR", "wing", 1.09),
}
HYBRIDS = {
    "pf_hybrid_aero_2h": ("AERO 2H", "x", 1.04),
    "pf_hybrid_vantage_3h": ("VANTAGE 3H", "y", 1.03),
    "pf_hybrid_forge_4h": ("FORGE 4H", "v", 1.015),
    "pf_hybrid_elevate_5h": ("ELEVATE 5H", "wing", 1.0),
}

REG = {}
META = {}

for _aid, (_name, _style, _carbon) in DRIVERS.items():
    REG[_aid] = (lambda aa, nn, ss, cc: (lambda M: C.club_asset(
        aa, M, length=1.145, category="clubs",
        head_fn=lambda a2, r2, M2: C.wood_head(a2, r2, M2, tip_z=1.145, size=1.0, style=ss, name=nn, carbon=cc),
        shaft="graphite")))(_aid, _name, _style, _carbon)
    META[_aid] = {"name": f"{_name.title()} Driver", "variant": _style, "price": 549.99,
                  "fixture": "pf_fixture_club_rack", "slot_type": "club_slot", "packaging": "none", "length_m": 1.145}

for _aid, (_name, _style, _len) in WOODS.items():
    REG[_aid] = (lambda aa, nn, ss, ll: (lambda M: C.club_asset(
        aa, M, length=ll, category="clubs",
        head_fn=lambda a2, r2, M2: C.wood_head(a2, r2, M2, tip_z=ll, size=0.78, style=ss, name=nn),
        shaft="graphite")))(_aid, _name, _style, _len)
    META[_aid] = {"name": f"{_name.title()} Fairway", "variant": _style, "price": 329.99,
                  "fixture": "pf_fixture_club_rack", "slot_type": "club_slot", "packaging": "none", "length_m": _len}

for _aid, (_name, _style, _len) in HYBRIDS.items():
    REG[_aid] = (lambda aa, nn, ss, ll: (lambda M: C.club_asset(
        aa, M, length=ll, category="clubs",
        head_fn=lambda a2, r2, M2: C.wood_head(a2, r2, M2, tip_z=ll, size=0.62, style=ss, name=nn),
        shaft="black")))(_aid, _name, _style, _len)
    META[_aid] = {"name": f"{_name.title()} Hybrid", "variant": _style, "price": 279.99,
                  "fixture": "pf_fixture_club_rack", "slot_type": "club_slot", "packaging": "none", "length_m": _len}

P.run_batch(REG, kind="products", category_of=lambda a: "clubs", manifest_extra=lambda a: META.get(a))
