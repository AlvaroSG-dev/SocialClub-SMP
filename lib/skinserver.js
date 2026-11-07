'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateSkinPng } = require('./skins');

const base = (url) => String(url).replace(/\/+$/, '');

/** Token secreto por instalación: demuestra que el nombre es "tuyo" frente a otros launchers. */
function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** Sube la skin al servidor de skins del servidor (jugadores sin premium). */
async function uploadToSkinServer({ serverUrl, name, token, data, variant = 'classic', fetchImpl = fetch }) {
  if (!['classic', 'slim'].includes(variant)) throw new Error('Modelo de skin no válido.');
  validateSkinPng(data);
  const res = await fetchImpl(`${base(serverUrl)}/skin/${encodeURIComponent(name)}?variant=${variant}`, {
    method: 'POST',
    headers: { 'X-Skin-Token': token, 'Content-Type': 'image/png' },
    body: data,
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error || ''; } catch {}
    throw new Error(msg || `El servidor de skins respondió ${res.status}.`);
  }
}

/** Skin actual de un nombre en el servidor de skins (o null). */
async function fetchServerSkin({ serverUrl, name, fetchImpl = fetch }) {
  const root = base(serverUrl);
  const info = await fetchImpl(`${root}/${encodeURIComponent(name)}.json`);
  if (!info.ok) return null;
  const j = await info.json();
  const variant = j.skins && j.skins.slim ? 'slim' : 'classic';
  const hash = j.skins && (j.skins.slim || j.skins.default);
  if (!/^[0-9a-f]{64}$/.test(hash || '')) return null;
  const tex = await fetchImpl(`${root}/textures/${hash}`);
  if (!tex.ok) return null;
  const buf = Buffer.from(await tex.arrayBuffer());
  validateSkinPng(buf);
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, variant };
}

/**
 * Configura CustomSkinLoader (viaja en el modpack).
 *  mode 'offline'           -> solo nuestro servidor (no se cuela la skin de una cuenta premium con el mismo nombre)
 *  mode 'premium'           -> nuestro servidor y luego Mojang
 *  mode 'premium-fallback'  -> Mojang primero (si no se pudo copiar la skin al servidor)
 */
function writeSkinLoaderConfig({ gameDir, serverUrl, mode = 'offline' }) {
  const dir = path.join(gameDir, 'CustomSkinLoader');
  fs.mkdirSync(dir, { recursive: true });
  const ours = { name: 'SocialClub', type: 'CustomSkinAPI', root: `${base(serverUrl)}/` };
  const mojang = { name: 'Mojang', type: 'MojangAPI' };
  const loadlist = mode === 'premium' ? [ours, mojang] : mode === 'premium-fallback' ? [mojang, ours] : [ours];
  fs.writeFileSync(path.join(dir, 'CustomSkinLoader.json'), JSON.stringify({ enable: true, loadlist }, null, 2));
}

module.exports = { newToken, uploadToSkinServer, fetchServerSkin, writeSkinLoaderConfig };
