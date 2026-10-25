'use strict';

const app = require('./lib');

module.exports = async () => ({
  run: [
    app.customStep(async () => {
      app.ensureProgramDirectory();
      return { ready: true };
    }),
    app.shellStep(app.bootstrapScript('install')),
    app.saveModeStep('backend'),
  ],
});
