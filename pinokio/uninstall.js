'use strict';
const app = require('./lib');
module.exports = async () => ({ run: [
  app.customStep(app.stopOwnedStart),
  app.customStep(app.ensureDoorPortFree),
  app.shellStep(app.bootstrapScript('uninstall')),
  app.customStep(async () => { app.removeProgramFiles(); return { uninstalled: true, dataKept: true }; }),
] });
