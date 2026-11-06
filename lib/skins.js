'use strict';
const fs = require('fs');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1024 * 1024; // 1 MB es de sobra para una skin

/** Comprueba que es un PNG válido de 64x64 o 64x32 (los únicos tamaños de skin de Minecraft). */
function validateSkinPng(buffer) {
  if (buffer.length > MAX_BYTES) throw new Error('La imagen es demasiado grande para ser una skin.');
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('El archivo no es un PNG.');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!(width === 64 && (height === 64 || height === 32))) {
    throw new Error(`Una skin debe medir 64x64 (o 64x32), la imagen mide ${width}x${height}.`);
  }
  return { width, height };
}

/** Sube la skin a la cuenta de Minecraft (Mojang). Se verá en cualquier servidor premium. */
async function uploadSkin({ token, filePath, variant = 'classic', fetchImpl = fetch }) {
  if (!['classic', 'slim'].includes(variant)) throw new Error('Modelo de skin no válido.');
  const data = fs.readFileSync(filePath);
  validateSkinPng(data);

  const form = new FormData();
  form.append('variant', variant);
  form.append('file', new Blob([data], { type: 'image/png' }), 'skin.png');

  const res = await fetchImpl('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {}
    throw new Error(`Mojang rechazó la skin (HTTP ${res.status}). ${detail}`.trim());
  }
}

/**
 * Descarga la skin actual de una cuenta para mostrarla en el visor 3D.
 * Solo se permite el servidor oficial de texturas de Mojang. Devuelve un data: URL.
 */
async function fetchSkinData(url, fetchImpl = fetch) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('URL de skin no válida.');
  }
  if (u.protocol !== 'https:' || u.hostname !== 'textures.minecraft.net') {
    throw new Error('Origen de skin no permitido.');
  }
  const res = await fetchImpl(u.href);
  if (!res.ok) throw new Error(`No se pudo descargar la skin (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  validateSkinPng(buf);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

module.exports = { validateSkinPng, uploadSkin, fetchSkinData };
