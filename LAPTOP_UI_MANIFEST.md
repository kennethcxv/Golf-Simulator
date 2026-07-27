# GOLF SIMULATOR — Laptop UI Reference Manifest & Implementation Audit

*2026-07-16 · branch `tcg-checkout` · references: `Designs/RefrenceImages/LaptopUI/`*

## 1. Reference inventory

The folder contains **one** image — `ChatGPT Image Jul 16, 2026, 07_01_17 PM.png` — a 10-panel
contact sheet of the management software. It is authoritative for visual direction. Panel by
panel:

| # | Panel | Visible header | Content shown | Interactions implied |
|---|-------|----------------|---------------|----------------------|
| 1 | Dashboard (Overview) | PRIME FAIRWAYS / Dashboard / date-time | Daily Overview card (revenue today, transactions, new members, rounds played, shop sales) · Course Condition photo card, 82% + zone bars (fairways/greens/tees/rough/bunkers) · Low Inventory Alerts (4 lines, amber "Low (n)") · Upcoming Events (3 dated rows) | sidebar nav; cards link out |
| 2 | Finances | Finances + tabs Overview/Transactions/P&L/Budgeting/Sales Tax | 4 summary cards (total revenue/expenses/net/shop sales w/ deltas) · Revenue Trend line chart · Revenue Breakdown donut (green fees 62%, shop 25%, memberships 8%, other 5%) · Recent Transactions table (date/description/category/amount) + View All | tabs, chart, table |
| 3 | Shop Management | Shop Management + tabs Overview/Products/Categories/Orders | Today's sales/items sold/average sale cards · Top Selling Items ranked list · Sales Trend week line chart · Low Stock Items product cards + View All Products | tabs, product cards |
| 4 | Inventory | Inventory | Total items/low stock/out of stock/total value cards · item table (item/category/stock/status/value; amber Low, green In Stock) · Filter By Category panel w/ dropdown + category list · Export Inventory button | filter panel, table |
| 5 | Staff | Staff + tabs Staff Management/Schedule/Payroll/Roles | total/on duty/off duty/open shifts cards · staff table (name/position/status/schedule) · Add New Staff button | tabs, table, add |
| 6 | Facilities | Facilities | Facilities Overview condition bars (clubhouse/pro shop/parking/restrooms/shed/range/cart barn) · Maintenance Alerts ("Needs Repair") · Upcoming Maintenance dated rows | alert links |
| 7 | Course Management | Course Management + tabs Course Overview/Conditions/Irrigation/Maintenance/Settings | routed course map · Overall Condition 82% + zone bars · Course Condition Map button | tabs, map |
| 8 | Marketing | Marketing + tabs Overview/Campaigns/Promotions/Members/Social Media | Active Campaigns w/ end dates · Membership Overview totals + deltas · Recent Activity rows | tabs |
| 9 | Reports | Reports | Reports Center: 6 report cards (sales/inventory/financial/staff/course/customer) + Custom Report Builder | card grid |
| 10 | Settings | Settings + tabs General/System/Users/Backup | club name (editable), currency, timezone, date/time format, measurement, language · Save Changes | form controls |

**Global style read from the reference:** deep pine-green glass; dark green-charcoal panels with
hairline edges; warm cream primary text; sage secondary; **muted brass/gold for headline values,
selected states and the brand**; light-green chart lines; amber/green/red status chips that also
carry words; left sidebar with icon+label rows and a highlighted current page; date-time top
right; generous card grids.

**Branding rule applied:** every occurrence of *PRIME FAIRWAYS* in the reference is rendered as
**GOLF SIMULATOR** in the implementation (per the build brief). The in-world club identity is the
save's own `clubName` (default "Willow Creek Golf Club"; the physical club props read
"Pinehollow") — the software brand and the club name are deliberately different things.

## 2. Implementation audit — before → after

The laptop already existed ("Fairway Office", 16 pages, DOM projected onto the physical screen
via `matrix3d`, all pages sim-fed). The audit below is what this pass changed.

