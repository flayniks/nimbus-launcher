'use strict';
// Offline unit tests for the launcher core: node test/unit.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const util = require('../src/core/util');
const { mergeVersion } = require('../src/core/versions');
const { planLibraries, clientJarId, libraryArtifact } = require('../src/core/install');
const { neoToMinecraft, compareNatural } = require('../src/core/loaders/forge');
const { buildArguments, parseServer, flattenArgs } = require('../src/core/launch');
const { LogParser } = require('../src/core/logparse');
const boost = require('../src/core/boost');
const { packLoader, modLoaders } = require('../src/core/modrinth');
const { createPaths } = require('../src/core/paths');
const { Instances } = require('../src/core/instances');
const { AccountStore } = require('../src/core/accounts');
const { Builtin, familyFor } = require('../src/core/builtin');

test('maven coordinates become repository paths', () => {
  assert.equal(util.mavenPath('net.fabricmc:fabric-loader:0.16.9'), 'net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar');
  assert.equal(util.mavenPath('org.lwjgl:lwjgl:3.3.1:natives-windows'), 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar');
  assert.equal(util.mavenPath('de.oceanlabs.mcp:mcp_config:1.20.1-20230612.114412:mappings@txt'), 'de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/mcp_config-1.20.1-20230612.114412-mappings.txt');
  assert.throws(() => util.mavenPath('broken'));
});

test('library keys ignore the version but keep the classifier', () => {
  assert.equal(util.libraryKey('org.ow2.asm:asm:9.6'), 'org.ow2.asm:asm');
  assert.equal(util.libraryKey('org.lwjgl:lwjgl:3.3.1:natives-linux'), 'org.lwjgl:lwjgl:natives-linux');
});

test('rules: no rules allows, last match wins, features gate', () => {
  const me = util.osName();
  const other = me === 'windows' ? 'linux' : 'windows';
  assert.equal(util.rulesAllow(undefined), true);
  assert.equal(util.rulesAllow([{ action: 'allow' }, { action: 'disallow', os: { name: me } }]), false);
  assert.equal(util.rulesAllow([{ action: 'allow' }, { action: 'disallow', os: { name: other } }]), true);
  assert.equal(util.rulesAllow([{ action: 'allow', os: { name: other } }]), false);
  assert.equal(util.rulesAllow([{ action: 'allow', features: { has_custom_resolution: true } }], {}), false);
  assert.equal(util.rulesAllow([{ action: 'allow', features: { has_custom_resolution: true } }], { has_custom_resolution: true }), true);
});

test('splitArgs keeps quoted parts together', () => {
  assert.deepEqual(util.splitArgs('-Xss4M "-Dfoo=a b" \'-Dbar=c d\''), ['-Xss4M', '-Dfoo=a b', '-Dbar=c d']);
  assert.deepEqual(util.splitArgs(''), []);
});

test('mergeVersion puts the loader first and keeps vanilla assets', () => {
  const parent = {
    id: '1.20.1', jar: '1.20.1', vanilla: '1.20.1', mainClass: 'net.minecraft.client.main.Main', type: 'release', releaseTime: '2023-06-12',
    libraries: [{ name: 'a:b:1' }], arguments: { game: ['--username'], jvm: ['-cp'] }, assetIndex: { id: '5' }, logging: { client: { argument: 'x' } },
  };
  const child = {
    id: '1.20.1-forge-47', inheritsFrom: '1.20.1', mainClass: 'cpw.Boot', type: 'release', releaseTime: '2099-01-01',
    libraries: [{ name: 'c:d:2' }], arguments: { game: ['--launchTarget'], jvm: ['-DignoreList'] }, logging: {},
  };
  const m = mergeVersion(parent, child);
  assert.equal(m.id, '1.20.1-forge-47');
  assert.equal(m.mainClass, 'cpw.Boot');
  assert.deepEqual(m.libraries.map((l) => l.name), ['c:d:2', 'a:b:1']);
  assert.deepEqual(m.arguments.game, ['--username', '--launchTarget']);
  assert.equal(m.assetIndex.id, '5');
  assert.equal(m.logging.client.argument, 'x', 'an empty logging object must not hide vanilla\'s');
  assert.equal(m.releaseTime, '2023-06-12');
  assert.equal(m.jar, '1.20.1');
  assert.equal(m.inheritsFrom, undefined);
});

test('planLibraries dedupes by group:artifact and spots generated jars', () => {
  const paths = createPaths(path.join(os.tmpdir(), 'nimbus-unit'));
  const version = {
    libraries: [
      { name: 'org.ow2.asm:asm:9.7', url: 'https://maven.fabricmc.net/' },
      { name: 'org.ow2.asm:asm:9.3', downloads: { artifact: { path: 'org/ow2/asm/asm/9.3/asm-9.3.jar', url: 'https://x/asm.jar', sha1: 'aa', size: 1 } } },
      { name: 'net.minecraftforge:forge:1.20.1-47:client', downloads: { artifact: { path: 'net/minecraftforge/forge/1.20.1-47/forge-1.20.1-47-client.jar', url: '', sha1: 'bb', size: 2 } } },
      { name: 'x:never:1', rules: [{ action: 'allow', os: { name: 'nope' } }] },
    ],
  };
  const plan = planLibraries(paths, version);
  assert.equal(plan.classpath.length, 2);
  assert.ok(plan.classpath[0].endsWith(path.join('asm', '9.7', 'asm-9.7.jar')));
  assert.equal(plan.generated.length, 1);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].url, 'https://maven.fabricmc.net/org/ow2/asm/asm/9.7/asm-9.7.jar');
});

test('natives-only libraries have no main jar, even without a downloads block', () => {
  const lib = { name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.0', natives: { linux: 'natives-linux', windows: 'natives-windows', osx: 'natives-osx' } };
  assert.equal(libraryArtifact(lib), null);
  const plan = planLibraries(createPaths('/data'), { libraries: [lib, { ...lib }] });
  assert.equal(plan.classpath.length, 0);
  assert.equal(plan.natives.length, 1, 'the same natives jar listed twice is extracted once');
  assert.ok(plan.tasks[0].url.endsWith('lwjgl-platform-2.9.0-natives-' + { windows: 'windows', osx: 'osx', linux: 'linux' }[util.osName()] + '.jar'));
});

test('old Forge maven URLs are rewritten to https', () => {
  const art = libraryArtifact({ name: 'net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10', url: 'http://files.minecraftforge.net/maven/' });
  assert.ok(art.url.startsWith('https://maven.minecraftforge.net/net/minecraftforge/forge/'));
  assert.ok(art.fallbacks.some((u) => u.startsWith('https://repo1.maven.org/')));
});

test('Forge 1.17+ needs the game jar named after the loader version', () => {
  assert.equal(clientJarId({ id: '1.20.1-forge-47', jar: '1.20.1', arguments: { jvm: ['-DignoreList=a,${version_name}.jar'] } }), '1.20.1-forge-47');
  assert.equal(clientJarId({ id: 'fabric-loader-0.16-1.21', jar: '1.21', arguments: { jvm: [] } }), '1.21');
});

test('NeoForge versions map to their Minecraft version', () => {
  assert.equal(neoToMinecraft('20.4.237'), '1.20.4');
  assert.equal(neoToMinecraft('21.0.167'), '1.21');
  assert.equal(neoToMinecraft('21.1.77'), '1.21.1');
  assert.equal(neoToMinecraft('21.10.5-beta'), '1.21.10');
  assert.equal(neoToMinecraft('26.1.0.5-beta'), '26.1');
  assert.equal(neoToMinecraft('26.1.2.3'), '26.1.2');
  assert.equal(neoToMinecraft('0.25w14craftmine.3-beta'), null);
  assert.equal(neoToMinecraft('26.1.0.0-alpha.1+snapshot-1'), null);
});

test('natural version sort', () => {
  const list = ['1.20.1-47.1.3', '1.20.1-47.10.0', '1.20.1-47.2.0'];
  assert.deepEqual(list.sort((a, b) => compareNatural(b, a)), ['1.20.1-47.10.0', '1.20.1-47.2.0', '1.20.1-47.1.3']);
});

test('buildArguments fills placeholders for modern and legacy versions', () => {
  const paths = createPaths('/data');
  const install = { classpath: ['/data/libraries/a.jar', '/data/versions/1.21/1.21.jar'], nativesDir: '/data/versions/1.21/natives', logConfig: { path: '/data/log.xml', argument: '-Dlog4j.configurationFile=${path}' } };
  const account = { name: 'Steve', uuid: 'abc', accessToken: 'tok', xuid: '42' };
  const modern = {
    id: '1.21', type: 'release', mainClass: 'net.minecraft.client.main.Main', assetIndex: { id: '17' },
    arguments: {
      game: ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}', { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}'] },
        { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }],
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    },
  };
  const inst = { resolution: { width: 1280, height: 720 }, server: 'play.example.net', jvmArgs: '-Dcustom=1' };
  const built = buildArguments({ paths, version: modern, install, instance: inst, account, gameDir: '/g', gameAssets: '/data/assets', extraJvm: ['-Xmx2G'] });
  assert.equal(built.jvm[0], '-Xmx2G');
  assert.ok(built.jvm.includes('-Djava.library.path=/data/versions/1.21/natives'));
  assert.ok(built.jvm.includes('-Dlog4j.configurationFile=/data/log.xml'));
  assert.equal(built.jvm.at(-1), '-Dcustom=1');
  assert.deepEqual(built.game.slice(0, 4), ['--username', 'Steve', '--accessToken', 'tok']);
  assert.ok(built.game.includes('1280'));
  assert.ok(built.game.includes('--quickPlayMultiplayer') && !built.game.includes('--server'));

  const legacy = { id: 'b1.7.3', type: 'old_beta', mainClass: 'net.minecraft.launchwrapper.Launch', assets: 'pre-1.6', minecraftArguments: '${auth_player_name} ${auth_session} --gameDir ${game_directory}' };
  const old = buildArguments({ paths, version: legacy, install: { ...install, logConfig: null }, instance: { server: 'mc.old:25566' }, account, gameDir: '/g', gameAssets: '/g/resources' });
  assert.deepEqual(old.game.slice(0, 4), ['Steve', 'token:tok:abc', '--gameDir', '/g']);
  assert.deepEqual(old.game.slice(-4), ['--server', 'mc.old', '--port', '25566']);
  assert.ok(old.jvm.includes('-cp'));
});

