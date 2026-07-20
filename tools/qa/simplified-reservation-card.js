async (page) => {
  const root = process.cwd().replace(/\\/g, '/');
  const driver = await import(`file:///${root}/tools/qa/simplified-reservation-card-acceptance.mjs`);
  return driver.runSimplifiedReservationCardAcceptance(page, {
    viewport: process.env.RESERVATION_QA_VIEWPORT
      || process.env.REGISTER_QA_VIEWPORT
      || process.env.QA_VIEWPORT,
  });
}
