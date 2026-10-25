'use strict';
const app = require('./lib');
module.exports = async () => {
  const mode = app.readInstallMode();
  if (!mode) throw new Error('Astrid install mode is missing. Reinstall Astrid from Pinokio.');
  const steps = [app.customStep(app.stopOwnedStart), app.customStep(app.ensureDoorPortFree)];
  if (mode === 'local') {
    if (!app.validateExistingEditorCheckout()) throw new Error('The local editor checkout is missing. Reset and reinstall.');
    steps.push(
      app.shellStep(app.pullEditorMessage()),
      app.shellStep(app.bootstrapScript('update', app.paths.join(app.EDITOR_DIR, 'public', 'install-manifest.json'))),
      app.sessionStep('build', 'local'),
    );
  } else steps.push(app.shellStep(app.bootstrapScript('update')));
  return { run: steps };
};
