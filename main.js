'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const config = require('./launcher.config.json');
const { validUsername, offlineAuth } = require('./lib/auth');
const { syncModpack } = require('./lib/modpack');
const { ensureJava } = require('./lib/java');
const { installGame, launchGame, describeError } = require('./lib/game');
const { getServerStatus } = require('./lib/status');
const microsoft = require('./lib/microsoft');
const { validateSkinPng, uploadSkin, fetchSkinData } = require('./lib/skins');
const { newToken, uploadToSkinServer, deleteFromSkinServer, fetchServerSkin, writeSkinLoaderConfig } = require('./lib/skinserver');

const { fetchNews, checkUpdate } = require('./lib/updates');
const { ensureServer } = require('./lib/servers');

const skinServerUrl = (config.skins && config.skins.serverUrl) || '';

const dataDir = path.join(app.getPath('appData'), config.dataFolderName);
const gameDir = path.join(dataDir, 'minecraft');
const runtimeDir = path.join(dataDir, 'runtime');
const msCacheDir = path.join(dataDir, 'ms-auth');
const mySkinFile = path.join(dataDir, 'my-skin.png');
const settingsFile = path.join(dataDir, 'launcher-settings.json');

// El modpack va dentro del instalador (extraResources) o en ./modpack durante el desarrollo.
const modpackDir = app.isPackaged ? path.join(process.resourcesPath, 'modpack') : path.join(__dirname, 'modpack');

const apiUrl = (config.api && config.api.url) || skinServerUrl; // novedades y actualizaciones
let lastUpdate = null; // resultado de la última comprobación (la URL de descarga no sale de aquí)
let win = null;
let busy = false; // preparando/ejecutando el juego
let loginBusy = false;
let pickedSkinPath = null; // última skin elegida en el diálogo (el renderer nunca manda rutas)

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), ...patch }, null, 2));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function errMsg(err) {
  return describeError(err);
}

/** Última skin que el jugador aplicó (se guarda aquí para reutilizarla con otro nombre). */
function savedSkin() {
  try {
    const data = fs.readFileSync(mySkinFile);
    validateSkinPng(data);
    return { data, variant: readSettings().mySkinVariant === 'slim' ? 'slim' : 'classic' };
  } catch {
    return null;
  }
}

/** Quién escribió por última vez la skin de un nombre en el servidor: 'premium' (copiada de Microsoft) u 'offline' (la que elegiste). */
function slotOf(name) {
  return (readSettings().skinSlots || {})[String(name).toLowerCase()] || '';
}
function setSlot(name, source) {
  const slots = { ...(readSettings().skinSlots || {}) };
  if (source) slots[String(name).toLowerCase()] = source;
  else delete slots[String(name).toLowerCase()];
  writeSettings({ skinSlots: slots });
}

function skinToken() {
  let t = readSettings().skinToken;
  if (!t) { t = newToken(); writeSettings({ skinToken: t }); }
  return t;
}

/** Guarda lo último que sabemos de la cuenta (nombre y skin) para mostrarlo sin volver a iniciar sesión. */
function rememberMs(ms) {
  writeSettings({
    msName: ms.name,
    msSkinUrl: ms.skin ? ms.skin.url : '',
    msSkinVariant: ms.skin ? ms.skin.variant : 'classic',
  });
}

