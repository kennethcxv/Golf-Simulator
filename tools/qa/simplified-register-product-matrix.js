async (page) => {
  const driver = await import('./simplified-register-product-matrix.mjs');
  const query = new URL(page.url()).searchParams;
  return driver.runProductStagingMatrix(page, {
    root: query.get('registerProductMatrixRoot') || undefined,
  });
}
