# Task L validation and handoff

All launcher changes are in `/Users/hannahomalley/Developer/astrid-pinokio`, branch `main`, as explicitly requested. No remote is configured. No push or PR was made. No package installation, login service, real Runtime or editor server was run. The actual POSIX bootstrap was executed only against fakes. Tests did not probe the live door, use the live data root, or touch production/live-door/app-door. Temporary fixtures were removed.

## Commands run

```sh
node --test tests/*.test.mjs
node tests/check-bootstrap.mjs /Users/hannahomalley/Developer/astrid-video/astrid-local/labs/pinokio-app-bootstrap/public/install
```

Every tracked/untracked launcher `.js` and `.mjs` file is checked with `node --check`; `git diff --check` is also run before commit. Final result: 24 Node tests passed, the bootstrap-source check passed for both raw-ref and checkout paths, all 17 JavaScript modules passed syntax checks, and the diff whitespace check passed.

The tests load `pinokio.js` and every action module with fake kernel/info/app objects. The exact command fixture covers darwin, linux and win32, both modes, empty ref and `feat/pinokio`, including quoting of spaces/apostrophes. It tests menu state, URL publication ordering, stop awaiting, delete confirmation, pinned-tool/data selection, port classification, and success/failure/interrupt cleanup. Native POSIX subprocess fixtures also prove successful builds, failed builds whose leader exits before descendants, and interrupted builds leave no live fixture descendants.

The optional bootstrap-source check executes the actual POSIX bootstrap supplied on its command line with fake curl, uv, Python-environment creation and package installation. Real Python only executes the bootstrap's standard-library handoff code. It verifies that only the two selected raw-ref URLs are requested, the manifest reaches the installer CLI, and temporary files are removed. It does not test internet availability, GitHub access, real package resolution or installation.

Sources inspected: agent `5e6f9e402`, app-bootstrap `c56946787`, editor worktree `833a848c8`, pinokiod `add4a67`; Runtime foreground changes in `labs/pinokio-runtime-run`. The coordinator must combine the bootstrap/editor changes and repin agent/Runtime before testing a published ref. Production endpoints were not assumed to contain those commits.

## Add to the owner's TESTING.md

These checks require the real Pinokio version and native operating system; the fake matrix does not establish them.

1. Fresh install of each choice from production and with `ASTRID_APP_REF=feat/pinokio`. Confirm bootstrap source, manifest pins, selected branch, program root, external data root, `managed_by=pinokio`, and no login service. On Windows prove PowerShell 5.1 argument forwarding, local `-File` Bypass behavior under the host's policy, UTF-8, native exit status, paths with spaces/apostrophes/ampersands/`!`, and the explicit refusal for `%`/quotes/newlines.
2. Hosted Start: Open is absent until the health JSON is ready; it opens `https://astrid.haus/?connect=1` in a popout. Confirm the real CORS/browser connection, permissions, projects, and agent discovery.
3. Local Start: no door on 17340; preview listens only on 127.0.0.1:5180; proxy on 17336 works; workspace config identifies the owned Runtime; Open appears only after attach and HTTP readiness. Confirm a schema/pin mismatch fails without Open. Confirm the editor works offline after installation and astrid.haus cannot connect or trigger a permission prompt.
4. Stop and Pinokio quit, during startup and after readiness, in both modes: capture all Runtime, worker, supervisor, dev-local, proxy, npm and Vite PIDs first; check that none survive and 17340/5180/17336 close. Restart immediately. On Windows cover Ctrl+C, Ctrl+Break, closing the console, Pinokio Stop, application quit, ConPTY behavior, Job containment and locked-file removal. Linux needs the same native checks; the process smoke here ran on macOS.
5. Kill the owned Runtime while local preview is attaching and after it is ready. The supervisor must stop the editor. Check the app wrapper's possible `astrid-runtime up` handoff does not leave a replacement daemon outside Pinokio's tree. Also stop/quit during this handoff and during a slow build. This race cannot be established by the fake children or normal POSIX build smoke.
6. Trigger npm install/build failure and interrupt a local install/update. Confirm temporary Runtime/proxy/Vite processes are gone, no local mode was saved early, and `public/bootstrap-venv` is absent. Retry successfully. Confirm the built preview serves the newly emitted dist and no installer venv was copied into it.
7. Update each choice while running (invoke its action directly if the running menu hides it), and Add local editor from a running hosted install. Confirm the owner stops first, no running-update refusal remains, backend pins match the checkout, the next local Start has the door off, and Update stays on the selected branch. Changing a local ref requires Reset/reinstall; detached tag/SHA updates are unsupported.
8. Put a separate Astrid on 17340, then an unrelated HTTP and non-HTTP program there. Confirm explanation/Open-only versus conflict and no second owner. Occupy 5180 with another editor/program and check local Start fails without stopping it. A healthy Runtime on the selected data root with no door must also cause a refusal.
9. Reset removes only app program/editor files and leaves projects/data untouched. Uninstall stops first and uses the Astrid uninstaller while retaining data. Wrong/cancelled `DELETE` changes nothing; exact `DELETE` invokes `--delete-data`. Cover Windows locked files and reinstall after Reset/Uninstall.
10. Verify Pinokio renders operation-only menus, pending Start/Stop, and published URLs correctly; default Start selection respects `ASTRID_AUTOSTART=0`. Verify the installed-environment npm entrypoint works without npm/npx symlinks on PATH.

Known source issue for the coordinator: the editor's diagnostics derive `<root>/with-env` from `ASTRID_START_COMMAND`, although the new installer has no such entry. The launcher uses the real `run`/`run.cmd` for the start hint and explicit recorded Python/profile/data for actual attach. A friendly Runtime-up hint can therefore be unusable on an editor validation error; it needs an upstream diagnostic change. No bootstrap or app source was changed by Task L.


## Files changed

- `ENVIRONMENT`, `README.md`, `pinokio.js`.
- `docs/INTERFACE.md`, `docs/VALIDATION.md`.
- `pinokio/lib.js`, `pinokio/session.mjs`.
- `pinokio/platforms/posix.js`, `pinokio/platforms/windows.js`.
- `pinokio/install.js`, `pinokio/install-local.js`, `pinokio/add-local.js`, `pinokio/update.js`.
- `pinokio/start.js`, `pinokio/stop.js`, `pinokio/reset.js`, `pinokio/uninstall.js`, `pinokio/uninstall-delete-data.js`.
- `tests/launcher.test.mjs`, `tests/process.test.mjs`, `tests/check-bootstrap.mjs`, `tests/commands.json`.
