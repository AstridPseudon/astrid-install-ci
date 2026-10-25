# Launcher and installer interface

These are the implemented commands. `A` is the absolute Pinokio app directory, `R=A/app/astrid`, `E=A/app/editor`, and `M=E/public/install-manifest.json`. Paths are quoted by the platform builder; Windows uses backslashes. Literal shell commands for all scripts, platforms and both production/ref sources are checked in [tests/commands.json](../tests/commands.json). That fixture includes spaces and an apostrophe in the app path.

## Sources and bootstrap

`ENVIRONMENT` has one source-selection hook: `ASTRID_APP_REF`, empty by default.

| Source | macOS / Linux bootstrap | Windows bootstrap | Manifest | Editor clone |
| --- | --- | --- | --- | --- |
| Empty ref | `https://astrid.haus/install` | `https://astrid.haus/install.ps1` | Bootstrap's production default | `banodoco/astrid-app`, branch `main` |
| Ref `feat/pinokio` | `https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install` | Same directory, `install.ps1` | Same directory, `install-manifest.json`, downloaded and passed with `--manifest` | Same repository, branch `feat/pinokio` |
| Fully local install/add/update | `sh E/public/install` | `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File E/public/install.ps1` | Always `--manifest M` | Existing validated checkout |

Remote bootstrap commands download the script into a temporary directory before executing it. Ref commands download the manifest there too. POSIX uses `curl -fsSL URL -o FILE` and `sh FILE`; Windows uses TLS 1.2, `Invoke-WebRequest -UseBasicParsing URL -OutFile FILE`, and `& ([scriptblock]::Create((Get-Content -Raw -LiteralPath FILE)))`. The surrounding POSIX EXIT trap / PowerShell finally removes the temporary directory.

Every installer invocation passes `--root R --managed-by pinokio`. Update adds `--update`. Uninstall adds `--uninstall`; only the typed-delete action additionally passes `--delete-data`.

The current POSIX bootstrap honors a supplied manifest before preparing tool/source pins, so it can run from raw GitHub without an astrid.haus manifest request. It uses absolute public uv/GitHub download URLs, not a URL relative to its own script. The source smoke runs its actual bytes with fake curl, uv and package operations. Windows has the equivalent manifest-selection logic; its native execution remains unqualified here.

The POSIX bootstrap creates a disposable `bootstrap-venv` beside its supplied manifest. For checkout bootstraps the launcher removes `E/public/bootstrap-venv` in an EXIT trap, on success or failure, so Vite cannot copy it into `dist`. Windows bootstrap creates its venv in its own temporary directory. The bootstrap itself was not changed.

## Commands per action

The shell is Bash on macOS/Linux and PowerShell on Windows. `B(action)` below means the remote bootstrap selected above; `L(action)` means the checkout's own bootstrap plus `--manifest M`.

| Script | Back-end-only mode | Fully local mode |
| --- | --- | --- |
| `install.js` | Port preflight; create `A/app`; `B(install)`; save `backend` | — |
| `install-local.js` | — | Port preflight; create `A/app`; clone or validate/pull editor; `L(install)`; temporary build session; save `local` |
| `add-local.js` | Await Stop; port preflight; clone or validate/pull editor; `L(update)`; temporary build session; save `local` | Refuses |
| `update.js` | Await Stop; port preflight; `B(update)` | Await Stop; port preflight; validate/pull editor; `L(update)`; temporary build session |
| `start.js` | Port preflight; foreground hosted session; publish hosted URL after readiness | Port preflight; foreground local session; publish local URL after readiness |
| `stop.js` | Await `kernel.api.stop({params:{uri: A/pinokio/start.js}})` | Same; the session owns the editor too |
| `reset.js` | Await Stop; recursively remove only `A/app` | Same; no bootstrap/uninstaller |
| `uninstall.js` | Await Stop; port preflight; `B(uninstall)`; remove `A/app` | Same |
| `uninstall-delete-data.js` | Require exact `DELETE`; await Stop; port preflight; `B(uninstall --delete-data)`; remove `A/app` | Same |

The editor commands on POSIX are:

```sh
git clone --branch '<ref-or-main>' --single-branch -- 'https://github.com/banodoco/astrid-app' 'E'
git -C 'E' pull --ff-only
```

