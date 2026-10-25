'use strict';

const fs = require('node:fs');
const app = require('./lib');

module.exports = async () => {
  const { root } = app.getPaths();
  const steps = [
    {
      method: 'input',
      params: {
        title: 'Permanently delete Astrid data?',
        description: 'This removes Astrid projects and all other data in the Astrid data root. This cannot be undone.',
        form: [{
          type: 'text',
          key: 'confirmation',
          title: 'Type DELETE to continue',
          description: 'Uninstall (keep data) is available as a separate action.',
          required: true,
          placeholder: 'DELETE',
        }],
      },
    },
    app.customStep(async (req) => {
      if (req.input?.confirmation !== 'DELETE') throw new Error('Data deletion cancelled; type DELETE exactly to continue.');
      return { confirmed: true };
    }),
  ];
  if (fs.existsSync(root)) steps.push(app.shellStep(app.bootstrapScript('uninstall', undefined, true)));
  steps.push(app.customStep(async () => {
    app.removeProgramFiles();
    return { uninstalled: true, dataDeleted: true };
  }));
  return { run: steps };
};
