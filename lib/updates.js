'use strict';
// Novedades y avisos de actualización. Se leen del mismo Worker de Cloudflare que las skins (panel /admin).
const base = (u) => String(u).replace(/\/+$/, '');

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 1 si a > b, -1 si a < b, 0 si iguales o no comparables. */
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

async function getJson(url, fetchImpl = fetch, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Lista de novedades válida, o null si el servidor todavía no tiene ninguna configurada. */
async function fetchNews({ apiUrl, fetchImpl }) {
  const j = await getJson(`${base(apiUrl)}/news.json`, fetchImpl);
  if (!Array.isArray(j.news)) return null;
  return j.news.slice(0, 20)
    .map((n) => ({ title: String((n && n.title) || '').slice(0, 80), date: String((n && n.date) || '').slice(0, 20), text: String((n && n.text) || '').slice(0, 600) }))
    .filter((n) => n.title || n.text);
}

async function checkUpdate({ apiUrl, current, fetchImpl }) {
  const j = await getJson(`${base(apiUrl)}/launcher.json`, fetchImpl);
  const version = String(j.version || '');
  if (!parseVersion(version)) return { available: false, required: false };
  const url = /^https:\/\//i.test(j.url || '') ? j.url : '';
  const required = Boolean(j.minVersion) && compareVersions(current, j.minVersion) < 0;
  return {
    available: compareVersions(version, current) > 0,
    required,
    version,
    url,
    notes: String(j.notes || '').slice(0, 300),
  };
}

module.exports = { compareVersions, fetchNews, checkUpdate };
