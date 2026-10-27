'use strict';
const app = require('./lib');
module.exports = async () => {
  const mode = app.readInstallMode();
  if (!mode) throw new Error("Astrid isn't fully installed. Choose Reset, then install again.");
  if (mode === 'backend') return { run: [
    app.customStep(app.preflightStop),
    app.gitShellStep(app.launcherPullMessage()),
    app.shellStep(app.bootstrapScript('update-app')),
  ] };
  const steps = [app.customStep(app.stopOwnedStart), app.gitShellStep(app.launcherPullMessage()), app.customStep(app.ensureDoorPortFree)];
  if (mode === 'local') {
    if (!app.validateExistingEditorCheckout()) throw new Error("Astrid's editor files are missing. Choose Reset, then install again.");
    steps.push(
      app.gitShellStep(app.pullEditorMessage()),
      app.shellStep(app.bootstrapScript('update', app.paths.join(app.EDITOR_DIR, 'public', 'install-manifest.json'))),
      app.sessionStep('build', 'local'),
    );
  } else steps.push(app.shellStep(app.bootstrapScript('update')));
  return { run: steps };
};
