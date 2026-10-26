# Astrid on Pinokio: testing guide

**Test branch:** `feat/pinokio` in all four repos below. Launcher: https://github.com/banodoco/astrid-pinokio/tree/feat/pinokio

You're testing Astrid's Pinokio launcher on a clean Mac: install, start, open in Chrome, chat, the fully local editor, and clean-up. The launcher is on the [`feat/pinokio` branch of banodoco/astrid-pinokio](https://github.com/banodoco/astrid-pinokio/tree/feat/pinokio), and it installs Astrid and its editor from the `feat/pinokio` branches below. Get Pinokio from [desktop.pinokio.co/download.html](https://desktop.pinokio.co/download.html).

| Repo | `feat/pinokio` head |
|---|---|
| banodoco/astrid-pinokio | `latest feat/pinokio` |
| banodoco/astrid-app | `630336b3b153` |
| banodoco/astrid-agent | `de5c62b93e58` |
| banodoco/astrid-runtime | `67ea67d834e5` |

## 1. Before you start

- A Mac that isn't your work one, ideally with no Astrid on it, and about 15 GB free. If it already has Astrid, remove it first (your projects stay): `curl -fsSL https://astrid.haus/install | sh -s -- --uninstall`
- Pinokio v8.2 or later.
- Chrome, set as the default browser (System Settings → Desktop & Dock → Default web browser).
- Optional: Claude Code and/or Codex, installed and signed in.
- Optional: ComfyUI, installed from Pinokio.

Commands assume Pinokio's home is `~/pinokio`; if Pinokio's Settings shows another, use that. Save Pinokio's Terminal output after each action.

## 2. Get the test launcher into Pinokio

1. In Pinokio, paste `https://github.com/banodoco/astrid-pinokio` into the search box (or Download from URL) and install it with the suggested folder name, `astrid-pinokio.git`. During testing the repo's default branch is `feat/pinokio`, so this gets the test launcher. If it doesn't work, run this, then restart Pinokio:
   ```sh
   git clone -b feat/pinokio https://github.com/banodoco/astrid-pinokio ~/pinokio/api/astrid-pinokio.git
   ```
2. Check the test setting. Pinokio copies `_ENVIRONMENT` to `ENVIRONMENT` when it first opens Astrid's page, so run `cat ~/pinokio/api/astrid-pinokio.git/ENVIRONMENT` (or `_ENVIRONMENT` if Pinokio hasn't opened the page yet) and expect `ASTRID_APP_REF=feat/pinokio`.

## 3. The main path (about 10 minutes)

1. Open Astrid's page in Pinokio. You should see **Install** and **Install fully local**, and neither should run by itself.
2. Choose **Install**. The first time takes a few minutes. You should see `Using your workspace at …` (note that folder), then `Astrid is installed. Choose Start in Pinokio.` Note whether Start then runs by itself.
3. If it didn't, choose **Start**. You should see **Starting Astrid…** and **Stop**, then Pinokio's "Click to open in browser" panel.
4. In Terminal:
   ```sh
   curl -s -H 'Origin: https://astrid.haus' http://127.0.0.1:17340/api/runtime/v1/health
   ```
   You should see `"install": {"managed_by": "pinokio"}` in the reply.
5. Click the panel once. Chrome should open astrid.haus and, without you pressing Connect, show **Choose Allow in Chrome** with Chrome's prompt at the top left. Screenshot the prompt, then choose **Allow**.
6. You should see a starter project. Open it, or create a project.
7. In the editor's chat, pick Claude Code or Codex and ask "What's in this project?" You should get a reply. Then record:
   ```sh
   echo $SHELL; which claude codex
   ls -la ~/.claude/skills ~/.codex/skills
   ```

astrid.haus runs the production editor, so its cards keep today's wording until the release. The fully local editor has the new Pinokio wording.

## 4. Fully local

1. Choose **Stop**, then **Switch to fully local**. It downloads and builds the editor, which takes several minutes.
2. Choose **Start** if it hasn't started by itself, then **Open Astrid**. The editor should open at `http://127.0.0.1:5180/tools/video-editor?connect=1` with no browser prompt, and your project should be there.
3. astrid.haus can't connect now. This should print `Failed to connect`:
   ```sh
   curl -sS --max-time 2 -H 'Origin: https://astrid.haus' http://127.0.0.1:17340/api/runtime/v1/health
   ```
   In Chrome, https://astrid.haus/?connect=1 should show **Astrid isn't answering on this computer**.
4. Turn Wi-Fi off and reload the local editor. It should still open. Turn Wi-Fi back on.
5. With the local editor open, choose **Stop** in Pinokio and note what the editor shows. The branch's wording is "Start Astrid in Pinokio." Then Start again.

