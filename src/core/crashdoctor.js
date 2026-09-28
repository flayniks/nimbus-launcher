'use strict';
// The crash doctor: after a crash, reads the crash report, the end of the game log and the JVM's
// own crash file, looks at the mods folder, and says in plain words what went wrong and which
// mod is to blame, with fixes the launcher can do in one click.
const fsp = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');

// Modrinth projects for the mod ids that other mods most often need
const PROJECT_FOR_ID = {
  fabric: 'fabric-api', 'fabric-api': 'fabric-api', fabric_api: 'fabric-api',
  'cloth-config': 'cloth-config', 'cloth-config2': 'cloth-config', cloth_config: 'cloth-config',
  architectury: 'architectury-api', 'architectury-api': 'architectury-api',
  geckolib: 'geckolib', geckolib3: 'geckolib',
  modmenu: 'modmenu', yet_another_config_lib_v3: 'yacl', yacl: 'yacl', owo: 'owo-lib', 'owo-lib': 'owo-lib',
  'fabric-language-kotlin': 'fabric-language-kotlin', kotlinforforge: 'kotlin-for-forge',
  sodium: 'sodium', iris: 'iris', indium: 'indium', lithium: 'lithium', balm: 'balm', 'balm-fabric': 'balm', 'balm-forge': 'balm',
  puzzleslib: 'puzzles-lib', forgeconfigapiport: 'forge-config-api-port', collective: 'collective', curios: 'curios', trinkets: 'trinkets',
  bookshelf: 'bookshelf-lib', 'placeholder-api': 'placeholder-api', resourcefullib: 'resourceful-lib', creativecore: 'creativecore',
  moonlight: 'moonlight', 'terrablender': 'terrablender', 'glitchcore': 'glitchcore', 'libz': 'libz', 'cardinal-components': 'cardinal-components-api',
  playeranimator: 'playeranimator', 'player-animator': 'playeranimator', 'bettercombat': 'better-combat', 'lambdynlights': 'lambdynamiclights',
  midnightlib: 'midnightlib', 'cristellib': 'cristel-lib', 'supermartijn642corelib': 'supermartijn642s-core-lib', 'supermartijn642configlib': 'supermartijn642s-config-lib',
};

// class packages of common libraries, for "a class is missing" crashes
const PROJECT_FOR_PACKAGE = [
  ['net/fabricmc/fabric/', 'fabric-api', 'Fabric API'],
  ['me/shedaniel/clothconfig', 'cloth-config', 'Cloth Config'],
  ['me/shedaniel/autoconfig', 'cloth-config', 'Cloth Config'],
  ['dev/architectury/', 'architectury-api', 'Architectury API'],
  ['software/bernie/geckolib', 'geckolib', 'GeckoLib'],
  ['com/terraformersmc/modmenu', 'modmenu', 'Mod Menu'],
  ['dev/isxander/yacl', 'yacl', 'YetAnotherConfigLib'],
  ['io/wispforest/owo', 'owo-lib', 'oωo'],
  ['kotlin/', 'fabric-language-kotlin', 'Fabric Language Kotlin'],
  ['net/blay09/mods/balm', 'balm', 'Balm'],
  ['fuzs/puzzleslib', 'puzzles-lib', 'Puzzles Lib'],
  ['fuzs/forgeconfigapiport', 'forge-config-api-port', 'Forge Config API Port'],
  ['net/darkhax/bookshelf', 'bookshelf-lib', 'Bookshelf'],
  ['dev/emi/trinkets', 'trinkets', 'Trinkets'],
  ['top/theillusivec4/curios', 'curios', 'Curios API'],
  ['eu/midnightdust/lib', 'midnightlib', 'MidnightLib'],
  ['net/caffeinemc/mods/sodium', 'sodium', 'Sodium'],
  ['me/jellysquid/mods/sodium', 'sodium', 'Sodium'],
  ['com/teamresourceful/resourcefullib', 'resourceful-lib', 'Resourceful Lib'],
  ['dev/kosmx/playerAnim', 'playeranimator', 'playerAnimator'],
];

