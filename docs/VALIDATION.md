# Task L validation and handoff

## GitHub CI

- **Unit** runs the launcher tests on Ubuntu, macOS and Windows with Node 20.19.4. The spec reporter prints skipped tests with their names and reasons.
- **Pinokio smoke** runs the real install, Start, health, one-second render, Stop, Update, restart and Uninstall flow on all three systems inside a temporary Pinokio home. It checks the downloaded FFmpeg pin, cache/data paths, service registration and port cleanup.
- **Fully local** installs and builds the local editor on Ubuntu, starts it on port 5180, checks the Runtime health proxy, and confirms the hosted origin is refused.

CI runs for pushes to `feat/pinokio` and `main`, pull requests, manual dispatches, and nightly upstream-drift checks.

The current Track L environment work is in `/Users/hannahomalley/Developer/astrid-pinokio`, branch `feat/pinokio`. The source-backed Pinokio environment fixture was pushed first in its own commit. No package installation, login service, real Runtime or editor server was run locally. The actual POSIX bootstrap was executed only against fakes. Tests use a temporary HOME and `ASTRID_RUNTIME_DOOR_PORT=17341`; they do not probe the owner's live port or use real Astrid/agent state. Earlier launcher validation notes below remain as native qualification context.

The environment contract covers every lifecycle script, both install modes, darwin/linux/win32 shell handoffs, serve/build/status/down children, and installer-lock checks. A native child-process test runs through the shell wrapper with the contaminated fixture, verifies the actual child environment and exit status, and also exercises a nested installer shell on POSIX. Installed records retain their explicit tool environment; inherited XDG, Python, Git, package/model/browser configuration and Pinokio PATH entries are excluded. Native Windows and Linux Pinokio integration still require runner/tester qualification.

## Commands run

On Windows, six tests report an explicit skip reason because they exercise native POSIX shell, process-group/signal, or `fcntl`/`flock` behavior that Windows does not provide. The five skips in `tests/process.test.mjs` cover failed-shell signaling, ref bootstrap, descendant cleanup, installer-failure cleanup, and controlled Stop ordering. The skip in `tests/lifecycle.test.mjs` covers the real Python lock-helper fixture. The platform-independent lifecycle and launcher tests still run on Windows.

```sh
node --test --test-concurrency=1 tests/*.test.mjs
node tests/check-bootstrap.mjs /Users/hannahomalley/Developer/astrid-video/astrid-local/labs/pinokio-app-bootstrap/public/install
```

Track L ran `node --test tests/*.test.mjs` with Node 20.19.4: **45 passed, 0 failed, 0 skipped** on macOS. The bootstrap-source check passed for both raw-ref and checkout paths against `labs/pinokio-app/public/install`, with fake package operations. JavaScript syntax checks and `git diff --check` also passed. The Windows skip reasons above are printed on Windows; the three-platform environment/command matrix runs on every host.

The tests load `pinokio.js` and every action module with fake kernel/info/app objects. The exact command fixture covers darwin, linux and win32, both modes, empty ref and `feat/pinokio`, including quoting of spaces/apostrophes. It tests menu state, URL publication ordering, stop awaiting, delete confirmation, pinned-tool/data selection, port classification, and success/failure/interrupt cleanup. Native POSIX subprocess fixtures also prove successful builds, failed builds whose leader exits before descendants, and interrupted builds leave no live fixture descendants.

The optional bootstrap-source check executes the actual POSIX bootstrap supplied on its command line with fake curl, uv, Python-environment creation and package installation. Real Python only executes the bootstrap's standard-library handoff code. It verifies that only the two selected raw-ref URLs are requested, the manifest reaches the installer CLI, and temporary files are removed. It does not test internet availability, GitHub access, real package resolution or installation.

Sources inspected: agent `70de7d77a`, app-bootstrap `c56946787`, editor worktree `833a848c8`, pinokiod `add4a67`; Runtime foreground changes in `labs/pinokio-runtime-run`. The coordinator must combine the bootstrap/editor changes and repin agent/Runtime before testing a published ref. Production endpoints were not assumed to contain those commits.

## Add to the owner's TESTING.md

These checks require the real Pinokio version and native operating system; the fake matrix does not establish them.

