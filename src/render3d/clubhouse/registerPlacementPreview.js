// Pure adapter for the physical POS while a shopper is still placing products.
// The register must not own or mutate the transaction until the final product lands,
// but the in-world screen still needs an honest CustomerPlacingProducts state.

export function placementPreviewOf(customer) {
  if (!customer || customer.checkoutPhase !== 'placing') return null;
  const items = [];
  const seen = new Set();
  for (const item of customer.cart || []) {
    if (!item || item.uid == null || seen.has(item.uid)) continue;
    seen.add(item.uid);
    items.push({
      uid: item.uid,
      skuId: item.skuId,
      price: Number(item.price) || 0,
      placed: item.placed === true,
    });
  }
  const placedItems = items.reduce((total, item) => total + (item.placed ? 1 : 0), 0);
  return {
    customer: String(customer.name || 'Customer'),
    state: 'CustomerPlacingProducts',
    activeUid: customer.checkoutPlacement?.activeUid || null,
    placedItems,
    totalItems: items.length,
    items,
  };
}

export function placementPreviewSignature(preview) {
  if (!preview) return '';
  return [
    preview.customer,
    preview.state,
    preview.activeUid || '',
    preview.placedItems,
    preview.totalItems,
    ...preview.items.map((item) => `${item.uid}:${item.skuId}:${item.placed ? 1 : 0}`),
  ].join('|');
}
