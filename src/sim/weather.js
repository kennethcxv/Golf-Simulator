// FAIRWAY STATE — daily weather generation.
// A transitional-climate muni (think mid-Atlantic): four real seasons, summer
// humidity, spring/fall frost risk, and genuine dry spells that stress turf.

import { DAYS_PER_SEASON, DAYS_PER_YEAR } from './constants.js';
import { clamp } from '../core/utils.js';

// Season shape: mean high/low (F), rain chance, humidity base. Property
// acquisitions select one of these real operating climates; the default stays
// the original transitional profile for every pre-overhaul save.
export const CLIMATE_PROFILES = Object.freeze({
  temperate: Object.freeze({
    label: 'Four-season temperate', windBase: 3, rainAmount: 1,
    seasons: Object.freeze([
      { hi: 63, lo: 42, rainChance: 0.38, humidity: 0.55 },
      { hi: 88, lo: 68, rainChance: 0.26, humidity: 0.68 },
      { hi: 66, lo: 46, rainChance: 0.3, humidity: 0.55 },
      { hi: 40, lo: 24, rainChance: 0.32, humidity: 0.5 },
    ]),
  }),
  maritime: Object.freeze({
    label: 'Cool maritime', windBase: 7, rainAmount: 0.82,
    seasons: Object.freeze([
      { hi: 58, lo: 45, rainChance: 0.52, humidity: 0.7 },
      { hi: 74, lo: 58, rainChance: 0.34, humidity: 0.68 },
      { hi: 61, lo: 48, rainChance: 0.48, humidity: 0.72 },
      { hi: 47, lo: 36, rainChance: 0.5, humidity: 0.7 },
    ]),
  }),
  alpine: Object.freeze({
    label: 'Mountain', windBase: 6, rainAmount: 0.9,
    seasons: Object.freeze([
      { hi: 52, lo: 31, rainChance: 0.4, humidity: 0.48 },
      { hi: 73, lo: 48, rainChance: 0.28, humidity: 0.44 },
      { hi: 51, lo: 30, rainChance: 0.34, humidity: 0.46 },
      { hi: 29, lo: 12, rainChance: 0.3, humidity: 0.42 },
    ]),
  }),
  arid: Object.freeze({
    label: 'Hot arid', windBase: 6, rainAmount: 1.35,
    seasons: Object.freeze([
      { hi: 78, lo: 50, rainChance: 0.12, humidity: 0.28 },
      { hi: 103, lo: 76, rainChance: 0.1, humidity: 0.24 },
      { hi: 82, lo: 53, rainChance: 0.13, humidity: 0.27 },
      { hi: 59, lo: 34, rainChance: 0.12, humidity: 0.3 },
    ]),
  }),
});

export function newWeather(climate = 'temperate') {
  return {
    today: { tempHiF: 60, tempLoF: 45, rainIn: 0, humidity: 0.5, windMph: 5 },
    droughtDays: 0,
    climate: CLIMATE_PROFILES[climate] ? climate : 'temperate',
    // slow-moving "weather system" bias so hot/dry and cool/wet stretches happen
    bias: { temp: 0, dry: 0 },
  };
}

// Smooth interpolation between season means across the year.
function seasonalMeans(dayOfYear, climate = 'temperate') {
  const profile = CLIMATE_PROFILES[climate] || CLIMATE_PROFILES.temperate;
  const seasonPos = ((dayOfYear - 1) / DAYS_PER_SEASON) % 4;
  const i0 = Math.floor(seasonPos) % 4;
  const i1 = (i0 + 1) % 4;
  const t = seasonPos - Math.floor(seasonPos);
  // blend centered on mid-season: shift t so day 12 of a season is "pure"
  const blend = clamp(t, 0, 1);
  const a = profile.seasons[i0];
  const b = profile.seasons[i1];
  const mix = (k) => a[k] * (1 - blend) + b[k] * blend;
  return { hi: mix('hi'), lo: mix('lo'), rainChance: mix('rainChance'), humidity: mix('humidity') };
}

export function rollDailyWeather(weather, rng, dayOfYear) {
  const profile = CLIMATE_PROFILES[weather.climate] || CLIMATE_PROFILES.temperate;
  if (!CLIMATE_PROFILES[weather.climate]) weather.climate = 'temperate';
  const m = seasonalMeans(((dayOfYear - 1) % DAYS_PER_YEAR) + 1, weather.climate);

  // weather systems drift: persistent hot/dry or cool/wet stretches
  weather.bias.temp = clamp(weather.bias.temp * 0.82 + (rng.next() - 0.5) * 7, -9, 9);
  weather.bias.dry = clamp(weather.bias.dry * 0.85 + (rng.next() - 0.5) * 0.3, -0.35, 0.35);

  const hi = Math.round(m.hi + weather.bias.temp + (rng.next() - 0.5) * 10);
  const lo = Math.round(Math.min(hi - 8, m.lo + weather.bias.temp * 0.8 + (rng.next() - 0.5) * 8));

  const rainChance = clamp(m.rainChance - weather.bias.dry, 0.04, 0.75);
  const raining = rng.chance(rainChance);
  const rainIn = raining
    ? Math.round(rng.range(0.05, 1.4) * profile.rainAmount * (rng.chance(0.15) ? 2 : 1) * 100) / 100 : 0;

  const humidity = clamp(m.humidity + (raining ? 0.22 : -0.02) + (rng.next() - 0.5) * 0.18, 0.15, 1);
  const windMph = Math.round(clamp(profile.windBase + rng.next() * 14 + (raining ? 4 : 0), 0, 34));

  weather.today = {
    tempHiF: hi,
    tempLoF: lo,
    rainIn: Math.min(rainIn, 3),
    humidity: Math.round(humidity * 100) / 100,
    windMph,
  };
  weather.droughtDays = rainIn > 0 ? 0 : weather.droughtDays + 1;
  return weather.today;
}

export function isFrostMorning(today) {
  return today.tempLoF <= 32;
}

// Rough temperature at a given hour, interpolating low (6am) → high (3pm) → low.
export function tempAtHour(today, hour) {
  const { tempHiF: hi, tempLoF: lo } = today;
  if (hour <= 6) return lo + (hi - lo) * 0.08 * Math.max(0, hour - 2);
  if (hour <= 15) return lo + (hi - lo) * ((hour - 6) / 9);
  return hi - (hi - lo) * ((hour - 15) / 9) * 0.85;
}

export function weatherSummary(today) {
  const icon = today.rainIn > 0.6 ? '🌧' : today.rainIn > 0 ? '🌦' : isFrostMorning(today) ? '❄' : today.tempHiF >= 88 ? '☀🔥' : '☀';
  return `${icon} ${today.tempHiF}°/${today.tempLoF}°F · ${Math.round(today.humidity * 100)}% RH` +
    (today.rainIn > 0 ? ` · ${today.rainIn}" rain` : '');
}
