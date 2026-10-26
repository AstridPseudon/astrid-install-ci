# Astrid on Pinokio: testing guide

**Test branch:** `feat/pinokio` in all four repos below. Launcher: https://github.com/banodoco/astrid-pinokio/tree/feat/pinokio

You're testing Astrid's Pinokio launcher. On Mac, check install, start, open in Chrome, chat, the fully local editor, and clean-up. On Windows, test the candidate installer, then complete one generation and one render. The launcher is on the [`feat/pinokio` branch of banodoco/astrid-pinokio](https://github.com/banodoco/astrid-pinokio/tree/feat/pinokio), and it installs Astrid and its editor from the `feat/pinokio` branches below. Get Pinokio from [desktop.pinokio.co/download.html](https://desktop.pinokio.co/download.html).

| Repo | `feat/pinokio` head |
|---|---|
| banodoco/astrid-pinokio | `d61ca1167550` |
| banodoco/astrid-app | `93cca9cd9559` |
| banodoco/astrid-agent | `b83d62119f0c` |
| banodoco/astrid-runtime | `5c1977cd6b8b` |

The App manifest's Runtime pin comes from the Agent's lock.

## 1. Before you start

- A Mac that isn't your work one, ideally with no Astrid on it, and about 15 GB free. If it already has Astrid, remove it first (your projects stay): `curl -fsSL https://astrid.haus/install | sh -s -- --uninstall`
- Fully local builds the editor on this Mac, which uses up to about 4 GB of memory for a minute or two. On an 8 GB Mac, close other heavy apps first.
- Pinokio v8.2 or later.
- Chrome, set as the default browser (System Settings → Desktop & Dock → Default web browser).
- Optional: a connected coding tool, if you want to test project chat.
- Optional: ComfyUI, installed from Pinokio.

Commands assume Pinokio's home is `~/pinokio`; if Pinokio's Settings shows another, use that. Save Pinokio's Terminal output after each action.

If you installed before today, choose **Reset**, then **Install** again, rather than Update. Astrid's state used to live inside Pinokio's cache folder and now lives in the normal per-user places. Until you've reinstalled, don't use Pinokio's Settings → **Reset server cache**.

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
7. In the editor's chat, choose a connected coding tool and ask "What's in this project?" You should get a reply. Note which tool you used and whether it replied.

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
3. **Update.** When the owner has pushed a new test commit, choose Stop, then **Update**. Pinokio should pull the launcher first, then update Astrid, and finish stopped. This should show the new commit:
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

### Test the candidate from PowerShell

With Astrid installed through Pinokio, run the branch's terminal installer to confirm it refuses a second install. The `feat/pinokio` `public/install.ps1` reads `ASTRID_INSTALL_MANIFEST_URL`. Fetch it from raw GitHub so this tests the candidate; `astrid.haus/install.ps1` serves the released installer.

```powershell
$env:ASTRID_INSTALL_MANIFEST_URL = 'https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install-manifest.json'
irm https://raw.githubusercontent.com/banodoco/astrid-app/feat/pinokio/public/install.ps1 | iex
```

It should refuse with `Astrid on this computer was installed with Pinokio. Use Pinokio to update or uninstall it.`

### Test through Pinokio

In Pinokio on Windows, search for `https://github.com/banodoco/astrid-pinokio` or use Download from URL, then install the test branch as in section 2. Open Astrid's page and choose **Install**, then **Start**. Check that:

1. The task host shows **Running**.
2. One generation completes.
3. One render completes.

If something fails, run this in PowerShell while Astrid is installed and send the output and the doctor bundle it creates:

```powershell
$R = "$env:USERPROFILE\pinokio\api\astrid-pinokio.git\app\astrid"
& "$R\versions\$((Get-Content -Raw "$R\current").Trim())\py\Scripts\python.exe" -I -m astrid install --doctor
```

## 9. What to send back

- Pinokio's Terminal output for each action, plus any `install.log` that an error names after `Details:`.
- Screenshots of Chrome's prompt and of anything confusing.
- Your notes: operating system and Pinokio versions, and the cards you noted.
- The doctor bundle, made while Astrid is installed:
  ```sh
  R="$HOME/pinokio/api/astrid-pinokio.git/app/astrid"
  "$R/versions/$(cat "$R/current")/py/bin/python" -I -m astrid install --doctor
  ```
  You should see `Astrid doctor bundle: …/astrid-doctor.zip`. It's saved to your Desktop and shown in Finder.

## 10. When something's wrong: the fix loop

1. Stop at that step. Note the step number, what you expected and what you saw, with the Terminal output and a screenshot. For an install or start problem, add the doctor bundle.
2. Send the report to the owner. Send a broken step straight away; small wording notes can be batched.
3. The owner will investigate the cause, make and check a fix on the test branches, and tell you which step to redo.
4. On the test machine, choose Stop, then **Update**. In test mode, Update:
   - pulls the launcher;
   - after Install: downloads the installer and its manifest from astrid-app's `feat/pinokio` branch, and installs the versions that manifest pins;
   - in fully local: pulls the editor's `feat/pinokio` branch, installs the versions its manifest pins, and rebuilds the editor.

   GitHub can serve the old manifest for about 5 minutes after a push, so wait that long before you update. astrid.haus changes only at the release, so check editor wording in fully local.
5. Redo the step. If the fix touched install or start, also Reset and run section 3 again.
6. Keep a short list of steps: passed, fixed and open. When nothing is open, go to the release.

**Optimizing.** Time these: Install, Switch to fully local, Start until the Open panel appears, and the first Open until it's connected. A slow step is worth fixing even when it works. Send the timings with your notes. There are no target numbers.

## 11. Known gaps

These are deferred to a testing round soon:

- The smoke's render step.
- Fully local in CI.
- Main's pre-existing red checks.

## 12. After you're happy: the release

The owner gives the go before release work starts. Keep this order:

1. Confirm the minimal pin coherence check (C1) is in place before release.
2. Fast-forward `astrid-runtime` `feat/pinokio` to `main`, then `astrid-agent` `feat/pinokio` to `main`. Both must contain the combined line. If either `main` has moved, rebase and re-pin the App manifest to the new heads.
3. Merge `astrid-app` `feat/pinokio` to `main`. This deploys astrid.haus; its manifest pins the new App head and takes Runtime from the Agent's lock.
4. Right after the App release, confirm astrid.haus serves exactly that manifest with the served-manifest canary (C4).
5. Make the Windows journey a required check in the repository ruleset.
6. On `astrid-pinokio`, revert the TEST ONLY commits `44c0969` and `e362bf4` (after the revert, `ASTRID_APP_REF` is empty), remove the empty test commit `0c9913e`, delete `TESTING.md`, make `feat/pinokio` the new `main` in place of the placeholder, and set `main` as the default branch again.
7. Import `https://github.com/banodoco/astrid-pinokio` in Pinokio. Connect GitHub under Settings → Repository access if needed, then set the project's description to **Community Beta**. The Pinokio item link will then work. Send the tester `https://pinokio.co/item?uri=https://github.com/banodoco/astrid-pinokio`.
8. Ask the Windows tester to confirm that the task host shows **Running**, one generation completes, and one render completes. Keep the beta label until the Windows journey is required and green. Then delete the `feat/pinokio` branches locally and on GitHub.

## 13. After the release: the beta

- Reports from testers, as GitHub issues on banodoco/astrid-pinokio or sent to the owner, go through the same loop. Fixes go to `main` through short branches.
- Pinokio users get launcher fixes and new Astrid versions with Stop, then Update. Fixes inside Astrid reach them once astrid.haus's install manifest pins the new versions.
