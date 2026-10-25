'use strict';

const path = require('node:path');

function requireAbsoluteWindowsPath(value, label) {
  if (typeof value !== 'string' || !path.win32.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute Windows path`);
  }
  return path.win32.normalize(value);
}

// PowerShell single-quoted strings escape embedded quotes by doubling them.
function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getAppPaths(pinokioAppDir) {
  const base = requireAbsoluteWindowsPath(pinokioAppDir, 'Pinokio app directory');
  return {
    root: path.win32.join(base, 'app', 'astrid'),
    editor: path.win32.join(base, 'app', 'editor'),
  };
}

/** Build a PowerShell command that invokes the hosted bootstrap script. */
function buildBootstrapScript({
  root,
  installerUrl,
  action,
  manifest,
  deleteData = false,
} = {}) {
  const installRoot = requireAbsoluteWindowsPath(root, 'Install root');
  if (typeof installerUrl !== 'string' || !/^https?:\/\//i.test(installerUrl)) {
    throw new TypeError('installerUrl must be an http or https URL');
  }
  const args = [
    '--root', quotePowerShell(installRoot),
    '--managed-by', 'pinokio',
  ];
  if (action === 'update') args.push('--update');
  else if (action === 'uninstall') args.push('--uninstall');
  else if (action !== undefined && action !== 'install') {
    throw new TypeError("action must be 'install', 'update', or 'uninstall'");
  }
  if (deleteData) {
    if (action !== 'uninstall') throw new TypeError('deleteData is only valid for uninstall');
    args.push('--delete-data');
  }
  if (manifest !== undefined) {
    args.push('--manifest', quotePowerShell(requireAbsoluteWindowsPath(manifest, 'Manifest path')));
  }

  return `& ([scriptblock]::Create((irm ${quotePowerShell(installerUrl)}))) ${args.join(' ')}`;
}

function buildBootstrapCommand(options = {}) {
  const script = buildBootstrapScript(options);
  return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
  };
}

/** Build a PowerShell invocation for root\\run.cmd and passthrough args. */
function buildRunScript(root, passthroughArgs = []) {
  const installRoot = requireAbsoluteWindowsPath(root, 'Install root');
  const runCmd = path.win32.join(installRoot, 'run.cmd');
  if (!Array.isArray(passthroughArgs)) throw new TypeError('passthroughArgs must be an array');
  return `& ${quotePowerShell(runCmd)}${passthroughArgs.length ? ` ${passthroughArgs.map(quotePowerShell).join(' ')}` : ''}`;
}

function buildRunCommand(root, passthroughArgs = []) {
  const installRoot = requireAbsoluteWindowsPath(root, 'Install root');
  const script = buildRunScript(installRoot, passthroughArgs);
  return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    cwd: installRoot,
    shell: false,
  };
}

module.exports = {
  quotePowerShell,
  getAppPaths,
  buildBootstrapScript,
  buildBootstrapCommand,
  buildRunScript,
  buildRunCommand,
};