const NOT_MODS = /^(java|javax|jdk|sun|com\/sun|net\/minecraft|com\/mojang|net\/fabricmc\/loader|net\/fabricmc\/api|org\/quiltmc\/loader|net\/minecraftforge\/fml|net\/neoforged\/fml|cpw\/mods|org\/spongepowered|com\/llamalad7|org\/lwjgl|io\/netty|com\/google|org\/apache|it\/unimi|org\/objectweb|org\/slf4j|kotlin\/jvm\/internal|dev\/flayniks\/nimbus)(\/|$)/;

const DRIVER_LINKS = {
  nvidia: ['NVIDIA', 'https://www.nvidia.com/Download/index.aspx'],
  amd: ['AMD', 'https://www.amd.com/en/support/download/drivers.html'],
  intel: ['Intel', 'https://www.intel.com/content/www/us/en/support/detect.html'],
};

// ------------------------------------------------------------------ the mods folder

/** Reads what each enabled mod jar says it is: ids, name, loader, and the packages its classes live in. */
async function scanMods(gameDir) {
  const dir = path.join(gameDir, 'mods');
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const file of names) {
    if (!/\.jar$/i.test(file)) continue;
    const full = path.join(dir, file);
    const mod = { file, rel: `mods/${file}`, ids: [], name: null, loader: null, packages: [], version: null, time: 0 };
    try {
      mod.time = (await fsp.stat(full)).mtimeMs;
      const zip = new AdmZip(full);
      const text = (n) => { const e = zip.getEntry(n); return e ? e.getData().toString('utf8') : null; };
      const fabric = text('fabric.mod.json');
      const quilt = text('quilt.mod.json');
      const forge = text('META-INF/mods.toml');
      const neo = text('META-INF/neoforge.mods.toml');
      if (fabric) {
        try {
          const j = JSON.parse(fabric.replace(/^﻿/, '').replace(/[\u0000-\u001f]+/g, ' '));
          mod.ids.push(j.id);
          mod.name = j.name || j.id;
          mod.version = j.version || null;
          for (const p of Object.keys(j.provides || {})) mod.ids.push(p);
          if (Array.isArray(j.provides)) mod.ids.push(...j.provides.filter((x) => typeof x === 'string'));
        } catch { /* a jar with a broken fabric.mod.json: the log will say */ }
        mod.loader = 'fabric';
      }
      if (quilt) {
        try {
          const j = JSON.parse(quilt).quilt_loader || {};
          if (j.id) mod.ids.push(j.id);
          mod.name = mod.name || j.metadata?.name || j.id;
          mod.version = mod.version || j.version || null;
        } catch { /* ignore */ }
        mod.loader = mod.loader || 'quilt';
      }
      for (const [toml, kind] of [[forge, 'forge'], [neo, 'neoforge']]) {
        if (!toml) continue;
        for (const m of toml.matchAll(/modId\s*=\s*["']([^"']+)["']/g)) mod.ids.push(m[1]);
        const dn = toml.match(/displayName\s*=\s*["']([^"']+)["']/);
        mod.name = mod.name || dn?.[1] || null;
        mod.loader = mod.loader ? `${mod.loader}+${kind}` : kind;
      }
      const pk = new Set();
      for (const e of zip.getEntries()) {
        if (!e.entryName.endsWith('.class') || e.entryName.startsWith('META-INF/')) continue;
        const parts = e.entryName.split('/');
        if (parts.length > 3) pk.add(parts.slice(0, 3).join('/'));
        else if (parts.length > 1) pk.add(parts.slice(0, parts.length - 1).join('/'));
        if (pk.size > 40) break;
      }
      mod.packages = [...pk];
    } catch { /* not a readable jar */ }
    mod.ids = [...new Set(mod.ids.filter(Boolean).map((x) => String(x).toLowerCase()))];
    mod.name = mod.name || file.replace(/\.jar$/i, '');
    out.push(mod);
  }
  return out;
}

// ------------------------------------------------------------------ reading the signs

const lines = (text) => String(text || '').split(/\r?\n/);

function modById(mods, id) {
  const k = String(id || '').toLowerCase();
  return mods.find((m) => m.ids.includes(k)) || null;
}

