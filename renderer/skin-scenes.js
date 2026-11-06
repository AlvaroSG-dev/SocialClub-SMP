'use strict';
/**
 * Escenas de fondo para el visor de skins, dibujadas por código en estilo pixel-art
 * (obra propia: no se usa ninguna imagen de Mojang). Cada escena se genera a baja resolución
 * y se amplía sin suavizado para que los píxeles se vean nítidos.
 *   SkinScenes.make(kind, ancho, alto) -> HTMLCanvasElement
 */
(() => {
  const PX = 4; // tamaño de cada "píxel" de la escena

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const THEMES = {
    cerezal: {
      seed: 11, sky: ['#2a1745', '#7a3f7e', '#e79cb8'], glow: { x: 0.5, y: 0.78, c: '255, 220, 190' },
      hills: ['#6a3a6e', '#8c4d83'], ground: '#2a1830', edge: '#f3b9d3', speck: ['#f7a8c8', '#ffd6e8', '#e98bb4'],
      leaves: ['#f7a8c8', '#e98bb4', '#f3b9d3', '#ffd0e3', '#c98e9c'], trunk: '#2b1a2f', stars: true,
    },
    pradera: {
      seed: 23, sky: ['#4f98e4', '#86c0f2', '#d4ebfb'], hills: ['#76b44c', '#5f9d3e'], ground: '#4e8f3a', edge: '#7cc152',
      speck: ['#3f7d2c', '#6fae48'], leaves: ['#3f7d2c', '#2f6a22', '#4b8f33', '#58a03c'], trunk: '#5b3f26', clouds: true,
    },
    noche: {
      seed: 37, sky: ['#070b1f', '#141a3f', '#2a2f63'], hills: ['#222c4a', '#1a2340'], ground: '#1d2a24', edge: '#2f4a3c',
      speck: ['#26382f', '#34503f'], leaves: ['#1f4a3a', '#183d30', '#255a45'], trunk: '#2a1f1a', stars: true, moon: true,
    },
  };

  function blob(g, rand, cx, cy, r, colors) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = (x * x) / (r * r) + (y * y) / (r * r * 0.85);
        if (d > 1 || rand() < 0.08 + d * 0.22) continue;
        const shade = Math.min(colors.length - 1, Math.floor(((y + r) / (2 * r)) * colors.length * (0.7 + rand() * 0.6)));
        g.fillStyle = colors[colors.length - 1 - shade];
        g.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }

  function tree(g, rand, th, cx, groundY, scale) {
    const trunkH = Math.round(22 * scale);
    const trunkW = Math.max(2, Math.round(3 * scale));
    g.fillStyle = th.trunk;
    g.fillRect(cx - (trunkW >> 1), groundY - trunkH, trunkW, trunkH);
    const top = groundY - trunkH;
    for (let i = 0; i < 6; i++) {
      blob(g, rand, cx + Math.round((rand() - 0.5) * 22 * scale), top + Math.round((rand() - 0.7) * 12 * scale), Math.round((7 + rand() * 6) * scale), th.leaves);
    }
  }

  function gradientScene(W, H, stops) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    stops.forEach(([o, col]) => grad.addColorStop(o, col));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    return c;
  }

  function make(kind, W, H) {
    if (kind === 'claro') return gradientScene(W, H, [[0, '#f4effa'], [0.7, '#e3dcee'], [1, '#cfc6de']]);
    const th = THEMES[kind] || THEMES.cerezal;
    const w = Math.ceil(W / PX), h = Math.ceil(H / PX);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const rand = rng(th.seed);

    // cielo
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, th.sky[0]); sky.addColorStop(0.5, th.sky[1]); sky.addColorStop(1, th.sky[2]);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    if (th.glow) {
      const r = g.createRadialGradient(w * th.glow.x, h * th.glow.y, 2, w * th.glow.x, h * th.glow.y, h * 0.55);
      r.addColorStop(0, `rgba(${th.glow.c}, .6)`); r.addColorStop(0.45, 'rgba(247,168,200,.2)'); r.addColorStop(1, 'rgba(247,168,200,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }
    if (th.stars) {
      for (let i = 0; i < 38; i++) { g.fillStyle = `rgba(255,240,248,${(0.35 + rand() * 0.6).toFixed(2)})`; g.fillRect(Math.floor(rand() * w), Math.floor(rand() * h * 0.5), 1, 1); }
    }
    if (th.moon) {
      g.fillStyle = '#f4f0d8'; g.beginPath(); g.arc(w * 0.78, h * 0.15, 8, 0, 6.3); g.fill();
      g.fillStyle = '#d9d3b0'; g.fillRect(Math.round(w * 0.78) - 3, Math.round(h * 0.15) - 2, 3, 2); g.fillRect(Math.round(w * 0.78) + 2, Math.round(h * 0.15) + 2, 2, 2);
    }
    if (th.clouds) {
      for (let i = 0; i < 4; i++) {
        const cx = Math.floor(rand() * w * 0.9), cy = Math.floor(h * (0.08 + rand() * 0.22)), len = 14 + Math.floor(rand() * 16);
        g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(cx, cy, len, 3); g.fillRect(cx + 3, cy - 2, len - 8, 2);
        g.fillStyle = 'rgba(214,230,246,.9)'; g.fillRect(cx, cy + 3, len, 1);
      }
    }

    // colinas en dos planos
    th.hills.forEach((col, i) => {
      const base = h * (0.64 + i * 0.09), amp = 4 + i * 2, ph = rand() * 6;
      g.fillStyle = col;
      for (let x = 0; x < w; x++) {
        const y = Math.round(base + Math.sin(x * 0.07 + ph) * amp + Math.sin(x * 0.19 + ph * 2) * 1.5);
        g.fillRect(x, y, 1, h - y);
      }
    });

    // suelo
    const gy = Math.round(h * 0.86);
    g.fillStyle = th.ground; g.fillRect(0, gy, w, h - gy);
    g.fillStyle = th.edge; g.fillRect(0, gy, w, 1);
    for (let i = 0; i < w * 1.2; i++) {
      g.fillStyle = th.speck[Math.floor(rand() * th.speck.length)];
      g.fillRect(Math.floor(rand() * w), gy + 1 + Math.floor(rand() * (h - gy - 1)), 1 + (rand() < 0.25 ? 1 : 0), 1);
    }

    // árboles en los laterales (el centro queda libre para el personaje)
    tree(g, rand, th, Math.round(w * 0.08), gy + 1, 1.1);
    tree(g, rand, th, Math.round(w * 0.2), gy, 0.75);
    tree(g, rand, th, Math.round(w * 0.9), gy + 1, 1.0);
    tree(g, rand, th, Math.round(w * 0.8), gy, 0.7);

    // ampliar sin suavizar
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const o = out.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.drawImage(c, 0, 0, w, h, 0, 0, w * PX, h * PX);
    return out;
  }

  window.SkinScenes = { make, kinds: ['cerezal', 'pradera', 'noche', 'claro'] };
})();