Windows uses the same Git arguments with PowerShell single-quote escaping, and checks `$LASTEXITCODE`. Before pulling, both platforms require the checkout's current branch to equal `ASTRID_APP_REF` or `main` when empty. An existing editor must have a `.git` entry and the expected HTTPS origin. A missing or different checkout fails rather than being silently replaced. Use a branch ref for the local update flow; detached tag/SHA updates are not supported.

Every shell step converts failure into `ASTRID_PINOKIO_FAILURE`, with a Pinokio `break: true` event. POSIX runs the command under a nested `bash --noprofile --norc -c` with `set -eu`; PowerShell uses `try/catch` and explicit native exit-code checks. This matters because the inspected Pinokio shell can resolve at its prompt after a failing command. The marker is split in the submitted shell source so terminal echo cannot trigger it. See the full wrapper bytes in the fixture.

## Pinned tools and sessions

The launcher reads `R/current`, validates the version identifier, then reads `R/versions/<id>/version.json`. It uses `env.ASTRID_NODE_EXECUTABLE` as the authoritative Node. It validates that Node is inside that version. The installer handoff pins Node 20.19.4; the launcher does not substitute ambient Node or download a second npm version.

Each session starts using:

```text
<PINNED_NODE> A/pinokio/session.mjs build R E local
<PINNED_NODE> A/pinokio/session.mjs serve R E backend
<PINNED_NODE> A/pinokio/session.mjs serve R E local
```

Shell commands resolve the pointer at execution time, after install/update. POSIX uses `V/py/bin/python -I -c <read-version-json>` to locate Node, then `exec`s Node. Windows uses `Get-Content | ConvertFrom-Json`, validates the Node path, and invokes `& $node ...`. The exact resolution commands are in the fixture.

`session.mjs` also reads `R/install.json` and requires `owner=haus.astrid.runtime`, `managed_by=pinokio`, and an absolute recorded data root. Its child invocations are:

| Operation | macOS / Linux | Windows |
| --- | --- | --- |
| Hosted Runtime | `R/run` | `cmd.exe /d /s /c ""R\run.cmd""` |
| Local Runtime, including temporary build | `R/run --hosted-origin off` | `cmd.exe /d /s /c ""R\run.cmd" --hosted-origin off"` |
| Runtime readiness/status | `<record.python> -I -m astrid_runtime status --data-root <recorded-data-root> --json` | Same argument array |
| Editor dependencies | `<Node> <npm-cli.js> ci --no-audit --no-fund` | Same argument array |
| Editor build | `<Node> scripts/dev-local-workspace.mjs --build` | Same argument array |
| Editor serve | `<Node> scripts/dev-local-workspace.mjs --preview --preview-dir E/dist` | Same argument array |

Windows batch invocation uses `windowsVerbatimArguments: true`. Install paths containing `%`, double quotes or newlines are refused to avoid cmd expansion/quoting errors. Spaces, apostrophes, ampersands and `!` are supported by the command construction and still require native qualification.

`npm-cli.js` is located from the authoritative Node:

- POSIX: `dirname(Node)/../lib/node_modules/npm/bin/npm-cli.js`.
- Windows: `dirname(Node)/node_modules/npm/bin/npm-cli.js`.

Node's directory is added to PATH for package scripts. `npm_execpath` and `npm_node_execpath` identify these pinned tools, including the editor wrapper's own npm/npx invocations. No unpacked POSIX npm/npx symlink is required.

The editor gets the installed version's environment plus explicit `ASTRID_RUNTIME_PYTHON=<record.python>`, `ASTRID_RUNTIME_SOURCE_MANIFEST=<record.profile>`, `ASTRID_RUNTIME_DATA_ROOT=<install.data_root>`, `ASTRID_SUPPORT_ROOT` and `ASTRID_WORKSPACE_DISCOVERY=<data>/runtime/discovery.json`. Ambient checkout selection, Python imports, Node options, endpoint and credential overrides are cleared. `PORT=5180`, `VITE_ASTRID_DYNAMIC_PROXY_PORT=17336`, `ASTRID_RUNTIME_DOOR_PORT=17340` and `ASTRID_INSTALL_MANAGED_BY=pinokio` are fixed.

Local sessions additionally set `ASTRID_APP_LOOPBACK_ORIGIN=off`. Hosted sessions clear that variable. `ASTRID_START_COMMAND` names the actual `R/run` or `R/run.cmd`, for diagnostics only. The installer does not provide `start` or `with-env`. An upstream editor error hint still derives nonexistent `with-env` from this variable; actual attach/start resolution uses the explicit Python/profile/data environment, not that hint.

