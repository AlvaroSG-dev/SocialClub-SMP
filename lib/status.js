'use strict';

/** Consulta el estado del servidor (jugadores conectados). Nunca lanza: devuelve online:false. */
async function getServerStatus(host, port) {
  try {
    const { status } = require('minecraft-server-util');
    const res = await status(host, port, { timeout: 4000 });
    return { online: true, players: res.players.online, max: res.players.max };
  } catch {
    return { online: false, players: 0, max: 0 };
  }
}

module.exports = { getServerStatus };
