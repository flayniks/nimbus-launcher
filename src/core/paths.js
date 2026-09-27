'use strict';
const path = require('path');

/**
 * Everything the launcher stores lives under one root. Libraries, assets and
 * Java runtimes are shared by every instance; each instance only owns its game folder.
 */
function createPaths(root) {
  return {
    root,
    instances: path.join(root, 'instances'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    versions: path.join(root, 'versions'),
    runtimes: path.join(root, 'runtimes'),
    cache: path.join(root, 'cache'),
    settings: path.join(root, 'settings.json'),
    accounts: path.join(root, 'accounts.json'),
    // Nimbus Core: the in-game Features setup and the menu background picture, shared by every instance
    features: path.join(root, 'nimbus-features.json'),
    menuImage: path.join(root, 'menu-background.png'),
    cosmetics: path.join(root, 'nimbus-cosmetics.json'),
    // Nimbus coins: what Nimbus Core counted today, and today's tasks for it to cheer about
    progress: path.join(root, 'nimbus-progress.json'),
    tasks: path.join(root, 'nimbus-tasks.json'),
    versionDir: (id) => path.join(root, 'versions', id),
    versionJson: (id) => path.join(root, 'versions', id, `${id}.json`),
    versionJar: (id) => path.join(root, 'versions', id, `${id}.jar`),
    nativesDir: (id) => path.join(root, 'versions', id, 'natives'),
    library: (rel) => path.join(root, 'libraries', ...rel.split('/')),
    instanceDir: (id) => path.join(root, 'instances', id),
    gameDir: (id) => path.join(root, 'instances', id, 'minecraft'),
  };
}

module.exports = { createPaths };
