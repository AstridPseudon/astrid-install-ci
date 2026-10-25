'use strict';
const app = require('./lib');
module.exports = async () => ({ run: [
  app.customStep(app.ensureDoorPortFree),
  app.customStep(async () => app.ensureProgramDirectory()),
  app.shellStep(app.bootstrapScript('install')),
  app.saveModeStep('backend'),
] });
