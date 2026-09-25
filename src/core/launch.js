'use strict';
const fsp = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { rulesAllow, splitArgs, osName, osArch } = require('./util');

const LAUNCHER_NAME = 'nimbus-launcher';
const LAUNCHER_VERSION = '1.0.0';

function substitute(arg, vars) {
  return arg.replace(/\$\{([^}]+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

/** Flattens modern {rules, value} argument lists down to the ones that apply here. */
function flattenArgs(list, features) {
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') out.push(item);
    else if (item && rulesAllow(item.rules, features)) {
      out.push(...(Array.isArray(item.value) ? item.value : [item.value]));
    }
  }
  return out;
}

/** Splits "play.example.net:25566" into host and port. */
function parseServer(address) {
  if (!address) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
  return m ? { host: m[1], port: m[2] || '25565', raw: trimmed } : null;
}

/**
 * Builds the full java command line for a prepared version.
 * `extraJvm` carries the memory and FPS boost flags.
 */
function buildArguments({ paths, version, install, instance, account, gameDir, gameAssets, clientId, extraJvm = [] }) {
  const server = parseServer(instance.server);
  const hasResolution = Boolean(instance.resolution?.width && instance.resolution?.height);
  const features = {
    is_demo_user: false,
    has_custom_resolution: hasResolution,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: Boolean(server),
    is_quick_play_realms: false,
  };
  const vars = {
    auth_player_name: account.name,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: paths.assets,
    game_assets: gameAssets,
    assets_index_name: version.assetIndex?.id || version.assets || 'legacy',
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    auth_session: `token:${account.accessToken}:${account.uuid}`,
    clientid: clientId || '',
    auth_xuid: account.xuid || '0',
    user_type: 'msa',
    version_type: version.type || 'release',
    user_properties: '{}',
    natives_directory: install.nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: install.classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: paths.libraries,
    resolution_width: instance.resolution?.width || 854,
    resolution_height: instance.resolution?.height || 480,
    quickPlayMultiplayer: server?.raw || '',
    quickPlayPath: '',
  };

  const jvm = [...extraJvm];
  if (version.arguments?.jvm) {
    jvm.push(...flattenArgs(version.arguments.jvm, features));
  } else {
    if (osName() === 'osx') jvm.push('-XstartOnFirstThread');
    if (osName() === 'windows') jvm.push('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
    if (osArch() === 'x86') jvm.push('-Xss1M');
    jvm.push(
      '-Djava.library.path=${natives_directory}',
      '-Dminecraft.launcher.brand=${launcher_name}',
      '-Dminecraft.launcher.version=${launcher_version}',
      // old Forge refuses to start when it cannot verify the game jar's long-expired signature
      '-Dfml.ignoreInvalidMinecraftCertificates=true',
      '-Dfml.ignorePatchDiscrepancies=true',
      '-cp', '${classpath}',
    );
  }
  if (install.logConfig) jvm.push(install.logConfig.argument.replace('${path}', install.logConfig.path));
  // belt and braces against Log4Shell on versions whose log config predates the fix
  jvm.push('-Dlog4j2.formatMsgNoLookups=true');
  jvm.push(...splitArgs(instance.jvmArgs));

  let game;
  if (version.arguments?.game) {
    game = flattenArgs(version.arguments.game, features);
  } else {
    game = (version.minecraftArguments || '').split(' ').filter(Boolean);
    if (hasResolution) game.push('--width', '${resolution_width}', '--height', '${resolution_height}');
  }
  // 1.20+ takes --quickPlayMultiplayer from its own arguments, older versions want --server/--port
  if (server && !game.includes('--quickPlayMultiplayer')) {
    game.push('--server', server.host, '--port', server.port);
  }
  if (instance.fullscreen) game.push('--fullscreen');

  return {
    mainClass: version.mainClass,
    jvm: jvm.map((a) => substitute(a, vars)),
    game: game.map((a) => substitute(a, vars)),
  };
}

/** Java 9+ can read arguments from a file, which dodges Windows' 32k command line limit on big modpacks. */
async function maybeArgFile(gameDir, javaMajor, args) {
  const length = args.reduce((n, a) => n + a.length + 3, 0);
  if (process.platform !== 'win32' || javaMajor < 9 || length < 30000) return args;
  const file = path.join(gameDir, '.nimbus-args.txt');
  const quoted = args.map((a) => `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  await fsp.writeFile(file, quoted.join('\n'));
  return [`@${file}`];
}

function maskToken(args, token) {
  if (!token) return args;
  return args.map((a) => a.split(token).join('••••••••'));
}

/**
 * Starts the game. `detach` lets it outlive the launcher (the "close launcher" option),
 * otherwise stdout/stderr are streamed back line by line.
 */
async function spawnGame({ java, gameDir, built, account, detach = false, onLine, onExit }) {
  const args = [...built.jvm, built.mainClass, ...built.game];
  const finalArgs = await maybeArgFile(gameDir, java.major, args);
  const child = spawn(java.bin, finalArgs, {
    cwd: gameDir,
    detached: detach,
    stdio: detach ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  if (detach) {
    child.unref();
  } else {
    let rest = { out: '', err: '' };
    const feed = (kind) => (buf) => {
      const text = rest[kind] + buf.toString();
      const lines = text.split(/\r?\n/);
      rest[kind] = lines.pop();
      for (const line of lines) if (onLine) onLine(line, kind);
    };
    child.stdout.on('data', feed('out'));
    child.stderr.on('data', feed('err'));
    child.on('close', (code) => {
      for (const kind of ['out', 'err']) if (rest[kind] && onLine) onLine(rest[kind], kind);
      rest = { out: '', err: '' };
      if (onExit) onExit(code);
    });
  }
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  return { child, commandLine: [java.bin, ...maskToken(args, account.accessToken)] };
}

module.exports = { LAUNCHER_NAME, LAUNCHER_VERSION, substitute, flattenArgs, parseServer, buildArguments, spawnGame, maskToken };
