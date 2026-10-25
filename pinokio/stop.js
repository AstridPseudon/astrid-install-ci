'use strict';
const app = require('./lib');
module.exports = { run: [app.customStep(app.stopOwnedStart)] };
