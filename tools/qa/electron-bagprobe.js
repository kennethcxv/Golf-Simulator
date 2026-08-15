// Three questions, one run: is `register` the right name, did the accessor land,
// and is the bag actually built at boot? Written because guessing between "my
// driver is wrong" and "G4.1 is not fixed" is exactly what produced a false
// defect earlier in this session.
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(7000);
  const out = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    const reg = ch?.register;
    let node = null;
    let threw = null;
    try { node = reg?.bagNode ? reg.bagNode() : undefined; } catch (e) { threw = String(e.message); }
    return {
      clubhouseHasRegister: !!reg,
      registerKeysMatching: reg ? Object.keys(reg).filter((k) => /bag/i.test(k)) : null,
      accessorType: typeof reg?.bagNode,
      nodeIsNull: node === null,
      nodeIsUndefined: node === undefined,
      nodeName: node?.name ?? null,
      nodeVisible: node?.visible ?? null,
      hasParent: !!node?.parent,
      threw,
    };
  });
  console.log('BAGPROBE', JSON.stringify(out));
  return out;
}
