'use strict';
// Installs an instance for real and starts the game for a few seconds with a fake account.
// usage: node test/smoke.js <loader> <mcVersion> [loaderVersion] [--assets] [--seconds=40]
const path = require('path');
const { spawn } = require('child_process');
const { Launcher } = require('../src/core/launcher');
const { buildArguments } = require('../src/core/launch');
const boost = require('../src/core/boost');
const { LogParser } = require('../src/core/logparse');

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [loader = 'vanilla', mc = '1.21.1', loaderVersion] = args.filter((a) => !a.startsWith('--'));
const seconds = Number((flags.find((f) => f.startsWith('--seconds=')) || '--seconds=40').split('=')[1]);

(async () => {
  const root = path.join(__dirname, '.data');
  const launcher = await new Launcher({ root, crypto: { encrypt: (s) => s, decrypt: (s) => s } }).init();
  let last = '';
  launcher.on('task', (t) => {
    const line = `${t.stage} ${t.total ? `${t.done}/${t.total}` : ''}`;
    if (line !== last && (t.done === t.total || !t.total)) { console.log(`  [task] ${line}`); last = line; }
    if (t.state === 'error') console.log(`  [task] ERROR ${t.error}`);
  });
  let inst;
  if (loader === 'modpack') {
    // node test/smoke.js modpack <slug>: installs the newest version of a Modrinth pack
    const modrinth = require('../src/core/modrinth');
    const project = await modrinth.getProject(mc);
    const [latest] = await modrinth.getVersions(project.id);
    inst = await launcher.task('modpack', (ctx, stage) => modrinth.installModpack(ctx, launcher.instances, { versionId: latest.id, project, onStatus: stage }));
    console.log(`modpack ${project.title} ${latest.version_number} -> ${inst.mcVersion} ${inst.loader} ${inst.loaderVersion}, mods: ${await launcher.instances.modCount(inst.id)}`);
  } else {
    inst = await launcher.instances.create({ name: `smoke ${loader} ${mc}`, mcVersion: mc, loader, loaderVersion: loaderVersion || null });
  }
  const t0 = Date.now();
  const prep = await launcher.task('smoke', (ctx, stage) => launcher.prepare(ctx, inst, { stage, skipAssets: !flags.includes('--assets') }));
  console.log(`prepared ${prep.version.id} in ${((Date.now() - t0) / 1000).toFixed(1)}s, java ${prep.java.major} ${prep.java.bin}`);
  console.log(`classpath entries: ${prep.install.classpath.length}, main: ${prep.version.mainClass}`);

  const account = { uuid: '00000000000000000000000000000000', name: 'Smoke', accessToken: 'smoke-token', xuid: '0' };
  const built = buildArguments({
    paths: launcher.paths, version: prep.version, install: prep.install, instance: prep.instance, account,
    gameDir: prep.gameDir, gameAssets: prep.gameAssets, clientId: 'smoke',
    extraJvm: boost.launchJvmFlags({ instance: prep.instance, javaMajor: prep.java.major, modCount: 0 }),
  });
  const child = spawn(prep.java.bin, [...built.jvm, built.mainClass, ...built.game], { cwd: prep.gameDir });
  const out = [];
  const parser = new LogParser();
  const onData = (d) => {
    for (const raw of d.toString().split(/\r?\n/)) {
      for (const l of parser.push(raw)) if (l.trim()) { out.push(l); if (process.env.VERBOSE) console.log('   |', l); }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve('killed-after-timeout'); }, seconds * 1000);
    child.on('close', (c) => { clearTimeout(timer); resolve(c); });
  });
  console.log(`exit: ${code}`);
  const marks = ['Setting user', 'LWJGL', 'Backend library', 'OpenGL', 'Loading Minecraft', 'Forge', 'Fabric', 'Quilt', 'NeoForge', 'Created:', 'Sound engine', 'Exception', 'Error'];
  console.log('highlights:\n' + out.filter((l) => marks.some((m) => l.includes(m))).slice(0, 14).map((l) => `   * ${l.slice(0, 200)}`).join('\n'));
  console.log(out.slice(-12).map((l) => `   | ${l}`).join('\n'));
  await launcher.instances.remove(inst.id);
})().catch((err) => { console.error('SMOKE FAILED:', err); process.exit(1); });