To go back from fully local, choose Reset, then Install. Your projects stay (section 6 does this).

## 5. Everyday checks

1. **Stop and Start.** Choose Stop. You should see `Astrid stopped.`, and this should print nothing:
   ```sh
   lsof -nP -iTCP:17340 -iTCP:5180 -sTCP:LISTEN
   ```
   Then Start again.
2. **Quit Pinokio while Astrid runs**, with the editor open. Pinokio force-stops Astrid, which is expected. Note the card the editor shows. The `lsof` line should print nothing. Reopen Pinokio and Astrid's page: Start should run by itself, and the Open panel should come back. Stop is the gentle way.
3. **Update.** Ask Claude to push a harmless launcher commit. Then choose Stop, then **Update**. Pinokio should pull the launcher first, then update Astrid, and finish stopped. This should show the new commit:
   ```sh
   git -C ~/pinokio/api/astrid-pinokio.git log -1 --oneline
   ```
   Then Start again.
4. **One Astrid only.** With Pinokio's Astrid installed, run the branch's terminal installer:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install | ASTRID_INSTALL_MANIFEST_URL=https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install-manifest.json sh
   ```
   It should refuse with `Astrid on this computer was installed with Pinokio. Use Pinokio to update or uninstall it.` Keep the `ASTRID_INSTALL_MANIFEST_URL` part, and don't use astrid.haus/install: both would install production Astrid, which doesn't know about Pinokio.
5. **Safari once.** Make Safari the default browser and click the Open panel. Safari should show **Open Astrid in Chrome or Edge**. Copy its link, paste it into Chrome, and note where it lands. Make Chrome the default again.
6. **ComfyUI (optional).** With Pinokio's ComfyUI running, ask Astrid's chat "Find my ComfyUI." It should find it on `127.0.0.1:8188`. Stop ComfyUI and ask again: it should ask you to start ComfyUI in Pinokio.

## 6. Clean-up checks

Do these in order.

1. **Reset.** Choose Stop, then **Reset**. The menu should go back to Install and Install fully local, and the workspace folder from step 3.2 should still be there.
2. **After Reset, the terminal installer is allowed.** Run the installer from 5.4. It should install Astrid the terminal way and open astrid.haus. Then remove it:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install | ASTRID_INSTALL_MANIFEST_URL=https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install-manifest.json sh -s -- --uninstall
   ```
3. In Pinokio, choose **Install**, then Start, then Open. Your project should still be there.
4. **Uninstall.** You should see `Workspace kept at …`. Run the skills `ls` line from 3.7 again and note whether Astrid's links are gone. Install again, and your project should still be there.
5. **Uninstall and delete all Astrid data…**, last. Type anything except DELETE, and you should see `Cancelled, so nothing was deleted.` Run it again and type `DELETE`. The workspace folder and your projects should be gone.

## 7. If you have time

- **Port 17340 taken.** Stop Astrid and run `python3 -m http.server 17340 --bind 127.0.0.1`. Astrid's page should say `Another program is using port 17340, so Astrid can't start.` Press Ctrl+C to end it.
- **Port 5180 taken** (fully local). Do the same with `5180`, then Start. You should see `Another program is using port 5180, so Astrid's editor can't start.`
- **The quiet Pinokio link** (fully local, where its setup screen is hidden). In Chrome at `http://127.0.0.1:5180/tools/video-editor`, press ⌥⌘J and run `localStorage.setItem('astrid:welcome-v1', 'local'); location.reload()` (type `allow pasting` first if Chrome asks). You should see **Or install with Pinokio, then choose Install fully local**. Its link 404s until the release. To undo: `localStorage.setItem('astrid:welcome-v1', 'complete'); location.href = '/tools/video-editor'`
- **Production (after the release only).** Uninstall, delete the app in Pinokio, install it from the listing (its ENVIRONMENT has `ASTRID_APP_REF=` empty), and repeat section 3.

## 8. Windows tester

Follow the same Pinokio steps in PowerShell. The Pinokio home is `%USERPROFILE%\pinokio`.

- Health (type `curl.exe`, not `curl`): `curl.exe -s -H "Origin: https://astrid.haus" http://127.0.0.1:17340/api/runtime/v1/health`
- One Astrid only:
  ```powershell
  $env:ASTRID_INSTALL_MANIFEST_URL = 'https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install-manifest.json'
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install.ps1)))
  ```
