# Astrid for Pinokio

Astrid is a community beta for macOS, Linux and Windows. Pinokio owns the processes; Astrid's installer installs the back end.

- **Install** installs the back end. Open the editor at [astrid.haus](https://astrid.haus/?connect=1).
- **Install fully local** also checks out and builds the editor at `http://127.0.0.1:5180/tools/video-editor?connect=1`. The astrid.haus connection is off.

Both choices use one Runtime. Program files live in `app/astrid`, the optional editor in `app/editor`, and the mode in `app/install-mode.json`. Projects and Runtime data stay in the data root recorded by the installer, outside these program files.

**Start** publishes Open only after readiness. **Stop** stops this launcher's process tree. **Update** and **Add local editor** stop it first; local builds use the editor checkout's bootstrap and manifest so both halves match. Start again after an update or mode change.

**Reset** removes only `app/`, keeping data. **Uninstall** stops Astrid and runs its uninstaller, keeping data, then removes program files. The separate **Uninstall and permanently delete all data…** action requires typing `DELETE`.

In Pinokio's `ENVIRONMENT` file, leave `ASTRID_APP_REF` empty for production. For branch testing, set it to `feat/pinokio` (or another astrid-app branch). This selects the ref's raw GitHub bootstrap and manifest and the matching editor branch. Reset and reinstall to change an existing local editor's branch. `ASTRID_AUTOSTART=0` disables the default Start menu selection.

If port 17340 already answers as Astrid, the menu explains and offers Open. If another program holds it, the menu reports the conflict. A local Start also refuses an occupied port 5180 or an already healthy Runtime at the selected data root.

See [the command and installer interface](docs/INTERFACE.md) and [validation and remaining native checks](docs/VALIDATION.md).
