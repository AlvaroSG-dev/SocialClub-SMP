'use strict';
// Añade el servidor a la lista "Multijugador" del juego (servers.dat), sin tocar los que ya tenga el jugador.
// servers.dat es NBT sin comprimir. Solo se modifica si se puede reescribir idéntico (si no, no se toca).
const fs = require('fs');
const path = require('path');

const FIXED = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 };
const str = (s) => Buffer.from(String(s), 'utf8');

function readValue(buf, o, type) {
  if (FIXED[type]) return { value: Buffer.from(buf.subarray(o.i, (o.i += FIXED[type]))) };
  switch (type) {
    case 7: { const n = buf.readInt32BE(o.i); o.i += 4; return { value: Buffer.from(buf.subarray(o.i, (o.i += n))) }; }
    case 8: { const n = buf.readUInt16BE(o.i); o.i += 2; return { value: Buffer.from(buf.subarray(o.i, (o.i += n))) }; }
    case 9: {
      const itemType = buf.readUInt8(o.i); const n = buf.readInt32BE(o.i + 1); o.i += 5;
      const items = [];
      for (let k = 0; k < n; k++) items.push(readValue(buf, o, itemType).value);
      return { value: { itemType, items } };
    }
    case 10: {
      const entries = [];
      for (;;) {
        const t = buf.readUInt8(o.i++);
        if (t === 0) break;
        const nl = buf.readUInt16BE(o.i); o.i += 2;
        const name = Buffer.from(buf.subarray(o.i, (o.i += nl)));
        entries.push({ type: t, name, value: readValue(buf, o, t).value });
      }
      return { value: entries };
    }
    case 11: { const n = buf.readInt32BE(o.i); o.i += 4; return { value: Buffer.from(buf.subarray(o.i, (o.i += n * 4))) , count: n }; }
    case 12: { const n = buf.readInt32BE(o.i); o.i += 4; return { value: Buffer.from(buf.subarray(o.i, (o.i += n * 8))), count: n }; }
    default: throw new Error(`Etiqueta NBT desconocida: ${type}`);
  }
}

function parse(buf) {
  const o = { i: 0 };
  if (buf.readUInt8(o.i++) !== 10) throw new Error('No es un NBT de servidores.');
  const nl = buf.readUInt16BE(o.i); o.i += 2 + nl;
  const root = readValue(buf, o, 10).value;
  if (o.i !== buf.length) throw new Error('Datos sobrantes.');
  return { rootName: Buffer.from(buf.subarray(3, 3 + nl)), root };
}

function writeValue(parts, type, v) {
  if (FIXED[type]) return parts.push(v);
  switch (type) {
    case 7: case 11: case 12: {
      const n = type === 7 ? v.length : v.length / (type === 11 ? 4 : 8);
      const h = Buffer.alloc(4); h.writeInt32BE(n); parts.push(h, v); return;
    }
    case 8: { const h = Buffer.alloc(2); h.writeUInt16BE(v.length); parts.push(h, v); return; }
    case 9: {
      const h = Buffer.alloc(5); h.writeUInt8(v.itemType, 0); h.writeInt32BE(v.items.length, 1); parts.push(h);
      for (const it of v.items) writeValue(parts, v.itemType, it);
      return;
    }
    case 10: {
      for (const e of v) {
        const h = Buffer.alloc(3); h.writeUInt8(e.type, 0); h.writeUInt16BE(e.name.length, 1);
        parts.push(h, e.name); writeValue(parts, e.type, e.value);
      }
      parts.push(Buffer.from([0]));
      return;
    }
    default: throw new Error(`Etiqueta NBT desconocida: ${type}`);
  }
}

function serialize({ rootName, root }) {
  const h = Buffer.alloc(3); h.writeUInt8(10, 0); h.writeUInt16BE(rootName.length, 1);
  const parts = [h, rootName];
  writeValue(parts, 10, root);
  return Buffer.concat(parts);
}

const normIp = (ip) => String(ip).trim().toLowerCase().replace(/:25565$/, '');
const field = (entries, key) => entries.find((e) => e.name.toString('utf8') === key);
const newEntry = (name, ip) => [
  { type: 8, name: str('name'), value: str(name) },
  { type: 8, name: str('ip'), value: str(ip) },
];

/** Devuelve 'created' | 'added' | 'present' | 'skipped'. */
function ensureServer({ gameDir, name, host, port }) {
  const file = path.join(gameDir, 'servers.dat');
  const ip = port && Number(port) !== 25565 ? `${host}:${port}` : host;

  if (!fs.existsSync(file)) {
    const data = serialize({
      rootName: Buffer.alloc(0),
      root: [{ type: 9, name: str('servers'), value: { itemType: 10, items: [newEntry(name, ip)] } }],
    });
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(file, data);
    return 'created';
  }

  const orig = fs.readFileSync(file);
  let tree;
  try {
    tree = parse(orig);
    if (!serialize(tree).equals(orig)) return 'skipped'; // no lo entendemos al 100 %: no tocar
  } catch {
    return 'skipped';
  }

  let list = field(tree.root, 'servers');
  if (!list) {
    list = { type: 9, name: str('servers'), value: { itemType: 10, items: [] } };
    tree.root.push(list);
  }
  if (list.type !== 9) return 'skipped';
  if (list.value.itemType === 0) list.value.itemType = 10; // lista vacía
  if (list.value.itemType !== 10) return 'skipped';

  const want = normIp(ip);
  for (const item of list.value.items) {
    const f = field(item, 'ip');
    if (f && f.type === 8 && normIp(f.value.toString('utf8')) === want) return 'present';
  }
  list.value.items.push(newEntry(name, ip));
  fs.copyFileSync(file, `${file}.launcher-bak`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serialize(tree));
  fs.renameSync(tmp, file);
  return 'added';
}

module.exports = { ensureServer, parse, serialize };
