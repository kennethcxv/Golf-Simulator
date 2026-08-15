// Why does the menu refuse the planted autosave? Plant it, reload, and read the
// menu's own verdict text plus a direct load-back, instead of guessing.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const saveDir = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');
  const autosave = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave-meta.json'), 'utf8'));

  await page.waitForFunction(() => !!window.fairwayNative?.save, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const planted = await page.evaluate(async ({ save, saveMeta }) => {
    const a = await window.fairwayNative.save('autosave', save);
    const b = await window.fairwayNative.save('autosave-meta', saveMeta);
    return { a, b };
  }, { save: autosave, saveMeta: meta });
  console.log('PLANTED', JSON.stringify(planted));

  await page.reload();
  await page.waitForTimeout(6000);
  const verdict = await page.evaluate(async () => {
    const title = document.querySelector('.menu-save-title')?.textContent ?? null;
    const detail = document.querySelector('.menu-save-detail')?.textContent ?? null;
    const state = document.querySelector('.menu-save-state')?.dataset?.state
      ?? document.querySelector('[data-state]')?.dataset?.state ?? null;
    let loadBack = null;
    try {
      const status = await window.fairwayNative.loadStatus?.('autosave', { repair: false });
      loadBack = status ? {
        source: status.source, missing: status.missing,
        hasValue: !!status.value,
        empireVersion: status.value?.empireVersion ?? null,
        primaryError: status.primaryError?.message ?? null,
      } : 'no loadStatus bridge';
    } catch (e) { loadBack = `load threw: ${e.message}`; }
    const buttons = Array.from(document.querySelectorAll('button'))
      .map((x) => ({ text: (x.textContent || '').trim().slice(0, 40), disabled: x.disabled }));
    const primary = document.querySelector('.menu-action-primary');
    return {
      title,
      detail,
      state,
      loadBack,
      buttonCount: buttons.length,
      buttons: buttons.slice(0, 10),
      primary: primary
        ? { text: (primary.textContent || '').slice(0, 40), disabled: primary.disabled }
        : null,
    };
  });
  console.log('WHY', JSON.stringify(verdict, null, 2));
  return verdict;
}
