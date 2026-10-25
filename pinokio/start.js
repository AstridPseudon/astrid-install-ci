'use strict';
const app = require('./lib');
module.exports = async () => {
  const mode = app.readInstallMode();
  // Pinokio also resolves this module while stopping it. Defer validation to
  // execution so Stop/Reset still work after a partial or damaged install.
  if (!mode) return { run: [app.customStep(async () => {
    throw new Error('Astrid install mode is missing. Reinstall Astrid from Pinokio.');
  })] };
  return { daemon: true, run: [
    app.customStep(app.ensureDoorPortFree),
    app.sessionStep('serve', mode),
    // The supervisor emits its sentinel only after health/attach + HTTP readiness.
    { method: 'local.set', params: app.localSetOpenTarget(mode) },
  ] };
};