The editor's `--build` requires a live Runtime and does not run `up`. A build session installs npm dependencies, starts one foreground Runtime with its door off, waits for Runtime status, builds, then stops that Runtime in `finally`. npm/build failures and interruption also enter cleanup. It never publishes an Open URL or switches mode on a failed shell step.

Normal local Start runs the foreground Runtime first, waits for status, then starts preview. `dev-local-workspace` validates discovery/credentials/schema/realm and attaches before starting its proxy/Vite server. `ASTRID_START_COMMAND` is not a mechanism for starting or attaching to Runtime. The editor can call `astrid-runtime up` itself if it loses discovery; the supervisor watches its owned Runtime and tears down the editor if that process exits. That custody race is a native qualification item.

## Readiness and menu

Before Start, TCP port 17340 is probed. A `workspace.v1` health response, the Astrid-specific unavailable/identity-mismatch response, or the hosted-origin-required response identifies Astrid. Other responses or a non-HTTP listener identify another program. This preflight runs again when Start executes, not only when the menu renders.

The session refuses an already healthy Runtime at its recorded data root. A local serve session also refuses any existing listener on 5180. Readiness then requires:

- Both modes: installed `astrid_runtime status` exits zero, `support.healthy=true`, no stale discovery, and `health.status=ok`.
- Hosted: HTTP 200 at `http://127.0.0.1:17340/api/runtime/v1/health`, with Origin `https://astrid.haus`, `status=ok` and `protocol=workspace.v1`.
- Local: HTTP success at `http://127.0.0.1:5180/tools/video-editor`, plus a successful `/runtime-config/v1/workspace.json` with `schemaVersion=1` and the same realm and Runtime instance as status discovery. This works with the door off and rejects an unrelated HTTP server.

After these checks the supervisor emits `ASTRID_PINOKIO_READY`. Pinokio's `done: true` listener retains that shell in the daemon script; only the next `local.set` stores `{url, mode}`. Request timeouts bound individual probes; production startup has a 180-second readiness deadline. The subprocess smoke supplies an unlimited startup deadline and uses no test timeouts.

| State | Menu |
| --- | --- |
| No installed mode/run entry, port free | Install; Install fully local |
| Installed backend, stopped | Start; Update; Add local editor; Reset; Uninstall; Uninstall and permanently delete all data… |
| Installed local, stopped | Start; Update; Reset; Uninstall; Uninstall and permanently delete all data… |
| Start running, no published URL | Starting Astrid…; Stop |
| Ready owned Start | Open Astrid; Stop |
| Install/add/update/reset/uninstall/delete/stop active | Operation status only |
| External Astrid on 17340 | Explanation; Open Astrid only (hosted URL) |
| Other program on 17340 | Conflict message only |

Start is the default stopped menu item unless `ASTRID_AUTOSTART=0`. Hosted Open is `https://astrid.haus/?connect=1`, `popout: true`. Local Open is `http://127.0.0.1:5180/tools/video-editor?connect=1`, `popout: false`. The owned running menu reads the published URL and does not synthesize Open while startup is pending.

## Stop and cleanup

Stop, Update, Add local editor, Reset and both uninstall actions await the absolute Start script's `kernel.api.stop`. The inspected Pinokio `script.stop` wrapper does not await that call, so the launcher uses the awaited API directly.

Pinokiod source inspected: `add4a67`. `kernel/api/index.js` stops all shells in the script group; `kernel/shell.js` calls `kill-sync(ptyPid, 'SIGKILL', true)` then closes the PTY. `server/index.js:shutdown` calls `kernel.shell.reset()` before recursively killing itself. Consequently Pinokio Stop/quit is a forced tree termination, not a catchable SIGTERM. The launcher does not start a login service, use `nohup`, `unref`, or intentionally reparent the foreground Runtime/editor. App-owned detached process groups remain descendants while their launcher lives.

The supervisor handles SIGINT, SIGTERM, SIGHUP and Windows SIGBREAK for direct interruption. It cleans children in reverse launch order, editor/build before Runtime. POSIX children have owned process groups: TERM, five-second escalation to KILL, and a final group sweep even after the group leader exits. macOS EPERM is ignored only when a process snapshot shows no live members of that group. Windows uses `taskkill.exe /PID <owned-child> /T /F` while the child is alive. SIGKILL cannot execute JavaScript/Python cleanup handlers; forced Stop/quit relies on Pinokio's recursive tree termination. Real PTY/ConPTY containment remains in the native checklist.
