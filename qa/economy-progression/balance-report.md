# Economy progression balance report

Deterministic 24-day accelerated run across 8 required scenarios and 5 matched seed replicates each. Full inputs and category results are in `simulated-scenarios.json`.

| Scenario | Net profit | Cash change | Customers | Missed | Condition | Value change | Net sale |
|---|---:|---:|---:|---:|---:|---:|---:|
| Poor operation | $1,078 | $988 | 33.8 | 106.4 | 13.58 | $-9,700 | $25,862 |
| Average operation | $21,538 | $21,667 | 572.4 | 104.2 | 28.06 | $21,400 | $71,314 |
| Skilled operation | $45,977 | $46,297 | 1137 | 46.2 | 80.74 | $67,300 | $135,100 |
| High-price strategy | $9,670 | $9,602 | 140.8 | 63.6 | 36.38 | $-1,100 | $49,408 |
| Low-price strategy | $9,287 | $9,876 | 1145.2 | 43.4 | 28.16 | $6,300 | $56,356 |
| Understocked store | $19,980 | $19,882 | 389.6 | 317.4 | 26.04 | $18,900 | $69,094 |
| Neglected course | $12,032 | $12,243 | 515 | 23.8 | 54.1 | $10,100 | $48,540 |
| Fully restored property | $46,039 | $46,359 | 1137 | 46.2 | 82.94 | $67,300 | $141,373 |

## Checks

- Maximum prices do not always win: **PASS**.
- Minimum prices do not always win: **PASS**.
- Skilled operation beats average operation: **PASS**.
- Understocking reduces retail gross margin and increases missed sales: **PASS** ($0 vs $2,657 retail margin; 317 vs 104 missed).
- Understocked whole-business net trails average after matched-seed averaging: **PASS**.
- Course neglect underperforms skilled restoration: **PASS**.
- Poor tutorial operation avoids unrecoverable bankruptcy: **PASS** (minimum cash $54,500).
- Average operation avoids instant wealth inside one 24-day season: **PASS** ($21,538 profit vs $45,500 acquisition).
- A restored property makes selling a meaningful unlocked option: **PASS** ($141,373 net sale proceeds).
- Next tier cannot bypass its required sale: **PASS**.
- Cheapest upgrade pace: average 5.62 days; skilled 2.66 days at observed operating profit.

## Assumptions

- Every scenario buys the same Willow Creek property in Relaxed mode and runs the real daily empire update for 24 closed days across five deterministic seed replicates.
- Each strategy uses the same five-seed set, plus the real weather, customers, membership, turf, pricing, ledger, reputation, and valuation systems; tables report replicate means.
- Accelerated stocked scenarios collapse unpacking lead time: replenishment enters the real inventory and posts merchandise plus 4% delivery cash entries before shelves are refilled.
- Poor and understocked scenarios receive no replenishment. High/low strategies change every supported price control to its legal bound.
- Restored fixtures mutate the same grime, clutter, wash masks, turf arrays, equipment, decor placements, and maintenance policies that normal gameplay changes; they do not write condition or value directly.
- Upgrade attainability divides the cheapest $5,000 progression upgrade by observed accounting profit and excludes restoration capital from operating profit.
