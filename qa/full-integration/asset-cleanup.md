# Asset cleanup

- No third-party or generated external assets were downloaded during integration.
- Raw Tripo/source assets were not overwritten.
- Authored GLB packages remain in the existing asset pipeline; runtime model stems, package dimensions, rotations, catalog lookups, and delivery validation were reconciled together.
- Furniture, display, equipment, municipal, property, vehicle, and checkout assets keep their source-branch ancestry through normal merge commits.
- Duplicate runtime ownership was removed at the fixture/layout level rather than by deleting source art: stable fixture IDs and stored ownership decide which visual is active.
- Checkout's final card and cash routes hash-guarded production files and reported an unchanged build snapshot.
- Clean install, `npm pack --dry-run`, Electron smoke, browser asset barriers, request-failure checks, and production browser routes were run as packaging/runtime gates.

`npm pack --dry-run` succeeds but reveals an unacceptable distribution footprint: 1.9 GB compressed, 2.0 GB unpacked, and 4,048 files. Nothing was deleted merely to improve that number; package allowlisting/compression is a separate release task recorded in `known-limitations.md`.

No branch or source asset directory was deleted. Generated screenshots, videos, TAP logs, and JSON evidence remain under ignored `qa/` paths and are not production payload.
