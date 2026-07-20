# Inventory delivery Blender sources

These five `.blend` files and their exported GLBs are original, project-owned
Golf Flipper assets. They use no downloaded meshes, textures, fonts, generated
images, Tripo sources, or other third-party inputs.

Rebuild from the repository root with Blender 5.1 available on `PATH`:

```powershell
blender `
  --background --factory-startup `
  --python tools/blender/build_inventory_delivery_assets.py
```

The deterministic builder uses metre-scale dimensions, applies mesh rotation
and scale before export, preserves separate van-door pivots and interaction
sockets, creates simplified `COL_*` collision meshes for the larger props,
exports into `vendor/models/clubhouse/`, renders QA previews, and cleanly
reimports every GLB as its final validation step.

| Blender source | Runtime export |
| --- | --- |
| `delivery_worktable.blend` | `delivery_worktable.glb` |
| `delivery_stock_shelf.blend` | `delivery_stock_shelf.glb` |
| `delivery_box_cutter.blend` | `delivery_box_cutter.glb` |
| `delivery_recycling_station.blend` | `delivery_recycling_station.glb` |
| `delivery_van.blend` | `delivery_van.glb` |

The generated mesh/material counts and the explicit external-asset ledger are
recorded in `qa/inventory-delivery-loop/assets/inventory_delivery_asset_build.json`.
