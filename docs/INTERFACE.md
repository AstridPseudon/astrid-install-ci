# Installer and Pinokio interface assumptions

This launcher is N3 scaffolding. These are the interface assumptions used by its scripts; reconcile them with the installer and runtime changes before release.

## Bootstrap and installed commands

- `ASTRID_INSTALL_URL` is the one bootstrap URL setting used on every platform. `ENVIRONMENT` defaults it to `https://astrid.haus/install`.
- POSIX install command: `curl -fsSL <url> | sh -s -- --root <absolute-root> --managed-by pinokio`.
- Windows install command: `& ([scriptblock]::Create((irm <url>))) --root <absolute-root> --managed-by pinokio`.
- Update and uninstall use the same root and manager arguments, with `--update` or `--uninstall` respectively.
- A local manifest is passed as `--manifest <absolute-file>` alongside the root and manager arguments. Fully local install/add/update use the editor checkout's `public/install-manifest.json`.
- `ENVIRONMENT` has one `ASTRID_INSTALL_URL` setting. Its default base is `https://astrid.haus/install`; Windows derives `https://astrid.haus/install.ps1`. A non-default override is used verbatim on both platforms, so tests can point it at their local bootstrap URL.
- The installer writes `<root>/run` on POSIX and `<root>\run.cmd` on Windows. It also writes `<root>/start` or `<root>\start.cmd`; the editor build receives that path in `ASTRID_START_COMMAND`.
- `--uninstall` keeps user data. The separate, typed-confirmation action adds `--delete-data` to `--uninstall`.
- `--managed-by pinokio` installs without registering a login service. Every launcher-owned backend start passes `ASTRID_INSTALL_MANAGED_BY=pinokio` to the run entry.

## Program layout and mode record

The Pinokio app folder is derived from the location of `pinokio.js`. Program files are stored at:

- `<Pinokio app>/app/astrid` — installed back end
- `<Pinokio app>/app/editor` — optional `banodoco/astrid-app` checkout
- `<Pinokio app>/app/install-mode.json` — the small `backend` or `local` install record

Reset and uninstall remove only `<Pinokio app>/app` after asking the installer to uninstall the back end. They do not choose a data root or remove it. The permanent-delete action relies on the installer's default/existing data-root selection.

## Fully local editor build

`dev-local-workspace.mjs --build` validates a running Runtime before building. Install fully local, Add local editor, and fully local Update therefore start `<root>/run` temporarily through Pinokio, wait for Runtime health, run the editor build, and let Pinokio clean up that temporary process when the non-daemon script finishes.

The build command runs the Node pinned in the installed version record. This scaffold assumes the installer stores `current` as the installed version ID, the version record at `<root>/versions/<id>/version.json`, and `env.ASTRID_NODE_EXECUTABLE` as the pinned Node path. POSIX scripts use the installed Python at `<version>/py/bin/python` to read that record; Windows uses PowerShell JSON parsing. The launcher invokes the Node distribution's bundled `npx-cli.js` as `node npx-cli.js -y npm@11 ci` (the same `npx -y npm@11 ci` operation without relying on an unpacked `npx` symlink), followed by `node scripts/dev-local-workspace.mjs --build`.

The local install and start paths pass `--hosted-origin off` to the backend and set `ASTRID_APP_LOOPBACK_ORIGIN=off` for the local editor. The preview command is `node scripts/dev-local-workspace.mjs --preview --preview-dir <absolute-editor-dist>` and is expected to listen only on `127.0.0.1:5180`.

## Readiness and menu state

- Runtime readiness is checked at `http://127.0.0.1:17340/api/runtime/v1/health`; success is HTTP 200 with JSON `status: "ok"` and `protocol: "workspace.v1"`.
- The local editor readiness probe uses `http://127.0.0.1:5180/tools/video-editor`.
- Start uses Pinokio `shell.run` with a startup sentinel and `done: true`, then waits on the health URL. Pinokio keeps the shell with the start script. Stop calls `script.stop` for `pinokio/start.js`.
- The dynamic menu uses `info.exists`, `info.running`, and `info.local`. If port `17340` already answers as Astrid, it offers Open only. If another program answers there, it displays a port conflict and hides Start until that program stops.
- Open for back-end-only installs is `https://astrid.haus/?connect=1` with `popout: true`. Open for fully local installs is `http://127.0.0.1:5180/tools/video-editor?connect=1`.
- `ASTRID_AUTOSTART=1` makes Start the default menu item after installation; set it to `0` to disable that default.

Pinokio's manual does not mandate icon dimensions or a raster format. The launcher includes a PNG, as used by the inspected launchers; `icon.png` is 256×256, scaled from the 16×16 source SVG with nearest-neighbour resampling.

## Open points for reconciliation

- Confirm the new installer accepts the bootstrap flags and keeps the `run`, `run.cmd`, `start`, and `start.cmd` paths described above.
- Confirm the installed version pointer/record and pinned Node field remain stable, or update the local editor command builder to the X1 layout.
- Confirm that a Pinokio-managed `run` with `--hosted-origin off` still exposes the local Runtime health endpoint on port `17340`.
- Confirm the local editor build succeeds with the temporary Pinokio-owned Runtime and that finishing the install/update script stops that temporary process on all three operating systems.
- Confirm the hosted bootstrap serves a manifest-compatible installer before setting `ASTRID_INSTALL_URL` back to the public URL in the beta listing.
