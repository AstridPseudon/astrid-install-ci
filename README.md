# Astrid for Pinokio

Astrid is a community beta Pinokio app for macOS, Linux, and Windows. Pinokio owns the running process; Astrid's installer installs the back end inside the Pinokio app folder. The normal Astrid project and runtime data stays outside that folder.

## Choose an install

- **Install** installs the back end only. Open the editor at [astrid.haus](https://astrid.haus); it connects to the local back end on port `17340`.
- **Install fully local** installs the back end and checks out/builds the editor locally. Pinokio serves it at `http://127.0.0.1:5180/tools/video-editor`; the `astrid.haus` connection is turned off.

Both choices install one back end. The local editor does not install a second Runtime.

## Data and program files

Pinokio program files live under the app's `app/` folder: the back end is in `app/astrid` and the optional editor checkout is in `app/editor`. The selected install mode is recorded in `app/install-mode.json`.

The installer keeps Astrid data in the normal user data root, outside the Pinokio app folder. Defaults are:

- macOS: `~/Library/Application Support/Astrid Runtime`
- Linux: `$XDG_DATA_HOME/astrid-runtime`, or `~/.local/share/astrid-runtime` when `XDG_DATA_HOME` is unset
- Windows: `%LOCALAPPDATA%\Astrid Runtime`

An installer option or an existing Astrid setup can select a different data root.

## Start, Update, Reset, and Uninstall

- **Start** runs the installed `<root>/run` entry in the foreground under Pinokio. The local choice also serves the editor on port `5180`.
- **Update** updates the back end. For a fully local install, it first runs `git pull --ff-only` in the editor checkout, updates from that checkout's `public/install-manifest.json`, reinstalls the editor dependencies with pinned Node, and rebuilds the editor.
- **Reset** uninstalls and removes Pinokio program files, then clears the selected mode. It keeps Astrid data.
- **Uninstall** removes the back end and editor program files while keeping Astrid data.
- **Uninstall and permanently delete all data…** is a separate action. It requires typing `DELETE` and passes the installer's `--delete-data` option.

The bootstrap address can be changed in Pinokio's `ENVIRONMENT` file with `ASTRID_INSTALL_URL`. Its default is `https://astrid.haus/install`.

## Beta notes

This launcher is an initial beta scaffold. It should be tested in Pinokio before general use. The launcher-to-installer assumptions and the points to reconcile with the installer work are listed in [docs/INTERFACE.md](docs/INTERFACE.md).
