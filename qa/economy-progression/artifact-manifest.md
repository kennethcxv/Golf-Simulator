# QA artifact manifest

## Required structured evidence

- `evidence/ledger.json` - authoritative entries and schema fields
- `evidence/daily-summary.json` - reconciled daily and weekly business summaries
- `evidence/reputation.json` - category ratings and stored outcome reasons
- `evidence/pricing.json` - price response bands and consequences
- `evidence/upgrades.json` - requirements, costs, visible/gameplay/value effects, and save state
- `evidence/condition.json` - all 13 live condition categories and source IDs
- `evidence/valuation-breakdown.json` - stable valuation contributions and exact reconciliation
- `evidence/appraisal.json` - persisted appraisal and net-offer fields
- `evidence/sale-flow.json` - sale backup, exact proceeds, and progression result
- `evidence/next-property-framework.json` - all four data-driven tiers
- `evidence/anti-exploit.json` - invariant results
- `evidence/save-load.json` - persisted economy/progression state and replay protection
- `simulated-scenarios.json` - raw accelerated simulation results
- `balance-report.md` - documented assumptions and aggregate balance findings

## Browser evidence

- `baseline/` - pre-change screenshots, video, browser metrics, and 16-defect audit
- `iteration-1/` through `iteration-4/` - four retained inspection/revision loops
- `final-accepted/` - final screenshots of all 17 pages, long-page bottoms, fixed camera, video, and accepted visual audit
- `sale-browser/` - normal-control keep, offer, confirmation, sold-market screenshots, video, and machine-readable assertions
- `paired-base-1/`, `paired-final-1/`, `paired-base-2/`, and `paired-final-2/` - accepted, identical simultaneous performance pairs used by `performance-comparison.md`
- `final-performance/` - retained rejected sequential sample, documented with its shared-host contention

Each browser report records viewport, browser version, deterministic seed, fixed camera, normal input route, page audit, console messages, page errors, failed requests, metric sources, and retained video path.

## Reproduction tools

- `tools/qa/economy-balance.mjs`
- `tools/qa/economy-evidence.mjs`
- `tools/qa/economy-browser-qa.mjs`
- `tools/qa/economy-sale-browser-qa.mjs`
