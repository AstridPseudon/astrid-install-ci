'use strict';
const app = require('./lib');
module.exports = async () => ({ run: [
  app.customStep(app.ensureDoorPortFree),
  app.customStep(async () => app.ensureProgramDirectory()),
  app.gitShellStep(app.validateExistingEditorCheckout() ? app.pullEditorMessage() : app.cloneEditorMessage()),
  app.shellStep(app.bootstrapScript('install', app.paths.join(app.EDITOR_DIR, 'public', 'install-manifest.json'))),
  app.sessionStep('build', 'local'),
  app.saveModeStep('local'),
] });
