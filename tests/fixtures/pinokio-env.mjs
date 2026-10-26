import path from 'node:path';

// Model the stable Pinokio-managed shell environment. HOME and the inherited
// system PATH are deliberately fixed so fixtures never depend on the host.
export function pinokioEnv(pinokioHome, platform = 'linux') {
  const win = platform === 'win32';
  const darwin = platform === 'darwin';
  const paths = win ? path.win32 : path.posix;
  const join = (...parts) => paths.resolve(...parts);
  const home = win ? 'C:\\fixture\\home' : '/fixture/home';
  const delimiter = win ? ';' : ':';
  const basePath = win
    ? 'C:\\Windows\\System32;C:\\Windows'
    : '/usr/bin:/bin';
  const cache = (...parts) => join(pinokioHome, 'cache', ...parts);
  const bin = (...parts) => join(pinokioHome, 'bin', ...parts);
  const condaPathParts = win
    ? ['miniforge/etc/profile.d', 'miniforge/bin', 'miniforge/Scripts', 'miniforge/condabin', 'miniforge/lib', 'miniforge/Library/bin', 'miniforge/pkgs', 'miniforge']
    : ['miniforge/etc/profile.d', 'miniforge/bin', 'miniforge/condabin', 'miniforge/lib', 'miniforge/Library/bin', 'miniforge/pkgs', 'miniforge'];
  const env = {
    HOME: home,
    ...(win ? { USERPROFILE: home } : {}),

    // Pinokio isolates Python user packages and drops inherited PYTHONPATH.
    // pinokiod/kernel/python_env.js:1-9; kernel/shell.js:160-164
    PYTHONNOUSERSITE: '1',

    // Base conda activation and managed Python package policy.
    // pinokiod/kernel/shell.js:1282-1295
    CONDA_AUTO_ACTIVATE_BASE: 'false',
    PIP_REQUIRE_VIRTUALENV: 'true',
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_PYTHON_DOWNLOADS: 'automatic',

    // Managed git/gh configuration is kept inside the Pinokio home.
    // pinokiod/kernel/bin/git.js:55-60; kernel/git.js:71-76
    GIT_CONFIG_GLOBAL: join(pinokioHome, 'gitconfig'),
    GH_CONFIG_DIR: join(pinokioHome, 'config', 'gh'),

    // Managed conda paths and shell defaults.
    // pinokiod/kernel/shell.js:195-200; kernel/bin/conda.js:39-70
    CONDA_SHORTCUTS: '0',
    CONDA_PREFIX: bin('miniforge'),
    CONDA_ENVS_PATH: bin('miniforge', 'envs'),
    CONDA_PKGS_DIRS: bin('miniforge', 'pkgs'),
    PYTHON: bin('miniforge', 'python'),
    CONDARC: join(pinokioHome, 'condarc'),
    PIP_CONFIG_FILE: join(pinokioHome, 'pipconfig'),
    UV_HTTP_TIMEOUT: '60',
    CMAKE_OBJECT_PATH_MAX: '1024',
    PYTORCH_ENABLE_MPS_FALLBACK: '1',
    TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',

    // Pinokio-owned Python package caches and temporary directories.
    // pinokiod/kernel/environment.js:261-284
    XDG_CACHE_HOME: cache('XDG_CACHE_HOME'),
    PIP_CACHE_DIR: cache('PIP_CACHE_DIR'),
    UV_CACHE_DIR: cache('UV_CACHE_DIR'),
    PIP_TMPDIR: cache('PIP_TMPDIR'),

    // Model and tool caches.
    // pinokiod/kernel/environment.js:474-508; kernel/shell.js:293-295
    HF_HOME: cache('HF_HOME'),
    HF_HUB_DISABLE_UPDATE_CHECK: '1',
    HF_TOKEN_PATH: cache('HF_AUTH', 'token'),
    TORCH_HOME: cache('TORCH_HOME'),

    // Node and pnpm are installed in Pinokio's managed bin tree.
    // pinokiod/kernel/bin/node.js:34-42
    NPM_CONFIG_PREFIX: join(pinokioHome, 'bin', 'npm'),
    npm_config_prefix: join(pinokioHome, 'bin', 'npm'),
    npm_config_cache: cache('npm_config_cache'),
    PNPM_HOME: join(pinokioHome, 'bin', 'npm'),
    pnpm_home: join(pinokioHome, 'bin', 'npm'),

    // Browser binaries are shared in Pinokio's managed bin tree.
    // pinokiod/kernel/bin/playwright.js:25-28, 51-54
    PLAYWRIGHT_BROWSERS_PATH: join(pinokioHome, 'bin', 'playwright', 'browsers'),

    // Shell PATH: conda, then managed npm and shell paths, inherited system
    // PATH, then Pinokio home/bin. pinokiod/kernel/bin/conda.js:39-60;
    // kernel/bin/node.js:34-42; kernel/shell.js:227-256
    PATH: (win
      ? [...condaPathParts.map((part) => bin(...part.split('/'))), bin('npm'), bin('npm', 'bin'), basePath, bin()]
      : [...condaPathParts.map((part) => bin(...part.split('/'))), bin('npm'), bin('npm', 'bin'), './node_modules/.bin', '/.nodebrew/current/bin', '/usr/local/bin', basePath, bin()]
    ).join(delimiter),

    // Pinokio redirects user caches and temp files under its cache directory.
    // pinokiod/kernel/environment.js:261-309
    TMP: cache('TMP'),
    TEMP: cache('TEMP'),
    TMPDIR: cache('TMPDIR'),
    XDG_DATA_HOME: cache('XDG_DATA_HOME'),
    XDG_CONFIG_HOME: cache('XDG_CONFIG_HOME'),
    XDG_STATE_HOME: cache('XDG_STATE_HOME'),
  };

  // Conda's Tcl/Tk libraries are explicitly set on macOS.
  // pinokiod/kernel/bin/conda.js:67-70
  if (darwin) {
    env.TCL_LIBRARY = bin('miniforge', 'lib', 'tcl8.6');
    env.TK_LIBRARY = bin('miniforge', 'lib', 'tk8.6');
  }

  // Windows uses Miniforge's CA bundle and disables HF symlink caching.
  // pinokiod/kernel/shell.js:297-309
  if (win) {
    // Windows conda command entrypoints. pinokiod/kernel/bin/conda.js:62-65
    env.CONDA_BAT = bin('miniforge', 'condabin', 'conda.bat');
    env.CONDA_EXE = bin('miniforge', 'Scripts', 'conda.exe');
    env.CONDA_PYTHON_EXE = bin('miniforge', 'Scripts', 'python');
    env.LOCALAPPDATA = join(home, 'AppData', 'Local');
    env.APPDATA = join(home, 'AppData', 'Roaming');
    env.SystemRoot = 'C:\\Windows';
    env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
    env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    const sslDir = bin('miniforge', 'Library', 'ssl');
    env.SSL_CERT_FILE = join(sslDir, 'cacert.pem');
    env.SSL_CERT_DIR = sslDir;
    env.HF_HUB_DISABLE_SYMLINKS = '1';
    env.HF_HUB_DISABLE_SYMLINKS_WARNING = '1';
  }

  // CUDA is reintroduced by Pinokio's managed cuda bin after inherited CUDA
  // variables are stripped. CMake's generator is managed on Windows only.
  // pinokiod/kernel/bin/cuda.js:190-199; kernel/bin/cmake.js:19-26;
  // kernel/shell.js:166-188
  env.CUDA_HOME = bin('miniforge', ...(win ? ['Library'] : []));
  if (win) env.CMAKE_GENERATOR = 'MinGW Makefiles';

  // Linux points nvcc at the available system compiler. The fixture uses a
  // stable representative path. pinokiod/kernel/shell.js:249-253
  if (platform === 'linux') env.NVCC_PREPEND_FLAGS = '-ccbin /usr/bin/g++';

  return env;
}
