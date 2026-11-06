'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MinecraftFolder, Version, launch, diagnose } = require('@xmcl/core');
const { spawn } = require('child_process');
const { getVersionList, install, installDependencies } = require('@xmcl/installer');

const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

async function downloadFile(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${url} (HTTP ${res.status}).`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/**
 * Instala NeoForge ejecutando el instalador oficial en modo cliente (igual que haría
 * un jugador a mano). Es más fiable que reimplementar sus procesadores.
 * Devuelve el id de versión resultante (p. ej. "neoforge-21.1.172").
 */
async function runNeoForgeInstaller({ gameDir, version, javaPath, log = () => {}, download = downloadFile }) {
  const installer = path.join(gameDir, '.cache', `neoforge-${version}-installer.jar`);
  if (!fs.existsSync(installer)) {
    log(`Descargando instalador de NeoForge ${version}...`);
    await download(`${NEOFORGE_MAVEN}/${version}/neoforge-${version}-installer.jar`, installer);
  }

  // El instalador exige que exista launcher_profiles.json en la carpeta destino.
  const profiles = path.join(gameDir, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) {
    fs.writeFileSync(profiles, JSON.stringify({ profiles: {}, selectedProfile: '', version: 3 }, null, 2));
  }

  await new Promise((resolve, reject) => {
    const proc = spawn(javaPath, ['-Djava.awt.headless=true', '-jar', installer, '--installClient', gameDir], {
      cwd: gameDir,
      windowsHide: true,
    });
    let tail = '';
    const onData = (d) => {
      const text = String(d);
      tail = (tail + text).slice(-4000);
      text.split(/\r?\n/).filter(Boolean).forEach((line) => log(line));
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`El instalador de NeoForge terminó con código ${code}.\n${tail.trim()}`))
    );
  });

  const versionId = `neoforge-${version}`;
  if (!fs.existsSync(path.join(gameDir, 'versions', versionId, `${versionId}.json`))) {
    throw new Error(`El instalador terminó pero no se creó la versión ${versionId}.`);
  }
  return versionId;
}

function stateFile(gameDir) {
  return path.join(gameDir, '.launcher-state.json');
}

function readState(gameDir) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(gameDir), 'utf8'));
  } catch {
    return {};
  }
}

/** Carpetas donde el launcher oficial de Minecraft deja sus archivos según el sistema. */
function officialRoots() {
  const home = os.homedir();
  if (process.platform === 'win32') return [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), '.minecraft')];
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'minecraft')];
  return [path.join(home, '.minecraft')];
}

function versionJson(root, versionId) {
  return path.join(root, 'versions', versionId, `${versionId}.json`);
}

/**
 * ¿Hay en `root` una instalación completa y sana de esta versión de NeoForge?
 * Comprueba también el .jar parcheado del cliente y que no falte ningún archivo (solo lectura).
 */
async function isComplete({ root, versionId, neoforgeVersion, diagnoseFn = diagnose }) {
  if (!fs.existsSync(versionJson(root, versionId))) return false;
  const patched = path.join(root, 'libraries', 'net', 'neoforged', 'neoforge', neoforgeVersion, `neoforge-${neoforgeVersion}-client.jar`);
  if (!fs.existsSync(patched)) return false;
  try {
    const report = await diagnoseFn(versionId, root);
    return report.issues.length === 0;
  } catch {
    return false;
  }
}

function saveState(gameDir, data) {
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(stateFile(gameDir), JSON.stringify(data, null, 2));
}

/**
 * Deja listo Minecraft + NeoForge, instalando SOLO lo que falte:
 *  1. Si ya lo preparamos antes, no se comprueba nada más.
 *  2. Si el jugador ya tiene esta versión completa (en la carpeta del launcher o en su
 *     Minecraft oficial), se reutiliza y no se descarga nada. Los mods y mundos siguen
 *     yendo a la carpeta del launcher, la instalación oficial no se toca.
 *  3. Si no, se instala en la carpeta del launcher.
 * Devuelve { versionId, resourceRoot }.
 *  Para forzar una reparación basta con borrar .launcher-state.json de la carpeta del juego.
 */
async function installGame({
  gameDir, minecraftVersion, neoforgeVersion, javaPath, log = () => {},
  extraRoots = officialRoots(), diagnoseFn = diagnose, installFn = installFresh,
}) {
  const key = `${minecraftVersion}|${neoforgeVersion}`;
  const defaultId = `neoforge-${neoforgeVersion}`;

  const state = readState(gameDir);
  if (state.key === key && state.resourceRoot && state.versionId && fs.existsSync(versionJson(state.resourceRoot, state.versionId))) {
    return { versionId: state.versionId, resourceRoot: state.resourceRoot };
  }

  for (const root of [gameDir, ...extraRoots]) {
    if (await isComplete({ root, versionId: defaultId, neoforgeVersion, diagnoseFn })) {
      log(root === gameDir ? 'Minecraft y NeoForge ya están instalados.' : `Usando tu instalación existente de Minecraft y NeoForge (${root}).`);
      saveState(gameDir, { key, versionId: defaultId, resourceRoot: root });
      return { versionId: defaultId, resourceRoot: root };
    }
  }

  const versionId = await installFn({ gameDir, minecraftVersion, neoforgeVersion, javaPath, log });
  saveState(gameDir, { key, versionId, resourceRoot: gameDir });
  return { versionId, resourceRoot: gameDir };
}

/** Descarga e instala Minecraft + NeoForge en la carpeta del launcher. */
async function installFresh({ gameDir, minecraftVersion, neoforgeVersion, javaPath, log }) {
  const folder = MinecraftFolder.from(gameDir);
  log(`Descargando Minecraft ${minecraftVersion}...`);
  const list = await getVersionList();
  const meta = list.versions.find((v) => v.id === minecraftVersion);
  if (!meta) throw new Error(`Minecraft ${minecraftVersion} no existe en el manifest de Mojang.`);
  await install(meta, folder);

  log(`Instalando NeoForge ${neoforgeVersion} (puede tardar unos minutos)...`);
  const versionId = await runNeoForgeInstaller({ gameDir, version: neoforgeVersion, javaPath, log });

  log('Comprobando librerías y recursos...');
  const resolved = await Version.parse(gameDir, versionId);
  await installDependencies(resolved);
  return versionId;
}

/**
 * Lanza el juego y entra directo al servidor.
 * `auth` = { name, uuid, accessToken, userType } (offline: ver auth.offlineAuth; premium: msa).
 */
async function launchGame({ gameDir, resourceRoot, versionId, javaPath, auth, ramMb, server, launcherName, onLog = () => {} }) {
  const args = [];
  if (server && server.host) args.push('--quickPlayMultiplayer', `${server.host}:${server.port || 25565}`);

  const proc = await launch({
    gamePath: gameDir, // mods, mundos, configs: siempre la carpeta del launcher
    resourcePath: resourceRoot || gameDir, // versions/libraries/assets: pueden ser los del Minecraft oficial
    javaPath,
    version: versionId,
    gameProfile: { name: auth.name, id: auth.uuid },
    accessToken: auth.accessToken,
    userType: auth.userType,
    launcherName: launcherName || 'Launcher',
    minMemory: Math.max(512, Math.floor(ramMb / 2)),
    maxMemory: ramMb,
    extraMCArgs: args,
  });
  proc.stdout && proc.stdout.on('data', (d) => onLog(String(d).trimEnd()));
  proc.stderr && proc.stderr.on('data', (d) => onLog(String(d).trimEnd()));
  return proc;
}

module.exports = { installGame, launchGame, runNeoForgeInstaller, isComplete, officialRoots };