test('parseServer and flattenArgs', () => {
  assert.deepEqual(parseServer('a.b:1234'), { host: 'a.b', port: '1234', raw: 'a.b:1234' });
  assert.equal(parseServer('  '), null);
  assert.deepEqual(flattenArgs(['a', { rules: [{ action: 'allow', features: { x: true } }], value: 'b' }], { x: false }), ['a']);
});

test('LogParser turns log4j XML back into readable lines', () => {
  const p = new LogParser();
  const out = [];
  const raw = [
    '<log4j:Event logger="x" timestamp="1700000000000" level="WARN" thread="Render thread">',
    '  <log4j:Message><![CDATA[First line',
    'second line]]></log4j:Message>',
    '  <log4j:Throwable><![CDATA[java.lang.RuntimeException: boom',
    '\tat a.b(C.java:1)',
    ']]></log4j:Throwable>',
    '</log4j:Event>',
    'plain output',
  ];
  for (const l of raw) out.push(...p.push(l));
  assert.match(out[0], /^\[\d\d:\d\d:\d\d\] \[Render thread\/WARN\]: First line$/);
  assert.equal(out[1], 'second line');
  assert.equal(out[2], 'java.lang.RuntimeException: boom');
  assert.equal(out[3], '\tat a.b(C.java:1)');
  assert.equal(out.at(-1), 'plain output');
});

test('boost: memory stays sane and GC flags suit the Java version', () => {
  assert.equal(boost.recommendMemory({ loader: 'vanilla', modCount: 0, totalMB: 16384 }), 2048);
  assert.equal(boost.recommendMemory({ loader: 'fabric', modCount: 200, totalMB: 32768 }), 6144);
  assert.equal(boost.recommendMemory({ loader: 'fabric', modCount: 300, totalMB: 4096 }), 2048, 'never more than half the RAM');
  assert.ok(boost.gcFlags('zgc', 21, 32768, 8192).includes('-XX:+ZGenerational'));
  assert.ok(!boost.gcFlags('zgc', 25, 32768, 8192).includes('-XX:+ZGenerational'));
  assert.ok(boost.gcFlags('zgc', 17, 32768, 8192).includes('-XX:+UseG1GC'), 'ZGC needs Java 21, fall back to G1');
  assert.ok(boost.gcFlags('auto', 21, 8192, 3072).includes('-XX:+UseG1GC'));
  const flags = boost.launchJvmFlags({ instance: { loader: 'fabric', jvmArgs: '-XX:+UseShenandoahGC', memory: { max: 4096 } }, javaMajor: 21, modCount: 10, totalMB: 16384 });
  assert.deepEqual(flags, ['-Xms512M', '-Xmx4096M'], 'a GC picked by the user wins');
});

test('boost: video options follow the game era', () => {
  const v = boost.PRESETS.max.video;
  const modern = boost.videoOptions(v, '2024-08-08T00:00:00Z');
  assert.equal(modern.renderClouds, '"false"');
  assert.equal(modern.ao, true);
  assert.equal(modern.enableVsync, false);
  const legacy = boost.videoOptions(v, '2017-09-18T00:00:00Z');
  assert.equal(legacy.renderClouds, 'false');
  assert.equal(legacy.ao, 2);
  assert.equal(legacy.fancyGraphics, false);
});

test('boost: options.txt keeps unknown keys and is backed up once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-opts-'));
  fs.writeFileSync(path.join(dir, 'options.txt'), 'version:3955\nrenderDistance:32\nlang:de_de\n');
  await boost.writeOptions(dir, { renderDistance: 8, maxFps: 260 });
  const text = fs.readFileSync(path.join(dir, 'options.txt'), 'utf8');
  assert.match(text, /^version:3955$/m);
  assert.match(text, /^renderDistance:8$/m);
  assert.match(text, /^lang:de_de$/m);
  assert.match(text, /^maxFps:260$/m);
  await boost.writeOptions(dir, { renderDistance: 6 });
  assert.match(fs.readFileSync(path.join(dir, 'options.txt.nimbus-backup'), 'utf8'), /renderDistance:32/);
  assert.equal(await boost.restoreOptions(dir), true);
  assert.match(fs.readFileSync(path.join(dir, 'options.txt'), 'utf8'), /renderDistance:32/);
});

test('modpack loaders and Modrinth loader tags', () => {
  assert.deepEqual(packLoader({ minecraft: '1.20.1', forge: '47.2.0' }), { loader: 'forge', loaderVersion: '1.20.1-47.2.0' });
  assert.deepEqual(packLoader({ minecraft: '1.21.1', 'fabric-loader': '0.16.9' }), { loader: 'fabric', loaderVersion: '0.16.9' });
  assert.deepEqual(packLoader({ minecraft: '1.21.1', neoforge: '21.1.77' }), { loader: 'neoforge', loaderVersion: '21.1.77' });
  assert.deepEqual(modLoaders('quilt'), ['quilt', 'fabric']);
});

test('instances: create, content toggle, remove', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-inst-'));
  const paths = createPaths(root);
  const insts = new Instances(paths);
  const a = await insts.create({ name: 'My Pack!', mcVersion: '1.21.1', loader: 'fabric' });
  const b = await insts.create({ name: 'My Pack!', mcVersion: '1.21.1', loader: 'fabric' });
  assert.equal(a.id, 'my-pack');
  assert.notEqual(a.id, b.id);
  fs.writeFileSync(path.join(paths.gameDir(a.id), 'mods', 'sodium.jar'), 'x');
  await insts.recordContent(a.id, 'mods/sodium.jar', { projectId: 'AANobbMI', title: 'Sodium', type: 'mod' });
  let content = await insts.listContent(a.id);
  assert.equal(content.length, 1);
  assert.equal(content[0].meta.title, 'Sodium');
  await insts.setContentEnabled(a.id, 'mods/sodium.jar', false);
  content = await insts.listContent(a.id);
  assert.equal(content[0].enabled, false);
  assert.equal(await insts.modCount(a.id), 0);
  await insts.remove(b.id);
  assert.equal((await insts.list()).length, 1);
});

test('accounts: tokens are sealed and the active account moves on removal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-acct-'));
  const sealer = { encrypt: (s) => `x:${Buffer.from(s).toString('base64')}`, decrypt: (s) => Buffer.from(s.slice(2), 'base64').toString() };
  const store = new AccountStore(path.join(root, 'accounts.json'), sealer);
  await store.add({ uuid: 'u1', name: 'One', refreshToken: 'REFRESH-SECRET-ONE', accessToken: 'ACCESS-SECRET-ONE', expiresAt: Date.now() + 3600e3 });
  await store.add({ uuid: 'u2', name: 'Two', refreshToken: 'REFRESH-SECRET-TWO', accessToken: 'ACCESS-SECRET-TWO', expiresAt: Date.now() + 3600e3 });
  const raw = fs.readFileSync(path.join(root, 'accounts.json'), 'utf8');
  assert.ok(!raw.includes('SECRET'), 'tokens never hit the disk in the clear');
  assert.equal((await store.activeSession({})).name, 'Two');
  await store.remove('u2');
  const session = await store.activeSession({});
  assert.equal(session.name, 'One');
  assert.equal(session.accessToken, 'ACCESS-SECRET-ONE');
});

test('builtin: Nimbus Core only goes where it is built for', () => {
  const f = (loader, mcVersion) => familyFor({ loader, mcVersion });
  assert.equal(f('fabric', '1.20.1'), 'fabric-1.20-1.21');
  assert.equal(f('quilt', '1.21.11'), 'fabric-1.20-1.21');
  assert.equal(f('fabric', '26.3'), 'fabric-26');
  assert.equal(f('fabric', '26.1.2'), 'fabric-26');
  assert.equal(f('fabric', '1.19.4'), null);
  assert.equal(f('fabric', '24w14a'), null);
  assert.equal(f('fabric', '26.4-snapshot-1'), null);
  assert.equal(f('forge', '1.20.1'), null);
  assert.equal(f('vanilla', '26.3'), null);
});

test('builtin: installed, re-enabled, restored, cleaned up and protected', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-builtin-'));
  const jars = path.join(root, 'jars');
  fs.mkdirSync(jars);
  fs.writeFileSync(path.join(jars, 'nimbus-core-fabric-1.20-1.21-1.2.0.jar'), 'new');
  fs.writeFileSync(path.join(jars, 'nimbus-core-fabric-26-1.2.0.jar'), 'new26');
  const paths = createPaths(path.join(root, 'data'));
  const insts = new Instances(paths);
  const builtin = new Builtin(jars);
  const inst = await insts.create({ name: 'b', mcVersion: '1.21.1', loader: 'fabric' });
  const mods = path.join(paths.gameDir(inst.id), 'mods');

  // an old version, disabled, from an earlier launcher
  fs.writeFileSync(path.join(mods, 'nimbus-core-fabric-1.20-1.21-1.0.0.jar.disabled'), 'old');
  assert.equal(await builtin.ensure(paths, insts, inst), 'nimbus-core-fabric-1.20-1.21-1.2.0.jar');
  assert.deepEqual(fs.readdirSync(mods).filter((f) => f.startsWith('nimbus')), ['nimbus-core-fabric-1.20-1.21-1.2.0.jar']);

  // deleted by hand: comes back
  fs.rmSync(path.join(mods, 'nimbus-core-fabric-1.20-1.21-1.2.0.jar'));
  await builtin.ensure(paths, insts, inst);
  assert.equal(fs.readFileSync(path.join(mods, 'nimbus-core-fabric-1.20-1.21-1.2.0.jar'), 'utf8'), 'new');

  const content = await insts.listContent(inst.id);
  assert.equal(content[0].meta.builtin, true, 'listed first');
  assert.equal(content[0].meta.title, 'Nimbus Core');
  await assert.rejects(insts.removeContent(inst.id, content[0].rel), /cannot be removed/);
  await assert.rejects(insts.setContentEnabled(inst.id, content[0].rel, false), /stays on/);

  // a loader that cannot run it gets none
  const forge = await insts.create({ name: 'f', mcVersion: '1.20.1', loader: 'forge' });
  fs.writeFileSync(path.join(paths.gameDir(forge.id), 'mods', 'nimbus-core-fabric-1.20-1.21-1.2.0.jar'), 'stray');
  assert.equal(await builtin.ensure(paths, insts, forge), null);
  assert.equal(fs.readdirSync(path.join(paths.gameDir(forge.id), 'mods')).length, 0);
});

