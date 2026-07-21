# GOLF EMPIRE — Game Design & Commercial Bible

*Working title: GOLF EMPIRE (aka Golf Course Flipper)*
*Target: 1.0 Steam release · Solo dev (SWE) · Vanilla JS + Three.js + Electron*
*Commercial goal: $1,000,000 in gross Steam sales*

---

## 0. Read this first — the honest framing

$1,000,000 in gross sales is not a feature count. At a $19.99 price point, after Steam's 30% cut, regional pricing, and launch/seasonal discounts, $1M gross means roughly **60,000–80,000 units sold**. That is a *solid indie hit* — not a unicorn, but not a default outcome either. Games with more systems than this one have sold 2,000 copies and died.

Three things — and only these three — get you to $1M. Everything in this document serves one of them:

1. **One core loop that is fun in the first 90 seconds**, before the player has bought or built anything. (TCG Card Shop Simulator is fun before you own a single card. That is the bar.)
2. **A visible transformation that makes a thumbnail.** Dead, weed-choked 3-hole muni → lush 18-hole championship club. The before/after *is* your marketing. If a streamer can't screenshot the glow-up, you don't have a $1M game, you have a spreadsheet.
3. **Wishlists before launch.** The Steam algorithm rewards launch-day wishlist conversion. You need **~10,000 wishlists minimum**, ideally 20,000+, to trigger the visibility snowball. Wishlists are earned during development, not at launch. This starts *now*, not at 1.0.

The single largest risk to this project is not scope or tech. It is the two-item pattern in your own history: **abandoning before a stranger plays it, and adding systems instead of shipping the core.** This doc is deliberately disciplined to fight both.

---

## 1. The pitch

**One line:** *Take over a dying golf course and rebuild it into a championship club — book the tee times, run the register, mow the greens, and watch a muddy 3-hole muni become the best course in the state.*

**The fantasy:** You are the owner-operator who does everything, then slowly earns the right to do less as the empire grows. Hands-on to hands-off. Broke to prestigious. Weeds to fairways.

**Why it sells:** Golf is a massive, affluent, underserved audience in the management-sim space. The proven "shop-sim + restoration" loop (Card Shop Sim, House Flipper, PowerWash) has *never* been properly aimed at golf. GolfTopia proved appetite exists but stayed a niche city-builder; it never gave players the tactile owner-operator loop. You are stacking three validated loops onto an unclaimed, high-spending theme.

---

## 2. How it should FEEL — the emotional spec

This is the most important section. Features are downstream of feel. If a feature doesn't produce one of these feelings, cut it.

**Cozy competence.** The dominant emotion is *quiet mastery*. The player is busy but never panicked. A good session feels like a satisfying shift at a job you're weirdly good at — tee times booked, register rung, greens cut, everything humming. Think the flow state of restocking shelves in Card Shop Sim, not the stress of Overcooked.

**Tactile, physical satisfaction.** Every core action has weight and feedback. Scanning an item *clicks*. A freshly mowed green visibly changes color. Opening a supply box has a little reveal. Number goes up with a sound. The hands must feel busy.

**The glow-up dopamine.** The signature feeling. Standing on a patchy brown fairway, spending your morning's earnings, and watching it turn green. The before/after must be *dramatic and visible*. This is the feeling players screenshot and streamers thumbnail.

**Earned pride, not pressure.** Progression should feel like *your* club improving because of *your* taste and labor — not like beating a difficulty curve. The reviews (human-written-sounding, some petty and funny like real life) are the emotional payoff: real "people" noticing your work.

**Calm ambient world.** Birdsong, distant club-thwack, a breeze, the golf-cart hum. The audio bed does enormous work here. Silence would kill the coziness.

**What it must NOT feel like:** a spreadsheet with a skin; a punishing tycoon fail-state grind; a menu simulator where you never touch the world; a game where the "fun" is always 20 minutes away behind a grind wall.

---

## 3. The core loop (the non-negotiable spine)

This is v1's beating heart. Everything else is a satellite. The loop, minute to minute:

