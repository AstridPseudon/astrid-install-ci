'use strict';

const fs = require('node:fs');
const app = require('./lib');

module.exports = async () => {
  const { root } = app.getPaths();
  const steps = [];
  if (fs.existsSync(root)) steps.push(app.shellStep(app.bootstrapScript('uninstall')));
  steps.push(app.customStep(async () => {
    app.removeProgramFiles();
    return { uninstalled: true, dataKept: true };
  }));
  return { run: steps };
};
