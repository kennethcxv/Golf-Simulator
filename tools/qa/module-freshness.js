// Is the Electron renderer running the source on disk, or a cached copy of it?
// Three prior "fix shipped, no effect in game" cases make this the first thing
// to rule out before any Electron result is believed.
async (page) => {
  await page.waitForTimeout(1200);
  return page.evaluate(async () => {
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    return {
      staffReturn: L.FRONT_DESK_FRAME.staffReturn,
      passThroughLocalX: L.FRONT_DESK_FRAME.passThroughLocalX ?? null,
      returnStaffExtent: L.FRONT_DESK_FRAME.returnStaffExtent,
      variant: L.CLUBHOUSE_LAYOUT_VARIANT,
      westSealKeys: Object.keys(L.PINE_HILLS_V2_LAYOUT.corridorWestSeal),
      staffChair: L.FRONT_DESK.staffChair,
    };
  });
}
