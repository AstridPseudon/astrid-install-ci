'use strict';
const app = require('./lib');
module.exports = async () => ({ run: [
  app.customStep(app.stopOwnedStart),
  app.customStep(async () => { app.removeProgramFiles(); return { reset: true, dataKept: true }; }),
] });
