async (page) => {
  // Assets 51-100 + first-person cleaning baseline.
  //
  // The established 01-50 route already owns the canonical clubhouse fixture,
  // thirteen fixed cameras, renderer counters, and browser diagnostics. Reuse
  // that exact route so the two master passes remain directly comparable, then
  // add architecture and current-tool cameras plus fixed vacuum/washer stress
  // samples. This script changes only the isolated browser save fixture.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = process.env.ASSET_QA_OUT
    ? path.resolve(repo, process.env.ASSET_QA_OUT)
    : path.join(repo, 'qa', 'assets_51_100_master', 'baseline', 'current');
  fs.mkdirSync(out, { recursive: true });

  // Frozen UTF-8 source reconstructed byte-for-byte from the Sheet 6
  // before_stable fixture. Keeping it embedded prevents later 01-50 camera or
  // stock-fixture changes from invalidating the matched comparison.
  const inheritedPath = 'embedded:frozen-assets-01-50-sheet06-performance';
  const expectedInheritedSha256 = '1920c529d16bc9346af37bccc86d15a2274fc18aae7d4813ba4c26887e3a627f';
  const inheritedSource = process.getBuiltinModule('node:buffer').Buffer
    .from('YXN5bmMgKHBhZ2UpID0+IHsKICAvLyBNQVNURVIgQVNTRVQgMDEtNTAgQkFTRUxJTkUKICAvLwogIC8vIENhcHR1cmVzIGEgZGV0ZXJtaW5pc3RpYywgZnVsbHkgc3RvY2tlZCBwbGF5ZXItY2FtZXJhIGJhc2VsaW5lIGJlZm9yZSB0aGUKICAvLyBjcm9zcy1zaGVldCBwcm9kdWN0aW9uIHBhc3MuIENhbWVyYSBpbmplY3Rpb24gaXMgbGltaXRlZCB0byBlc3RhYmxpc2hpbmcgYQogIC8vIHJlcGVhdGFibGUgdmlzdWFsIGZpeHR1cmU7IGxhdGVyIGludGVyYWN0aW9uIGFjY2VwdGFuY2UgdXNlcyBub3JtYWwgY29udHJvbHMuCiAgY29uc3QgZnMgPSBwcm9jZXNzLmdldEJ1aWx0aW5Nb2R1bGUoJ25vZGU6ZnMnKTsKICBjb25zdCBwYXRoID0gcHJvY2Vzcy5nZXRCdWlsdGluTW9kdWxlKCdub2RlOnBhdGgnKTsKICBjb25zdCByZXBvID0gJ0M6L1VzZXJzL0tlbm5ldGgvRG9jdW1lbnRzL0dpdEh1Yi9Hb2xmLUZsaXBwZXInOwogIGNvbnN0IG91dCA9IHByb2Nlc3MuZW52LkFTU0VUX1FBX09VVAogICAgPyBwYXRoLnJlc29sdmUocmVwbywgcHJvY2Vzcy5lbnYuQVNTRVRfUUFfT1VUKQogICAgOiBwYXRoLmpvaW4ocmVwbywgJ3FhJywgJ2Fzc2V0c18wMV81MF9tYXN0ZXInLCAnYmFzZWxpbmUnLCAnY3VycmVudCcpOwogIGZzLm1rZGlyU3luYyhvdXQsIHsgcmVjdXJzaXZlOiB0cnVlIH0pOwoKICBjb25zdCB2aWV3cG9ydCA9IHsgd2lkdGg6IDE2MDAsIGhlaWdodDogOTAwIH07CiAgY29uc3QgY2FtZXJhcyA9IFsKICAgIHsgaWQ6ICcwMS1jaGVja291dC1vdmVydmlldycsIHg6IDAuNSwgejogMi4zLCB0eDogMi45LCB0ejogNC41LCBwaXRjaDogLTAuMTAgfSwKICAgIHsgaWQ6ICcwMi1jaGVja291dC1jdXN0b21lci1zaWRlJywgeDogNC41LCB6OiA1LjQsIHR4OiAyLjcsIHR6OiA0LjQsIHBpdGNoOiAtMC4xMCB9LAogICAgeyBpZDogJzAzLWNsdWItYW5kLXB1dHRlci1yYWNrcycsIHg6IC02LjMsIHo6IC0wLjIsIHR4OiAtOS45LCB0ejogLTAuNCwgcGl0Y2g6IDAuMDIgfSwKICAgIHsgaWQ6ICcwNC1iYWxsLWFuZC1hY2Nlc3Nvcnktd2FsbHMnLCB4OiAtNi45LCB6OiAtMy41LCB0eDogLTYuOSwgdHo6IC02LjIsIHBpdGNoOiAwLjA1IH0sCiAgICB7IGlkOiAnMDUtYXBwYXJlbC1hbmQtdGFibGVzJywgeDogLTQuMCwgejogMy40LCB0eDogLTUuNCwgdHo6IDAuMCwgcGl0Y2g6IC0wLjAyIH0sCiAgICB7IGlkOiAnMDYtYmFnLWFuZC1zaG9lLWRpc3BsYXlzJywgeDogMi4zLCB6OiAxLjcsIHR4OiAzLjcsIHR6OiAtMS45LCBwaXRjaDogLTAuMDIgfSwKICAgIHsgaWQ6ICcwNy1sb3VuZ2UnLCB4OiAxLjMsIHo6IC0zLjMsIHR4OiA0LjMsIHR6OiAtNS4zLCBwaXRjaDogLTAuMDMgfSwKICAgIHsgaWQ6ICcwOC1vZmZpY2UnLCB4OiA3LjIsIHo6IDQuMywgdHg6IDkuNiwgdHo6IDQuNiwgcGl0Y2g6IC0wLjA2IH0sCiAgICB7IGlkOiAnMDktc3RvY2tyb29tJywgeDogNy40LCB6OiAtMi4zLCB0eDogOC4xLCB0ejogLTUuOSwgcGl0Y2g6IC0wLjA0IH0sCiAgICB7IGlkOiAnMTAtcmVjZWl2aW5nLWFuZC1wYWxsZXRzJywgeDogMTYuMywgejogNC45LCB5YXc6IDAuNTIsIHBpdGNoOiAtMC4yNSB9LAogICAgeyBpZDogJzExLWRlbGl2ZXJ5LXNlcnZpY2UtYmF5JywgeDogMjUuMiwgejogOS4yLCB5YXc6IDEuMDAsIHBpdGNoOiAtMC4xNCB9LAogICAgeyBpZDogJzEyLXN0b2Nrcm9vbS1lcXVpcG1lbnQtY2xvc2UnLCB4OiA4LjgsIHo6IC0xLjgsIHlhdzogMC43NCwgcGl0Y2g6IC0wLjIwIH0sCiAgICB7IGlkOiAnMTMtZXh0ZXJpb3InLCB4OiA2LjUsIHo6IDE1LjUsIHR4OiAtMC41LCB0ejogMy4wLCBwaXRjaDogMC4wMyB9LAogIF07CgogIGNvbnN0IGRpYWdub3N0aWNzID0gW107CiAgcGFnZS5vbignY29uc29sZScsIChtZXNzYWdlKSA9PiB7CiAgICBpZiAobWVzc2FnZS50eXBlKCkgPT09ICdlcnJvcicgfHwgbWVzc2FnZS50eXBlKCkgPT09ICd3YXJuaW5nJykgewogICAgICBkaWFnbm9zdGljcy5wdXNoKHsga2luZDogYGNvbnNvbGU6JHttZXNzYWdlLnR5cGUoKX1gLCBtZXNzYWdlOiBtZXNzYWdlLnRleHQoKSB9KTsKICAgIH0KICB9KTsKICBwYWdlLm9uKCdwYWdlZXJyb3InLCAoZXJyb3IpID0+IGRpYWdub3N0aWNzLnB1c2goeyBraW5kOiAncGFnZWVycm9yJywgbWVzc2FnZTogZXJyb3IubWVzc2FnZSB9KSk7CiAgcGFnZS5vbigncmVxdWVzdGZhaWxlZCcsIChyZXF1ZXN0KSA9PiB7CiAgICBjb25zdCBmYWlsdXJlID0gcmVxdWVzdC5mYWlsdXJlKCk/LmVycm9yVGV4dCB8fCAndW5rbm93bic7CiAgICBkaWFnbm9zdGljcy5wdXNoKHsKICAgICAga2luZDogL0VSUl9BQk9SVEVEL2kudGVzdChmYWlsdXJlKSA/ICdyZXF1ZXN0YWJvcnRlZCcgOiAncmVxdWVzdGZhaWxlZCcsCiAgICAgIG1lc3NhZ2U6IGAke3JlcXVlc3QudXJsKCl9ICgke2ZhaWx1cmV9KWAsCiAgICB9KTsKICB9KTsKCiAgYXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUodmlld3BvcnQpOwogIGF3YWl0IHBhZ2UuZ290bygnaHR0cDovL2xvY2FsaG9zdDo4NDU3LycsIHsgd2FpdFVudGlsOiAnZG9tY29udGVudGxvYWRlZCcgfSk7CiAgYXdhaXQgcGFnZS5nZXRCeVRleHQoJ0NvbnRpbnVlJywgeyBleGFjdDogdHJ1ZSB9KS5jbGljaygpOwogIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKCgpID0+IHdpbmRvdy5fX2Z3Py5zY2VuZTNkPy5jbHViaG91c2U/LigpLCBudWxsLCB7IHRpbWVvdXQ6IDkwMDAwIH0pOwogIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKCgpID0+IHsKICAgIGNvbnN0IHZlaWwgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcubG9hZC12ZWlsJyk7CiAgICByZXR1cm4gIXZlaWwgfHwgdmVpbC5zdHlsZS5kaXNwbGF5ID09PSAnbm9uZScgfHwgZ2V0Q29tcHV0ZWRTdHlsZSh2ZWlsKS5vcGFjaXR5ID09PSAnMCc7CiAgfSwgbnVsbCwgeyB0aW1lb3V0OiA5MDAwMCB9KTsKICBhd2FpdCBwYWdlLndhaXRGb3JGdW5jdGlvbigoKSA9PiB7CiAgICBjb25zdCBjbHViaG91c2UgPSB3aW5kb3cuX19mdz8uc2NlbmUzZD8uY2x1YmhvdXNlPy4oKTsKICAgIGlmICghY2x1YmhvdXNlKSByZXR1cm4gZmFsc2U7CiAgICBjb25zdCBiYXNlUmVhZHkgPSAhY2x1YmhvdXNlLmFzc2V0c1JlYWR5IHx8IGNsdWJob3VzZS5hc3NldHNSZWFkeSgpOwogICAgY29uc3QgZXF1aXBtZW50UmVhZHkgPSAhY2x1YmhvdXNlLmRlbGl2ZXJ5RXF1aXBtZW50UmVhZHkgfHwgY2x1YmhvdXNlLmRlbGl2ZXJ5RXF1aXBtZW50UmVhZHkoKTsKICAgIGNvbnN0IHNoZWV0MDYgPSBjbHViaG91c2Uuc2hlZXQwNlByb2R1Y3Rpb24/LmRpYWdub3N0aWNzPy4oKSB8fCBudWxsOwogICAgY29uc3Qgc2hlZXQwNlJlYWR5ID0gIWNsdWJob3VzZS5zaGVldDA2UHJvZHVjdGlvbgogICAgICB8fCAoc2hlZXQwNj8uYWN0dWFsU2hhcmVkR2FtZUludGVncmF0ZWQgPT09IHRydWUgJiYgc2hlZXQwNj8uYWN0aXZhdGlvblN0YXR1cyA9PT0gJ2FjdGl2ZScpOwogICAgcmV0dXJuIGJhc2VSZWFkeSAmJiBlcXVpcG1lbnRSZWFkeSAmJiBzaGVldDA2UmVhZHk7CiAgfSwgbnVsbCwgeyB0aW1lb3V0OiA5MDAwMCB9KTsKCiAgY29uc3QgZml4dHVyZSA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gewogICAgY29uc3QgYXBwID0gd2luZG93Ll9fZnc7CiAgICBjb25zdCBjbHViaG91c2UgPSBhcHAuc2NlbmUzZC5jbHViaG91c2UoKTsKICAgIGFwcC5zcGVlZElkeCA9IDA7CiAgICBhcHAuc2NlbmUzZC53YWxrLmNsZWFyS2V5cz8uKCk7CiAgICBjbHViaG91c2Uuc2V0T3JnYW5pY1dhbGtpbnM/LihmYWxzZSk7CiAgICBjbHViaG91c2UuY2xlYXJXYWxraW5zPy4oKTsKICAgIGNvbnN0IGRheSA9IE1hdGguZmxvb3IoYXBwLnN0YXRlLmNsb2NrLm1pbnV0ZXMgLyAxNDQwKSAqIDE0NDA7CiAgICBhcHAuc3RhdGUuY2xvY2subWludXRlcyA9IGRheSArIDE0ICogNjA7CiAgICBhcHAuc3RhdGUud2VhdGhlci50b2RheSA9IHsKICAgICAgdGVtcEhpRjogNzIsCiAgICAgIHRlbXBMb0Y6IDU0LAogICAgICByYWluSW46IDAsCiAgICAgIGh1bWlkaXR5OiAwLjQ4LAogICAgICB3aW5kTXBoOiA1LAogICAgfTsKICAgIGFwcC5zdGF0ZS53ZWF0aGVyLmxvY2tlZCA9IHRydWU7CiAgICBpZiAoYXBwLnN0YXRlLnNob3AucmVubykgewogICAgICBhcHAuc3RhdGUuc2hvcC5yZW5vLmdyaW1lLmZpbGwoMCk7CiAgICAgIGZvciAoY29uc3QgY2x1dHRlciBvZiBhcHAuc3RhdGUuc2hvcC5yZW5vLmNsdXR0ZXIgfHwgW10pIGNsdXR0ZXIuY2xlYXJlZCA9IHRydWU7CiAgICB9CiAgICBjb25zdCBub25SZXRhaWwgPSBuZXcgU2V0KFsncnVnMScsICdwbGFudDEnLCAncG9zdGVyMScsICdib2FyZDEnLCAnbGlnaHQxJywgJ2xvdW5nZTEnLCAndmFjMSddKTsKICAgIGNvbnN0IHBhcmtlZE5vblJldGFpbCA9IFtdOwogICAgZm9yIChjb25zdCBbaWQsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhhcHAuc3RhdGUuc2hvcC5pbnZlbnRvcnkgfHwge30pKSB7CiAgICAgIGlmIChlbnRyeSAmJiB0eXBlb2YgZW50cnkgPT09ICdvYmplY3QnKSB7CiAgICAgICAgaWYgKG5vblJldGFpbC5oYXMoaWQpKSB7CiAgICAgICAgICBlbnRyeS5zaGVsZiA9IDA7CiAgICAgICAgICBlbnRyeS5iYWNrID0gMDsKICAgICAgICAgIHBhcmtlZE5vblJldGFpbC5wdXNoKGlkKTsKICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KICAgICAgICBlbnRyeS5zaGVsZiA9IE1hdGgubWF4KDEyLCBOdW1iZXIoZW50cnkuc2hlbGYpIHx8IDApOwogICAgICAgIGVudHJ5LmJhY2sgPSBNYXRoLm1heCg2LCBOdW1iZXIoZW50cnkuYmFjaykgfHwgMCk7CiAgICAgIH0KICAgIH0KICAgIGNsdWJob3VzZS5yZWJ1aWxkU3RvY2s/LigpOwogICAgY2x1YmhvdXNlLnJlYnVpbGRSZW5vPy4oKTsKICAgIGFwcC5zY2VuZTNkLmFwcGx5VGltZVdlYXRoZXI/LigxNCAqIDYwLCBhcHAuc3RhdGUud2VhdGhlcik7CiAgICByZXR1cm4gewogICAgICBkZXNjcmlwdGlvbjogJ1dpbGxvdyBDcmVlayBib290c3RyYXAsIHBhdXNlZCBhdCAyIFBNLCBjbGVhciB3ZWF0aGVyLCBjbGVhbi9jbHV0dGVyLWZyZWUgc2hvcCwgZnVsbHkgc3RvY2tlZCByZXRhaWwgaW52ZW50b3J5LCBvcmdhbmljIGN1c3RvbWVycyBkaXNhYmxlZCcsCiAgICAgIGludGVyaW9yT2Zmc2V0OiBjbHViaG91c2UuaW50ZXJpb3IucG9zaXRpb24udG9BcnJheSgpLAogICAgICBpbnZlbnRvcnlFbnRyaWVzOiBPYmplY3Qua2V5cyhhcHAuc3RhdGUuc2hvcC5pbnZlbnRvcnkgfHwge30pLmxlbmd0aCwKICAgICAgcGFya2VkTm9uUmV0YWlsLAogICAgICBkZWxpdmVyeUVxdWlwbWVudDogY2x1YmhvdXNlLmRlbGl2ZXJ5RXF1aXBtZW50RGlhZ25vc3RpY3M/LigpIHx8IG51bGwsCiAgICB9OwogIH0pOwogIGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMTIwMCk7CgogIGNvbnN0IGNhcHR1cmVkID0gW107CiAgZm9yIChjb25zdCBjYW1lcmEgb2YgY2FtZXJhcykgewogICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoc2hvdCkgPT4gewogICAgICBjb25zdCBhcHAgPSB3aW5kb3cuX19mdzsKICAgICAgY29uc3Qgd2FsayA9IGFwcC5zY2VuZTNkLndhbGs7CiAgICAgIGNvbnN0IHN0YXRlID0gd2Fsay5zdGF0ZTsKICAgICAgd2Fsay5jbGVhcktleXM/LigpOwogICAgICBjb25zdCBvcmlnaW4gPSBhcHAuc2NlbmUzZC5jbHViaG91c2UoKS5pbnRlcmlvci5wb3NpdGlvbjsKICAgICAgc3RhdGUueCA9IHNob3Qud29ybGQgPyBzaG90LnggOiBvcmlnaW4ueCArIHNob3QueDsKICAgICAgc3RhdGUueiA9IHNob3Qud29ybGQgPyBzaG90LnogOiBvcmlnaW4ueiArIHNob3QuejsKICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZShzaG90LnlhdykpIHN0YXRlLnlhdyA9IHNob3QueWF3OwogICAgICBlbHNlIHsKICAgICAgICBjb25zdCB0YXJnZXRYID0gc2hvdC53b3JsZCA/IHNob3QudHggOiBvcmlnaW4ueCArIHNob3QudHg7CiAgICAgICAgY29uc3QgdGFyZ2V0WiA9IHNob3Qud29ybGQgPyBzaG90LnR6IDogb3JpZ2luLnogKyBzaG90LnR6OwogICAgICAgIGNvbnN0IGR4ID0gdGFyZ2V0WCAtIHN0YXRlLng7CiAgICAgICAgY29uc3QgZHogPSB0YXJnZXRaIC0gc3RhdGUuejsKICAgICAgICBjb25zdCBkaXN0YW5jZSA9IE1hdGguaHlwb3QoZHgsIGR6KSB8fCAxOwogICAgICAgIHN0YXRlLnlhdyA9IE1hdGguYXRhbjIoLWR4IC8gZGlzdGFuY2UsIC1keiAvIGRpc3RhbmNlKTsKICAgICAgfQogICAgICBzdGF0ZS5waXRjaCA9IHNob3QucGl0Y2g7CiAgICAgIGNvbnN0IGRheSA9IE1hdGguZmxvb3IoYXBwLnN0YXRlLmNsb2NrLm1pbnV0ZXMgLyAxNDQwKSAqIDE0NDA7CiAgICAgIGFwcC5zdGF0ZS5jbG9jay5taW51dGVzID0gZGF5ICsgMTQgKiA2MDsKICAgICAgYXBwLnNjZW5lM2QuYXBwbHlUaW1lV2VhdGhlcj8uKDE0ICogNjAsIGFwcC5zdGF0ZS53ZWF0aGVyKTsKICAgIH0sIGNhbWVyYSk7CiAgICBhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDUwMCk7CiAgICBjb25zdCBmaWxlID0gcGF0aC5qb2luKG91dCwgYCR7Y2FtZXJhLmlkfS5wbmdgKTsKICAgIGF3YWl0IHBhZ2Uuc2NyZWVuc2hvdCh7IHBhdGg6IGZpbGUgfSk7CiAgICBjYXB0dXJlZC5wdXNoKGZpbGUpOwogIH0KCiAgY29uc3QgZnJhbWVTYW1wbGVzID0gW107CiAgZm9yIChsZXQgc2FtcGxlID0gMDsgc2FtcGxlIDwgMzsgc2FtcGxlICs9IDEpIHsKICAgIGNvbnN0IGZyYW1lcyA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsKICAgICAgY29uc3QgdmFsdWVzID0gW107CiAgICAgIGxldCBwcmlvciA9IHBlcmZvcm1hbmNlLm5vdygpOwogICAgICBjb25zdCBzdGFydCA9IHByaW9yOwogICAgICBmdW5jdGlvbiB0aWNrKG5vdykgewogICAgICAgIHZhbHVlcy5wdXNoKG5vdyAtIHByaW9yKTsKICAgICAgICBwcmlvciA9IG5vdzsKICAgICAgICBpZiAobm93IC0gc3RhcnQgPj0gMjUwMCkgcmVzb2x2ZSh2YWx1ZXMuc2xpY2UoMSkpOwogICAgICAgIGVsc2UgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRpY2spOwogICAgICB9CiAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aWNrKTsKICAgIH0pKTsKICAgIGZyYW1lU2FtcGxlcy5wdXNoKGZyYW1lcyk7CiAgfQoKICBjb25zdCBmbGF0RnJhbWVzID0gZnJhbWVTYW1wbGVzLmZsYXQoKS5maWx0ZXIoKHZhbHVlKSA9PiB2YWx1ZSA+IDApOwogIGNvbnN0IHNvcnRlZFNsb3cgPSBbLi4uZmxhdEZyYW1lc10uc29ydCgoYSwgYikgPT4gYiAtIGEpOwogIGNvbnN0IHNsb3dDb3VudCA9IE1hdGgubWF4KDEsIE1hdGguY2VpbChzb3J0ZWRTbG93Lmxlbmd0aCAqIDAuMDEpKTsKICBjb25zdCBzbG93TWVhbiA9IHNvcnRlZFNsb3cuc2xpY2UoMCwgc2xvd0NvdW50KS5yZWR1Y2UoKHN1bSwgdmFsdWUpID0+IHN1bSArIHZhbHVlLCAwKSAvIHNsb3dDb3VudDsKICBjb25zdCBkdXJhdGlvbiA9IGZsYXRGcmFtZXMucmVkdWNlKChzdW0sIHZhbHVlKSA9PiBzdW0gKyB2YWx1ZSwgMCk7CgogIGNvbnN0IHJlbmRlcmVyID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gewogICAgY29uc3QgczMgPSB3aW5kb3cuX19mdy5zY2VuZTNkOwogICAgY29uc3Qgb3V0cHV0ID0gczMucmVuZGVyZXI7CiAgICBvdXRwdXQuaW5mby5hdXRvUmVzZXQgPSBmYWxzZTsKICAgIG91dHB1dC5pbmZvLnJlc2V0KCk7CiAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHsKICAgICAgY29uc3QgbWF0ZXJpYWxzID0gbmV3IFNldCgpOwogICAgICBjb25zdCB0ZXh0dXJlcyA9IG5ldyBTZXQoKTsKICAgICAgbGV0IG1lc2hlcyA9IDA7CiAgICAgIGxldCBzY2VuZVRyaWFuZ2xlcyA9IDA7CiAgICAgIGxldCBzaGFkb3dDYXN0ZXJzID0gMDsKICAgICAgbGV0IG5vZGVzID0gMDsKICAgICAgczMuc2NlbmUudHJhdmVyc2UoKG9iamVjdCkgPT4gewogICAgICAgIG5vZGVzICs9IDE7CiAgICAgICAgaWYgKCFvYmplY3QuaXNNZXNoIHx8ICFvYmplY3QudmlzaWJsZSkgcmV0dXJuOwogICAgICAgIG1lc2hlcyArPSAxOwogICAgICAgIGlmIChvYmplY3QuY2FzdFNoYWRvdykgc2hhZG93Q2FzdGVycyArPSAxOwogICAgICAgIGNvbnN0IGdlb21ldHJ5ID0gb2JqZWN0Lmdlb21ldHJ5OwogICAgICAgIGNvbnN0IHRyaWFuZ2xlcyA9IGdlb21ldHJ5Py5pbmRleAogICAgICAgICAgPyBnZW9tZXRyeS5pbmRleC5jb3VudCAvIDMKICAgICAgICAgIDogKGdlb21ldHJ5Py5hdHRyaWJ1dGVzPy5wb3NpdGlvbj8uY291bnQgfHwgMCkgLyAzOwogICAgICAgIHNjZW5lVHJpYW5nbGVzICs9IHRyaWFuZ2xlcyAqIChvYmplY3QuaXNJbnN0YW5jZWRNZXNoID8gb2JqZWN0LmNvdW50IDogMSk7CiAgICAgICAgZm9yIChjb25zdCBtYXRlcmlhbCBvZiAoQXJyYXkuaXNBcnJheShvYmplY3QubWF0ZXJpYWwpID8gb2JqZWN0Lm1hdGVyaWFsIDogW29iamVjdC5tYXRlcmlhbF0pKSB7CiAgICAgICAgICBpZiAoIW1hdGVyaWFsKSBjb250aW51ZTsKICAgICAgICAgIG1hdGVyaWFscy5hZGQobWF0ZXJpYWwudXVpZCk7CiAgICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiBbJ21hcCcsICdub3JtYWxNYXAnLCAncm91Z2huZXNzTWFwJywgJ21ldGFsbmVzc01hcCcsICdhb01hcCcsICdlbWlzc2l2ZU1hcCddKSB7CiAgICAgICAgICAgIGlmIChtYXRlcmlhbFtrZXldKSB0ZXh0dXJlcy5hZGQobWF0ZXJpYWxba2V5XS51dWlkKTsKICAgICAgICAgIH0KICAgICAgICB9CiAgICAgIH0pOwogICAgICBjb25zdCByZXN1bHQgPSB7CiAgICAgICAgZHJhd0NhbGxzOiBvdXRwdXQuaW5mby5yZW5kZXIuY2FsbHMsCiAgICAgICAgcmVuZGVyZWRUcmlhbmdsZXM6IG91dHB1dC5pbmZvLnJlbmRlci50cmlhbmdsZXMsCiAgICAgICAgc2NlbmVUcmlhbmdsZXM6IE1hdGgucm91bmQoc2NlbmVUcmlhbmdsZXMpLAogICAgICAgIHNjZW5lTm9kZXM6IG5vZGVzLAogICAgICAgIHZpc2libGVNZXNoZXM6IG1lc2hlcywKICAgICAgICBtYXRlcmlhbENvdW50OiBtYXRlcmlhbHMuc2l6ZSwKICAgICAgICB0ZXh0dXJlQ291bnQ6IHRleHR1cmVzLnNpemUsCiAgICAgICAgdGV4dHVyZU1lbW9yeUJ5dGVzOiBudWxsLAogICAgICAgIHNoYWRvd0Nhc3RlcnMsCiAgICAgICAgZ2VvbWV0cmllc0luTWVtb3J5OiBvdXRwdXQuaW5mby5tZW1vcnkuZ2VvbWV0cmllcywKICAgICAgICB0ZXh0dXJlc0luTWVtb3J5OiBvdXRwdXQuaW5mby5tZW1vcnkudGV4dHVyZXMsCiAgICAgIH07CiAgICAgIG91dHB1dC5pbmZvLmF1dG9SZXNldCA9IHRydWU7CiAgICAgIHJlc29sdmUocmVzdWx0KTsKICAgIH0pKTsKICB9KSk7CgogIGNvbnN0IGNkcCA9IGF3YWl0IHBhZ2UuY29udGV4dCgpLm5ld0NEUFNlc3Npb24ocGFnZSk7CiAgYXdhaXQgY2RwLnNlbmQoJ1BlcmZvcm1hbmNlLmVuYWJsZScpOwogIGNvbnN0IHBlcmZvcm1hbmNlTWV0cmljcyA9IGF3YWl0IGNkcC5zZW5kKCdQZXJmb3JtYW5jZS5nZXRNZXRyaWNzJyk7CiAgY29uc3QgYnJvd3NlciA9IE9iamVjdC5mcm9tRW50cmllcyhwZXJmb3JtYW5jZU1ldHJpY3MubWV0cmljcy5tYXAoKG1ldHJpYykgPT4gW21ldHJpYy5uYW1lLCBtZXRyaWMudmFsdWVdKSk7CiAgYXdhaXQgY2RwLmRldGFjaCgpOwoKICBjb25zdCByZXBvcnQgPSB7CiAgICBjYXB0dXJlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksCiAgICBsYXVuY2g6ICdub2RlIHRvb2xzL3FhL3J1bi1wbGF5d3JpZ2h0LmNqcyB0b29scy9xYS9hc3NldHMtMDEtNTAtYmFzZWxpbmUuanMgLS1ib290c3RyYXAnLAogICAgbWV0aG9kb2xvZ3k6IHsKICAgICAgdmlld3BvcnQsCiAgICAgIGRldmljZVNjYWxlRmFjdG9yOiAxLAogICAgICB3YXJtdXA6ICdzaGFkZXIgdmVpbCBjbGVhcmVkLCBhbGwgZGVjbGFyZWQgY2x1YmhvdXNlL2RlbGl2ZXJ5IGFzc2V0cyByZWFkeSwgdGhlbiAxLjIgc2Vjb25kcycsCiAgICAgIGZyYW1lU2FtcGxpbmc6ICd0aHJlZSBjb25zZWN1dGl2ZSAyLjUgc2Vjb25kIHJlcXVlc3RBbmltYXRpb25GcmFtZSBzYW1wbGVzIGF0IGZpeGVkIGNhbWVyYSAxMycsCiAgICAgIHRleHR1cmVNZW1vcnk6ICd1bm1lYXN1cmVkOyByZW5kZXJlciBleHBvc2VzIGNvdW50IGJ1dCBub3QgYnl0ZSBzaXplJywKICAgICAgY2FtZXJhRXN0YWJsaXNobWVudDogJ2RvY3VtZW50ZWQgZGV0ZXJtaW5pc3RpYyBmaXh0dXJlOyBub3JtYWwtY29udHJvbCBhY2NlcHRhbmNlIGlzIHNlcGFyYXRlJywKICAgIH0sCiAgICBmaXh0dXJlLAogICAgY2FtZXJhcywKICAgIGNhcHR1cmVzOiBjYXB0dXJlZCwKICAgIHBlcmZvcm1hbmNlOiB7CiAgICAgIGZyYW1lQ291bnQ6IGZsYXRGcmFtZXMubGVuZ3RoLAogICAgICBhdmVyYWdlRnBzOiBmbGF0RnJhbWVzLmxlbmd0aCAqIDEwMDAgLyBkdXJhdGlvbiwKICAgICAgb25lUGVyY2VudExvd0ZwczogMTAwMCAvIHNsb3dNZWFuLAogICAgICB3b3JzdEZyYW1lTXM6IHNvcnRlZFNsb3dbMF0gfHwgbnVsbCwKICAgICAgcmVuZGVyZXIsCiAgICAgIGJyb3dzZXI6IHsKICAgICAgICBqc0hlYXBVc2VkQnl0ZXM6IGJyb3dzZXIuSlNIZWFwVXNlZFNpemUgPz8gbnVsbCwKICAgICAgICBqc0hlYXBUb3RhbEJ5dGVzOiBicm93c2VyLkpTSGVhcFRvdGFsU2l6ZSA/PyBudWxsLAogICAgICAgIGV2ZW50TGlzdGVuZXJzOiBicm93c2VyLkpTRXZlbnRMaXN0ZW5lcnMgPz8gbnVsbCwKICAgICAgICBub2RlczogYnJvd3Nlci5Ob2RlcyA/PyBudWxsLAogICAgICAgIGRvY3VtZW50czogYnJvd3Nlci5Eb2N1bWVudHMgPz8gbnVsbCwKICAgICAgfSwKICAgIH0sCiAgICBkaWFnbm9zdGljcywKICB9OwogIGZzLndyaXRlRmlsZVN5bmMocGF0aC5qb2luKG91dCwgJ2Jhc2VsaW5lLXJlc3VsdC5qc29uJyksIGAke0pTT04uc3RyaW5naWZ5KHJlcG9ydCwgbnVsbCwgMil9XG5gKTsKICBjb25zdCBibG9ja2luZ0RpYWdub3N0aWNzID0gZGlhZ25vc3RpY3MuZmlsdGVyKChlbnRyeSkgPT4gIVsKICAgICdjb25zb2xlOndhcm5pbmcnLAogICAgJ3JlcXVlc3RhYm9ydGVkJywKICBdLmluY2x1ZGVzKGVudHJ5LmtpbmQpKTsKICByZXR1cm4geyBvazogYmxvY2tpbmdEaWFnbm9zdGljcy5sZW5ndGggPT09IDAsIC4uLnJlcG9ydCB9Owp9Cg==', 'base64')
    .toString('utf8');
  const inheritedSha256 = crypto.createHash('sha256').update(inheritedSource).digest('hex');
  if (inheritedSha256 !== expectedInheritedSha256) {
    throw new Error(`Frozen Sheet 6 performance fixture hash mismatch: ${inheritedSha256}`);
  }
  // The frozen fixture predates worktree-aware QA and therefore contains the
  // original repository path and default port. Keep hashing the canonical bytes,
  // then replace only those two environment bindings in the executable copy so
  // a benchmark cannot silently sample another worktree's server or write its
  // evidence outside this checkout.
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const frozenRepoBinding = /const repo = '[^'\r\n]+';/u;
  const frozenUrlBinding = "await page.goto('http://localhost:8457/',";
  if (!frozenRepoBinding.test(inheritedSource) || !inheritedSource.includes(frozenUrlBinding)) {
    throw new Error('Frozen Sheet 6 performance fixture environment bindings changed unexpectedly.');
  }
  const executableInheritedSource = inheritedSource
    .replace(frozenRepoBinding, `const repo = ${JSON.stringify(repo)};`)
    .replace(frozenUrlBinding, `await page.goto(${JSON.stringify(baseUrl)},`);
  const inheritedRun = Function(`"use strict"; return (${executableInheritedSource});`)();
  const httpDiagnostics = [];
  page.on('response', (response) => {
    if (response.status() < 400) return;
    httpDiagnostics.push({
      kind: 'http-response',
      message: `${response.status()} ${response.request().method()} ${response.url()}`,
      resourceType: response.request().resourceType(),
    });
  });
  const oldOut = process.env.ASSET_QA_OUT;
  process.env.ASSET_QA_OUT = path.relative(repo, out).split(path.sep).join('/');
  let baseline;
  try {
    baseline = await inheritedRun(page);
  } finally {
    if (oldOut === undefined) delete process.env.ASSET_QA_OUT;
    else process.env.ASSET_QA_OUT = oldOut;
  }

  const sheet06ProductionReadiness = await page.evaluate(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    const available = !!production;
    const diagnostics = production?.diagnostics?.() || null;
    return {
      available,
      actualSharedGameIntegrated: diagnostics?.actualSharedGameIntegrated === true,
      activationStatus: diagnostics?.activationStatus || null,
    };
  });
  if (!sheet06ProductionReadiness.available
    || !sheet06ProductionReadiness.actualSharedGameIntegrated
    || sheet06ProductionReadiness.activationStatus !== 'active') {
    throw new Error(`Sheet 6 production was not active for the frozen performance fixture: ${JSON.stringify(sheet06ProductionReadiness)}`);
  }

  const extraDiagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      extraDiagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => extraDiagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    extraDiagnostics.push({
      kind: /ERR_ABORTED/i.test(failure) ? 'requestaborted' : 'requestfailed',
      message: `${request.url()} (${failure})`,
    });
  });

  const cameras = [
    { id: '14-entry-porch-and-double-doors', x: -4.8, z: 11.6, tx: -0.8, tz: 6.4, pitch: -0.02 },
    { id: '15-south-windows-and-siding', x: -8.0, z: 12.8, tx: -6.4, tz: 6.5, pitch: 0.02 },
    { id: '16-interior-wall-floor-ceiling', x: -1.0, z: 1.4, tx: -7.5, tz: -3.8, pitch: 0.13 },
    { id: '17-front-and-back-counter-context', x: 0.2, z: 2.0, tx: 3.2, tz: 4.6, pitch: -0.08 },
    { id: '18-lounge-furniture-context', x: 1.0, z: -2.6, tx: 4.0, tz: -5.0, pitch: -0.05 },
    { id: '19-office-desk-chair-and-props', x: 7.0, z: 3.6, tx: 9.3, tz: 4.6, pitch: -0.04 },
    { id: '20-stockroom-shelving-and-cleaning-corner', x: 7.1, z: -2.0, tx: 6.1, tz: 1.45, pitch: -0.07 },
  ];

  async function pose(camera, tool = null, dirty = false) {
    await page.evaluate(({ shot, heldTool, makeDirty }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + shot.x;
      walk.state.z = origin.z + shot.z;
      const targetX = origin.x + shot.tx;
      const targetZ = origin.z + shot.tz;
      const dx = targetX - walk.state.x;
      const dz = targetZ - walk.state.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.state.pitch = shot.pitch;
      if (makeDirty && app.state.shop?.reno?.grime) {
        app.state.shop.reno.grime.fill(0.82);
        clubhouse.rebuildReno?.();
      }
      if (app.state.shop?.inventory?.vac1) app.state.shop.inventory.vac1.back = Math.max(1, app.state.shop.inventory.vac1.back || 0);
      walk.setSpraying?.(false);
      walk.setSoaping?.(false);
      walk.setTool?.(heldTool);
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, { shot: camera, heldTool: tool, makeDirty: dirty });
    await page.waitForTimeout(700);
  }

  const extraCaptures = [];
  for (const camera of cameras) {
    await pose(camera);
    const file = path.join(out, `${camera.id}.png`);
    await page.screenshot({ path: file });
    extraCaptures.push(file);
  }

  const vacuumCamera = { id: '21-current-vacuum-viewmodel', x: -0.2, z: 1.8, tx: -0.2, tz: -0.2, pitch: -0.30 };
  await pose(vacuumCamera, 'vacuum', true);
  const vacuumFile = path.join(out, `${vacuumCamera.id}.png`);
  await page.screenshot({ path: vacuumFile });
  extraCaptures.push(vacuumFile);

  const washerCamera = { id: '22-current-pressure-washer-viewmodel', x: -1.0, z: 11.5, tx: -1.0, tz: 6.4, pitch: -0.02 };
  await pose(washerCamera, 'washer');
  const washerFile = path.join(out, `${washerCamera.id}.png`);
  await page.screenshot({ path: washerFile });
  extraCaptures.push(washerFile);

  async function measureScenario(name, camera, tool, useTool) {
    await pose(camera, tool, tool === 'vacuum');
    await page.evaluate((on) => window.__fw.scene3d.walk.setSpraying?.(on), useTool);
    await page.waitForTimeout(800);
    const sample = await page.evaluate(async () => {
      const hud = document.querySelector('.hud') || document.querySelector('#ui');
      let uiMutations = 0;
      const observer = new MutationObserver((records) => { uiMutations += records.length; });
      if (hud) observer.observe(hud, { subtree: true, childList: true, characterData: true, attributes: true });
      const frames = [];
      let prior = performance.now();
      const start = prior;
      await new Promise((resolve) => {
        function tick(now) {
          frames.push(now - prior);
          prior = now;
          if (now - start >= 5000) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      observer.disconnect();
      return { frames: frames.slice(1), uiMutations, durationMs: performance.now() - start };
    });
    await page.evaluate(() => {
      const walk = window.__fw.scene3d.walk;
      walk.setSpraying?.(false);
      walk.setSoaping?.(false);
    });

    const renderer = await page.evaluate(() => new Promise((resolve) => {
      const s3 = window.__fw.scene3d;
      const output = s3.renderer;
      output.info.autoReset = false;
      output.info.reset();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const materials = new Set();
        const textures = new Set();
        let nodes = 0;
        let visibleMeshes = 0;
        let sceneTriangles = 0;
        s3.scene.traverse((object) => {
          nodes += 1;
          if (!object.isMesh || !object.visible) return;
          visibleMeshes += 1;
          const geometry = object.geometry;
          const triangles = geometry?.index
            ? geometry.index.count / 3
            : (geometry?.attributes?.position?.count || 0) / 3;
          sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
          for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
            if (!material) continue;
            materials.add(material.uuid);
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
              if (material[key]) textures.add(material[key].uuid);
            }
          }
        });
        const result = {
          drawCalls: output.info.render.calls,
          renderedTriangles: output.info.render.triangles,
          sceneTriangles: Math.round(sceneTriangles),
          sceneNodes: nodes,
          visibleMeshes,
          materialCount: materials.size,
          textureCount: textures.size,
          textureMemoryBytes: null,
          textureMemoryReason: 'Three.js renderer exposes texture count but not allocated byte size.',
          geometriesInMemory: output.info.memory.geometries,
          texturesInMemory: output.info.memory.textures,
        };
        output.info.autoReset = true;
        resolve(result);
      }));
    }));

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = await cdp.send('Performance.getMetrics');
    await cdp.detach();
    const browser = Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value]));
    const frameTimes = sample.frames.filter((value) => value > 0);
    const slowest = [...frameTimes].sort((a, b) => b - a);
    const onePercentCount = Math.max(1, Math.ceil(slowest.length * 0.01));
    const onePercentFrame = slowest.slice(0, onePercentCount).reduce((sum, value) => sum + value, 0) / onePercentCount;
    const duration = frameTimes.reduce((sum, value) => sum + value, 0);
    return {
      name,
      tool,
      usingTool: useTool,
      durationMs: sample.durationMs,
      frameCount: frameTimes.length,
      averageFps: frameTimes.length * 1000 / duration,
      onePercentLowFps: 1000 / onePercentFrame,
      worstFrameMs: slowest[0] || null,
      uiMutationCount: sample.uiMutations,
      uiMutationsPerSecond: sample.uiMutations / (sample.durationMs / 1000),
      renderer,
      browser: {
        jsHeapUsedBytes: browser.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: browser.JSHeapTotalSize ?? null,
        eventListeners: browser.JSEventListeners ?? null,
        nodes: browser.Nodes ?? null,
        documents: browser.Documents ?? null,
      },
    };
  }

  const performanceScenarios = {
    inheritedIdleExterior: baseline.performance,
    vacuumActive: await measureScenario('vacuum-active-dirty-shop-floor', vacuumCamera, 'vacuum', true),
    pressureWasherActive: await measureScenario('pressure-washer-active-south-siding', washerCamera, 'washer', true),
  };

  await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    walk.setSpraying?.(false);
    walk.setSoaping?.(false);
    walk.setTool?.(null);
  });

  const diagnostics = [
    ...(baseline.diagnostics || []),
    ...extraDiagnostics,
    ...httpDiagnostics,
  ];
  const blockingDiagnostics = diagnostics.filter((entry) => ![
    'console:warning',
    'requestaborted',
  ].includes(entry.kind));
  const report = {
    ...baseline,
    ok: blockingDiagnostics.length === 0,
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/assets-51-100-sheet06-performance.js --bootstrap',
    inheritedBaselineScript: {
      path: inheritedPath,
      sha256: inheritedSha256,
      runtimeOverrides: { repo, baseUrl },
    },
    sheet06ProductionReadiness,
    methodology: {
      ...baseline.methodology,
      runtimeOrigin: process.env.QA_BASE_URL || 'http://localhost:8457/',
      frozenIdleFixture: `Embedded 13-camera/Math.max(12) source ${inheritedSha256}; strict Sheet 6 activation assertion after the inherited sample.`,
      extraFixedCameras: 'Seven architecture/furniture cameras plus current vacuum and pressure-washer viewmodel cameras.',
      stressScenarios: 'Five-second fixed-route samples with the current vacuum and pressure washer actively running after 0.8-second warm-up.',
      uiUpdateFrequency: 'MutationObserver record count under the HUD/UI root during each five-second stress sample.',
    },
    cameras: [...(baseline.cameras || []), ...cameras, vacuumCamera, washerCamera],
    captures: [...(baseline.captures || []), ...extraCaptures],
    performanceScenarios,
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'baseline-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
