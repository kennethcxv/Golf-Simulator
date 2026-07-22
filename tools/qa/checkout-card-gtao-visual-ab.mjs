// Backward-compatible entry point for existing QA invocations. The GTAO bypass
// is register-scoped now, so the implementation and evidence live under the
// register-scoped harness name.
export {
  runCheckoutRegisterGtaoVisualAb,
  runCheckoutRegisterGtaoVisualAb as runCheckoutCardGtaoVisualAb,
} from './checkout-register-gtao-visual-ab.mjs';
