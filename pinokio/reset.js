'use strict';

const app = require('./lib');

module.exports = async () => {
  const { root } = app.getPaths();
  const hasBackend = require('node:fs').existsSync(root);
  const steps = [];
  if (hasBackend) steps.push(app.shellStep(app.bootstrapScript('uninstall')));
  steps.push(app.customStep(async () => {
    app.removeProgramFiles();
    return { reset: true, dataKept: true };
  }));
  return { run: steps };
};
