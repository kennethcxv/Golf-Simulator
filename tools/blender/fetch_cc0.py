"""Fetch CC0 material families from ambientCG into ``asset_sources/textures/cc0_spike``.

Why this is a tool and not a one-off download. The texture pass is reproducible only if
the sources are: a builder that reads ``Wood051_1K-JPG_Color.jpg`` is worthless if nobody
can say where that file came from or fetch it again. This records the provenance in a
manifest next to the files, and re-running it is a no-op for anything already present.

ambientCG publishes everything under CC0 1.0 (public domain dedication), which is the
only licence class this project will take third-party texture data under — see
``Designs/ProShop/ART_BIBLE.md`` §7.4.

    python tools/blender/fetch_cc0.py Leather011 Fabric030 Plastic010 Rubber004 Foam001
    python tools/blender/fetch_cc0.py --list        # what is already local
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CC0_DIR = REPO / "asset_sources" / "textures" / "cc0_spike"
MANIFEST = CC0_DIR / "SOURCES.json"

API = "https://ambientcg.com/api/v2/full_json?id={id}&include=downloadData"

# The CDN serving the zips rejects a request with urllib's default agent (403), while
# the JSON API accepts it. Identify the tool rather than impersonating a browser.
_HEADERS = {"User-Agent": "Golf-Flipper-asset-pipeline/1.0 (+CC0 texture sourcing)"}


def _get(url: str, timeout: int) -> bytes:
    request = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(request, timeout=timeout) as fh:
        return fh.read()

# The three maps the builders consume. Colour is sRGB; the other two are data.
# Metalness is taken when present but is optional — most non-metal families omit it.
WANTED = ("Color", "NormalGL", "Roughness", "Metalness")


def _api(asset_id: str) -> dict:
    payload = json.loads(_get(API.format(id=asset_id), 60))
    found = payload.get("foundAssets") or []
    if not found:
        raise SystemExit(f"ambientCG has no asset {asset_id!r}")
    return found[0]


def _zip_url(asset: dict, variant: str = "1K-JPG") -> str:
    cats = (asset.get("downloadFolders", {}).get("default", {})
            .get("downloadFiletypeCategories", {}))
    for entry in cats.get("zip", {}).get("downloads", []):
        if entry.get("attribute") == variant:
            return entry["fullDownloadPath"]
    raise SystemExit(f"{asset['assetId']}: no {variant} zip")


def fetch(asset_id: str, *, variant: str = "1K-JPG", force: bool = False) -> dict:
    CC0_DIR.mkdir(parents=True, exist_ok=True)
    existing = sorted(p.name for p in CC0_DIR.glob(f"{asset_id}_{variant}_*.jpg"))
    if existing and not force:
        return {"assetId": asset_id, "variant": variant, "files": existing, "skipped": True}

    asset = _api(asset_id)
    url = _zip_url(asset, variant)
    blob = _get(url, 300)

    written = []
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for name in zf.namelist():
            stem = Path(name).stem              # e.g. Leather011_1K-JPG_Color
            suffix = stem.rsplit("_", 1)[-1]
            if suffix not in WANTED or not name.lower().endswith((".jpg", ".jpeg")):
                continue
            out = CC0_DIR / f"{asset_id}_{variant}_{suffix}.jpg"
            out.write_bytes(zf.read(name))
            written.append(out.name)

    if not any(n.endswith("_Color.jpg") for n in written):
        raise SystemExit(f"{asset_id}: zip carried no Color map — {sorted(written)}")

    return {
        "assetId": asset_id,
        "displayName": asset.get("displayName"),
        "category": asset.get("displayCategory"),
        "variant": variant,
        "licence": "CC0 1.0 Universal (ambientCG)",
        "sourceUrl": f"https://ambientcg.com/view?id={asset_id}",
        "downloadUrl": url,
        "files": sorted(written),
        "skipped": False,
    }


def _load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {"licence": "All entries are CC0 1.0 from ambientCG.", "families": {}}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ids", nargs="*", help="ambientCG asset ids, e.g. Leather011")
    ap.add_argument("--variant", default="1K-JPG")
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    ap.add_argument("--list", action="store_true", help="print the local families and exit")
    args = ap.parse_args(argv)

    manifest = _load_manifest()

    if args.list or not args.ids:
        families: dict[str, list[str]] = {}
        for path in sorted(CC0_DIR.glob("*.jpg")):
            families.setdefault(path.name.split("_")[0], []).append(
                path.name.rsplit("_", 1)[-1].removesuffix(".jpg")
            )
        for fam, maps in families.items():
            recorded = "recorded" if fam in manifest["families"] else "NO PROVENANCE"
            print(f"{fam:14s} {sorted(maps)}  [{recorded}]")
        return 0

    for asset_id in args.ids:
        result = fetch(asset_id, variant=args.variant, force=args.force)
        state = "already local" if result.pop("skipped") else "downloaded"
        if state == "downloaded":
            manifest["families"][asset_id] = result
        print(f"{asset_id:14s} {state}: {result['files']}")

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
