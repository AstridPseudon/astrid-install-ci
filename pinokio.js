'use strict';

const app = require('./pinokio/lib');

const ICON = 'fa-solid fa-feather-pointed';

function infoItem(text, icon = 'fa-solid fa-circle-info') {
  return { icon, text };
}

function openItem(mode) {
  return { icon: 'fa-solid fa-arrow-up-right-from-square', text: 'Open Astrid', ...app.modeOpenTarget(mode) };
}

function autoStartEnabled() {
  return app.setting('ASTRID_AUTOSTART', '1') !== '0';
}

module.exports = {
  version: '8.0.0',
  menu: async (_kernel, info) => {
    const installScripts = [
      ['pinokio/install.js', 'Installing back end…'],
      ['pinokio/install-local.js', 'Installing fully local…'],
      ['pinokio/add-local.js', 'Adding local editor…'],
      ['pinokio/update.js', 'Updating Astrid…'],
      ['pinokio/reset.js', 'Resetting Astrid…'],
      ['pinokio/uninstall.js', 'Uninstalling Astrid…'],
      ['pinokio/uninstall-delete-data.js', 'Uninstalling and deleting Astrid data…'],
    ];
    const activeOperation = installScripts.find(([uri]) => info.running(uri));
    if (activeOperation) return [infoItem(activeOperation[1], 'fa-solid fa-spinner')];

    const storedMode = app.readInstallMode();
    const installed = Boolean(storedMode && (
      info.exists('app/astrid/run') || info.exists('app/astrid/run.cmd')
    ));
    const starting = info.running('pinokio/start.js');

    if (starting) {
      const local = info.local('pinokio/start.js') || {};
      const mode = ['backend', 'local'].includes(local.mode) ? local.mode : storedMode;
      return [openItem(mode), { icon: 'fa-solid fa-stop', text: 'Stop', href: 'pinokio/stop.js' }];
    }

    if (!installed) {
      return [
        { icon: 'fa-solid fa-download', text: 'Install', href: 'pinokio/install.js' },
        { icon: 'fa-solid fa-laptop', text: 'Install fully local', href: 'pinokio/install-local.js' },
      ];
    }

    const port = await app.probeDoor();
    if (port.kind === 'astrid') return [openItem(storedMode)];
    if (port.kind === 'occupied') {
      return [infoItem('Port 17340 is already in use. Stop that program before starting Astrid.', 'fa-solid fa-triangle-exclamation')];
    }

    const startItem = { icon: 'fa-solid fa-play', text: 'Start', href: 'pinokio/start.js' };
    if (autoStartEnabled()) startItem.default = true;
    const items = [
      startItem,
      { icon: 'fa-solid fa-rotate', text: 'Update', href: 'pinokio/update.js' },
    ];
    if (storedMode === 'backend') {
      items.push({ icon: 'fa-solid fa-laptop', text: 'Add local editor', href: 'pinokio/add-local.js' });
    }
    items.push(
      { icon: 'fa-solid fa-broom', text: 'Reset', href: 'pinokio/reset.js' },
      { icon: 'fa-solid fa-trash-can-arrow-up', text: 'Uninstall', href: 'pinokio/uninstall.js' },
      { icon: 'fa-solid fa-triangle-exclamation', text: 'Uninstall and permanently delete all data…', href: 'pinokio/uninstall-delete-data.js' },
    );
    return items;
  },
};