1. **Customers arrive** — some pre-booked online (they appear on your tee sheet), some walk up to the desk wanting a tee time.
2. **Work the desk** — check them in, book walk-ups a tee time, take payment (cash or card).
3. **Run the pro shop** — customers request items (balls, gloves, tees, drinks). Ring them up at the register.
4. **Restock** — order supply boxes, open them, stock the shelves.
5. **Maintain** — the course condition and clubhouse cleanliness decay with traffic. Mow, water, clean.
6. **Reputation responds** — condition + cleanliness + fair pricing → star rating → more (or fewer) customers tomorrow.
7. **Close the day** — tally revenue, pay bills before their deadline (mortgage, utilities, labor).
8. **Reinvest** — spend the day's profit on the transformation: new holes, a range, a bigger clubhouse, better greens.

**The test:** if steps 1–5 aren't fun *on day one with a 3-hole course and no upgrades*, the game is broken and no amount of content fixes it. **Prove this with a stranger before building anything in Section 5.**

---

## 4. Progression: the House Flipper backbone

The spine of long-term engagement is the **course transformation arc**, gated by cash and reputation.

- **Act 1 — The Muni (hours 0–3):** 3 dead holes, a shed-sized clubhouse, a card table for a "pro shop." Survival. Learn the loop. First glow-up: patch the worst fairway, unlock hole 4.
- **Act 2 — The Club (hours 3–12):** Expand to 9 holes. Add a real pro shop, a driving range, a snack counter. Hire your first staff (clerk, groundskeeper) and shift from doing-everything to managing. Redecorate the clubhouse. Reputation climbs from muni to "nice local course."
- **Act 3 — The Championship Course (hours 12–30+):** 18 holes. Course-design tools: reshape fairways, add water hazards, sculpt bunkers, move pins weekly to keep regulars engaged. Host events/tournaments. Prestige pricing. Become the best course in the state. This is the "endgame flex" — the fully transformed money shot.

Progression currency is always **cash + reputation**, and every purchase must produce a *visible* change in the world. No invisible stat upgrades. If the player can't see what $500 bought, don't sell it.

---

## 5. Full 1.0 feature set

Organized by system. Each system notes whether it's **CORE** (must be fun for the loop to work), **DEPTH** (extends session length), or **FLEX** (the transformation/marketing payoff). Ship CORE first, prove it, then layer.

### 5.1 Front desk & tee sheet — CORE
- Visual tee sheet: online reservations appear automatically; walk-ups queue at the desk.
- Book, check in, and take payment (cash-handling and card-swipe as distinct tactile actions).
- Patience timers: neglected customers leave and leave a bad review. Queue pressure scales with reputation.

### 5.2 Pro shop & register — CORE
- Customers request items; ring them up (scan → charge). Cash requires making change; card is faster but costs a processing fee. A real micro-decision.
- Inventory with stock levels; items sell out if not restocked.
- Supply boxes: order → delivery → open → shelve. The Card Shop Sim loop, exactly.
- Pricing control per item; overpricing tanks reputation, underpricing kills margin.

### 5.3 Course maintenance — CORE
- Mowing (greens, fairways, rough — each affects condition and pace of play).
- Watering (tied to the weather system — skip watering before a hot dry day and the course browns).
- Weekly pin placement: move the holes or regulars get bored (reputation decay for stale layouts).
- Bunker raking, cart-path upkeep, debris cleanup.

### 5.4 Clubhouse operations — CORE
- Cleanliness decays with foot traffic (more customers = more mess). Mop, empty bins.
- Cleanliness + course condition + price fairness → the reputation engine that drives demand.

### 5.5 Economy & bills — CORE
- Cash flow: revenue vs. mortgage, utilities, labor, supply costs.
- Bills have deadlines; the player chooses *when* to pay before the due date (cash-flow tension). Miss the deadline → penalties → bankruptcy fail-state.
- Daily close screen: satisfying tally, receipts, tomorrow's forecast.