function modByName(mods, name) {
  const k = String(name || '').toLowerCase();
  return mods.find((m) => m.name.toLowerCase() === k) || null;
}

function modForClass(mods, cls) {
  const c = cls.replace(/\./g, '/');
  if (NOT_MODS.test(c)) return null;
  let best = null;
  for (const m of mods) {
    for (const p of m.packages) {
      if ((c === p || c.startsWith(`${p}/`)) && (!best || p.length > best.len)) best = { mod: m, len: p.length };
    }
  }
  return best?.mod || null;
}

const disable = (mod, why) => ({ kind: 'disable', rel: mod.rel, label: `Turn off ${mod.name}`, why });
const install = (project, name) => ({ kind: 'install', project, label: `Add ${name}` });

/**
 * Works out what happened. Returns {kind, title, explain, culprits:[{name, rel}], fixes:[...], evidence}
 * or null when there is nothing to go on.
 *
 * @param {object} input
 * @param {string} [input.report] the crash report
 * @param {string[]} [input.log] the last lines of the game log
 * @param {string} [input.hsErr] the JVM's fatal error log
 * @param {number|null} [input.code] exit code
 * @param {object} input.instance the instance (loader, mcVersion, memory, javaPath)
 * @param {object[]} [input.mods] from scanMods
 * @param {number} [input.totalMB] the computer's memory
 */
