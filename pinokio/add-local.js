'use strict';
const app = require('./lib');
module.exports = async () => {
  if (app.readInstallMode() !== 'backend') throw new Error('Astrid is already fully local.');
  return { run: [
    app.customStep(app.stopOwnedStart),
    app.customStep(app.ensureDoorPortFree),
    app.shellStep(app.validateExistingEditorCheckout() ? app.pullEditorMessage() : app.cloneEditorMessage()),
    app.shellStep(app.bootstrapScript('update', app.paths.join(app.EDITOR_DIR, 'public', 'install-manifest.json'))),
    app.sessionStep('build', 'local'),
    app.saveModeStep('local'),
  ] };
};
