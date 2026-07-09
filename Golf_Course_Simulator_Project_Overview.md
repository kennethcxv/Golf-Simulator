# FAIRWAY STATE (working title)
## Golf Course Management Simulator — Complete Project Overview (v2)

> SUPERSEDING NOTE: This is the complete, authoritative spec for FAIRWAY STATE as it
> stands now — a golf course management sim with a hybrid presentation: top-down/2.5D for
> the course, walkable first-person for the pro shop. This replaces any earlier
> full-3D/Unity direction for this project. The tech stack, QA approach, and architecture
> patterns mirror the GLASSWATER project's proven approach: vanilla JavaScript/HTML5
> Canvas, Electron shell, Three.js used only for the specific walkable scene, Chrome
> DevTools MCP and Playwright MCP for self-QA throughout. See `BUILD_BRIEF.md` for the
> build directive.

### Honest Framing Before Anything Else

$2-4M lifetime revenue is the rare, major-hit outcome in this genre — comparable to a breakout
Wobbledogs or Terra Nil, not what a merely well-made game achieves. The closest direct comp,
GolfTopia, is Very Positive at 95% and built by a solo developer, but that tier of review score
alone typically lands well below multi-millions without genuine breadth, sustained content, and
real marketing reach behind it. This document aims fully at that ceiling, but hitting it depends on
execution, timing, and marketing reach as much as anything written here.

---

## The Pitch

Design, build, and run a real, living golf club — sculpt and reshape the course itself, nurture
genuine turf instead of a static tile, and step inside your own pro shop to stock shelves and greet
the members who walk through the door. The spiritual successor to Sid Meier's SimGolf: a grounded,
realistic management sim for the course, with a warm, walkable retail heart at its center.

## Player Fantasy

You're a golf course owner-operator — architect, greenkeeper, and retail proprietor all at once.
The course view is where you think like a business owner and a groundskeeper; the pro shop is
where you're on the floor, running the part of the business that's actually face-to-face. Both
halves draw on real golf-business operating knowledge, not just fandom.

## What Makes This Different

- **GolfTopia proved the core hook — 200 persistent golfers with 100+ distinct opinions about your
  course — is genuinely beloved (95% positive)**, wrapped in a stylized, futuristic presentation.
  This keeps the hook, grounds it in real turf science, and gives it a genuinely different
  presentation split (see below).
- **A real, expressed gap exists** for a more grounded, realistic alternative to that stylized
  approach.
- **Nobody in this genre has real membership or retail depth.** Every comp treats golfer happiness
  as one abstract meter and has no meaningful pro shop system at all. This game has both, built
  from genuine golf-business operator knowledge.
- **Resort Boss: Golf (35% Mostly Negative)** is the genre's clearest cautionary tale — promising
  depth that doesn't hold together. Every system here is built to actually connect to the others.

## Presentation & Technical Approach

This is a deliberate hybrid, not a single camera style, because the two halves of the game are
proven by different things:

- **The course itself: top-down / 2.5D management view.** This matches both proven successes in
  this exact genre (GolfTopia and Under Par Golf Architect are both top-down) — this is what's
  actually validated for course design and turf management, not a style choice.
- **The pro shop: a walkable, first-person interior.** This is where a TCG Card Shop Simulator-style
  approach genuinely fits — it's a small, bounded retail space, much closer to what that game
  actually is than a golf course is. Walk the floor, stock shelves, arrange displays, and interact
  with members and guests who come in.
- Built in vanilla JavaScript/HTML5 Canvas for the course and management views, with Three.js used
  specifically for the walkable pro shop interior — the same hybrid approach already proven out on
  the aquarium project, reusing the same Electron shell and the same Chrome DevTools/Playwright MCP
  QA workflow.

## Core Gameplay Loop

1. **Design and reshape the course** — lay out or redesign tees, fairways, greens, bunkers, and
   hazards using real terrain-editing tools in the top-down view. "Changing the course" is a
   continuous activity, not a one-time setup step — renovate holes as the business grows.
2. **Maintain** — the turf simulation, tracked per zone.
3. **Run the club** — membership tiers, staffing, pricing.
4. **Run the pro shop** — walk the floor, stock and price inventory, greet members and guests,
   handle rentals and fittings.
5. **Watch golfers develop real opinions** over repeat visits, tied to actual course condition and
   actual shop/service experience.
6. **Grow** — reputation, prestige, new amenities, eventually hosting tournaments.

---

## Systems Depth

### 1. Turf & Course Simulation

- Per-zone grass health: green speed, fairway density, rough overgrowth — tracked independently
  per section, not one course-wide number.
- Mowing (frequency, height, pattern), irrigation (coverage, drought vs. overwatering risk),
  fertilization, and diagnosable turf disease (dollar spot, brown patch).
- Weather and seasons feeding directly into turf state and golfer satisfaction.
- Course condition measurably affects play quality, not just appearance.
- Legible by default: one status per zone (Healthy/Stressed/Declining), detail available on
  demand — never every raw variable dumped on screen at once.

### 2. Course Editing ("Changing the Course")

- Full terrain-sculpting tools available at any point, not just at setup — raise/lower terrain,
  reshape fairways and greens, add or remove bunkers and water hazards, replant rough.
- Renovation projects have real cost, real downtime (a hole under renovation is unplayable and
  affects reputation temporarily), and real payoff in course rating once complete — redesigning the
  course should feel like a genuine business investment, not a free undo button.

