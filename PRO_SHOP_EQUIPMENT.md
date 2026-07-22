# Pro-Shop Equipment Program

Branch: `feature/pro-shop-equipment`

## Visual source

The three owner-supplied images under `Designs/ClubHouse` are the design source. They establish:

- five readable quality steps: Basic, Standard, Premium, High-End, Luxury;
- municipal equipment built from painted steel, simple plastics, and exposed hardware;
- middle tiers adding powder coating, better ergonomics, storage, and natural oak;
- high-end tiers adding warm charcoal, medium walnut, integrated systems, and cleaner silhouettes;
- luxury country-club tiers adding crafted cabinetry, warm cream panels, restrained brass, lighting, and concierge-scale capacity.

The images are references only. No image pixels, third-party meshes, brands, or proprietary designs are included in the assets.

## Authoring contract

`src/data/proShopEquipment.js` is the player-facing catalog. It contains all 24 requested families and all five tiers (120 asset identities), real-world target dimensions, progression descriptions, prices, unlock requirements, source paths, runtime GLB paths, and licensing.

Editable Blender sources live in `asset_sources/blender/pro_shop_equipment/`. Runtime exports live in `vendor/models/pro_shop_equipment/`. Every GLB uses metres, faces `-Y`, has applied scale/rotation, tier metadata, named moving components, interaction anchors where relevant, and separately named simplified collision proxies.

All work is original, deterministic repository-authored geometry. No external assets are used.
