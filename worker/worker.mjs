'use strict';
/**
 * Servidor de skins para jugadores sin cuenta premium (Cloudflare Worker + KV).
 * Habla el formato "CustomSkinAPI" de CustomSkinLoader:
 *   GET  /<nombre>.json     -> { "username": "...", "skins": { "default"|"slim": "<hash>" } }
 *   GET  /textures/<hash>   -> PNG
 *   POST /skin/<nombre>?variant=classic|slim   (cabecera X-Skin-Token, cuerpo = PNG)
 * El primer launcher que sube la skin de un nombre "reclama" ese nombre con su token secreto.
 */
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MAX_BYTES = 64 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', data));
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...extra } });

function checkPng(bytes) {
  if (bytes.length > MAX_BYTES) return 'Imagen demasiado grande.';
  if (bytes.length < 33 || PNG_SIG.some((b, i) => bytes[i] !== b)) return 'No es un PNG.';
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20);
  if (!(w === 64 && (h === 64 || h === 32))) return `La skin debe medir 64x64 o 64x32 (mide ${w}x${h}).`;
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (request.method === 'GET' && parts.length === 1 && parts[0].endsWith('.json')) {
        const name = parts[0].slice(0, -5);
        if (!NAME_RE.test(name)) return json({ error: 'not found' }, 404);
        const rec = await env.SKINS.get(`skin:${name.toLowerCase()}`, 'json');
        if (!rec) return json({ error: 'not found' }, 404);
        return json({ username: rec.name, skins: { [rec.variant === 'slim' ? 'slim' : 'default']: rec.hash } }, 200,
          { 'cache-control': 'public, max-age=60' });
      }

      if (request.method === 'GET' && parts.length === 2 && parts[0] === 'textures') {
        if (!/^[0-9a-f]{64}$/.test(parts[1])) return json({ error: 'not found' }, 404);
        const tex = await env.SKINS.get(`tex:${parts[1]}`, 'arrayBuffer');
        if (!tex) return json({ error: 'not found' }, 404);
        return new Response(tex, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' } });
      }

      if (request.method === 'POST' && parts.length === 2 && parts[0] === 'skin') {
        const name = parts[1];
        if (!NAME_RE.test(name)) return json({ error: 'Nombre no válido.' }, 400);
        const token = request.headers.get('x-skin-token') || '';
        if (token.length < 16 || token.length > 128) return json({ error: 'Falta el token.' }, 401);
        const variant = url.searchParams.get('variant') === 'slim' ? 'slim' : 'classic';
        const bytes = new Uint8Array(await request.arrayBuffer());
        const bad = checkPng(bytes);
        if (bad) return json({ error: bad }, 400);

        const key = `skin:${name.toLowerCase()}`;
        const tokenHash = await sha256(new TextEncoder().encode(token));
        const old = await env.SKINS.get(key, 'json');
        if (old && old.tokenHash !== tokenHash) {
          return json({ error: 'Ese nombre ya tiene una skin puesta desde otro ordenador.' }, 403);
        }
        const hash = await sha256(bytes);
        await env.SKINS.put(`tex:${hash}`, bytes);
        await env.SKINS.put(key, JSON.stringify({ name, variant, hash, tokenHash }));
        return json({ ok: true, hash });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'Error interno.' }, 500);
    }
  },
};
