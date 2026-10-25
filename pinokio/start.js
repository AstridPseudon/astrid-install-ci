'use strict';

const app = require('./lib');

module.exports = async () => {
  const mode = app.readInstallMode();
  if (!mode) throw new Error('Astrid install mode is missing. Reinstall Astrid from Pinokio.');
  const { root, editor } = app.getPaths();
  const steps = [
    app.customStep(app.ensureDoorPortFree),
    app.backendLaunchStep(root, { hostedOriginOff: mode === 'local' }),
    app.customStep(app.waitForDoor),
  ];

  if (mode === 'local') {
    steps.push(
      app.localEditorLaunchStep(root, editor),
      app.customStep(app.waitForLocalEditor),
    );
  }

  const target = app.localSetOpenTarget(mode);
  steps.push({ method: 'local.set', params: { url: target.url, mode: target.mode } });
  return { daemon: true, run: steps };
};
