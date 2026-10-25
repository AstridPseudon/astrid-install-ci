'use strict';

const app = require('./lib');

module.exports = async () => {
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
    app.shellStep(app.bootstrapScript('install', require('node:path').join(editor, 'public', 'install-manifest.json'))),
    // dev-local-workspace.mjs --build verifies the Runtime, so keep a temporary
    // Pinokio-owned backend process alive until the local editor build finishes.
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
