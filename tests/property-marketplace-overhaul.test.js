import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/core/utils.js';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import {
  generateMarketplace, generateListing, PROPERTY_REGIONS,
} from '../src/sim/marketplace.js';
import {
  PROPERTY_MARKET, activeState, auctionNextBid, buyProperty, deserializeEmpire,
  inspectPropertyListing, marketTick, newEmpire, placeAuctionBid, propertyAccess,
  serializeEmpire,
} from '../src/sim/empire.js';
import { CLIMATE_PROFILES, newWeather, rollDailyWeather } from '../src/sim/weather.js';

function advanceMarketOneDay(empire) {
  activeState(empire).clock.minutes += MINUTES_PER_DAY;
  marketTick(empire);
  empire.clockMinutes = activeState(empire).clock.minutes;
}

test('every opportunity carries a complete operating region, climate, cost, demand, and expansion profile', () => {
  const roster = generateMarketplace(4242);
  assert.ok(roster.length >= 9);
  assert.ok(new Set(roster.map((property) => property.climate)).size >= 4, 'launch roster spans materially different climates');
  for (const property of roster) {
    assert.ok(PROPERTY_REGIONS[property.region], `${property.id}: known region`);
    assert.ok(CLIMATE_PROFILES[property.climate], `${property.id}: real weather climate`);
    assert.match(property.regionLabel, /\w/);
    assert.match(property.courseClass, /\w/);
    assert.ok(property.difficulty >= 1 && property.difficulty <= 5);
    assert.ok(property.customerDemand >= 1 && property.customerDemand <= 100);
    assert.ok(property.expansionPotential >= 1 && property.expansionPotential <= 100);
    assert.ok(property.maxHoles >= property.size);
    assert.ok(property.maintenanceCostPerDay > 0);
    assert.ok(property.operatingCostPerDay >= property.maintenanceCostPerDay);
  }

  for (let seed = 1; seed <= 12; seed++) {
    const generated = generateListing(seed * 997);
    assert.ok(PROPERTY_REGIONS[generated.region]);
    assert.ok(CLIMATE_PROFILES[generated.climate]);
  }
});

test('a new empire exposes conventional listings and honest timed auctions without duplicate properties', () => {
  const empire = newEmpire('relaxed', 42);
  assert.ok(empire.market.length >= 6);
  assert.equal(empire.auctions.length, 2);
  assert.ok(empire.auctions.length <= PROPERTY_MARKET.maxAuctions);
  const all = [...empire.market, ...empire.auctions];
  assert.equal(new Set(all.map((property) => property.id)).size, all.length);
  for (const property of empire.auctions) {
    assert.equal(property.saleType, 'auction');
    assert.ok(property.auction.endsDay > property.auction.opensDay);
    assert.ok(property.auction.openingBid < property.askingPrice);
    assert.ok(property.auction.reservePrice > 0);
    assert.equal(auctionNextBid(property), property.auction.openingBid);
  }
});

test('regional progression locks advanced acquisitions until the empire has operating experience', () => {
  const empire = newEmpire('relaxed', 42);
  empire.cash = 1_000_000;
  const bent = empire.market.find((property) => property.id === 'bent-pines');
  assert.equal(propertyAccess(empire, bent).unlocked, false);
  assert.equal(buyProperty(empire, bent.id).ok, false);
  assert.equal(buyProperty(empire, 'willow-creek').ok, true);
  assert.equal(propertyAccess(empire, bent).unlocked, true);
  assert.equal(buyProperty(empire, bent.id).ok, true);
});

test('auction escrow survives a save and a below-reserve result refunds into a conventional listing', () => {
  const empire = newEmpire('relaxed', 42);
  empire.cash = 1_000_000;
  buyProperty(empire, 'willow-creek');
  const auction = empire.auctions.find((property) => property.id === 'quarry-bluffs');
  auction.auction.endsDay = 1;
  const beforeBid = empire.cash;
  const result = placeAuctionBid(empire, auction.id);
  assert.equal(result.ok, true, result.reason);
  assert.equal(empire.cash, beforeBid - result.bid);
  const loaded = deserializeEmpire(serializeEmpire(empire));
  assert.deepEqual(loaded.auctions.find((property) => property.id === auction.id).auction, auction.auction);

  advanceMarketOneDay(loaded);
  assert.equal(loaded.cash, beforeBid, 'escrow is fully refundable when reserve is missed');
  assert.ok(loaded.market.some((property) => property.id === auction.id));
  assert.ok(!loaded.auctions.some((property) => property.id === auction.id));
  assert.ok(!loaded.holdings.some((holding) => holding.property.id === auction.id));
});

test('a reserve-clearing auction win becomes a complete playable parked property', () => {
  const empire = newEmpire('relaxed', 42);
  empire.cash = 1_000_000;
  buyProperty(empire, 'willow-creek');
  const auction = empire.auctions.find((property) => property.id === 'quarry-bluffs');
  auction.auction.endsDay = 1;
  const result = placeAuctionBid(empire, auction.id, auction.auction.reservePrice);
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.bid >= auction.auction.reservePrice);
  advanceMarketOneDay(empire);
  const holding = empire.holdings.find((entry) => entry.property.id === auction.id);
  assert.ok(holding, 'winning bid closes into the portfolio');
  assert.equal(holding.operations.acquisition.source, 'auction');
  assert.equal(holding.state.weather.climate, holding.property.climate);
  assert.equal(holding.passive.managerTier, 'caretaker');
  assert.ok(!empire.auctions.some((property) => property.id === auction.id));
});

test('auction due diligence uses the same paid report and preserves regional operating facts', () => {
  const empire = newEmpire('relaxed', 42);
  empire.cash = 1_000_000;
  buyProperty(empire, 'willow-creek');
  const property = empire.auctions.find((entry) => entry.id === 'quarry-bluffs');
  const result = inspectPropertyListing(empire, property.id);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.report.region, property.region);
  assert.equal(result.report.climate, property.climate);
  assert.equal(result.report.operatingCostPerDay, property.operatingCostPerDay);
  assert.equal(result.report.expansionPotential, property.expansionPotential);
});

test('property climates produce deterministic, materially different operating weather', () => {
  const summarize = (climate) => {
    const weather = newWeather(climate);
    const rng = makeRng(1187);
    let high = 0;
    let rain = 0;
    let wind = 0;
    for (let day = 1; day <= 96; day++) {
      const today = rollDailyWeather(weather, rng, day);
      high += today.tempHiF;
      rain += today.rainIn;
      wind += today.windMph;
    }
    return { high: high / 96, rain, wind: wind / 96 };
  };
  assert.deepEqual(summarize('arid'), summarize('arid'), 'climate weather is deterministic for a save seed');
  const arid = summarize('arid');
  const maritime = summarize('maritime');
  assert.ok(arid.high > maritime.high + 15);
  assert.ok(arid.rain < maritime.rain * 0.55);
  assert.ok(maritime.wind > 0);
});
