'use strict';

const path = require('node:path');
const app = require('./lib');

module.exports = async () => {
  const mode = app.readInstallMode();
  if (!mode) throw new Error('Astrid install mode is missing. Reinstall Astrid from Pinokio.');
  const { root, editor } = app.getPaths();
  const steps = [];

  if (mode === 'local') {
    app.validateExistingEditorCheckout(editor);
    steps.push(app.shellStep(app.pullEditorMessage(editor)));
    steps.push(app.shellStep(app.bootstrapScript('update', path.join(editor, 'public', 'install-manifest.json'))));
    // The build helper validates the running Runtime; Pinokio owns this temporary
    // process and tears it down when the update script completes.
    steps.push(
      app.customStep(app.ensureDoorPortFree),
      app.backendLaunchStep(root, { hostedOriginOff: true }),
      app.customStep(app.waitForDoor),
      app.shellStep(app.pinnedNodeBuildMessage(root, editor), {
        cwd: editor,
        env: {
          ASTRID_APP_LOOPBACK_ORIGIN: 'off',
          ASTRID_START_COMMAND: app.editorStartCommand(root),
        },
      }),
    );
  } else {
    steps.push(app.shellStep(app.bootstrapScript('update')));
  }

  return { run: steps };
};
