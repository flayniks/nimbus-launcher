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
