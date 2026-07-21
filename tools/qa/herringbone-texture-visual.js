async (page) => {
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8491/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const { makeHerringboneFloorTexture } = await import('/src/render3d/clubhouse/materials.js');
    const texture = makeHerringboneFloorTexture({});
    document.body.replaceChildren(texture.image);
    Object.assign(document.body.style, {
      margin: '0', background: '#111', display: 'grid', placeItems: 'center', minHeight: '100vh',
    });
    Object.assign(texture.image.style, { width: '768px', height: '768px', imageRendering: 'auto' });
  });
  await page.screenshot({ path: 'qa/furniture_catalog/herringbone-texture.png' });
}