// ---------------------------------------------------------------- skins & capes

const skins = require('../src/core/skins');
const mock = require('./mock-services');

test('skins: only 64x64 and 64x32 PNGs pass', () => {
  assert.deepEqual(skins.checkSkin(mock.png(64, 64, () => [1, 2, 3, 255])), { width: 64, height: 64 });
  assert.deepEqual(skins.checkSkin(mock.png(64, 32, () => [1, 2, 3, 255])), { width: 64, height: 32 });
  assert.throws(() => skins.checkSkin(mock.png(128, 128, () => [0, 0, 0, 255])), /64×64/);
  assert.throws(() => skins.checkSkin(Buffer.from('GIF89a not a png at all')), /not a PNG/);
  assert.equal(skins.secureTextureUrl('http://textures.minecraft.net/texture/abc'), 'https://textures.minecraft.net/texture/abc');
});

test('skins: the wardrobe dedupes, remembers arm models and what is worn', async () => {
  const w = new skins.Wardrobe(fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-wardrobe-')));
  const a = mock.solid([10, 20, 30]);
  const first = await w.add({ name: 'Blue', variant: 'classic', png: a });
  const again = await w.add({ name: 'Blue again', variant: 'slim', png: a });
  assert.equal(again.id, first.id, 'the same image is stored once');
  assert.equal((await w.list())[0].variant, 'slim', 'a re-add updates the arm model');
  await w.add({ name: 'Green', png: mock.solid([0, 200, 0]) });
  assert.equal((await w.list()).length, 2);
  assert.match((await w.list())[0].texture, /^data:image\/png;base64,/);
  await w.setWorn('u1', first.id, 'https://skin/1');
  assert.equal(await w.wornId('u1', 'https://skin/1'), first.id);
  assert.equal(await w.wornId('u1', 'https://skin/changed-elsewhere'), null);
  await w.remove(first.id);
  assert.equal((await w.list()).length, 1);
  await assert.rejects(w.get(first.id), /no longer/);
});

test('skins: upload, reset and capes go through the services API', async () => {
  const server = await mock.start();
  process.env.NIMBUS_SERVICES_URL = server.url;
  try {
    const view = await skins.describe(await skins.getProfile(server.token));
    assert.equal(view.name, 'Tester');
    assert.equal(view.capes.length, 2);
    assert.equal(view.capes.find((c) => c.active).id, 'cape-1');
    assert.match(view.skin.texture, /^data:image\/png/);

    const mine = mock.png(64, 64, (x, y) => [x * 4, y * 4, 128, 255]);
    const after = await skins.describe(await skins.uploadSkin(server.token, mine, 'slim'));
    assert.deepEqual(server.state.uploads, [{ variant: 'SLIM', bytes: mine.length }], 'multipart upload carried the file and the arm model');
    assert.equal(after.skin.variant, 'slim');
    assert.equal(skins.fromDataUrl(after.skin.texture).toString('hex'), mine.toString('hex'), 'the uploaded pixels come back');

    let capes = await skins.describe(await skins.showCape(server.token, 'cape-2'));
    assert.equal(capes.capes.find((c) => c.active).id, 'cape-2');
    capes = await skins.describe(await skins.showCape(server.token, null));
    assert.equal(capes.capes.some((c) => c.active), false);

    const reset = await skins.describe(await skins.resetSkin(server.token));
    assert.equal(reset.skin.variant, 'classic');

    await assert.rejects(skins.getProfile('wrong-token'), (err) => err.code === 'REAUTH');
    await assert.rejects(skins.uploadSkin(server.token, mock.png(32, 32, () => [0, 0, 0, 255]), 'classic'), /64×64/);
  } finally {
    delete process.env.NIMBUS_SERVICES_URL;
    await server.close();
  }
});

test('skins: one search finds a player by name and gallery skins by keyword', async () => {
  const server = await mock.start({ players: { Knight: { png: mock.solid([10, 20, 30]), slim: true } } });
  const env = { NIMBUS_MOJANG_URL: server.url, NIMBUS_GALLERY_URL: server.url, NIMBUS_TEXTURES_URL: server.url };
  Object.assign(process.env, env);
  try {
    const knight = await skins.searchSkins('knight');
    assert.deepEqual(knight.skins.map((x) => x.name), ['Knight', 'Red knight', 'Blue knight'], 'the player first, then the gallery without repeats or nameless matches');
    assert.equal(knight.skins[0].source, 'player');
    assert.equal(knight.skins[0].variant, 'slim');
    assert.match(knight.skins[1].texture, /^data:image\/png;base64,/);
    assert.equal(knight.next, null);

    const wizard = await skins.searchSkins('wizard');
    assert.deepEqual(wizard.skins.map((x) => x.name), ['Green wizard'], 'no player called wizard, so only the gallery');

    const newest = await skins.searchSkins('');
    assert.equal(newest.skins.length, 4, 'an empty search lists the newest skins, once each');
    assert.equal(newest.skins[3].name, 'Untitled skin');

    const page1 = await skins.searchGallery('', null, 2);
    const page2 = await skins.searchGallery('', page1.next, 2);
    const page3 = await skins.searchGallery('', page2.next, 2);
    assert.deepEqual([...page1.skins, ...page2.skins].map((x) => x.name), ['Red knight', 'Blue knight', 'Green wizard', 'Untitled skin']);
    assert.equal(page3.next, null);

    const nobody = await skins.searchSkins('zz_nobody');
    assert.deepEqual(nobody.skins, []);
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    await server.close();
  }
});

test('packs: new resource and shader packs switch on once, and stay off if you turn them off', async () => {
  const packs = require('../src/core/packs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-packs-'));
  const game = path.join(root, 'game');
  const state = path.join(root, 'packs-seen.json');
  fs.mkdirSync(path.join(game, 'resourcepacks', 'Folder Pack'), { recursive: true });
  fs.writeFileSync(path.join(game, 'resourcepacks', 'Faithful.zip'), 'zip');
  fs.writeFileSync(path.join(game, 'resourcepacks', 'Old.zip.disabled'), 'zip');
  fs.writeFileSync(path.join(game, 'options.txt'), 'fov:0.0\nresourcePacks:["vanilla","fabric"]\n');
  const read = () => Object.fromEntries(fs.readFileSync(path.join(game, 'options.txt'), 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]));

  let res = await packs.enableNewPacks({ gameDir: game, mcVersion: '1.21.1', stateFile: state });
  assert.deepEqual(res.resourcepacks, ['Faithful.zip', 'Folder Pack']);
  assert.deepEqual(JSON.parse(read().resourcePacks), ['vanilla', 'fabric', 'file/Faithful.zip', 'file/Folder Pack'], 'appended on top, disabled files ignored');
  assert.deepEqual(JSON.parse(read().incompatibleResourcePacks), [], 'no game jar to compare with: nothing is marked incompatible');
  assert.equal(read().fov, '0.0', 'other options untouched');

  // switched off in game: stays off on the next launch
  fs.writeFileSync(path.join(game, 'options.txt'), 'resourcePacks:["vanilla","file/Folder Pack"]\n');
  res = await packs.enableNewPacks({ gameDir: game, mcVersion: '1.21.1', stateFile: state });
  assert.deepEqual(res.resourcepacks, []);
  assert.deepEqual(JSON.parse(read().resourcePacks), ['vanilla', 'file/Folder Pack']);

  // a newly added pack is switched on
  fs.writeFileSync(path.join(game, 'resourcepacks', 'New.zip'), 'zip');
  res = await packs.enableNewPacks({ gameDir: game, mcVersion: '1.21.1', stateFile: state });
  assert.deepEqual(JSON.parse(read().resourcePacks), ['vanilla', 'file/Folder Pack', 'file/New.zip']);

  // Iris picks up a new shader pack
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(game, 'mods', 'iris-fabric-1.8.0.jar'), 'jar');
  fs.mkdirSync(path.join(game, 'shaderpacks'), { recursive: true });
  fs.writeFileSync(path.join(game, 'shaderpacks', 'ComplementaryReimagined.zip'), 'zip');
  res = await packs.enableNewPacks({ gameDir: game, mcVersion: '1.21.1', stateFile: state });
  assert.equal(res.shader, 'ComplementaryReimagined.zip');
  const iris = fs.readFileSync(path.join(game, 'config', 'iris.properties'), 'utf8');
  assert.match(iris, /shaderPack=ComplementaryReimagined\.zip/);
  assert.match(iris, /enableShaders=true/);

  // 1.8.9 writes plain names; alpha/beta is left alone
  const old = path.join(root, 'old');
  fs.mkdirSync(path.join(old, 'resourcepacks'), { recursive: true });
  fs.writeFileSync(path.join(old, 'resourcepacks', 'PvP.zip'), 'zip');
  await packs.enableNewPacks({ gameDir: old, mcVersion: '1.8.9', stateFile: path.join(root, 'old.json') });
  assert.match(fs.readFileSync(path.join(old, 'options.txt'), 'utf8'), /^resourcePacks:\["PvP\.zip"\]$/m);
  assert.equal(packs.packStyle('b1.7.3'), null);
  assert.equal(packs.packStyle('26.3'), 'modern');
  fs.rmSync(root, { recursive: true, force: true });
});

