'use strict';
/**
 * Servidor de skins para jugadores sin cuenta premium (Cloudflare Worker + KV).
 * Habla el formato "CustomSkinAPI" de CustomSkinLoader:
 *   GET  /<nombre>.json     -> { "username": "...", "skins": { "default"|"slim": "<hash>" } }
 *   GET  /textures/<hash>   -> PNG
 *   POST /skin/<nombre>?variant=classic|slim   (cabecera X-Skin-Token, cuerpo = PNG)
 * Además sirve novedades y avisos de actualización del launcher, editables desde /admin:
 *   GET /news.json, GET /launcher.json, GET /admin (panel), /api/admin/* (necesita el secreto ADMIN_TOKEN)
 * El primer launcher que sube la skin de un nombre "reclama" ese nombre con su token secreto.
 */
import { ADMIN_HTML } from './admin-page.mjs';

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MAX_BYTES = 64 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', data));
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...extra } });

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([sha256(enc.encode(given)), sha256(enc.encode(env.ADMIN_TOKEN))]);
  return a === b;
}

function cleanNews(list) {
  if (!Array.isArray(list) || list.length > 20) throw new Error('Máximo 20 mensajes.');
  return list
    .map((n) => ({ title: text(n && n.title, 80), date: text(n && n.date, 20), text: text(n && n.text, 600) }))
    .filter((n) => n.title || n.text);
}

function cleanLauncher(b) {
  const version = text(b && b.version, 20);
  const minVersion = text(b && b.minVersion, 20);
  const url = text(b && b.url, 500);
  if (version && !VERSION_RE.test(version)) throw new Error('La versión debe ser tipo 1.4.0.');
  if (minVersion && !VERSION_RE.test(minVersion)) throw new Error('La versión mínima debe ser tipo 1.4.0.');
  if (url && !/^https:\/\//i.test(url)) throw new Error('El enlace debe empezar por https://');
  return { version, url, minVersion, notes: text(b && b.notes, 300) };
}

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

      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'news.json') {
        const news = await env.SKINS.get('cfg:news', 'json');
        return json({ news: news || null }, 200, { 'cache-control': 'public, max-age=30' });
      }
      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'launcher.json') {
        const l = await env.SKINS.get('cfg:launcher', 'json');
        return json(l || {}, 200, { 'cache-control': 'public, max-age=30' });
      }
      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'admin') {
        return new Response(ADMIN_HTML, { headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
          'x-frame-options': 'DENY', 'cache-control': 'no-store' } });
      }
      if (parts[0] === 'api' && parts[1] === 'admin') {
        if (!env.ADMIN_TOKEN) return json({ error: 'Falta configurar ADMIN_TOKEN en el Worker.' }, 503);
        if (!(await isAdmin(request, env))) return json({ error: 'Contraseña incorrecta.' }, 401);
        if (request.method === 'GET' && parts[2] === 'state') {
          return json({ news: (await env.SKINS.get('cfg:news', 'json')) || [], launcher: (await env.SKINS.get('cfg:launcher', 'json')) || {} });
        }
        if (request.method === 'PUT' && (parts[2] === 'news' || parts[2] === 'launcher')) {
          let body;
          try { body = await request.json(); } catch { return json({ error: 'JSON no válido.' }, 400); }
          try {
            if (parts[2] === 'news') await env.SKINS.put('cfg:news', JSON.stringify(cleanNews(body.news)));
            else await env.SKINS.put('cfg:launcher', JSON.stringify(cleanLauncher(body)));
          } catch (e) { return json({ error: e.message }, 400); }
          return json({ ok: true });
        }
      }

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

      if (request.method === 'DELETE' && parts.length === 2 && parts[0] === 'skin') {
        const name = parts[1];
        if (!NAME_RE.test(name)) return json({ error: 'Nombre no válido.' }, 400);
        const token = request.headers.get('x-skin-token') || '';
        if (token.length < 16 || token.length > 128) return json({ error: 'Falta el token.' }, 401);
        const key = `skin:${name.toLowerCase()}`;
        const old = await env.SKINS.get(key, 'json');
        if (!old) return json({ ok: true });
        if (old.tokenHash !== (await sha256(new TextEncoder().encode(token)))) {
          return json({ error: 'Ese nombre ya tiene una skin puesta desde otro ordenador.' }, 403);
        }
        await env.SKINS.delete(key);
        return json({ ok: true });
      }

      if (request.method === 'POST' && parts.length === 2 && parts[0] === 'skin') {
        const name = parts[1];
        if (!NAME_RE.test(name) || ['news', 'launcher', 'admin'].includes(name.toLowerCase())) return json({ error: 'Nombre no válido.' }, 400);
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