| Area | Before | After |
|------|--------|-------|
| Brand | "Fairway Office" everywhere (boot, lock screen, sidebar, prop label) | **GOLF SIMULATOR** everywhere; brass wordmark |
| Theme | cream content panels, blue-charcoal sidebar | reference dark-pine + brass theme, tokenized (`--lt-*`); validated chart palette |
| Sidebar | 16 flat entries, 4 groups | 24 entries in 5 groups (Operations/Pro Shop/Management/Course/System), unread badge on Notifications |
| Dashboard | stat strip + 3 cards + tiles | reference layout: 8 KPI cards, Today/Condition/Low-stock cards, revenue-vs-expense chart w/ working timeframes, reviews+events cards, 6 quick actions |
| Finances | window tabs + category tables | + revenue/expense line chart, revenue-mix donut, **real per-event transaction feed** (new ledger `txLog`, written at the `addRevenue/addExpense/unbill` chokepoint, w/ running balance), search + kind filters + pagination |
| Inventory | fixed table | search, category dropdown, 6 status filters, 9 sortable columns, pagination, per-row Order action |
| Suppliers | category tabs | + catalog search (name + supplier) |
| Orders | list + cancel | + Reorder (refills basket with the shipment's line/qty) |
| Tee Times | day picker + book/cancel | + Sheet/List/Week views, search, 7 status filters, deposit/balance shown, manual no-show (settles once, deposit first) |
| Reviews | factor bars + last 8 | + full on-file archive w/ search, 7 filters, cited-factor chips that jump to the owning desk, "Fix it" buttons on weak factors |
| Reports (was Analytics) | sparkline + movers | timeframe tabs, day-by-day chart, revenue/expense by line, sortable product table, review trend, sellouts/dead stock |
| Customers | — (didn't exist) | **new**: visitor directory (visits, purchases, check-ins, no-shows, lifetime spend), filters/sort/search, profile view w/ their reservations |
| Memberships | — | **new**: 3 real tiers w/ member counts, dues sliders vs `fairDues`, sortable member roll, dues revenue, joins/quits feed |
| Maintenance | — | **new**: crew hours + morning report (done/skipped/cost), editable standing orders (mow height/interval, irrigation, fertilizer, schedule, pattern), problem-section list w/ Treat/Aerate (real `treatSection`/`aerateSection`), tractor + turf-equipment status |
| Marketing | — | **new**: reputation/demand/rating/member KPIs, `explainVisitors` narrative, demand-driver rows linking to the owning desks, club feed. States plainly that paid ad campaigns are not simulated (no fake campaign buttons) |
| Upgrades | — (was buried in panels) | **new**: all 8 progression upgrades (prestige-gated, exactly-once `purchaseUpgrade`) + 3 amenities (`upgradeAmenity`) with confirms and insufficient-funds handling |
| Events | — | **new**: tournament scheduling (real gates via `canScheduleTournament`), staged-event countdown, corporate outing offers accept/decline, booked outings, past results |
| Notifications | — | **new sim system** (`src/sim/notifications.js`): persisted, deduped, bounded feed written by deliveries/blocked vans/sellouts/reviews/rent/overdraft/tournaments/outings/hole construction; page w/ filters, mark read/all, dismiss, jump-to-page; bell + badge in status bar |
| Settings | name/scale/checkout | + persisted office prefs (`state.uiPrefs`): interface scale, default Finances window, default tee-sheet view |
| Help | — | **new**: live tutorial arc (chapter list w/ current step) + desk manual |
| Course | zone table + hole status | + par/yardage per hole, pin A/B/C selection, Rest-1-day closure (real renovation downtime, auto-reopens), **Open the works desk** → the real course editor (`enterEditor`) |
| Physical machine | E-to-open, lid/boot/live, seat pose | + click-to-open (crosshair on laptop only), rubber feet + charge port on the model, boot/lock screens rebranded, 'live' backing repainted deep pine |

## 3. Deliberate divergences from the written brief (all honesty-driven)

- **Marketing campaigns, staff shift scheduling, per-staff clock-in/out, facilities registry,
  currency/timezone settings, CSV export, custom report builder** — the sim does not model
  these. Following the repo's standing rule (a page must never show a control the sim can't
  honor), the pages either omit them or say so in place, rather than shipping decorative
  buttons. The reference's Staff "Schedule/Payroll/Roles" tabs collapse into the real
  Employees page (hire/train/fire/wages — all real).
- **Money** stays in the repo's convention: dollars as floats rounded to cents at every ledger
  mutation (`r2`), integer cents inside the physical register. Rebuilding the whole sim on
  integer cents was judged a regression risk against every protected system.
- **Check-in stays physical** at the front desk; the laptop manages the sheet (per brief §2).
- Open/exit interaction: E **and** mouse click both open the laptop; Esc or "Close the lid"
  exit. E is the game's established interact verb everywhere else.

## 4. Where things live

- Theme: `src/styles.css` (§GOLF SIMULATOR block, `--lt-*` tokens)
- Shell + 24 pages: `src/ui/laptop.js`
- Charts/tables kit: `src/ui/laptopWidgets.js` (palette validated with the dataviz checks)
- Notifications sim: `src/sim/notifications.js` (+ emitters in deliveries/shop/reviews/property/
  progression/club/terrainEdit)
- Transaction log: `src/sim/economy.js` (`txLog`, healed in `state.js#healLedger`)
- Persistence: `state.js` — `notifications` + `uiPrefs` in snapshot/deserialize
- Physical machine: `src/render3d/clubhouse.js` (§THE LAPTOP), `src/core/laptopRig.js`,
  `src/core/laptopProjection.js`, seat/click wiring in `src/main.js`
- Tests: `tests/laptop-pages.test.js`, `tests/laptop-widgets.test.js`,
  `tests/notifications.test.js`, `tests/economy-txlog.test.js` (+ the pre-existing laptop suites)