/** Obtiene la sesión de Microsoft (renueva en silencio o pide el código de dispositivo). */
async function getMicrosoftAuth() {
  const clientId = (config.microsoft && config.microsoft.clientId) || null;
  try {
    return await microsoft.getMinecraftAuth({
      cacheDir: msCacheDir,
      clientId,
      onCode: (resp) => {
        const url = microsoft.linkUrl(resp);
        send('ms-code', { code: resp.user_code, url });
        shell.openExternal(url).catch(() => {});
      },
    });
  } finally {
    send('ms-code', null); // cierra el aviso con el código
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#12141a',
    title: config.launcherName,
    icon: path.join(__dirname, 'renderer', 'assets', 'icon-256.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

ipcMain.handle('init', () => {
  const s = readSettings();
  return {
    config: {
      launcherName: config.launcherName,
      server: config.server,
      minecraftVersion: config.minecraftVersion,
      neoforgeVersion: config.neoforgeVersion,
      news: config.news || [],
      defaultRamMb: config.defaultRamMb,
      skinServer: Boolean(skinServerUrl),
      hasSavedSkin: Boolean(savedSkin()),
      skinCommand: (config.skins && config.skins.command) || '/skin set web "URL_DE_TU_SKIN"',
    },
    settings: {
      accountType: s.accountType === 'microsoft' ? 'microsoft' : 'offline',
      username: s.username || '',
      ramMb: s.ramMb || config.defaultRamMb,
      msName: microsoft.hasSession(msCacheDir) ? s.msName || '' : '',
    },
    version: app.getVersion(),
  };
});

async function refreshUpdate() {
  if (!apiUrl) return null;
  try {
    lastUpdate = await checkUpdate({ apiUrl, current: app.getVersion() });
  } catch {
    // sin conexión con el servidor de avisos: se conserva el último resultado
  }
  return lastUpdate;
}

ipcMain.handle('news', async () => {
  if (!apiUrl) return config.news || [];
  try {
    const n = await fetchNews({ apiUrl });
    return n === null ? config.news || [] : n;
  } catch {
    return null; // el renderer conserva lo que ya muestra
  }
});
ipcMain.handle('update:check', async () => {
  const u = await refreshUpdate();
  if (!u) return { available: false, required: false };
  return { available: u.available, required: u.required, version: u.version, notes: u.notes, canOpen: Boolean(u.url) };
});
ipcMain.handle('update:open', () => (lastUpdate && lastUpdate.url ? shell.openExternal(lastUpdate.url).then(() => true) : false));

ipcMain.handle('status', () => getServerStatus(config.server.host, config.server.port));
ipcMain.handle('open-folder', () => shell.openPath(gameDir));
ipcMain.handle('clipboard', (_e, text) => clipboard.writeText(String(text).slice(0, 500)));

// ---- Cuenta Microsoft ----
ipcMain.handle('ms:login', async () => {
  if (loginBusy) return { ok: false, error: 'Ya hay un inicio de sesión en curso.' };
  loginBusy = true;
  try {
    const ms = await getMicrosoftAuth();
    writeSettings({ accountType: 'microsoft' });
    rememberMs(ms);
    return { ok: true, name: ms.name };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  } finally {
    loginBusy = false;
  }
});

ipcMain.handle('ms:logout', () => {
  microsoft.logout(msCacheDir);
  writeSettings({ msName: '' });
  return { ok: true };
});

// ---- Skins ----
ipcMain.handle('skin:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Elige tu skin (PNG 64x64)',
    properties: ['openFile'],
    filters: [{ name: 'Skin de Minecraft (PNG)', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  try {
    const data = fs.readFileSync(res.filePaths[0]);
    validateSkinPng(data);
    pickedSkinPath = res.filePaths[0];
    return { ok: true, name: path.basename(pickedSkinPath), dataUrl: `data:image/png;base64,${data.toString('base64')}` };
  } catch (err) {
    pickedSkinPath = null;
    return { ok: false, error: errMsg(err) };
  }
});

/** Skin actual de la cuenta de Microsoft (para el visor 3D). Nunca falla: { ok:false } si no hay. */
ipcMain.handle('skin:current', async (_e, args) => {
  const s = readSettings();
  if (args && args.accountType === 'offline') {
    if (!skinServerUrl || !validUsername(args.username)) return { ok: false };
    try {
      const r = await fetchServerSkin({ serverUrl: skinServerUrl, name: args.username });
      return r ? { ok: true, ...r } : { ok: false };
    } catch {
      return { ok: false };
    }
  }
  if (!microsoft.hasSession(msCacheDir) || !s.msSkinUrl) return { ok: false };
  try {
    return { ok: true, dataUrl: await fetchSkinData(s.msSkinUrl), variant: s.msSkinVariant || 'classic' };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('skin:saved', () => {
  const s = savedSkin();
  return s ? { ok: true, dataUrl: `data:image/png;base64,${s.data.toString('base64')}`, variant: s.variant } : { ok: false };
});

ipcMain.handle('skin:upload', async (_e, { variant, accountType, username }) => {
  if (accountType === 'offline') {
    if (!skinServerUrl) return { ok: false, error: 'Este launcher no tiene servidor de skins configurado.' };
    if (!validUsername(username)) return { ok: false, error: 'Pon primero tu nombre de jugador (3-16 caracteres).' };
    try {
      let data;
      let v = variant === 'slim' ? 'slim' : 'classic';
      if (pickedSkinPath) {
        data = fs.readFileSync(pickedSkinPath);
      } else {
        const saved = savedSkin();
        if (!saved) return { ok: false, error: 'Primero elige un archivo PNG.' };
        data = saved.data;
        v = variant === 'slim' || variant === 'classic' ? variant : saved.variant;
      }
      await uploadToSkinServer({ serverUrl: skinServerUrl, name: username, token: skinToken(), data, variant: v });
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(mySkinFile, data);
      writeSettings({ mySkinVariant: v });
      setSlot(username, 'offline');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  }
  if (!pickedSkinPath) return { ok: false, error: 'Primero elige un archivo PNG.' };
  if (!microsoft.hasSession(msCacheDir)) return { ok: false, error: 'Inicia sesión con tu cuenta Microsoft primero.' };
  try {
    const ms = await getMicrosoftAuth();
    await uploadSkin({ token: ms.token, filePath: pickedSkinPath, variant });
    try {
      rememberMs(await getMicrosoftAuth()); // refresca la skin guardada con la nueva
    } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

// ---- Jugar ----
ipcMain.handle('play', async (_e, { accountType, username, ramMb }) => {
  if (busy || loginBusy) return { ok: false, error: 'Ya se está preparando el juego.' };
  const premium = accountType === 'microsoft';
  const upd = await refreshUpdate();
  if (upd && upd.required) {
    return { ok: false, error: `Hay que actualizar el launcher a la versión ${upd.version} para poder jugar.` };
  }
  if (!premium && !validUsername(username)) {
    return { ok: false, error: 'Nombre no válido: 3-16 caracteres, solo letras, números y _' };
  }
  if (premium && !microsoft.hasSession(msCacheDir)) {
    return { ok: false, error: 'Inicia sesión con tu cuenta Microsoft antes de jugar.' };
  }
  const ram = Math.min(Math.max(Number(ramMb) || config.defaultRamMb, 2048), 32768);
  writeSettings({ accountType: premium ? 'microsoft' : 'offline', ramMb: ram, ...(premium ? {} : { username }) });

  busy = true;
  const log = (text) => send('log', text);
  const stage = (name) => send('stage', name);
  const progress = (value) => send('progress', value);
  try {
    fs.mkdirSync(gameDir, { recursive: true });

    let msInfo = null;
    if (premium) {
      stage('Comprobando tu cuenta de Microsoft');
      const ms = await getMicrosoftAuth(); // falla pronto si la sesión caducó o no hay Minecraft
      msInfo = ms;
      rememberMs(ms);
      log(`Sesión de Microsoft: ${ms.name}`);
    }

    stage('Preparando Java');
    const javaPath = await ensureJava({ runtimeDir, major: config.javaMajor, log, progress });

    stage('Comprobando Minecraft y NeoForge');
    send('progress', -1); // barra indeterminada
    const { versionId, resourceRoot } = await installGame({
      gameDir,
      minecraftVersion: config.minecraftVersion,
      neoforgeVersion: config.neoforgeVersion,
      javaPath,
      log,
    });

    stage('Sincronizando mods');
    const result = await syncModpack({
      modpackDir,
      gameDir,
      strictDirs: config.strictSyncDirs,
      log,
      progress,
    });
    log(`Mods: ${result.copied} instalados/actualizados, ${result.removed} eliminados.`);
    try {
      const r = ensureServer({ gameDir, name: config.server.name, host: config.server.host, port: config.server.port });
      if (r === 'created' || r === 'added') log('Servidor añadido a tu lista de multijugador.');
    } catch (err) {
      log(`Lista de servidores: ${errMsg(err)}`);
    }
    if (skinServerUrl) {
      let mode = premium ? 'premium-fallback' : 'offline';
      try {
        if (premium) {
          // Copia tu skin real de Microsoft al servidor de skins, para que no gane una skin antigua de ese nombre.
          if (msInfo.skin && msInfo.skin.url) {
            const dataUrl = await fetchSkinData(msInfo.skin.url);
            await uploadToSkinServer({
              serverUrl: skinServerUrl, name: msInfo.name, token: skinToken(),
              data: Buffer.from(dataUrl.split(',')[1], 'base64'),
              variant: msInfo.skin.variant === 'slim' ? 'slim' : 'classic',
            });
            setSlot(msInfo.name, 'premium');
            mode = 'premium';
          }
        } else {
          // Cada cuenta ve su skin: si el hueco de este nombre tiene la skin copiada de Microsoft, se cambia
          // por la última que elegiste, o se quita (Steve/Alex) si no elegiste ninguna.
          const saved = savedSkin();
          const hasServerSkin = Boolean(await fetchServerSkin({ serverUrl: skinServerUrl, name: username }));
          const fromPremium = slotOf(username) === 'premium';
          if (saved && (!hasServerSkin || slotOf(username) !== 'offline')) {
            await uploadToSkinServer({ serverUrl: skinServerUrl, name: username, token: skinToken(), data: saved.data, variant: saved.variant });
            setSlot(username, 'offline');
            log(`Skin aplicada al nombre ${username}.`);
          } else if (!saved && hasServerSkin && fromPremium) {
            await deleteFromSkinServer({ serverUrl: skinServerUrl, name: username, token: skinToken() });
            setSlot(username, '');
            log(`Se quitó la skin de Microsoft del nombre ${username} (cuenta sin premium).`);
          }
        }
      } catch (err) {
        log(`Skins: ${errMsg(err)}`);
      }
      writeSkinLoaderConfig({ gameDir, serverUrl: skinServerUrl, mode });
    }

    // El token se pide justo antes de lanzar (la instalación puede tardar y el token caduca).
    let auth;
    if (premium) {
      const ms = await getMicrosoftAuth();
      auth = { name: ms.name, uuid: ms.uuid, accessToken: ms.token, userType: 'msa' };
    } else {
      auth = offlineAuth(username);
    }

    stage('Iniciando Minecraft');
    send('progress', -1);
    const proc = await launchGame({
      gameDir,
      resourceRoot,
      versionId,
      javaPath,
      auth,
      ramMb: ram,
      server: config.server,
      launcherName: config.launcherName,
      onLog: log,
    });
    send('state', 'running');
    proc.on('close', (code) => {
      busy = false;
      log(`Minecraft se cerró (código ${code}).`);
      send('state', 'idle');
      send('progress', 0);
    });
    return { ok: true };
  } catch (err) {
    busy = false;
    send('state', 'idle');
    send('progress', 0);
    log(`ERROR: ${errMsg(err)}`);
    return { ok: false, error: errMsg(err) };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
