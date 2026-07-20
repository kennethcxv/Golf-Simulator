# Electron 43 Release Runtime

## Outcome

`S-001` is resolved. Electron was upgraded from 33.4.11 to 43.1.1, and the full
dependency tree now reports zero known vulnerabilities.

The Electron 43 documented behavior changes affect downloads, native-image
color normalization, and Linux window chrome; this game uses none of those
paths. The upgrade supplies Chromium 150 and Node 24 while retaining the
existing sandboxed local renderer.

## Security hardening

- Renderer sandbox, context isolation, and disabled Node integration remain
  explicit BrowserWindow settings.
- Native persistence IPC accepts only the top-level packaged `index.html`
  frame.
- Native persistence accepts only the autosave and three game slot/meta keys,
  with a 16 MiB serialized-payload limit.
- Unrequested navigation, child windows, and webviews are denied.
- The window remains hidden until `ready-to-show`, preventing an unpainted
  startup flash.
- The existing restrictive CSP remains active.

Primary guidance reviewed:

- https://www.electronjs.org/blog/electron-43-0
- https://www.electronjs.org/docs/latest/breaking-changes
- https://www.electronjs.org/docs/latest/tutorial/security

## Native desktop QA

The app was launched from `node_modules/electron/dist/electron.exe` with an
isolated `--user-data-dir` and attached through the Chrome DevTools protocol.
`result.json` records all checks:

- Electron 43.1.1 / Chromium 150 runtime
- preload bridge present; Node globals absent
- menu boot and reload/Continue
- byte-identical native save/load plus on-disk JSON proof
- allowlisted key enforcement and native delete cleanup
- healthy WebGL context
- denied child window
- first-person pointer lock
- zero console errors or CSP violations

`after.png` is the captured Electron gameplay frame. The isolated save folder
was empty at the end of the run and the owned Electron process was stopped.
