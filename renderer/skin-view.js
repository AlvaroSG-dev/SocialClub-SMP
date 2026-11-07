'use strict';
/**
 * Visor 3D de skins tipo escaparate (skinview3d, incluido en ./vendor: funciona sin internet).
 *
 *   SkinView.create(canvas, {width, height}) -> {
 *     show(dataUrl, variant), setModel(variant), setPlaying(bool),
 *     setBackground(kind), setView('front'|'threeq'|'side'|'back'), pause(bool)
 *   }
 *   SkinView.detectModel(dataUrl) -> Promise<'classic'|'slim'>
 */
(() => {
  const VIEWS = { front: 0, threeq: 0.62, side: Math.PI / 2, back: Math.PI };

  /** Skin genérica ORIGINAL (maniquí) para cuando todavía no hay ninguna skin que mostrar. */
  function placeholderSkin() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const rect = (color, x, y, w, h) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
    const SKIN = '#d9b8cf', HAIR = '#5b3a6e', SHIRT = '#b98ad1', PANTS = '#4c3a78';
    rect(SKIN, 0, 0, 32, 16);
    rect(HAIR, 8, 0, 8, 8);
    rect(HAIR, 0, 8, 32, 3);
    rect(HAIR, 24, 8, 8, 8);
    rect(HAIR, 8, 8, 8, 2);
    rect('#2a1830', 10, 12, 1, 1);
    rect('#2a1830', 13, 12, 1, 1);
    rect(SHIRT, 16, 16, 24, 16);
    rect(SKIN, 40, 16, 16, 16);
    rect(SKIN, 32, 48, 16, 16);
    rect(PANTS, 0, 16, 16, 16);
    rect(PANTS, 16, 48, 16, 16);
    return c.toDataURL('image/png');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      img.src = src;
    });
  }

  /**
   * Deduce si la skin usa brazos finos (Alex/"slim") o anchos (Steve/"classic").
   * Las skins finas dejan transparentes las dos últimas columnas de cada brazo.
   */
  async function detectModel(dataUrl) {
    try {
      const img = await loadImage(dataUrl);
      if (img.width !== 64 || img.height !== 64) return 'classic';
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const transparent = (x, y, w, h) => {
        const d = g.getImageData(x, y, w, h).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
        return true;
      };
      return transparent(54, 20, 2, 12) && transparent(46, 52, 2, 12) ? 'slim' : 'classic';
    } catch {
      return 'classic';
    }
  }

  function create(canvas, { width = 360, height = 440 } = {}) {
    const sv = window.skinview3d;
    if (!sv) throw new Error('El visor 3D no se pudo cargar.');

    const viewer = new sv.SkinViewer({
      canvas, width, height,
      skin: placeholderSkin(), model: 'default',
      pixelRatio: 'match-device', // nítido en pantallas de alta densidad
    });
    viewer.fov = 34;
    viewer.zoom = 0.82;
    viewer.autoRotate = false;
    viewer.animation = null; // pose estática, como en un escaparate
    // Iluminación calibrada midiendo el resultado: los colores de la skin salen fieles (camiseta de
    // referencia 214,110,120 -> 220,114,124) y la luz de la cámara da volumen a los laterales.
    // Sin "decay" la luz no se apaga con la distancia (con el zoom/fov elegidos, la cámara queda lejos).
    viewer.cameraLight.decay = 0;
    viewer.globalLight.intensity = 1.2;
    viewer.cameraLight.intensity = 2.0;
    if (viewer.controls) viewer.controls.enabled = false; // el giro lo gestionamos nosotros (más estable)
    viewer.playerWrapper.rotation.y = VIEWS.threeq;

    // ---- giro con el ratón / dedo ----
    let angleTween = 0;
    let dragging = false;
    let lastX = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; cancelAnimationFrame(angleTween);
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      viewer.playerWrapper.rotation.y += (e.clientX - lastX) * 0.013;
      lastX = e.clientX;
    });
    const endDrag = () => { dragging = false; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    function setView(name) {
      const wrapper = viewer.playerWrapper;
      const target = VIEWS[name] ?? 0;
      // camino más corto hasta el ángulo destino
      let from = wrapper.rotation.y % (Math.PI * 2);
      let delta = ((target - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      cancelAnimationFrame(angleTween);
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 380);
        const ease = 1 - Math.pow(1 - k, 3);
        wrapper.rotation.y = from + delta * ease;
        if (k < 1) angleTween = requestAnimationFrame(step);
      };
      angleTween = requestAnimationFrame(step);
    }

    // ---- skin y modelo ----
    let current = null; // { dataUrl, variant }
    const modelOf = (v) => (v === 'slim' ? 'slim' : 'default');
    function apply() {
      const src = current ? current.dataUrl : placeholderSkin();
      const res = viewer.loadSkin(src, { model: modelOf(current ? current.variant : 'classic') });
      if (res && typeof res.catch === 'function') res.catch(() => {});
    }

    // ---- fondos ----
    const sceneCache = {};
    function setBackground(kind) {
      if (kind === 'transparente') { viewer.background = null; return; }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const key = `${kind}@${dpr}`;
      if (!sceneCache[key]) sceneCache[key] = window.SkinScenes.make(kind, Math.round(width * dpr), Math.round(height * dpr));
      viewer.loadBackground(sceneCache[key]);
    }

    return {
      show(dataUrl, variant) { current = { dataUrl, variant }; apply(); },
      clear() { current = null; apply(); },
      setModel(variant) { if (current) { current.variant = variant; apply(); } },
      setPlaying(on) { viewer.animation = on ? Object.assign(new sv.WalkingAnimation(), { speed: 0.7 }) : null; },
      setBackground,
      setView,
      pause(paused) { viewer.renderPaused = paused; },
    };
  }

  window.SkinView = { create, detectModel };
})();
