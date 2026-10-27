'use strict';
const app = require('./lib');
module.exports = async () => {
  // A pending transaction is recovered before launcher/editor inputs change.
  // The installed CLI exits after recovery, so the user can retry Update.
  if (app.hasPendingUpdate()) return { run: [app.customStep(app.recoverPendingUpdate)] };
  const mode = app.readInstallMode();
  if (!mode) throw new Error("Astrid isn't fully installed. Choose Reset, then install again.");
  // This is an early, read-only refusal check. C2 stages and validates its
  // candidate before asking Runtime's C1 fence to stop the current owner.
  const steps = [app.customStep(app.preflightStop), app.gitShellStep(app.launcherPullMessage())];
  if (mode === 'local') {
    if (!app.validateExistingEditorCheckout()) throw new Error("Astrid's editor files are missing. Choose Reset, then install again.");
    steps.push(
      app.gitShellStep(app.pullEditorMessage()),
      app.shellStep(app.bootstrapScript('install', app.paths.join(app.EDITOR_DIR, 'public', 'install-manifest.json'))),
    );
  } else steps.push(app.shellStep(app.bootstrapScript('install')));
  return { run: steps };
};
