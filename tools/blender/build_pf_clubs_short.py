"""Prime Fairways short clubs: 4 irons (R19), 4 NORVIK wedges (R20),
4 putters (R11/R21).  Standing orientation, origin at grip butt."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import proshop_lib as P
import pf_club_lib as C

IRONS = {
    "pf_iron_players_7": ("AERO FORGED", "players"),
    "pf_iron_cavity_7": ("VANTAGE", "cavity"),
    "pf_iron_gameimp_7": ("FORGE 4300", "gameimp"),
    "pf_iron_distance_7": ("ELEVATE MAX", "distance"),
}
WEDGES = {
    "pf_wedge_gap_50": ("NORVIK GAP", "cavity"),
    "pf_wedge_versa_54": ("NORVIK VERSA", "players"),
    "pf_wedge_sand_56": ("NORVIK SAND", "players"),
    "pf_wedge_lob_60": ("NORVIK LOB", "players"),
}
PUTTERS = {
    "pf_putter_blade": "blade",
    "pf_putter_wide_blade": "wide",
    "pf_putter_mallet_spider": "spider",
    "pf_putter_fang": "fang",
}

REG = {}
META = {}

for _aid, (_name, _kind) in IRONS.items():
    REG[_aid] = (lambda aa, nn, kk: (lambda M: C.club_asset(
        aa, M, length=0.94, category="clubs",
        head_fn=lambda a2, r2, M2: C.iron_head(a2, r2, M2, tip_z=0.94, kind=kk, name=nn),
        shaft="black")))(_aid, _name, _kind)
    META[_aid] = {"name": f"{_name.title()} 7-Iron", "variant": _kind, "price": 179.99,
                  "fixture": "pf_fixture_club_rack", "slot_type": "club_slot", "packaging": "none", "length_m": 0.94}

for _aid, (_name, _kind) in WEDGES.items():
    loft = _aid.rsplit("_", 1)[-1]
    REG[_aid] = (lambda aa, nn, kk: (lambda M: C.club_asset(
        aa, M, length=0.905, category="clubs",
        head_fn=lambda a2, r2, M2: C.iron_head(a2, r2, M2, tip_z=0.905, kind=kk, name=nn),
        shaft="steel")))(_aid, _name, _kind)
    META[_aid] = {"name": f"{_name.title()} {loft} Wedge", "variant": f"{_kind}_{loft}", "price": 139.99,
                  "fixture": "pf_fixture_club_rack", "slot_type": "club_slot", "packaging": "none", "length_m": 0.905}

for _aid, _kind in PUTTERS.items():
    REG[_aid] = (lambda aa, kk: (lambda M: C.club_asset(
        aa, M, length=0.87, category="clubs",
        head_fn=lambda a2, r2, M2: C.putter_head(a2, r2, M2, tip_z=0.87, kind=kk),
        shaft="steel" if kk != "spider" else "black")))(_aid, _kind)
    META[_aid] = {"name": f"Elevate {_kind.title()} Putter", "variant": _kind, "price": 249.99,
                  "fixture": "pf_fixture_club_rack", "slot_type": "club_slot", "packaging": "none", "length_m": 0.87}

P.run_batch(REG, kind="products", category_of=lambda a: "clubs", manifest_extra=lambda a: META.get(a))
