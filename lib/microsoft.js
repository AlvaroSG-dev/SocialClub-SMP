'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Login con cuenta Microsoft (premium) mediante "código de dispositivo":
 * el launcher muestra un código y abre microsoft.com/link; el jugador inicia sesión ahí.
 * Nunca vemos la contraseña. Los tokens se guardan cifrados por prismarine-auth en cacheDir
 * y las siguientes veces se renuevan solos, sin volver a pedir el código.
 */
function makeFlow({ cacheDir, clientId, onCode }) {
  const { Authflow, Titles } = require('prismarine-auth');
  fs.mkdirSync(cacheDir, { recursive: true });
  const options = clientId
    ? { flow: 'msal', authTitle: clientId } // tu propia app de Azure (aprobada por Mojang)
    : { flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' }; // funciona sin registrar nada
  return new Authflow('launcher', cacheDir, options, onCode);
}

/** Devuelve { token, uuid, name }. Lanza si la cuenta no tiene Minecraft Java. */
async function getMinecraftAuth({ cacheDir, clientId, onCode }) {
  const flow = makeFlow({ cacheDir, clientId, onCode });
  const res = await flow.getMinecraftJavaToken({ fetchProfile: true });
  if (!res || !res.profile || !res.profile.id) {
    throw new Error('Esta cuenta de Microsoft no tiene Minecraft Java Edition.');
  }
  return { token: res.token, uuid: res.profile.id, name: res.profile.name, skin: activeSkin(res.profile.skins) };
}

/** Skin activa del perfil de Minecraft: { url, variant: 'classic'|'slim' } o null. */
function activeSkin(skins) {
  if (!Array.isArray(skins) || skins.length === 0) return null;
  const s = skins.find((x) => x && x.state === 'ACTIVE') || skins[0];
  if (!s || !s.url) return null;
  return {
    url: String(s.url).replace(/^http:/i, 'https:'),
    variant: String(s.variant || '').toUpperCase() === 'SLIM' ? 'slim' : 'classic',
  };
}

/** ¿Hay una sesión guardada? (no garantiza que siga válida) */
function hasSession(cacheDir) {
  try {
    return fs.readdirSync(cacheDir).some((f) => f.endsWith('.json'));
  } catch {
    return false;
  }
}

function logout(cacheDir) {
  fs.rmSync(cacheDir, { recursive: true, force: true });
}

/** Solo permitimos abrir páginas https de Microsoft con el código. */
function linkUrl(resp) {
  const url = resp && resp.verification_uri ? String(resp.verification_uri) : '';
  if (/^https:\/\/([a-z0-9-]+\.)*(microsoft|live)\.com(\/|$)/i.test(url)) {
    return resp.user_code ? `https://www.microsoft.com/link?otc=${encodeURIComponent(resp.user_code)}` : url;
  }
  return 'https://www.microsoft.com/link';
}

module.exports = { getMinecraftAuth, activeSkin, hasSession, logout, linkUrl };
