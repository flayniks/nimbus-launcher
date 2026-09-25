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
const flag = (name) => (flags.find((f) => f.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null;
// --mods=a.jar,b.jar copies jars into the instance; --shots=dir screenshots the X display every second
const extraMods = (flag('mods') || '').split(',').filter(Boolean);
const shotsDir = flag('shots');
const extraJvm = (flag('jvm') || '').split(' ').filter(Boolean);

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
  const fs = require('fs');
  for (const jar of extraMods) {
    fs.mkdirSync(path.join(launcher.paths.gameDir(inst.id), 'mods'), { recursive: true });
    fs.copyFileSync(jar, path.join(launcher.paths.gameDir(inst.id), 'mods', path.basename(jar)));
  }
  // --options=key:value,key:value seeds options.txt (e.g. onboardAccessibility:false to reach the title screen)
  const seed = (flag('options') || '').split(',').filter(Boolean);
  if (seed.length) fs.writeFileSync(path.join(launcher.paths.gameDir(inst.id), 'options.txt'), `${seed.join('\n')}\n`);
  const t0 = Date.now();
  const prep = await launcher.task('smoke', (ctx, stage) => launcher.prepare(ctx, inst, { stage, skipAssets: !flags.includes('--assets') }));
  console.log(`prepared ${prep.version.id} in ${((Date.now() - t0) / 1000).toFixed(1)}s, java ${prep.java.major} ${prep.java.bin}`);
  console.log(`classpath entries: ${prep.install.classpath.length}, main: ${prep.version.mainClass}`);

  const account = { uuid: '00000000000000000000000000000000', name: 'Smoke', accessToken: 'smoke-token', xuid: '0' };
  const built = buildArguments({
    paths: launcher.paths, version: prep.version, install: prep.install, instance: prep.instance, account,
    gameDir: prep.gameDir, gameAssets: prep.gameAssets, clientId: 'smoke',
    extraJvm: [...boost.launchJvmFlags({ instance: prep.instance, javaMajor: prep.java.major, modCount: 0 }), ...extraJvm],
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
  let shooter = null;
  if (shotsDir) {
    const { execSync } = require('child_process');
    fs.mkdirSync(shotsDir, { recursive: true });
    const started = Date.now();
    shooter = setInterval(() => {
      const name = path.join(shotsDir, `t${String(Math.round((Date.now() - started) / 1000)).padStart(3, '0')}.png`);
      try { execSync(`xwd -root -silent | convert xwd:- ${name}`, { stdio: 'ignore', timeout: 5000 }); } catch { /* display busy */ }
    }, 1000);
  }
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill(); resolve('killed-after-timeout'); }, seconds * 1000);
    child.on('close', (c) => { clearTimeout(timer); resolve(c); });
  });
  if (shooter) clearInterval(shooter);
  console.log(`exit: ${code}`);
  const marks = ['Setting user', 'LWJGL', 'Backend library', 'OpenGL', 'Loading Minecraft', 'Forge', 'Fabric', 'Quilt', 'NeoForge', 'Created:', 'Sound engine', 'Exception', 'Error'];
  console.log('highlights:\n' + out.filter((l) => marks.some((m) => l.includes(m))).slice(0, 14).map((l) => `   * ${l.slice(0, 200)}`).join('\n'));
  console.log(out.slice(-12).map((l) => `   | ${l}`).join('\n'));
  if (!flags.includes('--keep')) await launcher.instances.remove(inst.id);
})().catch((err) => { console.error('SMOKE FAILED:', err); process.exit(1); });
