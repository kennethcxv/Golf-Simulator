// Holds a renderer/user setting at one temporary value for a narrowly scoped
// interaction, then puts back the exact value that was present on entry.
// Missing adapters are deliberately a no-op so renderer-less clubhouse tests and
// fallback scenes keep the same behavior.
export function createScopedBooleanOverride({ read, write, overrideValue = false } = {}) {
  const available = typeof read === 'function' && typeof write === 'function';
  let held = false;
  let priorValue;

  function setActive(active) {
    if (!available) return false;
    if (active) {
      if (!held) {
        const captured = read();
        write(overrideValue);
        priorValue = captured;
        held = true;
      } else if (read() !== overrideValue) {
        // A settings refresh cannot accidentally re-enable the expensive effect
        // while the scoped workspace still owns the override.
        write(overrideValue);
      }
      return true;
    }
    return restore();
  }

  function restore() {
    if (!available || !held) return false;
    // Clear ownership only after the write succeeds, so teardown can retry if a
    // renderer adapter ever rejects during a context-loss edge case.
    write(priorValue);
    held = false;
    priorValue = undefined;
    return true;
  }

  return Object.freeze({
    setActive,
    restore,
    state: () => Object.freeze({ available, held, priorValue }),
  });
}
