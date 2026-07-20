# Performance comparison

Fixed exterior player camera at 2:00 PM after a 5 s warm-up; three runs of 600 consecutive requestAnimationFrame intervals with 1.5 s between runs.

Paired baseline: `qa/player-experience-polish/performance/paired-baseline/idle-exterior.json`.

| Metric | Baseline | Final | Change | Result |
| --- | ---: | ---: | ---: | --- |
| Average FPS | 96.42 | 116.45 | 20.77% | Pass |
| 1% low FPS | 31.88 | 80.21 | 151.64% | Pass |
| Worst frame (ms) | 94.4 | 16.7 | -82.31% | Pass |
| JS heap final (bytes) | 81,094,046 | 91,701,912 | 13.08% | Pass |
| UI mutations / frame | 2.11 | 0.09 | -95.66% | Pass |
| Draw calls / frame | 3,769 | 3,781 | 0.32% | Pass |
| Rendered triangles / frame | 5,283,328 | 5,279,896 | -0.06% | Pass |
| Materials | 229 | 229 | 0% | Pass |
| Visible textures | 163 | 163 | 0% | Pass |
| Resident textures | 208 | 208 | 0% | Pass |
| Texture estimate (bytes) | 6,169,904,488 | 6,169,904,488 | 0% | Pass |

Listener balance: 89 → 89 (delta 0); Pass.

Overall: Pass — no meaningful regression.

Noise guardrails: 5% for steady render counts/FPS, 10% for 1% lows and UI mutations, 20% worst-frame, 25% final heap. Listener growth must be exactly zero within the final sample.
