'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const IGNORED = new Set(['.gitkeep', '.gitignore', '.DS_Store', 'Thumbs.db']);

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function walk(dir, base = dir, out = []) {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else if (!IGNORED.has(entry.name)) out.push(path.relative(base, full));
  }
  return out;
}

async function sameFile(a, b) {
  try {
    const [sa, sb] = await Promise.all([fsp.stat(a), fsp.stat(b)]);
    if (sa.size !== sb.size) return false;
    return (await hashFile(a)) === (await hashFile(b));
  } catch {
    return false;
  }
}

/**
 * Copia el modpack que viene dentro del instalador a la carpeta del juego.
 *  - Archivos nuevos o cambiados se copian.
 *  - En las carpetas "estrictas" (por defecto mods/) se borran los archivos que ya no
 *    estén en el modpack, para que el cliente quede idéntico al servidor.
 *  - En el resto de carpetas (config, resourcepacks...) nunca se borra nada del jugador.
 */
async function syncModpack({ modpackDir, gameDir, strictDirs = ['mods'], log = () => {}, progress = () => {} }) {
  if (!fs.existsSync(modpackDir)) {
    log('No hay modpack incluido; se omite la sincronización de mods.');
    return { copied: 0, removed: 0 };
  }
  const files = await walk(modpackDir);
  const wanted = new Set(files.map((f) => f.split(path.sep).join('/')));

  let removed = 0;
  for (const dir of strictDirs) {
    const target = path.join(gameDir, dir);
    if (!fs.existsSync(target)) continue;
    for (const rel of await walk(target, gameDir)) {
      const key = rel.split(path.sep).join('/');
      if (!wanted.has(key)) {
        log(`Eliminando ${key} (ya no forma parte del servidor)`);
        await fsp.rm(path.join(gameDir, rel), { force: true });
        removed++;
      }
    }
  }

  let copied = 0;
  for (let i = 0; i < files.length; i++) {
    progress(i / Math.max(files.length, 1));
    const src = path.join(modpackDir, files[i]);
    const dest = path.join(gameDir, files[i]);
    if (await sameFile(src, dest)) continue;
    log(`Instalando ${files[i].split(path.sep).join('/')}`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    await fsp.copyFile(src, tmp);
    await fsp.rename(tmp, dest);
    copied++;
  }
  progress(1);
  return { copied, removed };
}

module.exports = { syncModpack };
