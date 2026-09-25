'use strict';
const fabric = require('./fabric');
const forge = require('./forge');

const LOADERS = {
  vanilla: { id: 'vanilla', name: 'Vanilla' },
  fabric: { id: 'fabric', name: 'Fabric' },
  quilt: { id: 'quilt', name: 'Quilt' },
  forge: { id: 'forge', name: 'Forge' },
  neoforge: { id: 'neoforge', name: 'NeoForge' },
};

function impl(kind) {
  if (kind === 'fabric' || kind === 'quilt') return fabric;
  if (kind === 'forge' || kind === 'neoforge') return forge;
  throw new Error(`Unknown loader ${kind}`);
}

async function supportedGameVersions(kind) {
  if (kind === 'vanilla') return null;
  return impl(kind).supportedGameVersions(kind);
}

async function listLoaderVersions(kind, mc) {
  if (kind === 'vanilla') return [];
  return impl(kind).listLoaderVersions(kind, mc);
}

/** The loader version to pick when the user does not choose: recommended, then newest stable, then newest. */
function pickDefault(list) {
  return (list.find((v) => v.recommended) || list.find((v) => v.stable) || list[0] || {}).version;
}

module.exports = { LOADERS, fabric, forge, supportedGameVersions, listLoaderVersions, pickDefault };
