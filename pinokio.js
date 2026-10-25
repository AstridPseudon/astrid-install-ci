'use strict';
const app = require('./pinokio/lib');
const infoItem = (text) => ({ icon: 'fa-solid fa-circle-info', text });
const openItem = (target) => ({ icon: 'fa-solid fa-arrow-up-right-from-square', text: 'Open Astrid', ...target });
const item = (text, script, icon) => ({ icon: `fa-solid fa-${icon}`, text, href: `pinokio/${script}.js` });

module.exports = {
  version: '8.0.0',
  menu: async (_kernel, info) => {
    const operations = [
      ['install', 'Installing back end…'], ['install-local', 'Installing fully local…'],
      ['add-local', 'Adding local editor…'], ['update', 'Updating Astrid…'],
      ['reset', 'Resetting Astrid…'], ['uninstall', 'Uninstalling Astrid…'],
      ['uninstall-delete-data', 'Uninstalling and deleting Astrid data…'], ['stop', 'Stopping Astrid…'],
    ];
    const active = operations.find(([script]) => info.running(`pinokio/${script}.js`));
    if (active) return [infoItem(active[1])];
    const mode = app.readInstallMode();
    const installed = Boolean(mode && (info.exists('app/astrid/run') || info.exists('app/astrid/run.cmd')));
    if (info.running('pinokio/start.js')) {
      const local = info.local('pinokio/start.js') || {};
      const ready = local.url === app.modeOpenTarget(mode).href && local.mode === mode;
      return [ready ? openItem({ href: local.url, popout: mode !== 'local' }) : infoItem('Starting Astrid…'),
        item('Stop', 'stop', 'stop')];
    }
    const port = await app.probeDoor();
    if (port.kind === 'astrid') return [infoItem('Astrid is already running on port 17340.'), openItem(app.modeOpenTarget('backend'))];
    if (port.kind === 'occupied') return [infoItem('Another program is using port 17340. Stop it before starting Astrid.')];
    if (!installed) return [item('Install', 'install', 'download'), item('Install fully local', 'install-local', 'laptop')];
    const items = [item('Start', 'start', 'play'), item('Update', 'update', 'rotate')];
    if (app.setting('ASTRID_AUTOSTART', '1') !== '0') items[0].default = true;
    if (mode === 'backend') items.push(item('Add local editor', 'add-local', 'laptop'));
    items.push(item('Reset', 'reset', 'broom'), item('Uninstall', 'uninstall', 'trash-can-arrow-up'),
      item('Uninstall and permanently delete all data…', 'uninstall-delete-data', 'triangle-exclamation'));
    return items;
  },
};
