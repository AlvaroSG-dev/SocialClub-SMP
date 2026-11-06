'use strict';
/**
 * Fondo animado: atardecer en un cerezal de píxeles con pétalos cayendo.
 * Se dibuja a baja resolución (cada "píxel" mide PIXEL px reales) para mantener el estilo
 * Minecraft y gastar muy poca CPU. Se pausa si la ventana no se ve y respeta
 * "reducir movimiento" del sistema (en ese caso dibuja un solo fotograma).
 */
(() => {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  const PIXEL = 3;
  const PETALS = ['#ffd6e8', '#f7a8c8', '#f3b9d3', '#e98bb4', '#fbe3ee'];
  const BLOSSOM = ['#f7a8c8', '#e98bb4', '#f3b9d3', '#d77aa3', '#ffd0e3', '#c98e9c'];

  // Aleatorio con semilla: los árboles quedan siempre igual al redimensionar.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let w = 0, h = 0, scenery = null, petals = [], stars = [];

  function drawTree(g, rand, cx, groundY, scale) {
    const trunkH = Math.round(h * 0.34 * scale);
    const trunkW = Math.max(3, Math.round(4 * scale));
    // tronco (ligeramente inclinado) y ramas
    g.fillStyle = '#2b1a2f';
    for (let i = 0; i < trunkH; i++) {
      const bend = Math.round(Math.sin(i / 14) * 2 * scale);
      g.fillRect(cx - (trunkW >> 1) + bend, groundY - i, trunkW, 1);
    }
    const crownY = groundY - trunkH;
    for (let b = 0; b < 4; b++) {
      const dir = b % 2 ? 1 : -1;
      const len = Math.round((10 + rand() * 16) * scale);
      for (let i = 0; i < len; i++) g.fillRect(cx + dir * i, crownY + Math.round(i * 0.5) + b * 3, 2, 1);
    }
    // copa: varios racimos de flores en píxeles, más claros arriba
    const blobs = 9;
    for (let b = 0; b < blobs; b++) {
      const bx = cx + Math.round((rand() - 0.5) * 70 * scale);
      const by = crownY + Math.round((rand() - 0.6) * 38 * scale);
      const r = Math.round((12 + rand() * 12) * scale);
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          const d = (x * x) / (r * r) + (y * y) / (r * r * 0.8);
          if (d > 1 || rand() < 0.1 + d * 0.25) continue;
          const light = Math.max(0, Math.min(BLOSSOM.length - 1, Math.floor(((y + r) / (2 * r)) * BLOSSOM.length * (0.7 + rand() * 0.6))));
          g.fillStyle = BLOSSOM[BLOSSOM.length - 1 - light] || BLOSSOM[0];
          g.fillRect(bx + x, by + y, 1, 1);
        }
      }
    }
  }

  function buildScenery() {
    scenery = document.createElement('canvas');
    scenery.width = w;
    scenery.height = h;
    const g = scenery.getContext('2d');
    const rand = rng(20261106);
    const ground = Math.round(h * 0.92);

    // árboles lejanos (más pequeños y apagados) y cercanos
    g.globalAlpha = 0.55;
    drawTree(g, rand, Math.round(w * 0.30), ground, 0.7);
    drawTree(g, rand, Math.round(w * 0.66), ground, 0.65);
    g.globalAlpha = 1;
    drawTree(g, rand, Math.round(w * 0.08), ground + 4, 1.15);
    drawTree(g, rand, Math.round(w * 0.9), ground + 4, 1.05);

    // suelo con pétalos caídos
    g.fillStyle = '#2a1830';
    g.fillRect(0, ground, w, h - ground);
    for (let i = 0; i < w * 0.9; i++) {
      g.fillStyle = PETALS[Math.floor(rand() * PETALS.length)];
      g.fillRect(Math.floor(rand() * w), ground + Math.floor(rand() * (h - ground)), 1 + (rand() < 0.3 ? 1 : 0), 1);
    }
  }

  function spawnPetal(initial) {
    const depth = Math.random(); // 0 = lejos, 1 = cerca
    return {
      x: Math.random() * (w + 40) - 20,
      y: initial ? Math.random() * h : -4 - Math.random() * 20,
      depth,
      size: depth > 0.7 ? 2 : 1,
      vy: 5 + depth * 12,
      sway: 3 + depth * 6,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.8,
      color: PETALS[Math.floor(Math.random() * PETALS.length)],
    };
  }

  function resize() {
    w = Math.ceil(window.innerWidth / PIXEL);
    h = Math.ceil(window.innerHeight / PIXEL);
    canvas.width = w;
    canvas.height = h;
    buildScenery();
    const count = Math.min(90, Math.max(30, Math.round((w * h) / 1500)));
    petals = Array.from({ length: count }, () => spawnPetal(true));
    const rand = rng(7);
    stars = Array.from({ length: 36 }, () => ({ x: Math.floor(rand() * w), y: Math.floor(rand() * h * 0.45), p: rand() * 6.28 }));
  }

  function sky() {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#150e22');
    g.addColorStop(0.45, '#3a2152');
    g.addColorStop(0.78, '#9a4f7f');
    g.addColorStop(1, '#e79cb8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // resplandor del sol poniente
    const sx = w * 0.62, sy = h * 0.78;
    const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, h * 0.5);
    glow.addColorStop(0, 'rgba(255, 220, 190, .55)');
    glow.addColorStop(0.4, 'rgba(247, 168, 200, .22)');
    glow.addColorStop(1, 'rgba(247, 168, 200, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  let last = 0;
  function frame(now, still) {
    const t = now / 1000;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;

    sky();
    for (const s of stars) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.8 + s.p));
      ctx.fillStyle = `rgba(255, 235, 245, ${(a * 0.8).toFixed(2)})`;
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    ctx.drawImage(scenery, 0, 0);

    for (const p of petals) {
      if (!still) {
        p.y += p.vy * dt;
        p.x += (Math.sin(t * p.speed + p.phase) * p.sway + 4 + p.depth * 4) * dt;
        if (p.y > h * 0.93 || p.x > w + 20) Object.assign(p, spawnPetal(false), { x: Math.random() * w - 10 });
      }
      ctx.globalAlpha = 0.55 + p.depth * 0.45;
      ctx.fillStyle = p.color;
      const flip = Math.sin(t * 3 * p.speed + p.phase) > 0.3; // el pétalo "gira"
      ctx.fillRect(Math.round(p.x), Math.round(p.y), flip ? p.size + 1 : p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  function loop(now) {
    frame(now, false);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    cancelAnimationFrame(raf);
    if (reduce) frame(performance.now(), true);
    else raf = requestAnimationFrame(loop);
  }

  resize();
  start();
  window.addEventListener('resize', () => { resize(); if (reduce) start(); });
  document.addEventListener('visibilitychange', () => (document.hidden ? cancelAnimationFrame(raf) : start()));
})();
