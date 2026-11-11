'use strict';
// Pruebas de la lógica sin Electron ni red. Ejecuta: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { offlineUuid, validUsername, dashed } = require('../lib/auth');
const { syncModpack } = require('../lib/modpack');
const { findJava } = require('../lib/java');

(async () => {
  // UUID offline: valor de referencia calculado con Java (UUID.nameUUIDFromBytes) / Python
  assert.strictEqual(dashed(offlineUuid('Alvaro')), '046ef7e0-c45e-3024-b0c1-203aa495bef8');
  assert.ok(validUsername('Alvaro_1') && !validUsername('a') && !validUsername('mal nombre') && !validUsername('x'.repeat(17)));

  // Sincronización de mods
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-'));
  const pack = path.join(tmp, 'pack'), game = path.join(tmp, 'game');
  fs.mkdirSync(path.join(pack, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(pack, 'config'), { recursive: true });
  fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(game, 'config'), { recursive: true });
  fs.writeFileSync(path.join(pack, 'mods', 'a.jar'), 'mod-a');
  fs.writeFileSync(path.join(pack, 'mods', '.gitkeep'), '');
  fs.writeFileSync(path.join(pack, 'config', 'x.toml'), 'server=1');
  fs.writeFileSync(path.join(game, 'mods', 'viejo.jar'), 'sobra');          // debe borrarse
  fs.writeFileSync(path.join(game, 'config', 'propio.toml'), 'del jugador'); // NO debe borrarse

  let r = await syncModpack({ modpackDir: pack, gameDir: game });
  assert.deepStrictEqual([r.copied, r.removed], [2, 1]);
  assert.ok(!fs.existsSync(path.join(game, 'mods', 'viejo.jar')));
  assert.ok(fs.existsSync(path.join(game, 'config', 'propio.toml')));
  assert.ok(!fs.existsSync(path.join(game, 'mods', '.gitkeep')));

  fs.writeFileSync(path.join(game, 'mods', 'a.jar'), 'corrupto');             // se repara
  r = await syncModpack({ modpackDir: pack, gameDir: game });
  assert.deepStrictEqual([r.copied, r.removed], [1, 0]);
  assert.strictEqual(fs.readFileSync(path.join(game, 'mods', 'a.jar'), 'utf8'), 'mod-a');

  r = await syncModpack({ modpackDir: pack, gameDir: game });                  // idempotente
  assert.deepStrictEqual([r.copied, r.removed], [0, 0]);

  // Sesión offline: mismos datos que antes, con el formato nuevo
  const { offlineAuth } = require('../lib/auth');
  const oa = offlineAuth('Alvaro');
  assert.deepStrictEqual(oa, { name: 'Alvaro', uuid: '046ef7e0c45e30 24b0c1203aa495bef8'.replace(' ', ''), accessToken: '0', userType: 'legacy' });

  // Skins: validación de PNG y subida (con un fetch falso)
  const { validateSkinPng, uploadSkin } = require('../lib/skins');
  const png = (w, h) => {
    const b = Buffer.alloc(40);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
    return b;
  };
  assert.deepStrictEqual(validateSkinPng(png(64, 64)), { width: 64, height: 64 });
  assert.doesNotThrow(() => validateSkinPng(png(64, 32)));
  assert.throws(() => validateSkinPng(png(128, 128)), /64x64/);
  assert.throws(() => validateSkinPng(Buffer.from('no soy un png, solo texto de relleno largo...')), /no es un PNG/);
  assert.throws(() => validateSkinPng(Buffer.alloc(2 * 1024 * 1024)), /demasiado grande/);

  const skinFile = path.join(tmp, 'skin.png');
  fs.writeFileSync(skinFile, png(64, 64));
  let seen;
  await uploadSkin({
    token: 'TOKEN', filePath: skinFile, variant: 'slim',
    fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200 }; },
  });
  assert.strictEqual(seen.url, 'https://api.minecraftservices.com/minecraft/profile/skins');
  assert.strictEqual(seen.opts.method, 'POST');
  assert.strictEqual(seen.opts.headers.Authorization, 'Bearer TOKEN');
  assert.strictEqual(seen.opts.body.get('variant'), 'slim');
  assert.strictEqual(seen.opts.body.get('file').size, 40);
  await assert.rejects(
    uploadSkin({ token: 't', filePath: skinFile, fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }) }),
    /HTTP 401/
  );
  await assert.rejects(uploadSkin({ token: 't', filePath: skinFile, variant: 'raro' }), /Modelo/);

  // Skin actual de la cuenta: elegir la activa y descargarla solo de Mojang
  const { fetchSkinData } = require('../lib/skins');
  const msMod = require('../lib/microsoft');
  assert.deepStrictEqual(
    msMod.activeSkin([{ state: 'INACTIVE', url: 'http://textures.minecraft.net/a' }, { state: 'ACTIVE', url: 'http://textures.minecraft.net/b', variant: 'SLIM' }]),
    { url: 'https://textures.minecraft.net/b', variant: 'slim' }
  );
  assert.deepStrictEqual(msMod.activeSkin([{ state: 'ACTIVE', url: 'https://textures.minecraft.net/c', variant: 'CLASSIC' }]).variant, 'classic');
  assert.strictEqual(msMod.activeSkin([]), null);
  assert.strictEqual(msMod.activeSkin(undefined), null);
  const okPng = png(64, 64);
  const dataUrl = await fetchSkinData('https://textures.minecraft.net/texture/abc', async () => ({ ok: true, arrayBuffer: async () => okPng.buffer.slice(okPng.byteOffset, okPng.byteOffset + okPng.length) }));
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
  await assert.rejects(fetchSkinData('https://evil.example.com/x.png', async () => { throw new Error('no debe llamarse'); }), /no permitido/);
  await assert.rejects(fetchSkinData('http://textures.minecraft.net/x', async () => { throw new Error('no debe llamarse'); }), /no permitido/);
  await assert.rejects(fetchSkinData('https://textures.minecraft.net/x', async () => ({ ok: false, status: 404 })), /HTTP 404/);

  // Microsoft: enlaces, sesión guardada y construcción del flujo (sin red)
  const ms = require('../lib/microsoft');
  assert.strictEqual(
    ms.linkUrl({ verification_uri: 'https://www.microsoft.com/link', user_code: 'AB12CD34' }),
    'https://www.microsoft.com/link?otc=AB12CD34'
  );
  assert.strictEqual(ms.linkUrl({ verification_uri: 'https://evil.example.com/x', user_code: 'A' }), 'https://www.microsoft.com/link');
  assert.strictEqual(ms.linkUrl({ verification_uri: 'file:///etc/passwd' }), 'https://www.microsoft.com/link');
  const cache = path.join(tmp, 'ms-auth');
  assert.strictEqual(ms.hasSession(cache), false);
  fs.mkdirSync(cache); fs.writeFileSync(path.join(cache, 'x_live-cache.json'), '{}');
  assert.strictEqual(ms.hasSession(cache), true);
  ms.logout(cache);
  assert.strictEqual(ms.hasSession(cache), false);
  assert.doesNotThrow(() => require('prismarine-auth'));

  // Reutilizar Minecraft/NeoForge ya instalados (sin descargar nada)
  const { installGame } = require('../lib/game');
  const NEO = '21.1.172', VID = 'neoforge-21.1.172';
  const makeRoot = (name, { patched = true } = {}) => {
    const r = path.join(tmp, name);
    fs.mkdirSync(path.join(r, 'versions', VID), { recursive: true });
    fs.writeFileSync(path.join(r, 'versions', VID, `${VID}.json`), '{}');
    if (patched) {
      fs.mkdirSync(path.join(r, 'libraries/net/neoforged/neoforge', NEO), { recursive: true });
      fs.writeFileSync(path.join(r, 'libraries/net/neoforged/neoforge', NEO, `neoforge-${NEO}-client.jar`), 'x');
    }
    return r;
  };
  const okDiag = async () => ({ issues: [] });
  const badDiag = async () => ({ issues: [{ type: 'missing' }] });
  const installCalls = [];
  const fakeInstall = async () => { installCalls.push(1); throw new Error('INSTALACION_SIMULADA'); };
  const base = { minecraftVersion: '1.21.1', neoforgeVersion: NEO, javaPath: 'java-que-no-debe-usarse', log: () => {}, installFn: fakeInstall };

  // a) el jugador ya tiene NeoForge completo en su .minecraft: se reutiliza
  const official = makeRoot('official');
  const gdA = path.join(tmp, 'gameA');
  let res = await installGame({ ...base, gameDir: gdA, extraRoots: [official], diagnoseFn: okDiag });
  assert.deepStrictEqual(res, { versionId: VID, resourceRoot: official });
  // b) segunda vez: se confía en el estado guardado, ni siquiera se vuelve a diagnosticar
  res = await installGame({ ...base, gameDir: gdA, extraRoots: [], diagnoseFn: async () => { throw new Error('no debe diagnosticar'); } });
  assert.deepStrictEqual(res, { versionId: VID, resourceRoot: official });
  // c) si esa instalación desaparece, se vuelve a buscar (y aquí falla al intentar instalar de verdad)
  fs.rmSync(official, { recursive: true, force: true });
  await assert.rejects(installGame({ ...base, gameDir: gdA, extraRoots: [], diagnoseFn: okDiag }), /INSTALACION_SIMULADA/);
  assert.strictEqual(installCalls.length, 1);
  // d) instalación sin el jar parcheado o con problemas: NO se reutiliza
  const incomplete = makeRoot('incomplete', { patched: false });
  const broken = makeRoot('broken');
  const gdB = path.join(tmp, 'gameB');
  await assert.rejects(installGame({ ...base, gameDir: gdB, diagnoseFn: badDiag, extraRoots: [incomplete, broken] }), /INSTALACION_SIMULADA/);
  assert.strictEqual(installCalls.length, 2, 'debe intentar instalar al no encontrar nada sano');
  assert.ok(!fs.existsSync(path.join(gdB, '.launcher-state.json')));
  // e) la carpeta propia del launcher ya completa también se reconoce
  const own = makeRoot('own');
  res = await installGame({ ...base, gameDir: own, extraRoots: [], diagnoseFn: okDiag });
  assert.deepStrictEqual(res, { versionId: VID, resourceRoot: own });

  // Detección de Java ya descargado
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  fs.mkdirSync(path.join(tmp, 'rt', 'jdk-21', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'rt', 'jdk-21', 'bin', exe), '');
  assert.ok(findJava(path.join(tmp, 'rt')).endsWith(path.join('jdk-21', 'bin', exe)));

  // Instalador de NeoForge con un "java" falso (solo Linux/mac)
  if (process.platform !== 'win32') {
    const { runNeoForgeInstaller } = require('../lib/game');
    const gd = path.join(tmp, 'mc');
    const fake = path.join(tmp, 'fakejava.sh');
    const argsLog = path.join(tmp, 'args.txt');
    fs.mkdirSync(gd, { recursive: true });
    fs.writeFileSync(fake, `#!/bin/sh\necho "$@" > "${argsLog}"\nmkdir -p "${gd}/versions/neoforge-21.1.1"\necho '{}' > "${gd}/versions/neoforge-21.1.1/neoforge-21.1.1.json"\necho instalando\nexit 0\n`);
    fs.chmodSync(fake, 0o755);
    const urls = [];
    const download = async (url, dest) => { urls.push(url); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'jar'); };
    const lines = [];
    const id = await runNeoForgeInstaller({ gameDir: gd, version: '21.1.1', javaPath: fake, log: (l) => lines.push(l), download });
    assert.strictEqual(id, 'neoforge-21.1.1');
    assert.strictEqual(urls[0], 'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.1/neoforge-21.1.1-installer.jar');
    assert.ok(fs.readFileSync(argsLog, 'utf8').includes('--installClient ' + gd));
    assert.ok(fs.existsSync(path.join(gd, 'launcher_profiles.json')));
    assert.ok(lines.includes('instalando'));

    fs.writeFileSync(fake, '#!/bin/sh\necho "Input file not found" >&2\nexit 1\n');
    await assert.rejects(
      runNeoForgeInstaller({ gameDir: gd, version: '21.1.1', javaPath: fake, download }),
      /código 1[\s\S]*Input file not found/
    );
  }

  // ---- Servidor de skins (Worker) + cliente del launcher ----
  {
    const worker = (await import('../worker/worker.mjs')).default;
    const store = new Map();
    const env = { SKINS: { get: async (k, t) => { const v = store.get(k); if (v === undefined) return null; return t === 'json' ? JSON.parse(v) : t === 'arrayBuffer' ? v : v; },
                           put: async (k, v) => { store.set(k, typeof v === 'string' ? v : v.slice().buffer); },
                           delete: async (k) => { store.delete(k); } } };
    const { uploadToSkinServer, fetchServerSkin, writeSkinLoaderConfig, newToken } = require('../lib/skinserver');
    const png = Buffer.alloc(100); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(png);
    png.writeUInt32BE(64, 16); png.writeUInt32BE(64, 20);
    const f = (u, o) => worker.fetch(new Request(u, o), env);
    const fetchImpl = (u, o) => f(u, o);
    const U = 'https://skins.test';
    const tokA = newToken(), tokB = newToken();

    await uploadToSkinServer({ serverUrl: U, name: 'Alvaro', token: tokA, data: png, variant: 'slim', fetchImpl });
    const info = await (await f(`${U}/alvaro.json`)).json();
    assert.strictEqual(info.username, 'Alvaro');
    assert.ok(/^[0-9a-f]{64}$/.test(info.skins.slim));
    const tex = await f(`${U}/textures/${info.skins.slim}`);
    assert.strictEqual(tex.status, 200);
    assert.strictEqual((await tex.arrayBuffer()).byteLength, 100);
    // otro token no puede pisar el nombre; el mismo sí puede cambiarla
    await assert.rejects(uploadToSkinServer({ serverUrl: U, name: 'alvaro', token: tokB, data: png, fetchImpl }), /otro ordenador/);
    await uploadToSkinServer({ serverUrl: U, name: 'Alvaro', token: tokA, data: png, variant: 'classic', fetchImpl });
    assert.ok((await (await f(`${U}/Alvaro.json`)).json()).skins.default);
    assert.strictEqual((await f(`${U}/nadie.json`)).status, 404);
    // quitar la skin: solo con el token de quien la puso
    const { deleteFromSkinServer } = require('../lib/skinserver');
    await assert.rejects(deleteFromSkinServer({ serverUrl: U, name: 'Alvaro', token: tokB, fetchImpl }), /otro ordenador/);
    await deleteFromSkinServer({ serverUrl: U, name: 'alvaro', token: tokA, fetchImpl });
    assert.strictEqual((await f(`${U}/Alvaro.json`)).status, 404);
    await deleteFromSkinServer({ serverUrl: U, name: 'Alvaro', token: tokB, fetchImpl }); // ya no existe: sin error
    await uploadToSkinServer({ serverUrl: U, name: 'Alvaro', token: tokB, data: png, variant: 'classic', fetchImpl }); // y otro puede reclamarlo
    await deleteFromSkinServer({ serverUrl: U, name: 'Alvaro', token: tokB, fetchImpl });
    await uploadToSkinServer({ serverUrl: U, name: 'Alvaro', token: tokA, data: png, variant: 'classic', fetchImpl });
    // el servidor valida por su cuenta (sin pasar por el cliente)
    const bad = Buffer.from(png); bad.writeUInt32BE(100, 16);
    assert.strictEqual((await f(`${U}/skin/Bob_1`, { method: 'POST', headers: { 'x-skin-token': tokA }, body: bad })).status, 400);
    assert.strictEqual((await f(`${U}/skin/Bob_1`, { method: 'POST', body: png })).status, 401);
    assert.strictEqual((await f(`${U}/skin/a`, { method: 'POST', headers: { 'x-skin-token': tokA }, body: png })).status, 400);
    const got = await fetchServerSkin({ serverUrl: U, name: 'Alvaro', fetchImpl });
    assert.strictEqual(got.variant, 'classic');
    assert.ok(got.dataUrl.startsWith('data:image/png;base64,'));
    assert.strictEqual(await fetchServerSkin({ serverUrl: U, name: 'Nadie', fetchImpl }), null);

    const gd2 = fs.mkdtempSync(path.join(tmp, 'csl-'));
    writeSkinLoaderConfig({ gameDir: gd2, serverUrl: U + '/' });
    const cfg = JSON.parse(fs.readFileSync(path.join(gd2, 'CustomSkinLoader', 'CustomSkinLoader.json'), 'utf8'));
    assert.deepStrictEqual(cfg.loadlist, [{ name: 'SocialClub', type: 'CustomSkinAPI', root: U + '/' }]);
    const types = (mode) => { writeSkinLoaderConfig({ gameDir: gd2, serverUrl: U, mode }); return JSON.parse(fs.readFileSync(path.join(gd2, 'CustomSkinLoader', 'CustomSkinLoader.json'), 'utf8')).loadlist.map((x) => x.type); };
    assert.deepStrictEqual(types('premium'), ['CustomSkinAPI', 'MojangAPI']);
    assert.deepStrictEqual(types('premium-fallback'), ['MojangAPI', 'CustomSkinAPI']);
  }


  // ---- Novedades, avisos de actualización y panel de administración ----
  {
    const worker = (await import('../worker/worker.mjs')).default;
    const store = new Map();
    const env = { ADMIN_TOKEN: 'clave-secreta-larga-123', SKINS: { get: async (k, t) => { const v = store.get(k); if (v === undefined) return null; return t === 'json' ? JSON.parse(v) : v; },
                                                      put: async (k, v) => { store.set(k, v); } } };
    const f = (u, o) => worker.fetch(new Request(u, o), env);
    const U = 'https://api.test';
    const auth = { authorization: 'Bearer clave-secreta-larga-123', 'content-type': 'application/json' };
    const { compareVersions, fetchNews, checkUpdate } = require('../lib/updates');

    assert.strictEqual(compareVersions('1.10.0', '1.9.9'), 1);
    assert.strictEqual(compareVersions('v1.3.1', '1.3.1'), 0);
    assert.strictEqual(compareVersions('1.3.0', '1.3.1'), -1);

    // sin configurar: news null (el launcher usa sus novedades de respaldo)
    assert.strictEqual(await fetchNews({ apiUrl: U, fetchImpl: f }), null);
    assert.deepStrictEqual(await checkUpdate({ apiUrl: U, current: '1.3.1', fetchImpl: f }), { available: false, required: false });

    // el panel exige contraseña
    assert.strictEqual((await f(`${U}/api/admin/state`)).status, 401);
    assert.strictEqual((await f(`${U}/api/admin/news`, { method: 'PUT', headers: { authorization: 'Bearer mala' }, body: '{}' })).status, 401);
    assert.strictEqual((await worker.fetch(new Request(`${U}/api/admin/state`), {})).status, 503); // sin ADMIN_TOKEN
    assert.ok((await (await f(`${U}/admin`)).text()).includes('Panel del launcher'));

    const put = (p, body) => f(`${U}/api/admin/${p}`, { method: 'PUT', headers: auth, body: JSON.stringify(body) });
    assert.strictEqual((await put('news', { news: [{ title: 'Hola', date: '2026-11-07', text: 'Mundo nuevo' }, { title: '', text: '' }] })).status, 200);
    const news = await fetchNews({ apiUrl: U, fetchImpl: f });
    assert.deepStrictEqual(news, [{ title: 'Hola', date: '2026-11-07', text: 'Mundo nuevo' }]);
    assert.strictEqual((await put('news', { news: new Array(21).fill({ title: 'x' }) })).status, 400);

    assert.strictEqual((await put('launcher', { version: '1.4.0', url: 'http://malo' })).status, 400);
    assert.strictEqual((await put('launcher', { version: 'abc' })).status, 400);
    assert.strictEqual((await put('launcher', { version: '1.4.0', url: 'https://x.test/setup.exe', notes: 'Nuevos mods', minVersion: '1.3.5' })).status, 200);
    let u = await checkUpdate({ apiUrl: U, current: '1.3.1', fetchImpl: f });
    assert.deepStrictEqual([u.available, u.required, u.version, u.url], [true, true, '1.4.0', 'https://x.test/setup.exe']);
    u = await checkUpdate({ apiUrl: U, current: '1.4.0', fetchImpl: f });
    assert.deepStrictEqual([u.available, u.required], [false, false]);
    // un servidor caído no rompe: lanza error y el launcher conserva lo que tenía
    await assert.rejects(checkUpdate({ apiUrl: U, current: '1.0.0', fetchImpl: async () => new Response('x', { status: 500 }) }), /HTTP 500/);
    // un enlace que no sea https nunca se ofrece
    store.set('cfg:launcher', JSON.stringify({ version: '9.0.0', url: 'file:///etc/passwd' }));
    assert.strictEqual((await checkUpdate({ apiUrl: U, current: '1.0.0', fetchImpl: f })).url, '');
  }


  // ---- Lista de servidores del juego (servers.dat) ----
  {
    const { ensureServer, parse, serialize } = require('../lib/servers');
    const dir = fs.mkdtempSync(path.join(tmp, 'srv-'));
    const file = path.join(dir, 'servers.dat');
    const names = () => parse(fs.readFileSync(file)).root.find((e) => e.name.toString() === 'servers').value.items
      .map((it) => it.map((e) => `${e.name}=${e.type === 8 ? e.value.toString() : '#'}`).join(','));

    assert.strictEqual(ensureServer({ gameDir: dir, name: 'SC', host: 'a.b.com', port: 25565 }), 'created');
    assert.deepStrictEqual(names(), ['name=SC,ip=a.b.com']);
    assert.strictEqual(ensureServer({ gameDir: dir, name: 'SC', host: 'A.b.com', port: 25565 }), 'present');

    // servers.dat de un jugador con otro servidor, con campos extra (icono, byte "hidden")
    const other = [{ type: 8, name: Buffer.from('name'), value: Buffer.from('Mio') }, { type: 8, name: Buffer.from('ip'), value: Buffer.from('mio.net:25566') },
      { type: 8, name: Buffer.from('icon'), value: Buffer.from('AAAA') }, { type: 1, name: Buffer.from('hidden'), value: Buffer.from([1]) }];
    fs.writeFileSync(file, serialize({ rootName: Buffer.alloc(0), root: [{ type: 9, name: Buffer.from('servers'), value: { itemType: 10, items: [other] } }] }));
    assert.strictEqual(ensureServer({ gameDir: dir, name: 'SC', host: 'a.b.com', port: 25565 }), 'added');
    assert.deepStrictEqual(names(), ['name=Mio,ip=mio.net:25566,icon=AAAA,hidden=#', 'name=SC,ip=a.b.com']);
    assert.ok(fs.existsSync(file + '.launcher-bak'));
    assert.strictEqual(ensureServer({ gameDir: dir, name: 'SC', host: 'a.b.com', port: 25565 }), 'present');
    assert.strictEqual(ensureServer({ gameDir: dir, name: 'SC2', host: 'a.b.com', port: 25570 }), 'added'); // otro puerto = otro servidor

    // lista vacía y archivo ilegible
    fs.writeFileSync(file, serialize({ rootName: Buffer.alloc(0), root: [{ type: 9, name: Buffer.from('servers'), value: { itemType: 0, items: [] } }] }));
    assert.strictEqual(ensureServer({ gameDir: dir, name: 'SC', host: 'x.y', port: 25565 }), 'added');
    fs.writeFileSync(file, Buffer.from('basura que no es nbt'));
    assert.strictEqual(ensureServer({ gameDir: dir, name: 'SC', host: 'x.y', port: 25565 }), 'skipped');
    assert.strictEqual(fs.readFileSync(file).toString(), 'basura que no es nbt'); // no se toca
  }


  // ---- Reintentos y mensajes de error de descarga ----
  {
    const { describeError, withRetries } = require('../lib/game');
    const agg = Object.assign(new AggregateError([Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }), new Error('connect ETIMEDOUT')], 'Multiple errors occurred during download process'),
      { urls: ['https://resources.download.minecraft.net/ab/abcd?x=1'] });
    assert.strictEqual(describeError(agg), 'Multiple errors occurred during download process: connect ETIMEDOUT [https://resources.download.minecraft.net/ab/abcd]');
    assert.strictEqual(describeError(new Error('simple')), 'simple');
    let n = 0;
    const logs = [];
    const ok = await withRetries(async () => { if (++n < 3) throw agg; return 'listo'; }, { log: (l) => logs.push(l), sleep: async () => {} });
    assert.strictEqual(ok, 'listo');
    assert.strictEqual(n, 3);
    assert.strictEqual(logs.length, 2);
    let m = 0;
    await assert.rejects(withRetries(async () => { m++; throw new Error('siempre falla'); }, { tries: 3, sleep: async () => {} }), /siempre falla/);
    assert.strictEqual(m, 3);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK: todas las pruebas pasan');
})().catch((e) => { console.error(e); process.exit(1); });
