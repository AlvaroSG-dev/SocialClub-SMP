'use strict';
const crypto = require('crypto');

/** 3-16 caracteres: letras, números y guion bajo (igual que exige Minecraft). */
function validUsername(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(name);
}

/**
 * UUID idéntico al que calcula un servidor con online-mode=false:
 * UUID.nameUUIDFromBytes("OfflinePlayer:<nombre>".getBytes(UTF_8)) de Java.
 * Así el jugador conserva siempre su inventario y datos en el servidor.
 * Devuelve el UUID sin guiones (formato que espera el cliente).
 */
function offlineUuid(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // versión 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // variante IETF
  return hash.toString('hex');
}

function dashed(uuidHex) {
  return uuidHex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

/** Datos de sesión para un jugador sin cuenta premium. */
function offlineAuth(name) {
  return { name, uuid: offlineUuid(name), accessToken: '0', userType: 'legacy' };
}

module.exports = { validUsername, offlineUuid, offlineAuth, dashed };