### 5.6 Staff & automation — DEPTH
- Hire hourly labor: clerk (auto-serves register), groundskeeper (auto-maintains condition), cart attendant.
- The automation *is* the progression reward: you buy your way from doing everything to overseeing everything. Pace this carefully — automate too early and the game empties out.

### 5.7 Reviews & reputation — DEPTH (but high-value)
- Procedurally assembled, human-sounding reviews driven by the player's actual service that day. Some glowing, some petty, some cosmetic/funny ("great course, but the guy at the desk sneezed on my glove"). This is the emotional payoff and a huge *shareability* driver — funny reviews get screenshotted.
- Star rating, named regulars who return and remember their treatment.

### 5.8 Weather — DEPTH
- Forecast you can check and plan around. Rain closes play but waters the course free; heat browns unwatered greens; perfect days spike demand. Turns maintenance into planning, not chores.

### 5.9 Parking & facilities — DEPTH
- Expand and upgrade the parking lot (arrival capacity ceiling). Upgrade clubhouse size (queue capacity, slower mess). Concrete, visible spend.

### 5.10 Course design & customization — FLEX (the money shot)
- Reshape fairways, dig/place water hazards, sculpt bunkers, patch and re-turf, alter hole layouts.
- Redecorate the clubhouse interior: move shelves, re-lay the floor plan, furniture, signage.
- Players rate your design changes — taste has consequences.
- **This is your Steam-page hero and your streamer thumbnail.** It must ship in 1.0 even if shallow. The transformation is the product.

### 5.11 Driving range & expansion — FLEX
- Unlock a range (passive revenue + a new mini-loop: buckets, ball-picking).
- Expand 3 → 9 → 18 holes as the central prestige ladder.
- Late-game: host tournaments/events for reputation and cash spikes.

---

## 6. What is EXPLICITLY CUT from 1.0

Discipline is the whole game here. These are *good ideas* deferred on purpose. Cutting them is how you ship.

- Multiple courses / franchise mode → post-launch update (great "1.5" headline).
- Playable golf (swinging clubs yourself) → **hard no.** Different game, different genre, 10x the scope. You manage the course; you don't play the round.
- Multiplayer / co-op → post-launch at earliest, probably never.
- Deep staff management (schedules, morale, training trees) → keep staff shallow in 1.0.
- Story/campaign mode → the transformation *is* the story.
- Seasons/full calendar simulation beyond weather → later.

If you feel the urge to add a system not on the 1.0 list, that urge is the failure mode. Write it on the post-launch list and close the tab.

---

## 7. Art & audio direction

**Visual target:** clean, warm, readable stylized 3D — *not* photoreal. Photoreal is a budget trap and a performance risk in Three.js/Electron. Aim for the friendly, slightly-toy-like look of the Card Shop / House Flipper family: clear silhouettes, saturated turf greens, warm clubhouse wood, readable UI at a glance. Your Tripo-generated assets fit this lane; keep the style *consistent* over "detailed."

**The transformation must read at thumbnail size.** Brown/patchy → lush/green must be obvious in a 200px Steam capsule. Design the palette around that contrast from day one.

**Audio is not optional polish — it's core to the cozy feel.** Ambient bed: birdsong, breeze, distant ball-strike, cart hum, muffled clubhouse chatter. Punchy feedback SFX on every core action (scan click, cash register cha-ching, mower, box open, cash tally). A light, unobtrusive acoustic/lo-fi music layer. Budget real money here (Fiverr/Upwork/asset packs) — it's the highest ROI polish you can buy.

---

## 8. UX principles

- **Image-led, dense, compact.** Card layouts over text walls. Show the item, the customer, the course — don't describe them.
- **Conversational tone, not marketing-speak,** in all UI copy and reviews.
- **Every action has immediate, visible feedback.** No silent state changes.
- **Onboard through the loop, not a tutorial wall.** The 3-hole muni *is* the tutorial. First 90 seconds must teach by doing and be fun while doing it.
- **The fun is never gated behind a grind.** Reaching "hands-off management" should feel earned in an evening, not a month.

