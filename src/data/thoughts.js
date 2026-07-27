// FAIRWAY STATE — the golfer thought catalog.
// Every thought has a `when(ctx)` predicate over REAL simulation values and a
// text renderer that quotes those values where it reads naturally. No thought
// fires without its condition being true right now — that's the whole point.
//
// ctx shape (built in sim/rounds.js):
//   golfer: { name, persona, wealth, memberTier, satisfaction }
//   round: { score, par, waitMin, playersToday, greensSpeed, greensHealth,
//            fairwayHealth, roughHeightMm, diseasedGreens, bunkers, waterHoles,
//            weather{tempHiF,rainIn,humidity}, seasonIndex, renovations }
//   club:  { greenFee, fairFee, reputation, amenities{range,restaurant,instruction},
//            outingToday }
//   shop:  { bought, lostSale, fittedRecently, stockRatio, markupMax, staffed }
//   staff: { groundsHours, hasInstructor, hasFnb, hasProshop }

import { makeRng } from '../core/utils.js';

const T = (id, mood, cat, when, text) => ({ id, mood, cat, when, text });
const over = (g) => g.score - g.par;

export const THOUGHTS = [
  // ─── greens: pace & purity ────────────────────────────────────────────────
  T('grn-pure', 'good', 'greens', (c) => c.round.greensSpeed >= 10.5 && c.round.greensHealth >= 78,
    (c) => `These greens roll pure — ${c.round.greensSpeed} on the stimp, easy.`),
  T('grn-fast-scary', 'good', 'greens', (c) => c.round.greensSpeed >= 11.8,
    (c) => `Lightning greens today. Downhill putts had my heart going.`),
  T('grn-true', 'good', 'greens', (c) => c.round.greensHealth >= 85 && c.round.greensSpeed >= 9,
    () => `Every putt held its line. Whoever cuts these greens knows their trade.`),
  T('grn-slow', 'bad', 'greens', (c) => c.round.greensSpeed <= 7.4,
    (c) => `Greens are crawling — barely ${c.round.greensSpeed} out there. Like putting through porridge.`),
  T('grn-shaggy', 'bad', 'greens', (c) => c.round.greensSpeed <= 8.2 && c.round.greensHealth >= 60,
    () => `Somebody skipped a mow. The greens are healthy but woolly.`),
  T('grn-bumpy', 'bad', 'greens', (c) => c.round.greensHealth <= 45,
    () => `Putts were bouncing like gravel out there. These greens are hurting.`),
  T('grn-disease-seen', 'bad', 'greens', (c) => c.round.diseasedGreens >= 1,
    (c) => `There are sick patches on ${c.round.diseasedGreens} green${c.round.diseasedGreens > 1 ? 's' : ''}. Somebody call an agronomist.`),
  T('grn-disease-bad', 'bad', 'greens', (c) => c.round.diseasedGreens >= 3,
    () => `Half the greens have blotch. I've seen healthier turf in a parking lot.`),
  T('grn-mid', 'neutral', 'greens', (c) => c.round.greensSpeed > 8.2 && c.round.greensSpeed < 9.4 && c.round.greensHealth > 55,
    (c) => `Greens were fine. Not fast, not slow — ${c.round.greensSpeed}-ish.`),
  T('grn-recover', 'good', 'greens', (c) => c.round.greensHealth >= 68 && c.round.diseasedGreens === 0 && c.golfer.satisfaction < 50,
    () => `Credit where due — the greens are coming back around.`),

  // ─── fairways / tees / rough ──────────────────────────────────────────────
  T('fw-carpet', 'good', 'fairway', (c) => c.round.fairwayHealth >= 78,
    () => `Fairways like carpet. The ball sits up begging to be hit.`),
  T('fw-stripes', 'good', 'fairway', (c) => c.round.fairwayHealth >= 70 && c.staff.groundsHours >= 14,
    () => `Love the fresh mow stripes down the fairways. Feels like a real club.`),
  T('fw-thin', 'bad', 'fairway', (c) => c.round.fairwayHealth <= 45,
    () => `Fairway lies are bare dirt in spots. Hard to hit crisp off that.`),
  T('fw-patchy', 'bad', 'fairway', (c) => c.round.fairwayHealth > 45 && c.round.fairwayHealth <= 58,
    () => `Fairways are patchy — one hole plush, the next one scruffy.`),
  T('rough-jungle', 'bad', 'rough', (c) => c.round.roughHeightMm >= 70,
    () => `Lost two balls in rough that should be baled for hay. Mow it!`),
  T('rough-fair', 'good', 'rough', (c) => c.round.roughHeightMm > 35 && c.round.roughHeightMm < 60,
    () => `Rough is honest — you get punished, but you can find your ball.`),
  T('rough-none', 'neutral', 'rough', (c) => c.round.roughHeightMm <= 30,
    () => `Rough's cut so short it may as well be fairway. Plays easy.`),
  T('tee-level', 'good', 'tee', (c) => c.round.fairwayHealth >= 60 && c.round.greensHealth >= 60 && over(c.round) <= 2,
    () => `Tee boxes are level and clean. Small thing, tells you a lot.`),

  // ─── design / architecture ─────────────────────────────────────────────────
  T('dsg-bunkers', 'good', 'design', (c) => c.round.bunkers >= 6,
    () => `The bunkering here makes you think on every approach. Good bones.`),
  T('dsg-water5', 'good', 'design', (c) => c.round.waterHoles >= 1,
    () => `That pond carry gets me every time. Best hole on the property.`),
  T('dsg-nobunker', 'neutral', 'design', (c) => c.round.bunkers <= 2,
    () => `Barely a bunker out there. Point and shoot golf.`),
  T('dsg-reno', 'bad', 'design', (c) => c.round.renovations >= 1,
    (c) => `${c.round.renovations} hole${c.round.renovations > 1 ? 's' : ''} closed for works today. The routing felt like a detour.`),
  T('dsg-reno-hope', 'good', 'design', (c) => c.round.renovations >= 1 && c.golfer.persona === 'conditions',
    () => `They're actually investing in the course. Pardon the dust — I like it.`),
  T('dsg-full9', 'good', 'design', (c) => c.round.renovations === 0 && c.round.par >= 33 && c.round.par <= 36,
    () => `A proper nine. Par threes, a real five, nothing gimmicky.`),

  // ─── weather / season ────────────────────────────────────────────────────────
  T('wx-perfect', 'good', 'weather', (c) => !c.round.weather.rainIn && c.round.weather.tempHiF >= 65 && c.round.weather.tempHiF <= 82,
    (c) => `${c.round.weather.tempHiF} degrees and not a cloud that mattered. Golf weather.`),
  T('wx-scorcher', 'bad', 'weather', (c) => c.round.weather.tempHiF >= 93,
    (c) => `${c.round.weather.tempHiF} degrees out there. I drank my weight at the turn.`),
  T('wx-soaked', 'bad', 'weather', (c) => c.round.weather.rainIn > 0.4,
    () => `Played through real rain. Squelched the whole back stretch.`),
  T('wx-drizzle', 'neutral', 'weather', (c) => c.round.weather.rainIn > 0 && c.round.weather.rainIn <= 0.4,
    () => `A little drizzle never hurt anybody. Kept the crowds away.`),
  T('wx-crisp-fall', 'good', 'weather', (c) => c.round.seasonIndex === 2 && !c.round.weather.rainIn,
    () => `Fall golf. Crisp air, quiet course. This is the good stuff.`),
  T('wx-winter-nut', 'neutral', 'weather', (c) => c.round.seasonIndex === 3,
    () => `Winter golf builds character. Mostly in the fingers.`),
  T('wx-spring', 'good', 'weather', (c) => c.round.seasonIndex === 0 && c.round.greensHealth > 55,
    () => `The course is waking up for spring. You can smell the cut grass again.`),
  T('wx-humid', 'bad', 'weather', (c) => c.round.weather.humidity >= 0.85 && c.round.weather.tempHiF >= 80,
    () => `Air you could wring out. My grips were soaked by the sixth.`),

  // ─── pace / crowding ──────────────────────────────────────────────────────────
  T('pace-empty', 'good', 'pace', (c) => c.round.playersToday <= 10,
    () => `Had the course practically to myself. Played in under two hours.`),
  T('pace-good', 'good', 'pace', (c) => c.round.waitMin <= 5 && c.round.playersToday > 10,
    () => `Busy but moving — never waited on a tee. Well marshaled.`),
  T('pace-ok', 'neutral', 'pace', (c) => c.round.waitMin > 5 && c.round.waitMin <= 14,
    () => `Usual weekend rhythm. A short wait on the par threes.`),
  T('pace-slow', 'bad', 'pace', (c) => c.round.waitMin > 14 && c.round.waitMin <= 25,
    (c) => `Waited ${Math.round(c.round.waitMin)} minutes across the round. Getting crowded out here.`),
  T('pace-awful', 'bad', 'pace', (c) => c.round.waitMin > 25,
    (c) => `${Math.round(c.round.waitMin)} minutes of standing around. Sell fewer tee times or marshal the thing.`),
  T('pace-outing', 'bad', 'pace', (c) => c.club.outingToday,
    () => `Corporate crowd took over the course today. We got squeezed around them.`),
  T('pace-outing-ok', 'neutral', 'pace', (c) => c.club.outingToday && c.golfer.persona !== 'pace',
    () => `Big outing in today — good money for the club, I suppose.`),

  // ─── pricing / value ─────────────────────────────────────────────────────────────
  T('val-steal', 'good', 'value', (c) => c.club.greenFee <= c.club.fairFee * 0.75,
    (c) => `${c.club.greenFee} dollars for golf like this? Best deal in the county.`),
  T('val-fair', 'good', 'value', (c) => c.club.greenFee > c.club.fairFee * 0.75 && c.club.greenFee <= c.club.fairFee * 1.05 && c.round.greensHealth > 55,
    () => `Fair price for what you get. I'll keep coming.`),
  T('val-steep', 'bad', 'value', (c) => c.club.greenFee > c.club.fairFee * 1.3,
    (c) => `${c.club.greenFee} dollars to play THIS? Somebody's dreaming.`),
  T('val-gouge', 'bad', 'value', (c) => c.club.greenFee > c.club.fairFee * 1.7,
    () => `The pricing here is straight robbery. They charge championship money for a muni.`),
  T('val-worth-it', 'good', 'value', (c) => c.club.greenFee > c.club.fairFee * 1.1 && c.round.greensHealth >= 80,
    () => `It's not cheap, but the course backs it up. You pay for the greens.`),
  T('val-member-smug', 'good', 'value', (c) => !!c.golfer.memberTier && c.club.greenFee >= c.club.fairFee,
    () => `Days like this, the membership pays for itself.`),
  T('val-persona', 'bad', 'value', (c) => c.golfer.persona === 'value' && c.club.greenFee > c.club.fairFee * 1.15,
    () => `I count every dollar, and this place is counting a few too many of mine.`),

  // ─── staff / service ─────────────────────────────────────────────────────────────
  T('svc-crew-visible', 'good', 'service', (c) => c.staff.groundsHours >= 20,
    () => `Grounds crew was out before dawn. You can tell someone cares.`),
  T('svc-skeleton', 'bad', 'service', (c) => c.staff.groundsHours <= 8,
    () => `One poor soul maintaining nine holes. The place needs hands.`),
  T('svc-lesson', 'good', 'service', (c) => c.staff.hasInstructor && c.golfer.satisfaction >= 50,
    () => `Booked a lesson with the pro. Found ten yards by dinner.`),
  T('svc-no-pro', 'neutral', 'service', (c) => !c.staff.hasInstructor && c.club.amenities.instruction > 0,
    () => `A teaching bay with nobody teaching in it. Hire a pro already.`),
  T('svc-grill-good', 'good', 'service', (c) => c.staff.hasFnb && c.club.amenities.restaurant >= 1,
    () => `Post-round burger at the grill hit exactly right.`),
  T('svc-no-food', 'neutral', 'service', (c) => c.club.amenities.restaurant === 0 && c.golfer.persona === 'service',
    () => `Not even a hot dog at the turn. A vending machine isn't hospitality.`),
  T('svc-register-un', 'bad', 'service', (c) => !c.shop.staffed && c.shop.stockRatio > 0.2,
    () => `Stood at the register with money in hand and nobody in sight.`),
  T('svc-persona', 'good', 'service', (c) => c.golfer.persona === 'service' && c.staff.groundsHours >= 14 && c.staff.hasProshop,
    () => `Everyone here greets you by name. That's why I stay.`),

  // ─── the pro shop ───────────────────────────────────────────────────────────────────
  T('shop-bought', 'good', 'shop', (c) => !!c.shop.bought,
    (c) => `Picked up the ${c.shop.bought} from the shop. Treat yourself day.`),
  T('shop-empty', 'bad', 'shop', (c) => c.shop.lostSale,
    () => `Went in to buy balls and the shelf was BARE. In a golf shop!`),
  T('shop-thin', 'bad', 'shop', (c) => c.shop.stockRatio <= 0.15 && !c.shop.lostSale,
    () => `The shop's half empty shelves make the whole club feel broke.`),
  T('shop-stocked', 'good', 'shop', (c) => c.shop.stockRatio >= 0.55,
    () => `Shop's looking sharp — racks full, new gear out front.`),
  T('shop-pricey', 'bad', 'shop', (c) => c.shop.markupMax >= 1.5,
    () => `Checked a price tag in the shop and put it right back down. Fifty percent over book!`),
  T('shop-deal', 'good', 'shop', (c) => c.shop.markupMax <= 0.9,
    () => `The shop prices are better than the big-box store. Bought two.`),
  T('shop-fitted', 'good', 'shop', (c) => c.shop.fittedRecently,
    () => `That fitting changed my game. The new setup feels dialed.`),
  T('shop-fit-flush', 'good', 'shop', (c) => c.shop.fittedRecently && over(c.round) <= 1,
    (c) => `Best round in years — ${c.round.score}. The fitted clubs are earning their keep.`),
  T('shop-browse', 'neutral', 'shop', (c) => c.shop.stockRatio > 0.15 && c.shop.stockRatio < 0.55 && !c.shop.bought,
    () => `Browsed the shop. Decent basics, nothing that made me reach for the wallet.`),
  T('shop-persona', 'good', 'shop', (c) => c.golfer.persona === 'shop' && c.shop.stockRatio >= 0.4,
    () => `I judge a club by its shop, and this one's coming along nicely.`),
  T('shop-persona-bad', 'bad', 'shop', (c) => c.golfer.persona === 'shop' && c.shop.stockRatio < 0.2,
    () => `I judge a club by its shop, and this one's an empty closet.`),
  T('shop-rental-save', 'good', 'shop', (c) => !c.golfer.memberTier && c.shop.stockRatio > 0.2 && c.round.playersToday > 5,
    () => `Forgot my clubs and the rentals were clean and ready. Saved my morning.`),

  // ─── amenities ────────────────────────────────────────────────────────────────────────
  T('amn-range-warm', 'good', 'amenities', (c) => c.club.amenities.range >= 1,
    () => `Warmed up on the range first. Makes the first tee a lot less rude.`),
  T('amn-range-none', 'neutral', 'amenities', (c) => c.club.amenities.range === 0,
    () => `No range, so the first three holes were my warmup. It showed.`),
  T('amn-range-big', 'good', 'amenities', (c) => c.club.amenities.range >= 2,
    () => `That practice range is better than clubs twice the price. I come early just for it.`),
  T('amn-grill-none', 'bad', 'amenities', (c) => c.club.amenities.restaurant === 0 && c.golfer.wealth >= 3,
    () => `Nowhere to take a client for lunch after the round. That's costing them business.`),
  T('amn-grill-nice', 'good', 'amenities', (c) => c.club.amenities.restaurant >= 2,
    () => `The grill room's turned into the best nineteenth hole in town.`),
  T('amn-teaching', 'good', 'amenities', (c) => c.club.amenities.instruction >= 1 && c.staff.hasInstructor && c.golfer.skillTrend === 'improving',
    () => `My handicap's actually moving for once. The teaching program works.`),

  // ─── club life / reputation / membership ─────────────────────────────────────────────────
  T('club-rising', 'good', 'club', (c) => c.club.reputation >= 55,
    () => `You can feel this place turning into something. Glad I'm here for it.`),
  T('club-shabby', 'bad', 'club', (c) => c.club.reputation <= 25,
    () => `My buddies laughed when I said I play here. Prove them wrong, please.`),
  T('club-proud-member', 'good', 'club', (c) => c.golfer.memberTier === 'premium' && c.club.reputation >= 45,
    () => `Legacy membership at a club on the rise. Called it early.`),
  T('club-guest-brag', 'good', 'club', (c) => c.golfer.memberTier === 'full' && c.club.reputation >= 50,
    () => `Brought a guest today. He's asking about membership before we hit the ninth.`),
  T('club-new-member', 'neutral', 'club', (c) => !!c.golfer.memberTier && c.golfer.satisfaction >= 45 && c.golfer.satisfaction <= 60,
    () => `Still deciding how I feel about this club. The jury's out.`),
  T('club-tight-margin', 'neutral', 'club', (c) => !c.golfer.memberTier && c.club.reputation < 40,
    () => `Decent enough for a cheap loop. Membership? Not yet.`),
  T('club-would-join', 'good', 'club', (c) => !c.golfer.memberTier && c.round.greensHealth >= 70 && c.club.reputation >= 45,
    () => `If they keep the course like this, I might finally sign up.`),

  // ─── scores & personal moments (condition-linked) ─────────────────────────────────────────
  T('score-career', 'good', 'score', (c) => over(c.round) <= -2,
    (c) => `${c.round.score}! ${Math.abs(over(c.round))} under! Frame this scorecard.`),
  T('score-solid', 'good', 'score', (c) => over(c.round) > -2 && over(c.round) <= 3,
    (c) => `Shot ${c.round.score}. When the course is this fair, good golf gets rewarded.`),
  T('score-grind', 'neutral', 'score', (c) => over(c.round) > 3 && over(c.round) <= 9,
    (c) => `${c.round.score} today. A couple of loose swings, no complaints.`),
  T('score-blowup', 'bad', 'score', (c) => over(c.round) > 14,
    (c) => `Carded a ${c.round.score}. Between me and this course, one of us was a mess.`),
  T('score-blame-greens', 'bad', 'score', (c) => over(c.round) > 9 && c.round.greensHealth < 50,
    () => `I putted fine — the greens just wouldn't hold a line. Fix them.`),
  T('score-hot-streak', 'good', 'score', (c) => c.golfer.skillTrend === 'improving' && over(c.round) <= 5,
    () => `Three rounds, three season bests. This course fits my eye.`),

  // ─── word of mouth / misc (all condition-gated) ──────────────────────────────────────────────
  T('wom-bring-friends', 'good', 'wom', (c) => c.golfer.satisfaction >= 75,
    () => `Told the whole office about this place. Expect my foursome Saturday.`),
  T('wom-warn', 'bad', 'wom', (c) => c.golfer.satisfaction <= 25,
    () => `I tell people to drive the extra twenty minutes to the valley course. Sorry.`),
  T('wom-quiet-fan', 'good', 'wom', (c) => c.golfer.satisfaction >= 60 && c.golfer.persona === 'conditions' && c.round.greensHealth >= 70,
    () => `Purists know: watch the greens, not the clubhouse. These greens say plenty.`),
  T('wom-loyal', 'good', 'wom', (c) => (c.golfer.roundsHere || 0) >= 12 && c.golfer.satisfaction >= 55,
    (c) => `Round number ${c.golfer.roundsHere} here this year. It's my course now.`),
  T('wom-return', 'neutral', 'wom', (c) => (c.golfer.roundsHere || 0) === 1,
    () => `First time playing here. There's something to work with.`),

  // ─── conditions personas (extra specificity) ────────────────────────────────────────────────
  T('per-cond-happy', 'good', 'persona', (c) => c.golfer.persona === 'conditions' && c.round.greensHealth >= 80 && c.round.fairwayHealth >= 70,
    () => `Turf nerd verdict: firm, healthy, alive. This groundskeeping is top shelf.`),
  T('per-cond-angry', 'bad', 'persona', (c) => c.golfer.persona === 'conditions' && (c.round.greensHealth <= 45 || c.round.diseasedGreens >= 2),
    () => `Turf nerd verdict: neglect. I can name the disease from fifty yards.`),
  T('per-pace-happy', 'good', 'persona', (c) => c.golfer.persona === 'pace' && c.round.waitMin <= 5,
    () => `Two hours, no waiting. Golf as it was intended.`),
  T('per-pace-angry', 'bad', 'persona', (c) => c.golfer.persona === 'pace' && c.round.waitMin > 20,
    () => `Golf isn't supposed to have a queue. Today it did. Twice.`),
  T('per-value-happy', 'good', 'persona', (c) => c.golfer.persona === 'value' && c.club.greenFee <= c.club.fairFee * 0.9,
    () => `Ran the numbers: cost per hole here beats everywhere in the county.`),
  T('per-service-angry', 'bad', 'persona', (c) => c.golfer.persona === 'service' && c.staff.groundsHours <= 8 && !c.staff.hasProshop,
    () => `Nobody on the grounds, nobody in the shop. Who's running this place?`),

  // ─── weather+condition combos ─────────────────────────────────────────────────────────────────
  T('mix-rain-drain', 'good', 'mix', (c) => c.round.weather.rainIn > 0.3 && c.round.fairwayHealth >= 65,
    () => `Rained all morning and the fairways still played firm. Great drainage — great turf.`),
  T('mix-rain-swamp', 'bad', 'mix', (c) => c.round.weather.rainIn > 0.3 && c.round.fairwayHealth < 50,
    () => `One shower and the fairways turned to soup. That turf has no roots.`),
  T('mix-heat-crisp', 'good', 'mix', (c) => c.round.weather.tempHiF >= 88 && c.round.greensHealth >= 75,
    () => `A heatwave and the greens are still emerald. That irrigation crew earns every cent.`),
  T('mix-heat-fried', 'bad', 'mix', (c) => c.round.weather.tempHiF >= 88 && c.round.greensHealth < 55,
    () => `The course is baking to death out there. Water it before it's a desert.`),
  T('mix-frost-patience', 'neutral', 'mix', (c) => c.round.weather.tempHiF <= 45,
    () => `Cold enough that the starter had us waiting on the frost. Part of the deal.`),

  // ─── crowd texture / neutral color (still condition-gated) ───────────────────────────────────────
  T('tex-morning', 'neutral', 'texture', (c) => c.round.playersToday >= 15 && c.round.waitMin <= 10,
    () => `Good crowd out today and the course swallowed it easily.`),
  T('tex-regulars', 'neutral', 'texture', (c) => (c.golfer.roundsHere || 0) >= 6,
    () => `Same faces on the first tee every week now. That's how a club starts.`),
  T('tex-outing-buzz', 'neutral', 'texture', (c) => c.club.outingToday && c.club.reputation >= 45,
    () => `Big corporate day here. Word's getting around about this place.`),
  T('tex-birds', 'good', 'texture', (c) => c.round.playersToday <= 12 && !c.round.weather.rainIn && c.round.seasonIndex !== 3,
    () => `So quiet today you could hear the course breathe. Needed that.`),

  // ─── membership economics ──────────────────────────────────────────────────────────────────────
  T('mem-dues-worth', 'good', 'membership', (c) => !!c.golfer.memberTier && c.golfer.satisfaction >= 65,
    () => `Renewal notice came and I didn't even hesitate this year.`),
  T('mem-dues-doubt', 'bad', 'membership', (c) => !!c.golfer.memberTier && c.golfer.satisfaction <= 35,
    () => `Doing the math on these dues versus what I'm getting. It's not close.`),
  T('mem-upgrade-eye', 'good', 'membership', (c) => c.golfer.memberTier === 'weekday' && c.golfer.satisfaction >= 70,
    () => `Thinking about the full membership. Weekdays aren't enough anymore.`),
  T('mem-guest-passes', 'good', 'membership', (c) => c.golfer.memberTier === 'premium' && c.club.reputation >= 40,
    () => `Used a guest pass on my brother-in-law. He owes me a steak now.`),

  // ─── final coverage: specific numeric callouts ────────────────────────────────────────────────────
  T('num-stimp-brag', 'good', 'greens', (c) => c.round.greensSpeed >= 11 && c.golfer.persona === 'conditions',
    (c) => `Measured it myself: ${c.round.greensSpeed} on the stimp. Tour numbers at a muni.`),
  T('num-crowd', 'neutral', 'pace', (c) => c.round.playersToday >= 35,
    (c) => `${c.round.playersToday} players through today. This place is getting discovered.`),
  T('num-dead-quiet', 'neutral', 'pace', (c) => c.round.playersToday <= 5 && c.round.seasonIndex !== 3,
    () => `Practically nobody out. Peaceful — but a club needs heartbeat.`),
  T('num-fee-cheap-sus', 'neutral', 'value', (c) => c.club.greenFee <= c.club.fairFee * 0.55,
    (c) => `${c.club.greenFee} bucks? Either a bargain or a warning sign. Turned out fine.`),
];

// Evaluate the catalog against a real context; return up to `max` picks,
// seeded so the same round yields the same thoughts.
export function thoughtsForRound(ctx, seed, max = 3) {
  const rng = makeRng(seed >>> 0 || 1);
  const fired = [];
  for (const t of THOUGHTS) {
    let ok = false;
    try {
      ok = !!t.when(ctx);
    } catch {
      ok = false;
    }
    if (ok) fired.push(t);
  }
  // prefer mood variety: shuffle deterministically, cap
  for (let i = fired.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [fired[i], fired[j]] = [fired[j], fired[i]];
  }
  const picked = [];
  const moods = new Set();
  for (const t of fired) {
    if (picked.length >= max) break;
    if (moods.has(t.mood) && fired.length > max) continue; // seek variety when we can afford it
    moods.add(t.mood);
    picked.push(t);
  }
  for (const t of fired) {
    if (picked.length >= max) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.map((t) => ({ id: t.id, mood: t.mood, rendered: t.text(ctx) }));
}
