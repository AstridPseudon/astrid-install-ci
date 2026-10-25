'use strict';
const app = require('./lib');
module.exports = async () => ({ run: [
  { method: 'input', params: {
    title: 'Permanently delete Astrid data?',
    description: 'This permanently removes projects and all other data in the Astrid data root.',
    form: [{ type: 'text', key: 'confirmation', title: 'Type DELETE to continue', required: true, placeholder: 'DELETE' }],
  } },
  app.customStep(async (req) => {
    if (req.input?.confirmation !== 'DELETE') throw new Error('Data deletion cancelled; type DELETE exactly to continue.');
    return { confirmed: true };
  }),
  app.customStep(app.stopOwnedStart),
  app.customStep(app.ensureDoorPortFree),
  app.shellStep(app.bootstrapScript('uninstall', undefined, true)),
  app.customStep(async () => { app.removeProgramFiles(); return { uninstalled: true, dataDeleted: true }; }),
] });
