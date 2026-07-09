// FAIRWAY STATE — shared zone colors (UI swatches, minimap-style uses).
// The 3D terrain shader has its own tint uniforms tuned for lighting; these are
// the flat reference colors.

import { ZONE } from '../sim/constants.js';

export const ZONE_COLORS = {
  [ZONE.OUT]: '#46543a',
  [ZONE.ROUGH]: '#5c7d43',
  [ZONE.FAIRWAY]: '#7cb257',
  [ZONE.GREEN]: '#96d377',
  [ZONE.TEE]: '#8ac168',
  [ZONE.BUNKER]: '#d8c78e',
  [ZONE.WATER]: '#3e6f9e',
  [ZONE.PATH]: '#a89f8d',
};
