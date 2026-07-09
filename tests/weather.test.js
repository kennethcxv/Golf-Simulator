import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/core/utils.js';
import { newWeather, rollDailyWeather, isFrostMorning } from '../src/sim/weather.js';

function rollDays(seed, dayOfYearStart, n) {
  const rng = makeRng(seed);
  const weather = newWeather();
  const days = [];
  for (let i = 0; i < n; i++) {
    rollDailyWeather(weather, rng, dayOfYearStart + i);
    days.push({ ...weather.today });
  }
  return { weather, days };
}

test('weather is deterministic per seed', () => {
  const a = rollDays(42, 1, 10).days;
  const b = rollDays(42, 1, 10).days;
  assert.deepEqual(a, b);
});

test('summer runs hotter than winter', () => {
  // day 30 = summer day 6; day 78 = winter day 6 (24-day seasons)
  const summer = rollDays(7, 25, 20).days;
  const winter = rollDays(7, 73, 20).days;
  const avg = (arr, k) => arr.reduce((s, d) => s + d[k], 0) / arr.length;
  assert.ok(avg(summer, 'tempHiF') > avg(winter, 'tempHiF') + 20);
});

test('drought spell counter tracks consecutive rainless days', () => {
  const rng = makeRng(1);
  const weather = newWeather();
  let sawDrought = false;
  for (let d = 25; d < 73; d++) { // summer + fall
    rollDailyWeather(weather, rng, d);
    if (weather.today.rainIn === 0) {
      sawDrought = weather.droughtDays >= 5 || sawDrought;
    } else {
      assert.equal(weather.droughtDays, 0, 'rain must reset the drought counter');
    }
  }
  assert.ok(sawDrought, 'a 48-day summer/fall stretch should include a 5+ day dry spell');
});

test('frost mornings only when the low is freezing', () => {
  assert.equal(isFrostMorning({ tempLoF: 30 }), true);
  assert.equal(isFrostMorning({ tempLoF: 33 }), false);
});

test('humidity and temperatures stay in sane bands', () => {
  const { days } = rollDays(99, 1, 96);
  for (const d of days) {
    assert.ok(d.tempHiF > d.tempLoF, 'high above low');
    assert.ok(d.tempHiF >= 10 && d.tempHiF <= 110, `hi ${d.tempHiF}`);
    assert.ok(d.humidity >= 0.15 && d.humidity <= 1, `humidity ${d.humidity}`);
    assert.ok(d.rainIn >= 0 && d.rainIn <= 3, `rain ${d.rainIn}`);
  }
});