### 3. Membership & Hospitality System

- Tiered membership (3-4 tiers) with distinct pricing, privileges, and guest policy.
- Guest passes, corporate outings, reciprocal-club arrangements.
- Amenities (restaurant, practice facility, instruction) as real investments with their own
  satisfaction contribution.
- Staff (groundskeepers, instructors, food & beverage) with skill progression.
- Dynamic pricing responding to club reputation and condition.

### 4. Pro Shop Retail System (new, and the home of the walkable presentation)

- **Inventory**: clubs (drivers, irons, putters, wedges), balls, apparel, accessories, and rental
  equipment — ordered from suppliers, with real restocking cadence and seasonal inventory shifts
  (new equipment releases, holiday gear).
- **The walkable shop floor**: arrange shelves and displays, walk up to restock, interact with
  members and guests who enter — the TCG-style interaction model, scoped to this one room.
- **Club fitting and rentals**: a natural tie-in with golfer satisfaction and skill — a well-fitted
  member plays better and is happier, tying the shop directly into the persistent-golfer system
  rather than sitting apart from it.
- **Staffing the shop floor and register**, with the same skill-progression approach as course
  staff.
- **Pricing strategy** for retail goods, distinct from green fees and membership pricing.

### 5. Persistent Golfer System

- Named, recurring golfers who remember their history at your club — course visits AND pro shop
  interactions both feed into their opinions.
- 100+ distinct thoughts tied to specific, checkable conditions (course state, shop experience,
  staff interactions, pricing) — never generic, disconnected flavor text.
- Golfers evolve in skill, become prestigious members if well cared for, or leave permanently if
  neglected, with a visible reputation consequence.

### 6. Progression

- Start with a small, underfunded fixer-upper course and a bare-bones shop, not a blank sandbox.
- Research/unlock tree: turf equipment, amenities, membership tiers, shop inventory tiers,
  tournament-hosting rights.
- Prestige rating gating what tier of golfer, event, and sponsorship the club can attract.
- Endgame: hosting a genuinely major tournament.

### 7. Difficulty / Tone Toggle

Relaxed Mode (forgiving tolerances, softer financial pressure) alongside Realistic Mode (real
stakes on turf, margins, and shop economics) — the same split proven across every successful comp
checked this session.

---

## First Release Scope (v1)

**Must ship:** one course (9-18 holes) with full turf simulation and editing tools; the complete
membership/hospitality system; the full pro shop with the walkable interior and inventory system;
the persistent golfer system spanning both course and shop; progression from fixer-upper to
respected local club; Relaxed/Realistic toggle; save/load; core sound design; a tutorial arc woven
into the opening hours.

**Deferred to post-launch:** multiple course themes/climates, tournament broadcast systems,
course-sharing/Workshop support, multiplayer.

---

## Post-Launch Roadmap

1. New course themes and climates (links/coastal, desert, mountain) — each a distinct management
   puzzle, not a reskin.
2. Tournament hosting expansion: spectators, sponsorships, broadcast/replay, prestige events.
3. Course-sharing / Workshop support for player-designed layouts.
4. Deepened membership and retail systems: junior programs, premium/boutique shop lines, corporate
   partnerships.
5. Cadence: a major content drop roughly every 3-4 months for the first 18-24 months post-launch.

## Marketing & Positioning

- Golf carries a large, well-monied, passionate real-world audience with an active
  course-architecture content community — a direct parallel to the creator-outreach angle that
  worked for the aquarium concept.
- Position directly against GolfTopia's stylized approach: the grounded, realistic golf management
  game players have been asking for.
- Standard wishlist discipline: Coming Soon page 6-12 months out, a genuine Next Fest demo once
  there's a real wishlist base, frequent honest devlogs — particularly valuable here given Resort
  Boss: Golf's apparent struggle to deliver on its promises.
- Worth a publisher conversation once a genuinely polished vertical slice exists.

## Business Model

- Launch price around $17.99-$22.99, in line with genre norms for a scoped, focused v1.
- Paid expansion cadence for course themes ($6.99-$12.99 each); free major updates otherwise.
- Cosmetic-only monetization beyond that (clubhouse décor, shop interior themes) — never anything
  touching turf simulation, membership balance, or shop economics directly.

## Quality Bar

- Distinct sound design per surface, activity, and space — mower types, sprinkler patterns, ball
  strikes on different lies, the specific ambient feel of walking the shop floor versus standing on
  the course.
- Trailer and key art produced to a genuinely premium bar.
- Real external human playtesting, specifically including actual golf enthusiasts among testers.
- Full accessibility (colorblind-safe turf and inventory indicators, remappable controls, subtitle/
  text scaling) and localization for at least Simplified Chinese, German, Spanish, Japanese, and
  Korean.

---

## The Honest Summary

Every system here answers something specific found in real research: GolfTopia's proven-but-
stylized hook, the expressed desire for a grounded alternative, Resort Boss: Golf's cautionary
example, and — as the genuine differentiator — real golf-business operator knowledge applied to
both the course and, now, the pro shop that no existing comp in this genre has. The presentation
split (top-down course, walkable shop) is built from what's actually proven in each of those two
spaces, not a single stylistic choice imposed on both. Whether it lands at the $2-4M tier still
depends on execution, sustained post-launch support, and marketing reach — but the design is now
aimed as precisely as this research can aim it.