function diagnose({ report = '', log = [], hsErr = '', code = null, instance, mods = [], totalMB = 8192 }) {
  const logText = log.join('\n');
  const all = `${report}\n${logText}`;
  const found = [];
  const add = (d) => found.push(d);
  const loader = instance?.loader || 'vanilla';

  // --- mods for another loader
  const fabricish = loader === 'fabric' || loader === 'quilt';
  const forgeish = loader === 'forge' || loader === 'neoforge';
  const wrongLoader = mods.filter((m) => m.loader && ((fabricish && /^(forge|neoforge)/.test(m.loader) && !/fabric|quilt/.test(m.loader)) || (forgeish && /^(fabric|quilt)$/.test(m.loader))));
  if (wrongLoader.length) {
    add({
      kind: 'wrong-loader', weight: 90,
      title: wrongLoader.length === 1 ? `${wrongLoader[0].name} is made for ${/fabric|quilt/.test(wrongLoader[0].loader) ? 'Fabric' : 'Forge'}` : `${wrongLoader.length} mods are made for a different mod loader`,
      explain: `This instance runs ${loader[0].toUpperCase()}${loader.slice(1)}, and mods only work with the loader they were made for.`,
      culprits: wrongLoader,
      fixes: wrongLoader.slice(0, 4).map((m) => disable(m)),
    });
  }

  // --- the same mod twice
  const byId = new Map();
  for (const m of mods) for (const id of m.ids.slice(0, 1)) (byId.get(id) || byId.set(id, []).get(id)).push(m);
  const dupes = [...byId.values()].filter((l) => l.length > 1);
  if (dupes.length || /duplicate mods?|provided by (?:more than one|multiple)|Found \d+ duplicate/i.test(logText)) {
    const list = dupes.flatMap((l) => l.sort((a, b) => a.time - b.time).slice(0, l.length - 1));
    if (list.length) {
      add({
        kind: 'duplicate', weight: 85,
        title: `${list[0].name} is in the mods folder twice`,
        explain: 'Two copies of the same mod can\'t load together. Keep the newest one.',
        culprits: list,
        fixes: list.slice(0, 4).map((m) => ({ ...disable(m), label: `Turn off the older ${m.name} (${m.file})` })),
      });
    }
  }

  // --- Fabric and Quilt telling us exactly what's missing
  const missing = new Map();
  const wrongGame = [];
  const needsOther = [];
  for (const l of lines(logText)) {
    const who = l.match(/Mod '([^']+)' \(([^)]+)\)/);
    if (/which is missing/.test(l) || /is not installed/.test(l)) {
      const dep = l.match(/requires .*?(?:of |mod )(?:mod )?'?([^'(),]+?)'? ?(?:\(([\w.-]+)\))?,? which is missing/) || l.match(/requires .*?\b([\w.-]+),? which is missing/);
      const depId = (dep?.[2] || dep?.[1] || '').trim().toLowerCase();
      if (!depId) continue;
      if (depId === 'minecraft' || depId === 'java') {
        const m = who && (modById(mods, who[2]) || modByName(mods, who[1]));
        if (m) wrongGame.push(m);
        continue;
      }
      if (depId === 'fabricloader' || depId === 'quilt_loader') continue;
      missing.set(depId, { requiredBy: who?.[1] || null, name: dep?.[2] ? dep[1] : depId });
    }
    const install15 = l.match(/^\s*-\s*Install ([\w.-]+), (?:any|version)/);
    if (install15) missing.set(install15[1].toLowerCase(), { requiredBy: null, name: install15[1] });
    if (/of minecraft, but only the wrong version is present/.test(l) && who) {
      const m = modById(mods, who[2]) || modByName(mods, who[1]);
      if (m) wrongGame.push(m);
    }
    const remove = l.match(/^\s*-\s*Remove mod '([^']+)' \(([^)]+)\)/);
    if (remove) { const m = modById(mods, remove[2]) || modByName(mods, remove[1]); if (m) needsOther.push(m); }
    const breaks = l.match(/Mod '([^']+)' \(([^)]+)\).*(?:is incompatible with|breaks)/);
    if (breaks) { const m = modById(mods, breaks[2]) || modByName(mods, breaks[1]); if (m) needsOther.push(m); }
  }
  // Forge and NeoForge: "Mod ID: 'x', Requested by: 'y', Expected range: '...', Actual version: '[MISSING]'"
  for (const m of all.matchAll(/Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^']*)'/g)) {
    if (m[4] === '[MISSING]') missing.set(m[1].toLowerCase(), { requiredBy: m[2], name: m[1] });
    else if (m[1] === 'minecraft') { const mm = modById(mods, m[2]); if (mm) wrongGame.push(mm); }
  }
  if (missing.size) {
    const deps = [...missing.entries()].filter(([id]) => !modById(mods, id));
    if (deps.length) {
      const [id, info] = deps[0];
      const nice = PROJECT_FOR_PACKAGE.find(([, p]) => p === (PROJECT_FOR_ID[id] || id))?.[2] || info.name;
      add({
        kind: 'missing-dependency', weight: 100,
        title: deps.length === 1 ? `${info.requiredBy || 'A mod'} needs ${nice}` : `${deps.length} mods that others need are missing`,
        explain: `Some mods need another mod installed to work${info.requiredBy ? `: ${info.requiredBy} needs ${nice}` : ''}. Nimbus can add ${deps.length === 1 ? 'it' : 'them'} from Modrinth.`,
        culprits: [],
        fixes: deps.slice(0, 5).map(([depId, i]) => install(PROJECT_FOR_ID[depId] || depId, PROJECT_FOR_PACKAGE.find(([, p]) => p === (PROJECT_FOR_ID[depId] || depId))?.[2] || i.name)),
      });
    }
  }
  if (wrongGame.length) {
    const uniq = [...new Set(wrongGame)];
    add({
      kind: 'wrong-version', weight: 95,
      title: uniq.length === 1 ? `${uniq[0].name} is made for another Minecraft version` : `${uniq.length} mods are made for another Minecraft version`,
      explain: `This instance is Minecraft ${instance?.mcVersion}. Turn ${uniq.length === 1 ? 'it' : 'them'} off, or update to a build for ${instance?.mcVersion}.`,
      culprits: uniq,
      fixes: uniq.slice(0, 3).flatMap((m) => [{ kind: 'update', rel: m.rel, label: `Update ${m.name}` }, disable(m)]),
    });
  }
  if (needsOther.length) {
    const uniq = [...new Set(needsOther)];
    add({
      kind: 'incompatible', weight: 80,
      title: `${uniq[0].name} doesn't work with another of your mods`,
      explain: 'Some mods clash with each other. Turn one of them off.',
      culprits: uniq,
      fixes: uniq.slice(0, 3).map((m) => disable(m)),
    });
  }

  // --- a class is missing: usually a library mod
  for (const m of all.matchAll(/(?:NoClassDefFoundError|ClassNotFoundException):\s*([\w./$]+)/g)) {
    const cls = m[1].replace(/\./g, '/');
    const lib = PROJECT_FOR_PACKAGE.find(([p]) => cls.startsWith(p));
    if (lib && !mods.some((x) => x.packages.some((p) => p.startsWith(lib[0].replace(/\/$/, '').split('/').slice(0, 3).join('/'))))) {
      add({
        kind: 'missing-library', weight: 88,
        title: `A mod needs ${lib[2]}`,
        explain: `One of your mods uses ${lib[2]}, which isn't installed.`,
        culprits: [],
        fixes: [install(lib[1], lib[2])],
      });
      break;
    }
  }

  // --- a mod's mixins broke the game
  const mixinMods = new Set();
  for (const m of all.matchAll(/Mixin apply for mod ([\w.-]+) failed|mixin config ([\w.-]+?)(?:\.mixins)?\.json[^\n]*(?:failed|error|could not)|from mod ([\w.-]+) (?:failed injection|failed)/gi)) {
    const id = (m[1] || m[2] || m[3] || '').toLowerCase().replace(/\.mixins$/, '');
    if (id && id !== 'nimbus') mixinMods.add(id);
  }
  const mixinCulprits = [...mixinMods].map((id) => modById(mods, id) || mods.find((x) => x.file.toLowerCase().includes(id))).filter(Boolean);
  if (mixinCulprits.length) {
    add({
      kind: 'mixin', weight: 75,
      title: `${mixinCulprits[0].name} broke while loading`,
      explain: `${mixinCulprits[0].name} changes the game's code and that failed, usually because it doesn't fit this Minecraft version or clashes with another mod. Update it or turn it off.`,
      culprits: mixinCulprits,
      fixes: mixinCulprits.slice(0, 2).flatMap((m) => [{ kind: 'update', rel: m.rel, label: `Update ${m.name}` }, disable(m)]),
    });
  }

  // --- memory
  if (/java\.lang\.OutOfMemoryError/.test(all)) {
    const now = instance?.memory?.max || 4096;
    const next = Math.min(Math.max(now + 2048, 4096), Math.max(2048, Math.floor(totalMB * 0.7 / 512) * 512));
    add({
      kind: 'memory', weight: 70,
      title: 'Minecraft ran out of memory',
      explain: `It had ${Math.round(now / 1024 * 10) / 10} GB and needed more. Big modpacks and shaders use a lot.`,
      culprits: [],
      fixes: next > now ? [{ kind: 'memory', mb: next, label: `Give it ${Math.round(next / 1024 * 10) / 10} GB` }] : [{ kind: 'link', url: 'https://modrinth.com/mod/ferrite-core', label: 'Try FerriteCore (uses less memory)' }],
    });
  }
  if (/Could not reserve enough space for .*object heap|Invalid maximum heap size/.test(all)) {
    add({ kind: 'memory-too-much', weight: 72, title: 'Minecraft asked for more memory than Java can give', explain: 'The memory setting is higher than this computer (or this Java) allows.', culprits: [], fixes: [{ kind: 'memory', mb: 4096, label: 'Set it to 4 GB' }, { kind: 'java', label: 'Use the Java Nimbus picks' }] });
  }
  if (code === 137 || code === -9) {
    add({ kind: 'killed', weight: 40, title: 'Your computer stopped Minecraft', explain: 'The system closed it, usually because the whole computer ran out of memory. Close other programs, or give Minecraft a bit less memory.', culprits: [], fixes: [] });
  }

  // --- Java version
  const cv = all.match(/(?:compiled by a more recent version of the Java Runtime \(class file version (\d+)(?:\.\d+)?\)|Unsupported class file major version (\d+))/);
  if (cv || /UnsupportedClassVersionError/.test(all)) {
    const need = cv ? Number(cv[1] || cv[2]) - 44 : null;
    const cls = all.match(/UnsupportedClassVersionError: ([\w/$.]+)/)?.[1];
    const m = cls ? modForClass(mods, cls) : null;
    add({
      kind: 'java', weight: 78,
      title: m ? `${m.name} needs a newer Java` : 'A mod needs a newer Java',
      explain: `${m ? m.name : 'Something'} was built for Java ${need || 'newer'}, newer than this Minecraft version runs on. It's most likely made for a newer Minecraft.`,
      culprits: m ? [m] : [],
      fixes: [...(m ? [disable(m)] : []), ...(instance?.javaPath ? [{ kind: 'java', label: 'Use the Java Nimbus picks' }] : [])],
    });
  }

  // --- graphics drivers
  const gl = /GLFW error (?:65542|65543)|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|OpenGL (?:is )?not supported|Failed to create .*OpenGL context|No OpenGL context|Unable to find a usable OpenGL|GL_OUT_OF_MEMORY/i.test(all);
  const frame = hsErr.match(/Problematic frame:[\s\S]{0,200}?\b(atio6axx|atioglxx|amdxc64|nvoglv64|nvoglv32|nvwgf2umx|ig\w*icd(?:64|32)|igxelp\w*|libGL\w*|iris_dri|radeonsi_dri|nouveau_dri|libnvidia\w*)/i);
  if (gl || frame || code === -1073741819 || code === 3221225477 || code === -805306369) {
    const vendor = frame ? (/nv|nvidia/i.test(frame[1]) ? 'nvidia' : /ati|amd|radeon/i.test(frame[1]) ? 'amd' : /ig|intel|iris/i.test(frame[1]) ? 'intel' : null) : null;
    const shader = mods.find((m) => m.ids.some((i) => ['iris', 'oculus', 'optifabric', 'optifine'].includes(i)));
    const strong = gl || frame;
    add({
      kind: 'graphics', weight: strong ? 82 : 35,
      title: strong ? 'The graphics driver crashed' : 'Minecraft crashed hard (outside Java)',
      explain: strong
        ? `Minecraft couldn't draw with your graphics card${vendor ? ` (${DRIVER_LINKS[vendor][0]})` : ''}. Updating the graphics driver fixes this most of the time.${shader ? ' Shaders make it more likely.' : ''}`
        : 'This kind of crash usually comes from graphics drivers, overlays (Discord, recording apps) or overclocking.',
      culprits: [],
      fixes: [
        ...(vendor ? [{ kind: 'link', url: DRIVER_LINKS[vendor][1], label: `Get the newest ${DRIVER_LINKS[vendor][0]} driver` }] : [{ kind: 'link', url: 'https://www.minecraft.net/en-us/article/minecraft-java-edition-graphics-drivers', label: 'How to update graphics drivers' }]),
        ...(shader ? [{ kind: 'shaders-off', label: 'Turn off shaders' }] : []),
      ],
    });
  }

  // --- a broken config file
  const cfg = all.match(/(?:config[\\/])([\w./\\-]+?\.(?:json5?|toml|properties|cfg|yml|yaml))[^\n]*?(?:Exception|failed|could not|malformed|invalid)|(?:Failed to (?:load|read|parse)[^\n]*?)(config[\\/][\w./\\-]+?\.(?:json5?|toml|properties|cfg|yml|yaml))/i);
  if (cfg && /(JsonSyntaxException|MalformedJson|ParsingException|Failed to (?:load|read|parse)|Unterminated|Expected)/i.test(all)) {
    const rel = `config/${(cfg[1] || cfg[2].replace(/^config[\\/]/, '')).replace(/\\/g, '/')}`;
    add({ kind: 'config', weight: 76, title: `A settings file is broken: ${path.basename(rel)}`, explain: 'A mod couldn\'t read its settings file. Resetting it gives that mod its default settings back (the old file is kept next to it).', culprits: [], fixes: [{ kind: 'reset-config', rel, label: `Reset ${path.basename(rel)}` }] });
  }

  // --- the crash report's own suspects, and the stack trace
  const suspects = [];
  const sec = report.match(/Suspected Mods?:\s*([\s\S]*?)(?:\n\s*\n|\nStacktrace:|$)/);
  if (sec && !/Suspected Mods?:\s*(?:NONE|Unknown)/i.test(sec[0])) {
    for (const l of lines(sec[1])) {
      const m = l.match(/^\s*(.+?) \(([\w.-]+)\)/);
      const mod = m && (modById(mods, m[2]) || modByName(mods, m[1]));
      if (mod && !suspects.includes(mod)) suspects.push(mod);
    }
  }
  const frames = [...report.matchAll(/^\s*at ([\w$.]+)\.[\w$<>]+\(/gm)].slice(0, 25).map((m) => m[1]);
  for (const f of frames) {
    const mod = modForClass(mods, f);
    if (mod && !suspects.includes(mod)) suspects.push(mod);
    if (suspects.length >= 3) break;
  }
  const description = report.match(/^Description: (.+)$/m)?.[1] || null;
  const exception = (report.match(/^([\w.$]+(?:Exception|Error)(?::[^\n]*)?)$/m) || logText.match(/([\w.$]+(?:Exception|Error): [^\n]+)/))?.[1] || null;
  if (suspects.length) {
    add({
      kind: 'suspect', weight: 60,
      title: `${suspects[0].name} crashed the game`,
      explain: `The crash happened inside ${suspects[0].name}${suspects.length > 1 ? ` (${suspects.slice(1).map((m) => m.name).join(', ')} ${suspects.length > 2 ? 'were' : 'was'} involved too)` : ''}. Updating it often fixes this; if not, turn it off.`,
      culprits: suspects,
      fixes: suspects.slice(0, 2).flatMap((m) => [{ kind: 'update', rel: m.rel, label: `Update ${m.name}` }, disable(m)]),
    });
  }

  if (!found.length) {
    if (code === 0 || code === null) return null;
    const recent = [...mods].sort((a, b) => b.time - a.time).slice(0, 3);
    return {
      kind: 'unknown',
      title: 'Minecraft crashed',
      explain: `${description ? `The game says: "${description}". ` : ''}Nimbus couldn't tell which mod did it. If it started after you added mods, try turning the newest ones off.`,
      culprits: [],
      fixes: [...recent.slice(0, 2).map((m) => ({ ...disable(m), label: `Turn off ${m.name} (newest)` })), { kind: 'repair', label: 'Repair the instance' }],
      evidence: [description, exception].filter(Boolean).join('\n'),
    };
  }
  found.sort((a, b) => b.weight - a.weight);
  const best = found[0];
  // fixes from other findings that don't repeat the first one's
  const extra = found.slice(1).flatMap((f) => f.fixes).filter((fx) => !best.fixes.some((b) => b.kind === fx.kind && b.rel === fx.rel && b.project === fx.project));
  return {
    kind: best.kind,
    title: best.title,
    explain: best.explain,
    culprits: best.culprits.map((m) => ({ name: m.name, rel: m.rel, file: m.file })),
    fixes: [...best.fixes, ...extra].slice(0, 6),
    also: found.slice(1, 3).map((f) => f.title),
    evidence: [description, exception].filter(Boolean).join('\n'),
  };
}

/** Everything the doctor needs from disk for an instance that just stopped, then the diagnosis. */
async function examine({ gameDir, instance, code, since, log = [], crashFile = null, totalMB }) {
  const report = crashFile ? await fsp.readFile(crashFile, 'utf8').catch(() => '') : '';
  let hsErr = '';
  try {
    for (const f of await fsp.readdir(gameDir)) {
      if (!/^hs_err_pid\d+\.log$/.test(f)) continue;
      const st = await fsp.stat(path.join(gameDir, f));
      if (st.mtimeMs >= since) hsErr = await fsp.readFile(path.join(gameDir, f), 'utf8');
    }
  } catch { /* no game folder */ }
  let tail = log;
  if (!tail.length) {
    const latest = await fsp.readFile(path.join(gameDir, 'logs', 'latest.log'), 'utf8').catch(() => '');
    tail = latest.split(/\r?\n/).slice(-1500);
  }
  const mods = instance.loader === 'vanilla' ? [] : (await scanMods(gameDir)).filter((m) => !/^nimbus-core-/i.test(m.file));
  return diagnose({ report, log: tail.slice(-1500), hsErr, code, instance, mods, totalMB });
}

module.exports = { diagnose, examine, scanMods, PROJECT_FOR_ID };