test('writeJson: saves in the same millisecond do not trip over each other', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-wj-'));
  const file = path.join(root, 'settings.json');
  await Promise.all(Array.from({ length: 40 }, (_, i) => util.writeJson(file, { i })));
  assert.deepEqual(await util.readJson(file), { i: 39 }); // the last call wins
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('presence: counts an install once, each window once, and reads the busier window', async () => {
  const http = require('http');
  const counters = {};
  const hits = [];
  const server = http.createServer((req, res) => {
    const [, kind, , key] = req.url.split('/');
    if (kind === 'hit') { counters[key] = (counters[key] || 0) + 1; hits.push(key); }
    if (!(key in counters)) { res.writeHead(404); return res.end('{}'); }
    res.end(JSON.stringify({ value: counters[key] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.NIMBUS_COUNTER_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const { Presence, WINDOW_MS } = require('../src/core/presence');
    let now = 10 * WINDOW_MS + 1000;
    let settings = { shareOnline: true, countedInstall: false };
    let playing = false;
    const p = new Presence({ settings: () => settings, save: async (patch) => { settings = { ...settings, ...patch }; }, playing: () => playing, now: () => now });
    await p.beat();
    await p.beat();
    assert.deepEqual(hits, ['players-total', 'online-10']);
    assert.equal(settings.countedInstall, true);
    playing = true;
    now += WINDOW_MS; // next window
    await p.beat();
    assert.deepEqual(hits.slice(2), ['online-11', 'playing-11']);
    counters['online-10'] = 30; // lots of people last window, few so far in this one
    assert.deepEqual(await p.stats(), { online: 30, playing: 1, total: 1 });
    // sharing off: nothing is sent
    settings.shareOnline = false;
    now += WINDOW_MS;
    await p.beat();
    assert.equal(hits.length, 4);
  } finally {
    delete process.env.NIMBUS_COUNTER_URL;
    server.close();
  }
});

test('packs: only packs for another version go on the incompatible list, and old mistakes are repaired', async () => {
  const AdmZip = require('adm-zip');
  const packs = require('../src/core/packs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-packfmt-'));
  const game = path.join(root, 'game');
  const dir = path.join(game, 'resourcepacks');
  fs.mkdirSync(dir, { recursive: true });
  const zip = (file, entries) => { const z = new AdmZip(); for (const [n, t] of Object.entries(entries)) z.addFile(n, Buffer.from(t)); z.writeZip(file); };
  const jar = path.join(root, 'client.jar');
  zip(jar, { 'version.json': JSON.stringify({ pack_version: { resource: 34, data: 48 } }) });
  zip(path.join(dir, 'Fits.zip'), { 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: '' } }) });
  zip(path.join(dir, 'Old.zip'), { 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 15, description: '' } }) });
  zip(path.join(dir, 'Range.zip'), { 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 15, supported_formats: [15, 40] } }) });
  const read = () => Object.fromEntries(fs.readFileSync(path.join(game, 'options.txt'), 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]));

  // a 1.4.3 install: everything was put on the incompatible list, and the game dropped the compatible packs
  const state = path.join(root, 'packs-seen.json');
  fs.writeFileSync(state, JSON.stringify({ resourcepacks: ['Fits.zip', 'Old.zip', 'Range.zip'], shaderpacks: [] }));
  fs.writeFileSync(path.join(game, 'options.txt'), 'resourcePacks:["vanilla","file/Old.zip"]\nincompatibleResourcePacks:["file/Fits.zip","file/Old.zip"]\n');
  const res = await packs.enableNewPacks({ gameDir: game, mcVersion: '1.21.1', stateFile: state, clientJar: jar });
  assert.deepEqual(res.resourcepacks.sort(), ['Fits.zip', 'Range.zip'], 'the dropped packs get switched back on');
  assert.deepEqual(JSON.parse(read().resourcePacks), ['vanilla', 'file/Old.zip', 'file/Fits.zip', 'file/Range.zip']);
  assert.deepEqual(JSON.parse(read().incompatibleResourcePacks), ['file/Old.zip'], 'only the pack for another version stays marked');
  assert.equal(JSON.parse(fs.readFileSync(state, 'utf8')).v, 2);

  // formats written as major/minor (1.21.9 and 26.x)
  assert.equal(packs.packFits({ min_format: [84, 0], max_format: 90 }, { major: 84, minor: 0 }), true);
  assert.equal(packs.packFits({ min_format: 97, max_format: [97, 0] }, { major: 97, minor: 1 }), false);
  assert.equal(packs.packFits({ pack_format: 34, supported_formats: { min_inclusive: 30, max_inclusive: 34 } }, { major: 32, minor: 0 }), true);
  assert.equal(packs.packFits({ description: 'no format' }, { major: 34, minor: 0 }), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('friends service: Mojang sign-in, friend requests, presence, chat and the relay', async () => {
  const { createApi, memoryStore } = await import('../website/lib/friends-api.mjs');
  const store = memoryStore();
  const people = { alex: '0123456789abcdef0123456789abcdef', steve: 'fedcba9876543210fedcba9876543210', eve: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const names = { alex: 'Alex', steve: 'Steve', eve: 'Eve' };
  const joined = new Map();
  const fakeFetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/users/profiles/minecraft/')) {
      const n = decodeURIComponent(u.pathname.split('/').pop()).toLowerCase();
      return people[n] ? new Response(JSON.stringify({ id: people[n], name: names[n] })) : new Response('', { status: 404 });
    }
    if (u.pathname === '/session/minecraft/hasJoined') {
      const who = joined.get(u.searchParams.get('serverId'));
      return who === u.searchParams.get('username') ? new Response(JSON.stringify({ id: people[who.toLowerCase()], name: who })) : new Response(null, { status: 204 });
    }
    return new Response('', { status: 500 });
  };
  const api = createApi({ store, fetch: fakeFetch, sessionServer: 'http://mojang', profileApi: 'http://mojang' });
  const call = async (path, body, token) => {
    const res = await api(new Request(`http://site/api/${path}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body || {}) }));
    return { ...(await res.json()), http: res.status };
  };
  const login = async (who) => {
    const { serverId } = await call('login/start');
    joined.set(serverId, names[who]); // the launcher's POST /session/minecraft/join, in effect
    return call('login/finish', { name: names[who], serverId });
  };

  const alex = await login('alex');
  const steve = await login('steve');
  assert.equal(alex.uuid, people.alex);
  assert.equal(alex.token.length, 64);
  // someone who didn't really join the session is refused
  const { serverId } = await call('login/start');
  assert.equal((await call('login/finish', { name: 'Eve', serverId })).http, 401);
  assert.equal((await call('beat', {}, 'f'.repeat(64))).http, 401);

  // alex asks, steve sees the request and accepts
  assert.equal((await call('friends/add', { name: 'steve' }, alex.token)).http, 200);
  assert.equal((await call('friends/add', { name: 'nobodyhere' }, alex.token)).http, 404);
  let s = await call('beat', { status: 'online' }, steve.token);
  assert.deepEqual(s.requests.map((r) => r.name), ['Alex']);
  assert.equal(s.inbox[0].type, 'friend-request');
  assert.equal((await call('chat/send', { to: people.alex, text: 'hi' }, steve.token)).http, 403, 'no chat before being friends');
  await call('friends/accept', { uuid: people.alex }, steve.token);

  // presence and hosting
  await call('beat', { status: 'playing', playing: { mc: '1.21.1', loader: 'fabric' }, hosting: { mc: '1.21.1', loader: 'fabric', world: 'Survival' } }, steve.token);
  let a = await call('beat', {}, alex.token);
  assert.equal(a.friends.length, 1);
  assert.equal(a.friends[0].online, true);
  assert.equal(a.friends[0].hosting.world, 'Survival');
  assert.ok(a.inbox.some((m) => m.type === 'friend-added'));

  // chat: delivered once, kept in history
  await call('chat/send', { to: people.steve, text: 'let me in 👀' }, alex.token);
  s = await call('beat', {}, steve.token);
  assert.deepEqual(s.inbox.filter((m) => m.type === 'chat').map((m) => m.text), ['let me in 👀']);
  assert.equal((await call('beat', {}, steve.token)).inbox.length, 0, 'each message arrives once');
  assert.deepEqual((await call('chat/history', { with: people.alex }, steve.token)).messages.map((m) => m.text), ['let me in 👀']);

  // relay: join request goes through between friends only
  await call('relay', { to: people.steve, type: 'join-request', data: { id: 'r1' } }, alex.token);
  s = await call('beat', {}, steve.token);
  assert.deepEqual(s.inbox.map((m) => [m.type, m.name, m.data.id]), [['join-request', 'Alex', 'r1']]);
  assert.equal((await call('relay', { to: people.steve, type: 'rm -rf', data: {} }, alex.token)).http, 400);
  const eve = await (async () => { const st = await call('login/start'); joined.set(st.serverId, 'Eve'); return call('login/finish', { name: 'Eve', serverId: st.serverId }); })();
  assert.equal((await call('relay', { to: people.steve, type: 'join-request', data: {} }, eve.token)).http, 403);

  // unfriend
  await call('friends/remove', { uuid: people.steve }, alex.token);
  assert.equal((await call('beat', {}, alex.token)).friends.length, 0);
});

test('discord: what the status says in the launcher, in menus, in worlds and on servers', () => {
  const { activityFor, shownServer } = require('../src/core/discord');
  const game = { instance: { mcVersion: '1.21.1', loader: 'fabric' }, started: 1000 };
  const idle = activityFor({ version: '1.5.2', game: null, status: null, since: 5 });
  assert.equal(idle.details, 'In the launcher');
  assert.equal(idle.timestamps.start, 5);
  assert.equal(idle.assets.large_text, 'Nimbus Launcher 1.5.2');
  assert.equal(idle.buttons[0].label, 'Get Nimbus Launcher');
  const vanilla = activityFor({ version: '1', game: { instance: { mcVersion: '1.20.4', loader: 'vanilla' }, started: 7 }, status: null });
  assert.deepEqual([vanilla.details, vanilla.state, vanilla.timestamps.start], ['Playing Minecraft', 'Minecraft 1.20.4', 7]);
  assert.equal(activityFor({ version: '1', game, status: { where: 'menu' } }).details, 'In the menus');
  assert.equal(activityFor({ version: '1', game, status: { where: 'menu' } }).state, 'Minecraft 1.21.1 · Fabric');
  assert.equal(activityFor({ version: '1', game, status: { where: 'singleplayer' } }).details, 'Playing singleplayer');
  assert.equal(activityFor({ version: '1', game, status: { where: 'singleplayer', lan: true } }).details, 'Hosting a world on Nimbus LAN');
  assert.equal(activityFor({ version: '1', game, status: { where: 'multiplayer', server: 'MC.Hypixel.net:25565' } }).details, 'Playing on mc.hypixel.net');
  assert.equal(activityFor({ version: '1', game, status: { where: 'multiplayer', server: 'mc.hypixel.net' }, showServer: false }).details, 'Playing multiplayer');
  assert.equal(activityFor({ version: '1', game, status: { where: 'multiplayer', server: '127.0.0.1:50123' }, lan: { joining: { status: 'playing', name: 'Alex' } } }).details, "In Alex's world on Nimbus LAN");
  // addresses that would give away where someone lives stay hidden
  for (const a of ['192.168.1.20', '85.10.4.1:25565', 'localhost', '[::1]:25565', 'myserver', 'box.local', '2001:db8::1']) assert.equal(shownServer(a), null, a);
  assert.equal(shownServer('play.example.org'), 'play.example.org');
});

test('discord: talks to the Discord app over its local socket, and clears the status on stop', async () => {
  const net = require('net');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-discord-'));
  // Discord listens on a named pipe on Windows and a socket file elsewhere
  const sockPath = process.platform === 'win32' ? `\\\\.\\pipe\\nimbus-discord-test-${process.pid}` : path.join(dir, 'discord-ipc-0');
  const got = [];
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        const msg = JSON.parse(buf.subarray(8, 8 + len).toString());
        buf = buf.subarray(8 + len);
        got.push({ op, msg });
        const reply = (data) => {
          const body = Buffer.from(JSON.stringify(data));
          const head = Buffer.alloc(8);
          head.writeInt32LE(1, 0);
          head.writeInt32LE(body.length, 4);
          sock.write(Buffer.concat([head, body]));
        };
        if (op === 0) reply({ cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } });
        else reply({ cmd: msg.cmd, nonce: msg.nonce, data: msg.args.activity });
      }
    });
  });
  await new Promise((r) => server.listen(sockPath, r));
  process.env.NIMBUS_DISCORD_IPC = sockPath;
  try {
    const { DiscordStatus } = require('../src/core/discord');
    const running = new Map();
    const launcher = { settings: { discordStatus: true, discordServer: true }, running };
    const lan = { gameStatus: null, state: () => ({ hosting: null, joining: null }) };
    const d = new DiscordStatus({ launcher, lan, version: '9.9.9', config: async () => ({ clientId: '123' }) });
    await d.refresh();
    assert.deepEqual(got[0], { op: 0, msg: { v: 1, client_id: '123' } });
    assert.equal(got[1].msg.cmd, 'SET_ACTIVITY');
    assert.equal(got[1].msg.args.pid, process.pid);
    assert.equal(got[1].msg.args.activity.details, 'In the launcher');
    // nothing changed: nothing sent
    await d.refresh();
    assert.equal(got.length, 2);
    // a game on a server (after Discord's rate limit gap)
    running.set('a', { instance: { mcVersion: '1.21.1', loader: 'quilt' }, started: Date.now() });
    lan.gameStatus = { where: 'multiplayer', server: 'play.example.org' };
    d.sentAt = 0;
    await d.refresh();
    assert.equal(got[2].msg.args.activity.details, 'Playing on play.example.org');
    assert.equal(got[2].msg.args.activity.state, 'Minecraft 1.21.1 · Quilt');
    // switched off in settings: the status is cleared
    launcher.settings.discordStatus = false;
    await d.refresh();
    assert.equal(got[3].msg.args.activity, null);
    assert.equal(d.ipc, null);
    await d.stop();
  } finally {
    delete process.env.NIMBUS_DISCORD_IPC;
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('friends service: cosmetics are saved by their owner and anyone can look them up', async () => {
  const { createApi, memoryStore } = await import('../website/lib/friends-api.mjs');
  const store = memoryStore();
  const api = createApi({ store, devAuth: true });
  const call = async (path, body, token) => {
    const res = await api(new Request(`http://x/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
    return { http: res.status, ...(await res.json()) };
  };
  const alex = await call('login/finish', { dev: true, uuid: '11111111111111111111111111111111', name: 'Alex' });
  // only you can set yours, and only real ids go in
  assert.equal((await call('cosmetics/set', { hat: 'crown_royal' })).http, 401);
  assert.equal((await call('cosmetics/set', { hat: 'Crown Royal!' }, alex.token)).http, 400);
  // what isn't unlocked yet (or free) isn't shown to others
  const set = await call('cosmetics/set', { hat: 'tophat_classic', pet: 'dragon_ember', wings: null, aura: 'aura_runes' }, alex.token);
  assert.deepEqual(set.worn, { hat: 'tophat_classic', pet: null, wings: null, aura: null });
  assert.deepEqual(set.locked, ['dragon_ember', 'aura_runes']);
  await store.set('wallet/11111111111111111111111111111111', { coins: 0, owned: ['dragon_ember', 'aura_runes'] });
  assert.deepEqual((await call('cosmetics/set', { hat: 'tophat_classic', pet: 'dragon_ember', wings: null, aura: 'aura_runes' }, alex.token)).worn, { hat: 'tophat_classic', pet: 'dragon_ember', wings: null, aura: 'aura_runes' });
  // anyone can look, by uuid (dashes or not) or by name on offline-mode servers
  const got = await call('cosmetics/get', { players: [{ uuid: '11111111-1111-1111-1111-111111111111' }, { uuid: '99999999999999999999999999999999', name: 'alex' }, { uuid: '22222222222222222222222222222222', name: 'Nobody' }] });
  assert.equal(got.http, 200);
  assert.equal(got.cosmetics['11111111-1111-1111-1111-111111111111'].hat, 'tophat_classic');
  assert.equal(got.cosmetics['99999999999999999999999999999999'].pet, 'dragon_ember');
  assert.equal(got.cosmetics['22222222222222222222222222222222'], undefined);
});

test('friends service: screenshots in chat are only for the two friends, and go with old messages', async () => {
  const { createApi, memoryStore } = await import('../website/lib/friends-api.mjs');
  const store = memoryStore();
  const api = createApi({ store, devAuth: true });
  const call = async (path, body, token) => {
    const res = await api(new Request(`http://x/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
    return { http: res.status, ...(await res.json()) };
  };
  const A = '11111111111111111111111111111111';
  const B = '22222222222222222222222222222222';
  const alex = await call('login/finish', { dev: true, uuid: A, name: 'Alex' });
  const steve = await call('login/finish', { dev: true, uuid: B, name: 'Steve' });
  const eve = await call('login/finish', { dev: true, uuid: '33333333333333333333333333333333', name: 'Eve' });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]).toString('base64');
  const shot = { to: B, type: 'image/jpeg', data: jpeg, w: 1600, h: 900, text: 'look at my base' };
  // friends only
  assert.equal((await call('chat/image', shot, alex.token)).http, 403);
  await store.set(`friend/${A}/${B}`, { at: 1 });
  await store.set(`friend/${B}/${A}`, { at: 1 });
  // only real pictures, not too big
  assert.equal((await call('chat/image', { ...shot, data: Buffer.from('<html>').toString('base64') }, alex.token)).http, 400);
  assert.equal((await call('chat/image', { ...shot, type: 'image/gif' }, alex.token)).http, 400);
  assert.equal((await call('chat/image', { ...shot, data: `/9j/${'A'.repeat(1_600_000)}` }, alex.token)).http, 413);
  assert.equal((await call('chat/image', { ...shot, w: 0 }, alex.token)).http, 400);
  const sent = await call('chat/image', shot, alex.token);
  assert.equal(sent.http, 200);
  assert.equal(sent.message.text, 'look at my base');
  assert.equal(sent.message.image.w, 1600);
  const id = sent.message.image.id;
  // Steve gets it in his next beat and in the history, and can fetch it; Eve can't
  const beat = await call('beat', {}, steve.token);
  assert.equal(beat.inbox[0].type, 'chat');
  assert.equal(beat.inbox[0].image.id, id);
  assert.equal((await call('chat/history', { with: A }, steve.token)).messages[0].image.id, id);
  const got = await call('chat/image/get', { id }, steve.token);
  assert.equal(got.http, 200);
  assert.equal(got.data, jpeg);
  assert.equal((await call('chat/image/get', { id }, alex.token)).http, 200);
  assert.equal((await call('chat/image/get', { id }, eve.token)).http, 404);
  assert.equal((await call('chat/image/get', { id: '../session' }, steve.token)).http, 404);
  // plain messages still work, and old pictures go when the history is trimmed
  for (let i = 0; i < 200; i++) await call('chat/send', { to: A, text: `hi ${i}` }, steve.token);
  assert.equal((await call('chat/image/get', { id }, steve.token)).http, 404);
  assert.equal(await store.get(`image/${id}`), null);
  // a day's worth of pictures at most
  for (let i = 0; i < 59; i++) await call('chat/image', shot, alex.token);
  const tooMany = await call('chat/image', shot, alex.token);
  assert.equal(tooMany.http, 429);
});

test('server search: names, game modes and addresses, from the built-in list and Minehut', async () => {
  const { search, score, asAddress, plainMotd, DIRECTORY } = require('../src/core/serverdir');
  assert.ok(DIRECTORY.length >= 30, 'a decent built-in list');
  for (const s of DIRECTORY) {
    assert.ok(s.name && s.address && Array.isArray(s.tags), `${s.name} is complete`);
    assert.ok(!/\s/.test(s.address), `${s.name}'s address has no spaces`);
  }
  assert.equal(asAddress('play.example.com'), 'play.example.com');
  assert.equal(asAddress('Play.Example.com:25566'), 'play.example.com:25566');
  assert.equal(asAddress('1.2.3.4'), '1.2.3.4');
  assert.equal(asAddress('bed wars'), null);
  assert.equal(asAddress('hypixel'), null);
  assert.equal(asAddress('play.example.com:99999'), null);
  assert.equal(plainMotd('<b><gradient:#f00:#0f0>Box</gradient></b>\n<#3399ff>PvP §aNow'), 'Box PvP Now');
  // a name beats a tag, and every word has to fit
  const a = { name: 'SkyBlock Heaven', address: 'play.sbh.net', tags: ['Survival'] };
  const b = { name: 'Big Network', address: 'big.net', tags: ['SkyBlock', 'Bed Wars'] };
  assert.ok(score(a, ['skyblock']) > score(b, ['skyblock']));
  assert.ok(score(b, ['bed', 'wars']) > 0);
  assert.equal(score(b, ['bed', 'prison']), 0);
  assert.ok(score(b, ['bedwars']) > 0, 'words run together still match');
  // Minehut's live list (a stand-in here), cached between searches
  let asked = 0;
  const fakeFetch = async () => {
    asked++;
    return new Response(JSON.stringify({ servers: [
      { name: 'TechMines', motd: '<b>TECHMINES</b> Box-PvP', playerData: { playerCount: 251 }, allCategories: ['box', 'pvp'], visibility: true, connectable: true, staticInfo: { platform: 'java' } },
      { name: 'SkyLand', motd: 'The best skyblock', playerData: { playerCount: 12 }, allCategories: ['skyblock'], visibility: true, connectable: true, staticInfo: { platform: 'java' } },
      { name: 'Hidden', motd: 'skyblock', playerData: { playerCount: 99 }, allCategories: ['skyblock'], visibility: false, staticInfo: { platform: 'java' } },
      { name: 'bad name!', motd: 'skyblock', playerData: { playerCount: 99 }, allCategories: ['skyblock'] },
    ] }));
  };
  let r = await search('skyblock', { fetchImpl: fakeFetch });
  assert.deepEqual(r.minehut.map((s) => s.address), ['skyland.minehut.gg']);
  assert.equal(r.minehut[0].players, 12);
  assert.ok(r.directory.length > 0, 'the built-in list has SkyBlock servers');
  assert.ok(r.directory.every((s) => /skyblock/i.test([s.name, ...s.tags].join(' '))));
  assert.equal(r.address, null);
  r = await search('box pvp', { fetchImpl: fakeFetch });
  assert.equal(r.minehut[0].name, 'TechMines');
  assert.equal(asked, 1, 'Minehut is asked once, then cached');
  r = await search('mc.hypixel.net', { fetchImpl: fakeFetch });
  assert.equal(r.address, 'mc.hypixel.net');
  assert.equal(r.directory[0]?.address, 'mc.hypixel.net');
  assert.deepEqual((await search('   ', { fetchImpl: fakeFetch })).directory, []);
});

test('friends service: Nimbus coins from daily tasks, log-ins, playing and achievements', async () => {
  const { createApi, memoryStore } = await import('../website/lib/friends-api.mjs');
  const { tasksFor, REWARDS, STATS } = await import('../website/lib/coins.mjs');
  const store = memoryStore();
  let clock = Date.UTC(2026, 8, 27, 10);
  const api = createApi({ store, devAuth: true, now: () => clock });
  const call = async (p, body, token) => {
    const res = await api(new Request(`http://x/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
    return { http: res.status, ...(await res.json()) };
  };
  const uuid = '33333333333333333333333333333333';
  const me = await call('login/finish', { dev: true, uuid, name: 'Coiny' });
  assert.equal((await call('coins/state', {})).http, 401);

  // first visit: the welcome gift and the daily log-in
  let st = await call('coins/state', {}, me.token);
  assert.equal(st.http, 200);
  assert.deepEqual(st.events.map((e) => e.type), ['welcome', 'login']);
  assert.equal(st.coins, REWARDS.welcome + REWARDS.login);
  assert.equal(st.tasks.length, 3);
  assert.equal(new Set(st.tasks.map((t) => t.stat)).size, 3, 'three different things to do');
  assert.deepEqual(st.tasks.map((t) => t.reward), REWARDS.tiers);
  assert.deepEqual(st.tasks.map((t) => t.id), tasksFor('2026-09-27', uuid).map((t) => t.id));
  assert.equal(st.resetsAt, Date.UTC(2026, 8, 28));
  // asking again pays nothing twice
  st = await call('coins/state', {}, me.token);
  assert.deepEqual(st.events, []);
  const start = st.coins;

  // the game reports today's totals: finishing the first task pays it, plus playing time
  const [easy, medium, hard] = st.tasks;
  const stats = { [easy.stat]: easy.goal, play: Math.max(easy.stat === 'play' ? easy.goal : 0, 30 * 60) };
  st = await call('coins/progress', { day: '2026-09-27', stats }, me.token);
  const types = st.events.map((e) => e.type);
  assert.ok(types.includes('task'));
  assert.ok(types.includes('play'));
  assert.equal(st.tasks[0].done, true);
  assert.equal(st.tasks[1].done, false);
  const paidPlay = st.events.find((e) => e.type === 'play').coins;
  assert.equal(paidPlay, Math.floor(stats.play / REWARDS.playEvery));
  assert.equal(st.coins, start + easy.reward + paidPlay + st.events.filter((e) => e.type === 'achievement').reduce((a, e) => a + e.coins, 0));
  // the same totals again pay nothing; lower ones don't take anything away
  assert.deepEqual((await call('coins/progress', { day: '2026-09-27', stats }, me.token)).events, []);
  assert.deepEqual((await call('coins/progress', { day: '2026-09-27', stats: { [easy.stat]: 1 } }, me.token)).events, []);
  // a report for another day counts for nothing, and silly numbers are capped
  assert.deepEqual((await call('coins/progress', { day: '2026-09-20', stats: { [medium.stat]: medium.goal } }, me.token)).events, []);
  st = await call('coins/progress', { day: '2026-09-27', stats: { [medium.stat]: medium.goal, [hard.stat]: hard.goal, mine: 1e12 } }, me.token);
  assert.ok(st.events.some((e) => e.type === 'bonus'), 'all three done pays the bonus');
  const w = await store.get(`wallet/${uuid}`);
  assert.ok(w.stats.mine <= STATS.mine);
  assert.ok(st.achievements.find((a) => a.id === 'mine_1k').done);

  // buying: only with enough coins, only once, only real ones
  assert.equal((await call('coins/buy', { id: 'nope_nope' }, me.token)).http, 400);
  assert.equal((await call('coins/buy', { id: 'tophat_classic' }, me.token)).http, 400, 'free ones are already yours');
  const before = st.coins;
  const bought = await call('coins/buy', { id: 'halo_angel' }, me.token);
  assert.equal(bought.http, 200);
  assert.equal(bought.coins, before - 150);
  assert.ok(bought.owned.includes('halo_angel'));
  assert.equal((await call('coins/buy', { id: 'halo_angel' }, me.token)).http, 400);
  await store.set(`wallet/${uuid}`, { ...(await store.get(`wallet/${uuid}`)), coins: 10 });
  const poor = await call('coins/buy', { id: 'crown_void' }, me.token);
  assert.equal(poor.http, 400);
  assert.match(poor.error, /more coins/);

  // the next day: new tasks, and the streak goes up
  clock += 86_400_000;
  st = await call('coins/state', {}, me.token);
  assert.equal(st.streak, 2);
  assert.equal(st.events[0].type, 'login');
  assert.equal(st.events[0].coins, REWARDS.login + REWARDS.streakStep);
  assert.ok(st.tasks.every((t) => !t.done && t.progress === 0));
  // missing a day starts it over
  clock += 3 * 86_400_000;
  assert.equal((await call('coins/state', {}, me.token)).streak, 1);
});

test('cosmetics: what you wear is saved, written for the game and shared; locked ones need coins', async () => {
  const { Cosmetics, describe } = require('../src/core/cosmetics');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-cos-'));
  const calls = [];
  const launcher = {
    paths: { root: dir, cosmetics: path.join(dir, 'nimbus-cosmetics.json'), progress: path.join(dir, 'nimbus-progress.json'), tasks: path.join(dir, 'nimbus-tasks.json') },
    settings: {},
    accounts: { activeSession: async () => ({ uuid: '44444444-4444-4444-4444-444444444444' }) },
  };
  let wallet = { coins: 400, owned: [], day: '2026-09-27', tasks: [{ id: '0-mine-64', title: 'Mine 64 blocks', stat: 'mine', goal: 64, reward: 30, done: false }] };
  const friends = {
    call: async (p, body) => {
      calls.push([p, body]);
      if (p === 'coins/state') return { ...wallet, events: [] };
      if (p === 'coins/buy') { wallet = { ...wallet, coins: wallet.coins - 150, owned: [...wallet.owned, body.id] }; return { ...wallet, events: [], bought: body.id }; }
      if (p === 'coins/progress') return { ...wallet, events: [{ type: 'task', title: 'Mine 64 blocks', coins: 30 }] };
      return { ok: true, locked: [] };
    },
  };
  const c = await new Cosmetics({ launcher, friends }).init();
  await c.refresh();
  assert.equal(c.state().wallet.coins, 400);
  // free ones go straight on; locked ones don't
  await c.set('pet', 'bee');
  await assert.rejects(() => c.set('hat', 'halo_angel'), /Unlock it first/);
  await assert.rejects(() => c.set('hat', 'Not A Real Id'));
  await assert.rejects(() => c.set('cape', 'bee'));
  await assert.rejects(() => c.set('hat', 'bee'), /Unknown/);
  // buying puts it on
  const coins = [];
  c.on('coins', (e) => coins.push(...e));
  await c.buy('halo_angel');
  assert.equal(c.state().worn.hat, 'halo_angel');
  assert.equal(c.state().wallet.coins, 250);
  const game = JSON.parse(fs.readFileSync(launcher.paths.cosmetics, 'utf8'));
  assert.equal(game.hat, 'halo_angel');
  assert.equal(game.pet, 'bee');
  // today's tasks are written for the game
  assert.equal(JSON.parse(fs.readFileSync(launcher.paths.tasks, 'utf8')).tasks[0].stat, 'mine');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.filter(([p]) => p === 'cosmetics/set').at(-1)[1], { hat: 'halo_angel', pet: 'bee', wings: null, aura: null });
  assert.equal(c.state().sync.state, 'shared');
  // what the game counted goes to the service once, and what it pays is passed on
  fs.writeFileSync(launcher.paths.progress, JSON.stringify({ day: '2026-09-27', stats: { mine: 70 } }));
  await c.report();
  await c.report();
  assert.equal(calls.filter(([p]) => p === 'coins/progress').length, 1);
  assert.equal(coins[0].coins, 30);
  // it all comes back after a restart, even with the service gone
  const offline = { call: async () => { throw new Error('The friends service answered 404.'); } };
  const again = await new Cosmetics({ launcher, friends: offline }).init();
  assert.equal(again.state().worn.hat, 'halo_angel');
  assert.ok(again.owns('halo_angel'));
  await again.refresh();
  assert.equal(again.state().sync.state, 'offline');
  assert.match(again.state().sync.error, /answered 404/);
  again.stop();
  // a wallet that doesn't have it any more takes it off
  wallet = { ...wallet, owned: [] };
  await c.refresh();
  assert.equal(c.state().worn.hat, null);
  assert.equal(describe(new Error('Sign in with a Microsoft account to use friends.')).state, 'signed-out');
  c.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('crash doctor: reads real crash signs and names the mod to blame', async () => {
  const { diagnose, scanMods } = require('../src/core/crashdoctor');
  const AdmZip = require('adm-zip');
  const fabric = { loader: 'fabric', mcVersion: '1.21.1', memory: { max: 3072 } };
  const mod = (name, ids, pk, extra = {}) => ({ name, ids, packages: pk, rel: `mods/${ids[0]}.jar`, file: `${ids[0]}.jar`, loader: 'fabric', time: 1, ...extra });
  const modmenu = mod('Mod Menu', ['modmenu'], ['com/terraformersmc/modmenu']);
  const sodium = mod('Sodium', ['sodium'], ['net/caffeinemc/mods']);
  const bad = mod('Bad Mod', ['badmod'], ['com/example/badmod']);

  // Fabric 0.15+: a missing dependency, with what to install
  let d = diagnose({ instance: fabric, mods: [modmenu], code: 1, log: [
    '[main/ERROR]: Incompatible mods found!',
    'net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!',
    'A potential solution has been determined, this may resolve your problem:',
    '\t - Install fabric-api, any version.',
    'More details:',
    "\t - Mod 'Mod Menu' (modmenu) 11.0.1 requires any version of fabric-api, which is missing!",
  ] });
  assert.equal(d.kind, 'missing-dependency');
  assert.match(d.title, /Mod Menu needs Fabric API/);
  assert.deepEqual(d.fixes[0], { kind: 'install', project: 'fabric-api', label: 'Add Fabric API' });

  // made for another Minecraft version
  d = diagnose({ instance: fabric, mods: [sodium], code: 1, log: ["\t - Mod 'Sodium' (sodium) 0.5.8+mc1.20.4 requires version 1.20.4 of minecraft, but only the wrong version is present: 1.21.1!"] });
  assert.equal(d.kind, 'wrong-version');
  assert.equal(d.culprits[0].name, 'Sodium');
  assert.ok(d.fixes.some((f) => f.kind === 'disable' && f.rel === 'mods/sodium.jar'));

  // two mods that clash (Simple Voice Chat 2.6.24 breaks Flashback 0.39.9 and older): Fabric
  // suggests removing Voice Chat, but updating Flashback keeps both
  const flashback = mod('Flashback', ['flashback'], ['com/moulberry/flashback']);
  const voicechat = mod('Simple Voice Chat', ['voicechat'], ['de/maxhenkel/voicechat']);
  d = diagnose({ instance: fabric, mods: [voicechat, flashback, sodium], code: 1, log: [
    '[main/ERROR]: Incompatible mods found!',
    'net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!',
    'A potential solution has been determined, this may resolve your problem:',
    "\t - Remove mod 'Simple Voice Chat' (voicechat) 1.21.1-2.6.24 (C:\\mods\\voicechat.jar).",
    'More details:',
    "\t - Mod 'Simple Voice Chat' (voicechat) 1.21.1-2.6.24 is incompatible with version 0.39.9 or earlier of mod 'Flashback' (flashback), yet a conflicting version is present: 0.39.9!",
    "\t\t - The developer(s) of 'Simple Voice Chat' (voicechat) have found that this combination doesn't work.",
  ] });
  assert.equal(d.kind, 'incompatible');
  assert.equal(d.title, 'Your Flashback is too old for Simple Voice Chat');
  assert.deepEqual(d.culprits.map((c) => c.name), ['Simple Voice Chat', 'Flashback']);
  assert.deepEqual(d.fixes.map((f) => f.label), ['Update Flashback', 'Turn off Flashback', 'Turn off Simple Voice Chat']);
  assert.match(d.evidence, /Simple Voice Chat is incompatible with version 0\.39\.9 or earlier of Flashback \(you have 0\.39\.9\)/);
  // what Fabric 0.19 really prints for Flashback 0.39.9 with Simple Voice Chat: Flashback's own rule
  // trips over Voice Chat's "1.21.1-2.6.24" version, and Fabric's solver says a newer Flashback fixes it
  d = diagnose({ instance: fabric, mods: [voicechat, flashback], code: 1, log: [
    "[12:58:01] [main/INFO]: Fix: add [], remove [], replace [[flashback 0.39.9] -> add:flashback 1 ([(-∞,∞)])]",
    '[12:58:01] [main/ERROR]: Incompatible mods found!',
    'net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!',
    'A potential solution has been determined, this may resolve your problem:',
    "\t - Replace mod 'Flashback' (flashback) 0.39.9 with any version that is compatible with:",
    '\t\t - voicechat 1.21.1-2.6.24',
    'More details:',
    "\t - Mod 'Flashback' (flashback) 0.39.9 is incompatible with any version before 2.6.23 of mod 'Simple Voice Chat' (voicechat), yet a conflicting version is present: 1.21.1-2.6.24!",
    "\t - Mod 'Simple Voice Chat' (voicechat) 1.21.1-2.6.24 is incompatible with version 0.39.9 or earlier of mod 'Flashback' (flashback), yet a conflicting version is present: 0.39.9!",
  ] });
  assert.equal(d.title, 'Your Flashback is too old for Simple Voice Chat');
  assert.deepEqual(d.fixes.map((f) => f.label), ['Update Flashback', 'Turn off Flashback', 'Turn off Simple Voice Chat']);
  assert.equal(d.evidence.split('\n').length, 2);
  // never together: one of them goes
  d = diagnose({ instance: fabric, mods: [voicechat, flashback], code: 1, log: ["\t - Mod 'Flashback' (flashback) 0.19.1 is incompatible with any version of mod 'Simple Voice Chat' (voicechat), yet a conflicting version is present: 2.5.20!"] });
  assert.equal(d.title, "Flashback doesn't work with Simple Voice Chat");
  assert.deepEqual(d.fixes.map((f) => f.label), ['Turn off Flashback', 'Turn off Simple Voice Chat', 'Update Flashback']);
  // a mod that breaks newer versions of another: a newer one of it is the cure
  d = diagnose({ instance: fabric, mods: [voicechat, flashback], code: 1, log: ["\t - Mod 'Flashback' (flashback) 0.30.0 is incompatible with version 2.6.0 or later of mod 'Simple Voice Chat' (voicechat), yet a conflicting version is present: 2.6.24!"] });
  assert.equal(d.title, "Flashback doesn't work with your newer Simple Voice Chat");
  assert.equal(d.fixes[0].label, 'Update Flashback');
  // a mod that needs a newer version of another
  d = diagnose({ instance: fabric, mods: [modmenu, sodium], code: 1, log: ["\t - Mod 'Mod Menu' (modmenu) 11.0.1 requires version 0.6.0 or later of mod 'Sodium' (sodium), but only the wrong version is present: 0.5.8!"] });
  assert.equal(d.kind, 'dependency-version');
  assert.equal(d.title, 'Mod Menu needs a newer Sodium');
  assert.deepEqual(d.fixes[0], { kind: 'update', rel: 'mods/sodium.jar', label: 'Update Sodium' });
  // newer loaders name Minecraft like a mod
  d = diagnose({ instance: fabric, mods: [sodium], code: 1, log: ["\t - Mod 'Sodium' (sodium) 0.5.8 requires version 1.20.4 of 'Minecraft' (minecraft), but only the wrong version is present: 1.21.1!"] });
  assert.equal(d.kind, 'wrong-version');

  // a mixin that doesn't apply
  d = diagnose({ instance: fabric, mods: [bad, sodium], code: 1, log: ['Mixin apply for mod badmod failed badmod.mixins.json:TitleMixin from mod badmod -> net.minecraft.class_442: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException'] });
  assert.equal(d.kind, 'mixin');
  assert.equal(d.culprits[0].name, 'Bad Mod');

  // the stack trace points into a mod
  d = diagnose({ instance: fabric, mods: [bad, sodium], code: -1, report: [
    '---- Minecraft Crash Report ----',
    'Description: Ticking entity',
    '',
    'java.lang.NullPointerException: Cannot invoke "Object.toString()"',
    '\tat com.example.badmod.feature.Thing.tick(Thing.java:42)',
    '\tat net.minecraft.class_1297.method_5773(class_1297.java:500)',
  ].join('\n') });
  assert.equal(d.kind, 'suspect');
  assert.match(d.title, /Bad Mod crashed the game/);
  assert.match(d.evidence, /Ticking entity/);

  // out of memory
  d = diagnose({ instance: fabric, mods: [], code: 1, log: ['Exception in thread "Render thread" java.lang.OutOfMemoryError: Java heap space'], totalMB: 16384 });
  assert.equal(d.kind, 'memory');
  assert.deepEqual(d.fixes[0], { kind: 'memory', mb: 5120, label: 'Give it 5 GB' });

  // the graphics driver, from the JVM's crash file
  d = diagnose({ instance: fabric, mods: [], code: -1073741819, hsErr: '# Problematic frame:\n# C  [nvoglv64.dll+0xd9f1b2]' });
  assert.equal(d.kind, 'graphics');
  assert.match(d.fixes[0].label, /NVIDIA/);

  // Forge's list of missing dependencies
  d = diagnose({ instance: { loader: 'forge', mcVersion: '1.20.1' }, mods: [], code: 1, log: ["Mod ID: 'geckolib', Requested by: 'cobblemon', Expected range: '[4.4,)', Actual version: '[MISSING]'"] });
  assert.equal(d.kind, 'missing-dependency');
  assert.equal(d.fixes[0].project, 'geckolib');

  // a class that isn't there: a library mod is missing
  d = diagnose({ instance: fabric, mods: [modmenu], code: 1, log: ['java.lang.NoClassDefFoundError: me/shedaniel/clothconfig2/api/ConfigBuilder'] });
  assert.equal(d.kind, 'missing-library');
  assert.equal(d.fixes[0].project, 'cloth-config');

  // nothing to go on
  assert.equal(diagnose({ instance: fabric, mods: [], code: 0, log: [] }), null);
  d = diagnose({ instance: fabric, mods: [bad], code: 1, log: ['something odd'] });
  assert.equal(d.kind, 'unknown');

  // scanning the mods folder: the same mod twice, and a Forge mod in a Fabric instance
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-doctor-'));
  fs.mkdirSync(path.join(dir, 'mods'));
  const jar = (file, entries, time) => {
    const z = new AdmZip();
    for (const [n, t] of Object.entries(entries)) z.addFile(n, Buffer.from(t));
    z.writeZip(path.join(dir, 'mods', file));
    fs.utimesSync(path.join(dir, 'mods', file), time, time);
  };
  jar('jei-1.0.jar', { 'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="jei"\ndisplayName="Just Enough Items"', 'mezz/jei/api/A.class': 'x' }, 1000);
  jar('zoom-1.0.jar', { 'fabric.mod.json': '{"id":"zoomify","name":"Zoomify","version":"1.0"}', 'dev/isxander/zoomify/Z.class': 'x' }, 1000);
  jar('zoom-2.0.jar', { 'fabric.mod.json': '{"id":"zoomify","name":"Zoomify","version":"2.0"}', 'dev/isxander/zoomify/Z.class': 'x' }, 2000);
  // a mod bundled inside another: Fabric names it by its own id
  const api = new AdmZip();
  api.addFile('fabric.mod.json', Buffer.from('{"id":"voicechat_api","name":"Simple Voice Chat API","version":"2.6.20"}'));
  const svc = new AdmZip();
  svc.addFile('fabric.mod.json', Buffer.from('{"id":"voicechat","name":"Simple Voice Chat","version":"2.6.20","jars":[{"file":"META-INF/jars/voicechat-api-2.6.20.jar"}]}'));
  svc.addFile('META-INF/jars/voicechat-api-2.6.20.jar', api.toBuffer());
  svc.addFile('de/maxhenkel/voicechat/V.class', Buffer.from('x'));
  svc.writeZip(path.join(dir, 'mods', 'voicechat-fabric-2.6.20.jar'));
  let mods = await scanMods(dir);
  assert.deepEqual(mods.find((m) => m.file === 'voicechat-fabric-2.6.20.jar').ids, ['voicechat', 'voicechat_api']);
  const fb = mod('Flashback', ['flashback'], ['com/moulberry/flashback']);
  d = diagnose({ instance: fabric, mods: [...mods.filter((m) => m.file.startsWith('voicechat')), fb], code: 1, log: ["\t - Mod 'Flashback' (flashback) 0.39.10 is incompatible with any version before 2.6.24 of mod 'Simple Voice Chat API' (voicechat_api), yet a conflicting version is present: 2.6.20!"] });
  assert.equal(d.title, 'Your Simple Voice Chat is too old for Flashback');
  assert.deepEqual(d.fixes[0], { kind: 'update', rel: 'mods/voicechat-fabric-2.6.20.jar', label: 'Update Simple Voice Chat' });
  fs.rmSync(path.join(dir, 'mods', 'voicechat-fabric-2.6.20.jar'));
  mods = await scanMods(dir);
  assert.equal(mods.length, 3);
  assert.deepEqual(mods.find((m) => m.file === 'jei-1.0.jar').ids, ['jei']);
  d = diagnose({ instance: fabric, mods, code: 1, log: [] });
  assert.equal(d.kind, 'wrong-loader');
  assert.match(d.title, /Just Enough Items is made for Forge/);
  assert.ok(d.fixes.some((f) => f.rel === 'mods/zoom-1.0.jar'), 'the older duplicate goes too');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('import: reads CurseForge, Prism/MultiMC, ATLauncher and Modrinth App instances and copies the game folder', async () => {
  const { scanFolder, copyGame, readInstance } = require('../src/core/importer');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-import-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  // CurseForge: Forge
  put('cf/All the Mods/minecraftinstance.json', JSON.stringify({ name: 'All the Mods', gameVersion: '1.20.1', baseModLoader: { name: 'forge-47.2.0', minecraftVersion: '1.20.1', forgeVersion: '47.2.0' } }));
  put('cf/All the Mods/mods/a.jar', 'x');
  put('cf/All the Mods/mods/b.jar', 'x');
  put('cf/All the Mods/saves/World/level.dat', 'x');
  put('cf/All the Mods/logs/latest.log', 'x');
  // CurseForge: Fabric
  put('cf/Fabby/minecraftinstance.json', JSON.stringify({ name: 'Fabby', gameVersion: '1.21.1', baseModLoader: { name: 'fabric-0.16.5-1.21.1', minecraftVersion: '1.21.1' } }));
  // Prism: NeoForge, game in .minecraft
  put('prism/Neo/instance.cfg', 'InstanceType=OneSix\nname=Neo Pack\n');
  put('prism/Neo/mmc-pack.json', JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.21.1' }, { uid: 'net.neoforged', version: '21.1.65' }] }));
  put('prism/Neo/.minecraft/options.txt', 'fov:0.5');
  put('prism/Neo/.minecraft/config/x.toml', 'a=1');
  // ATLauncher: Quilt
  put('at/Quilty/instance.json', JSON.stringify({ id: '1.20.4', launcher: { name: 'Quilty', loaderVersion: { type: 'Quilt', version: '0.26.0' } } }));
  // the Modrinth App's old profile.json
  put('mr/Plain/profile.json', JSON.stringify({ metadata: { name: 'Plain', game_version: '1.21', loader: 'vanilla' } }));

  const cf = await scanFolder(path.join(root, 'cf'), 'CurseForge');
  const atm = cf.find((x) => x.name === 'All the Mods');
  assert.deepEqual([atm.mcVersion, atm.loader, atm.loaderVersion, atm.mods, atm.worlds], ['1.20.1', 'forge', '1.20.1-47.2.0', 2, 1]);
  const fab = cf.find((x) => x.name === 'Fabby');
  assert.deepEqual([fab.loader, fab.loaderVersion], ['fabric', '0.16.5']);
  const [neo] = await scanFolder(path.join(root, 'prism'), 'Prism Launcher');
  assert.deepEqual([neo.name, neo.mcVersion, neo.loader, neo.loaderVersion], ['Neo Pack', '1.21.1', 'neoforge', '21.1.65']);
  assert.equal(neo.gameDir, path.join(root, 'prism', 'Neo', '.minecraft'));
  const [q] = await scanFolder(path.join(root, 'at'));
  assert.deepEqual([q.loader, q.loaderVersion, q.mcVersion], ['quilt', '0.26.0', '1.20.4']);
  assert.equal((await readInstance(path.join(root, 'mr', 'Plain'))).loader, 'vanilla');
  // a single instance folder works too
  assert.equal((await scanFolder(path.join(root, 'prism', 'Neo'))).length, 1);
  assert.equal(await readInstance(path.join(root, 'cf')), null);

  // copying leaves out the launcher's bookkeeping and logs
  const dest = path.join(root, 'out');
  await copyGame(atm.gameDir, dest);
  assert.ok(fs.existsSync(path.join(dest, 'mods', 'a.jar')));
  assert.ok(fs.existsSync(path.join(dest, 'saves', 'World', 'level.dat')));
  assert.ok(!fs.existsSync(path.join(dest, 'logs')));
  assert.ok(!fs.existsSync(path.join(dest, 'minecraftinstance.json')));
  fs.rmSync(root, { recursive: true, force: true });
});