1. Fresh install of each choice from production and with `ASTRID_APP_REF=feat/pinokio`. Confirm bootstrap source, manifest pins, selected branch, program root, external data root, `managed_by=pinokio`, and no login service. On Windows prove PowerShell 5.1 argument forwarding, local `-File` Bypass behavior under the host's policy, UTF-8, native exit status, paths with spaces/apostrophes/ampersands/`!`, and the explicit refusal for `%`/quotes/newlines.
2. Hosted Start: Open is absent until the health JSON is ready; it opens `https://astrid.haus/?connect=1` in a popout. Confirm the real CORS/browser connection, permissions, projects, and agent discovery.
3. Local Start: no door on 17340; preview listens only on 127.0.0.1:5180; proxy on 17336 works; workspace config identifies the owned Runtime; Open appears only after attach and HTTP readiness. Confirm a schema/pin mismatch fails without Open. Confirm the editor works offline after installation and astrid.haus cannot connect or trigger a permission prompt.
4. Native Pinokio Stop and the launcher Stop menu, during startup and after readiness, in both modes: verify the direct `shell.run` on.stop hook finishes before forced tree kill. In local mode prove editor/proxy/Vite exit before installed Runtime `down`; prove Runtime shutdown/reconciliation and lifetime installer-lock release before maintenance. Separately test Pinokio quit: source `add4a67` bypasses the script hook, so direct quit remains forced; Stop before quit is required for grace. For each path, capture all Runtime, worker, supervisor, dev-local, proxy, npm and Vite PIDs first; check that none survive and 17340/5180/17336 close. Restart immediately. On Windows cover Ctrl+C, Ctrl+Break, closing the console, Pinokio Stop, application quit, ConPTY behavior, Job containment and locked-file removal. Linux needs the same native checks; the process smoke here ran on macOS.
5. Kill the owned Runtime while local preview is attaching and after it is ready. The supervisor must stop the editor. Check the app wrapper's possible `astrid-runtime up` handoff does not leave a replacement daemon outside Pinokio's tree. Also stop/quit during this handoff and during a slow build. This race cannot be established by the fake children or normal POSIX build smoke.
6. Trigger npm install/build failure and interrupt a local install/update. Confirm temporary Runtime/proxy/Vite processes are gone, no local mode was saved early, and `public/bootstrap-venv` is absent. Retry successfully. Confirm the built preview serves the newly emitted dist and no installer venv was copied into it.
7. Update each choice while running (invoke its action directly if the running menu hides it), and Switch to fully local from a running hosted install. Confirm graceful stop runs first, forced fallback always follows an error, and the per-user installer lock is actually free before any mutation. Hold that lock from a temporary fixture and trigger a failed/hung down/editor; Update, Reset, Uninstall, typed deletion and Switch to fully local must show “Astrid is still running. Stop it in Pinokio, then try again.” and perform no mutation. Release/retry successfully; confirm no running-update refusal remains, backend pins match the checkout, the next local Start has the door off, and Update stays on the selected branch. Changing a local ref requires Reset/reinstall; detached tag/SHA updates are unsupported.
8. Put a separate Astrid on 17340, then an unrelated HTTP and non-HTTP program there. Confirm explanation/Open-only versus conflict and no second owner. Occupy 5180 with another editor/program and check local Start fails without stopping it. A healthy Runtime on the selected data root with no door must also cause a refusal.
9. Reset removes only app program/editor files and leaves projects/data untouched. Uninstall stops first and uses the Astrid uninstaller while retaining data. Wrong/cancelled `DELETE` changes nothing; exact `DELETE` invokes `--delete-data`. Cover Windows locked files and reinstall after Reset/Uninstall.
10. Verify Pinokio renders operation-only menus, pending Start/Stop, and published URLs correctly; Start is the default stopped menu item. Verify the installed-environment npm entrypoint works without npm/npx symlinks on PATH.

Known source issue for the coordinator: the editor's diagnostics derive `<root>/with-env` from `ASTRID_START_COMMAND`, although the new installer has no such entry. The launcher uses the real `run`/`run.cmd` for the start hint and explicit recorded Python/profile/data for actual attach. A friendly Runtime-up hint can therefore be unusable on an editor validation error; it needs an upstream diagnostic change. No bootstrap or app source was changed by Task L or this follow-up.


## Files changed

- `ENVIRONMENT`, `README.md`, `pinokio.js`.
- `docs/INTERFACE.md`, `docs/VALIDATION.md`.
- `pinokio/lib.js`, `pinokio/session.mjs`, `pinokio/lifecycle.mjs`, `pinokio/installer-lock.py`.
- `pinokio/platforms/posix.js`, `pinokio/platforms/windows.js`.
- `pinokio/install.js`, `pinokio/install-local.js`, `pinokio/add-local.js`, `pinokio/update.js`.
- `pinokio/start.js`, `pinokio/stop.js`, `pinokio/reset.js`, `pinokio/uninstall.js`, `pinokio/uninstall-delete-data.js`.
- `tests/launcher.test.mjs`, `tests/process.test.mjs`, `tests/check-bootstrap.mjs`, `tests/lifecycle.test.mjs`, `tests/commands.json`.


## Graceful-stop follow-up

Stop-hook evidence is pinned to `add4a674ad1ba95bb62ec427fce519fe5bf0e9bf`: `kernel/api/index.js:599-602` awaits the on.stop request before `:617-622` shell killing. A URI queues at `:2035`; a direct method is awaited at `:2086`, so the launcher uses a direct `shell.run` hook. `server/index.js:486-505` bypasses this hook on quit. The exact platform stop sequence and production bounds are in INTERFACE.md. Direct quit grace still requires upstream Pinokio support; it is not established by these launcher changes.

New tests cover authenticated/awaited controller shutdown, idempotent down, exact installed-Python/profile/data invocation on all platforms, editor-before-down ordering, bounded-failure paths, hung POSIX editor parent retention, forced cleanup after failure, delayed/held per-user lock gating, and all five maintenance actions refusing to mutate after a failed stop. A real macOS fixture records `editor-stop → down → runtime-clean`, holds a temporary fcntl lock through its foreground process lifetime, and proves it is free after controlled Stop. Another executes the actual lock-verifier helper against a real held temporary lock, then release/missing-file cases. No real Runtime, installer lock, user data root or port 17340/5180 was used; controller tests bind only ephemeral loopback ports.

Additional native checks: force the control endpoint to stall (45-second request bound), down to stall/fail (25-second command bound), and the editor to ignore SIGTERM. Confirm final Pinokio tree cleanup, a clean Stop-first error, zero subsequent mutations and a successful retry. Inspect actual durable-work reconciliation under down; the fixture proves ordering and lock lifetime, not Runtime persistence behavior. Confirm the latest installed agent actually includes 70de7d77a before evaluating its lifetime-lock behavior.


Follow-up files: `pinokio/lib.js`, `pinokio/start.js`, `pinokio/session.mjs`, new `pinokio/lifecycle.mjs` and `pinokio/installer-lock.py`; `tests/launcher.test.mjs`, `tests/process.test.mjs`, new `tests/lifecycle.test.mjs`, `tests/commands.json`; `docs/INTERFACE.md` and `docs/VALIDATION.md`.
