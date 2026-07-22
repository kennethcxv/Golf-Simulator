// FAIRWAY STATE — shared zone colors (UI swatches, minimap-style uses).
// The 3D terrain shader has its own tint uniforms tuned for lighting; these are
// the flat reference colors.

import { ZONE } from '../sim/constants.js';

export const ZONE_COLORS = {
  [ZONE.OUT]: '#4d6342',
  [ZONE.ROUGH]: '#668b4d',
  [ZONE.FAIRWAY]: '#78ad52',
  [ZONE.GREEN]: '#8bc669',
  [ZONE.TEE]: '#82b85e',
  [ZONE.BUNKER]: '#dbc38b',
  [ZONE.WATER]: '#397982',
  [ZONE.PATH]: '#b8aa91',
};