- Unproven on Windows, so watch these closely. After Stop, and after closing Pinokio's console window, `Get-NetTCPConnection -State Listen -LocalPort 17340,5180` should find nothing. Reset and Uninstall may hit locked files, so send any `Remaining:` lines.
- Doctor bundle:
  ```powershell
  $R = "$env:USERPROFILE\pinokio\api\astrid-pinokio.git\app\astrid"
  & "$R\versions\$((Get-Content -Raw "$R\current").Trim())\py\Scripts\python.exe" -I -m astrid install --doctor
  ```

## 9. What to send back

- Pinokio's Terminal output for each action, plus any `install.log` that an error names after `Details:`.
- Screenshots of Chrome's prompt and of anything confusing.
- Your notes: macOS and Pinokio versions, the `$SHELL`, `which` and skills output, and the cards you noted.
- The doctor bundle, made while Astrid is installed:
  ```sh
  R="$HOME/pinokio/api/astrid-pinokio.git/app/astrid"
  "$R/versions/$(cat "$R/current")/py/bin/python" -I -m astrid install --doctor
  ```
  You should see `Astrid doctor bundle: …/astrid-doctor.zip`. It's saved to your Desktop and shown in Finder.

## 10. When something's wrong: the fix loop

1. Stop at that step. Note the step number, what you expected and what you saw, with the Terminal output and a screenshot. For an install or start problem, add the doctor bundle.
2. Send it to Claude in your session on your main Mac. Batch small wording things, and send a broken step straight away.
3. Claude finds why it was possible (the cause, not just this case) and fixes it on the same `feat/pinokio` branches, never `main`. Claude runs the tests and pushes new commits, re-pinning the App branch's install manifest when Astrid itself changed. The reply says what changed and which step to redo.
4. On the test Mac, choose Stop, then **Update**. In test mode, Update:
   - pulls the launcher;
   - after Install: downloads the installer and its manifest from astrid-app's `feat/pinokio` branch, and installs the versions that manifest pins;
   - in fully local: pulls the editor's `feat/pinokio` branch, installs the versions its manifest pins, and rebuilds the editor.

   GitHub can serve the old manifest for about 5 minutes after a push, so wait that long before you update. astrid.haus changes only at the release, so check editor wording in fully local.
5. Redo the step. If the fix touched install or start, also Reset and run section 3 again.
6. Keep a short list of steps: passed, fixed and open. When nothing is open, go to the release.

**Optimizing.** Time these: Install, Switch to fully local, Start until the Open panel appears, and the first Open until it's connected. A slow step is worth fixing even when it works. Send the timings with your notes. There are no target numbers.

## 11. What guides the fixes

- Plain words, and every dead end says what to do next.
- One obvious path, with no hidden modes, extra settings or flags.
- Pinokio stays a quiet option on astrid.haus, never a prominent one.
- Fix the cause and the whole class, and ask why it was possible.
- Keep the full ambition and make the how simpler. Handle real use, refuse rare edge cases cleanly, and ship soon.
- Tests prove behaviour, not timing, and nothing is skipped silently.
- Everything stays on `feat/pinokio` until the release. After it, every branch is merged or deleted.

## 12. After you're happy: the release

In this order:

1. Fast-forward astrid-runtime `feat/pinokio` → `main`, then astrid-agent `feat/pinokio` → `main`. If a `main` has moved, rebase and re-pin the App's install manifest to the new heads.
2. Merge astrid-app `feat/pinokio` → `main`. This deploys astrid.haus, with production installer support for Pinokio and the quiet "Or install with Pinokio" links.
3. Straight after: on astrid-pinokio, revert the TEST ONLY commits `44c0969` and `e362bf4` (after the revert, `ASTRID_APP_REF` is empty) and delete TESTING.md, make `feat/pinokio` the new `main` (replacing the placeholder), and set `main` as the default branch again.
4. In Pinokio, signed in: pinokio.co → Settings → Repository access → connect GitHub and grant `banodoco` (this needs an org Owner). Paste `https://github.com/banodoco/astrid-pinokio` into Pinokio's search to import it. Open **Manage this project** and set the description to "Community Beta". From now on, the pinokio.co/item link works.
5. Send the Windows tester https://pinokio.co/item?uri=https://github.com/banodoco/astrid-pinokio and post in #testers-wanted.
6. Delete the `feat/pinokio` branches, locally and on GitHub.

Claude does steps 1–3 and 6 when you say "go". Step 4 needs you.

## 13. After the release: the beta

- Reports from the Windows tester and others, as GitHub issues on banodoco/astrid-pinokio or sent to Claude, go through the same loop. Fixes go to `main` through short branches.
- Pinokio users get launcher fixes and new Astrid versions with Stop, then Update. Fixes inside Astrid reach them once astrid.haus's install manifest pins the new versions.
