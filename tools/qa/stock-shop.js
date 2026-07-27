async (page) => {
  // QA aid for the ART passes only: fill every RETAIL display so the merchandise
  // models are actually on screen to be judged.
  //
  // Deliberately does NOT touch `decor` or `supplies`: a decor SKU sitting in
  // inventory makes the shop spawn a translucent green PLACEMENT GHOST for it,
  // which would fill the room with fake blobs and poison the before/after compare.
  // Final gameplay proof does not use this file at all.
  return await page.evaluate(() => {
    const app = window.__fw;
    const cat = window.__SHOP_CATALOG_BY_ID || null;
    const inv = app.state.shop.inventory;
    const RETAIL = new Set(['clubs', 'balls', 'apparel', 'accessories']);
    const catalog = app.__catalog || null;
    const filled = {};
    const skipped = [];
    for (const id of Object.keys(inv)) {
      const c = (cat && cat[id]) || (catalog && catalog[id]) || null;
      // fall back to id prefixes when the catalogue isn't exposed on window
      const isDecor = ['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1'].includes(id);
      const isSupply = ['vac1'].includes(id);
      if (isDecor || isSupply || (c && !RETAIL.has(c.cat))) { skipped.push(id); continue; }
      inv[id].shelf = Math.max(inv[id].shelf, 12);
      inv[id].back = Math.max(inv[id].back, 6);
      filled[id] = inv[id].shelf;
    }
    app.scene3d.clubhouse().rebuildStock();
    return { stocked: Object.keys(filled).length, skipped, filled };
  });
}
