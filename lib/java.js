'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');

const EXE = process.platform === 'win32' ? 'java.exe' : 'java';

/** Busca bin/java dentro de la carpeta del runtime (hasta 4 niveles). */
function findJava(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 4) return null;
  const direct = path.join(dir, 'bin', EXE);
  if (fs.existsSync(direct)) return direct;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const found = findJava(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function adoptiumUrl(major) {
  const osName = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
  if (!osName || !arch) throw new Error(`Plataforma no soportada: ${process.platform}/${process.arch}`);
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
}

/**
 * Garantiza un Java <major> propio del launcher (JRE de Eclipse Temurin).
 * Si ya está descargado, lo reutiliza. El jugador no necesita instalar Java.
 */
async function ensureJava({ runtimeDir, major = 21, log = () => {}, progress = () => {} }) {
  const javaDir = path.join(runtimeDir, `java-${major}`);
  const existing = findJava(javaDir);
  if (existing) return existing;

  await fsp.rm(javaDir, { recursive: true, force: true });
  await fsp.mkdir(javaDir, { recursive: true });

  log(`Descargando Java ${major} (solo la primera vez)...`);
  const res = await fetch(adoptiumUrl(major), { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar Java (HTTP ${res.status}).`);

  const isZip = process.platform === 'win32';
  const archive = path.join(os.tmpdir(), `java-${major}-${Date.now()}${isZip ? '.zip' : '.tar.gz'}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (total) progress(received / total);
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(archive));

  log('Extrayendo Java...');
  try {
    if (isZip) {
      const AdmZip = require('adm-zip');
      new AdmZip(archive).extractAllTo(javaDir, true);
    } else {
      await require('tar').x({ file: archive, cwd: javaDir });
    }
  } finally {
    await fsp.rm(archive, { force: true });
  }

  const java = findJava(javaDir);
  if (!java) throw new Error('Java se descargó pero no se encontró el ejecutable.');
  if (process.platform !== 'win32') await fsp.chmod(java, 0o755);
  progress(1);
  return java;
}

module.exports = { ensureJava, findJava };
