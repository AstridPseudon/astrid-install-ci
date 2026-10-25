'use strict';

const path = require('node:path');
const app = require('./lib');

module.exports = async () => {
  if (app.readInstallMode() !== 'backend') {
    throw new Error('Add local editor is available only for a back-end-only install.');
  }
  const { root, editor } = app.getPaths();
  const hasEditorCheckout = app.validateExistingEditorCheckout(editor);
  const steps = [
    app.customStep(async () => {
      app.ensureProgramDirectory();
      return { ready: true };
    }),
    app.customStep(app.ensureDoorPortFree),
  ];

  if (!hasEditorCheckout) steps.push(app.shellStep(app.cloneEditorMessage(editor)));
  steps.push(
    // Align the backend with the app checkout's own pinned manifest before building it.
    app.shellStep(app.bootstrapScript('update', path.join(editor, 'public', 'install-manifest.json'))),
    app.backendLaunchStep(root, { hostedOriginOff: true }),
    app.customStep(app.waitForDoor),
    app.shellStep(app.pinnedNodeBuildMessage(root, editor), {
      cwd: editor,
      env: {
        ASTRID_APP_LOOPBACK_ORIGIN: 'off',
        ASTRID_START_COMMAND: app.editorStartCommand(root),
      },
    }),
    app.saveModeStep('local'),
  );

  return { run: steps };
};
