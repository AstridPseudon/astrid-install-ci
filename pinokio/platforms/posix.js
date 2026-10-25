"use strict";

const path = require("node:path");

// POSIX shell helpers for Pinokio's macOS and Linux scripts. These functions
// only construct commands; callers are responsible for running them.

function quote(value) {
  // Single-quote every dynamic value, escaping embedded single quotes using
  // the standard shell close/escape/reopen sequence.
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function absolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty path`);
  }
  if (!path.isAbsolute(value)) {
    throw new TypeError(`${label} must be absolute: ${value}`);
  }
  return path.normalize(value);
}

function appRoot(pinokioAppDirectory) {
  const appDirectory = absolutePath(pinokioAppDirectory, "Pinokio app directory");
  return path.join(appDirectory, "app", "astrid");
}

function editorDirectory(pinokioAppDirectory) {
  const appDirectory = absolutePath(pinokioAppDirectory, "Pinokio app directory");
  return path.join(appDirectory, "app", "editor");
}

function bootstrapCommand(bootstrapUrl, root, flags = []) {
  if (typeof bootstrapUrl !== "string" || !/^https?:\/\//i.test(bootstrapUrl)) {
    throw new TypeError("bootstrap URL must use http or https");
  }
  const installRoot = absolutePath(root, "Astrid root");
  const args = ["--root", installRoot, "--managed-by", "pinokio", ...flags];
  return `curl -fsSL ${quote(bootstrapUrl)} | sh -s -- ${args.map(quote).join(" ")}`;
}

function install(bootstrapUrl, root) {
  return bootstrapCommand(bootstrapUrl, root);
}

function update(bootstrapUrl, root) {
  return bootstrapCommand(bootstrapUrl, root, ["--update"]);
}

function uninstall(bootstrapUrl, root) {
  return bootstrapCommand(bootstrapUrl, root, ["--uninstall"]);
}

function manifestCommand(bootstrapUrl, root, manifestFile, action) {
  if (typeof bootstrapUrl !== "string" || !/^https?:\/\//i.test(bootstrapUrl)) {
    throw new TypeError("bootstrap URL must use http or https");
  }
  const installRoot = absolutePath(root, "Astrid root");
  const manifest = absolutePath(manifestFile, "Manifest file");
  const flags = ["--root", installRoot, "--managed-by", "pinokio"];
  if (action === "update") flags.push("--update");
  else if (action !== undefined && action !== "install") {
    throw new TypeError("action must be 'install' or 'update'");
  }
  flags.push("--manifest", manifest);
  return `curl -fsSL ${quote(bootstrapUrl)} | sh -s -- ${flags.map(quote).join(" ")}`;
}

function uninstallAndDeleteData(bootstrapUrl, root) {
  return bootstrapCommand(bootstrapUrl, root, ["--uninstall", "--delete-data"]);
}

function run(root, args = []) {
  const installRoot = absolutePath(root, "Astrid root");
  if (!Array.isArray(args)) throw new TypeError("run arguments must be an array");
  return [quote(path.join(installRoot, "run")), ...args.map(quote)].join(" ");
}

module.exports = {
  quote,
  absolutePath,
  appRoot,
  editorDirectory,
  install,
  update,
  uninstall,
  manifestCommand,
  uninstallAndDeleteData,
  run,
};
