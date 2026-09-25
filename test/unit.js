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