---

## 9. The $1M commercial plan (weighted equal to the game)

Building the game is half the job. This half is where most good indie games leave the money.

### 9.1 Price & units
- **$19.99** launch price. Cozy management sims support it; $14.99 leaves money on the table for this depth.
- $1M gross ≈ **~65,000–80,000 units** across launch + a year of discounts. Model it as: strong launch spike + long tail fed by 2–3 free content updates and every seasonal sale.

### 9.2 Wishlists are the whole ballgame
- Steam's launch visibility is driven by **wishlist-to-purchase conversion in the first 48 hours.** You need momentum *before* you launch.
- **Target: 10,000 wishlists minimum before 1.0; 20,000+ to be confident of $1M.**
- Steam page live **early** (during development) with a killer transformation trailer/GIF. Every wishlist compounds.

### 9.3 The marketing engine
- **The transformation is the content.** Before/after GIFs, timelapses of a course glow-up — this is native to TikTok/Reels/YouTube Shorts and to streamer thumbnails. Manufacture these moments *inside the game* so they're easy to capture.
- **Demo during a Steam Next Fest.** Non-negotiable. Next Fest is the single biggest wishlist accelerator available to an unknown indie. Time your development to hit one with a polished vertical slice.
- **Streamer/creator seeding:** cozy-game and sim YouTubers/streamers. The loop is inherently watchable; lean into it.
- **Devlog presence** (a short YouTube/TikTok devlog or a Twitter/Reddit build-in-public thread) to accumulate wishlists during dev. Your Georgia Tech + Uber SWE angle is a credible "solo dev builds a golf empire" narrative hook.

### 9.4 Post-launch tail
- 2–3 free content updates in year one (new course, franchise mode, seasonal events), each timed to a major Steam sale to re-trigger visibility. The tail is where the second half of the $1M is earned.

---

## 10. Risk register (brutal)

| Risk | Severity | Reality |
|---|---|---|
| **Zero playtests to date** | 🔴 Critical | The core loop is *unproven*. Nothing else matters until a stranger plays the 3-hole muni and you watch their face. Do this before Section 5. |
| **Pivot/abandon pattern** | 🔴 Critical | GRID, GLASSWATER, Wildbound all had working code and no players, then stopped. This is the pattern that kills GOLF EMPIRE. Ship the core to a human within weeks. |
| **Scope creep** | 🟠 High | 12+ systems is your instinct; discipline is the whole plan. The cut list in §6 is load-bearing. |
| **No Steam page / late wishlisting** | 🟠 High | If the page goes up at launch, you've already lost. Page up early, wishlists compounding, or $1M is off the table. |
| **Transformation not visible enough** | 🟡 Medium | If the glow-up doesn't read at thumbnail size, marketing has nothing to sell. Design the palette contrast in from day one. |
| **Photoreal / performance trap in Electron** | 🟡 Medium | Stylized, optimized, LOD'd. Don't chase fidelity your engine and solo bandwidth can't sustain. |

---

## 11. Milestones (the only sequence that reaches $1M)

1. **Playable core (weeks, not months):** 3 holes, desk, register, restock, one maintenance chore, bills. Ugly is fine.
2. **Playtest with a stranger.** Watch, don't explain. If they're not having fun, fix the loop — do not add systems.
3. **Vertical slice + Steam page live.** Best-looking 20 minutes, real transformation moment, trailer. Start wishlists.
4. **Depth pass:** staff, weather, reviews, parking. Content to fill Act 2.
5. **Next Fest demo.** Wishlist accelerator. Gather feedback.
6. **Flex pass:** course-design tools, 18-hole endgame, driving range — the money shot.
7. **1.0 launch** into wishlist momentum.
8. **Live tail:** content updates timed to Steam sales for a year.

---

## 12. The one-sentence north star

*If a stranger can pick it up, be smiling within 90 seconds, and screenshot their brown-to-green course glow-up an hour later — you have a $1M game. Everything in this document exists to make those two moments true.*