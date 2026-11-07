'use strict';
const $ = (id) => document.getElementById(id);

const el = {
  brand: $('brand-name'), serverName: $('server-name'), serverMeta: $('server-meta'),
  dot: $('dot'), statusText: $('status-text'), news: $('news-list'),
  username: $('username'), ram: $('ram'), ramLabel: $('ram-label'),
  play: $('play'), stage: $('stage'), fill: $('fill'), log: $('log'),
  tabOffline: $('tab-offline'), tabMicrosoft: $('tab-microsoft'),
  paneOffline: $('pane-offline'), paneMicrosoft: $('pane-microsoft'),
  msName: $('ms-name'), msLogin: $('ms-login'), msLogout: $('ms-logout'),
  codeModal: $('code-modal'), msCode: $('ms-code'),
  skinModal: $('skin-modal'), skinCanvas: $('skin-canvas'), skinPlay: $('skin-play'), skinModelLabel: $('skin-model-label'),
  bgBtn: $('bg-btn'), bgMenu: $('bg-menu'), skinFile: $('skin-file'),
  skinVariant: $('skin-variant'), skinUpload: $('skin-upload'), skinMsg: $('skin-msg'),
  skinCmd: $('skin-cmd'),
  updBar: $('update-bar'), updText: $('update-text'), updBtn: $('update-btn'),
};

const state = { hasSaved: false, skinServer: false, accountType: 'offline', msName: '', busy: false, skinPicked: false, skinPlaying: false };

function appendLog(text) {
  el.log.textContent += text + '\n';
  if (el.log.textContent.length > 60000) el.log.textContent = el.log.textContent.slice(-40000);
  el.log.scrollTop = el.log.scrollHeight;
}

function setProgress(value) {
  if (value < 0) {
    el.fill.classList.add('indeterminate');
    el.fill.style.width = '';
  } else {
    el.fill.classList.remove('indeterminate');
    el.fill.style.width = `${Math.round(Math.min(value, 1) * 100)}%`;
  }
}

/** Refleja el estado (cuenta, ocupado) en todos los controles. */
function render() {
  const ms = state.accountType === 'microsoft';
  el.tabOffline.classList.toggle('active', !ms);
  el.tabMicrosoft.classList.toggle('active', ms);
  el.paneOffline.hidden = ms;
  el.paneMicrosoft.hidden = !ms;

  const logged = Boolean(state.msName);
  el.msName.textContent = logged ? state.msName : 'Sin sesión iniciada';
  el.msLogin.hidden = logged;
  el.msLogout.hidden = !logged;

  const lock = state.busy;
  el.play.disabled = lock || (ms && !logged);
  el.username.disabled = lock;
  el.ram.disabled = lock;
  el.tabOffline.disabled = lock;
  el.tabMicrosoft.disabled = lock;
  el.msLogin.disabled = lock;
  el.msLogout.disabled = lock;
  const nameOk = /^[A-Za-z0-9_]{3,16}$/.test(el.username.value.trim());
  el.skinUpload.disabled = !((ms ? state.skinPicked : true) && (ms ? logged : state.skinServer && nameOk && (state.skinPicked || state.hasSaved))) || lock;
  el.skinUpload.textContent = ms ? 'Subir a mi cuenta' : 'Aplicar mi skin';
  $('skin-sec-ms').hidden = !ms;
  $('skin-sec-cmd').hidden = ms || state.skinServer;
  $('skin-sec-off').hidden = ms || !state.skinServer;
}

async function refreshStatus() {
  const s = await window.launcher.status();
  el.dot.className = `dot ${s.online ? 'on' : 'off'}`;
  el.statusText.textContent = s.online ? `En línea · ${s.players}/${s.max} jugadores` : 'Servidor sin conexión';
}

function renderNews(items) {
  el.news.textContent = '';
  for (const n of items) {
    const box = document.createElement('div');
    box.className = 'news-item';
    const h = document.createElement('h4'); h.textContent = n.title;
    const d = document.createElement('small'); d.textContent = n.date || '';
    const p = document.createElement('p'); p.textContent = n.text;
    box.append(h, d, p);
    el.news.append(box);
  }
}

function setSkinMsg(text, kind) {
  el.skinMsg.textContent = text || '';
  el.skinMsg.className = `note ${kind || ''}`;
}

async function main() {
  const { config, settings } = await window.launcher.init();
  document.title = config.launcherName;
  el.brand.textContent = config.launcherName;
  el.serverName.textContent = config.server.name;
  el.serverMeta.textContent = `Minecraft ${config.minecraftVersion} · NeoForge ${config.neoforgeVersion}`;
  el.username.value = settings.username;
  el.ram.value = settings.ramMb;
  el.ramLabel.textContent = `${el.ram.value} MB`;
  el.skinCmd.textContent = config.skinCommand;
  state.skinServer = config.skinServer;
  state.hasSaved = config.hasSavedSkin;
  state.accountType = settings.accountType;
  state.msName = settings.msName;
  renderNews(config.news);
  render();

  el.username.addEventListener('input', render);
  el.ram.addEventListener('input', () => (el.ramLabel.textContent = `${el.ram.value} MB`));
  $('open-folder').addEventListener('click', () => window.launcher.openFolder());

  // --- cuentas ---
  el.tabOffline.addEventListener('click', () => { state.accountType = 'offline'; render(); });
  el.tabMicrosoft.addEventListener('click', () => { state.accountType = 'microsoft'; render(); });

  el.msLogin.addEventListener('click', async () => {
    state.busy = true; render();
    el.msLogin.textContent = 'Esperando…';
    const res = await window.launcher.msLogin();
    el.msLogin.textContent = 'Iniciar sesión';
    state.busy = false;
    if (res.ok) state.msName = res.name;
    else appendLog(`Microsoft: ${res.error}`);
    el.stage.textContent = res.ok ? `Sesión iniciada: ${res.name}` : res.error;
    render();
  });

  el.msLogout.addEventListener('click', async () => {
    await window.launcher.msLogout();
    state.msName = '';
    render();
    if (!el.skinModal.hidden) refreshSkinPreview();
  });

  window.launcher.onMsCode((data) => {
    el.codeModal.hidden = !data;
    if (data) el.msCode.textContent = data.code || '----';
  });

  // --- skins ---
  const BG_KEY = 'launcher.skinBg';
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  let skinView = null; // el visor 3D se crea la primera vez que se abre el panel
  const modelLabel = (v) => (v === 'slim' ? 'Brazos finos (Alex)' : 'Brazos anchos (Steve)');

  function syncModel(variant) {
    el.skinVariant.value = variant;
    el.skinModelLabel.textContent = modelLabel(variant);
    if (skinView) skinView.setModel(variant);
  }

  function chooseBackground(kind) {
    el.bgMenu.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('active', b.dataset.bg === kind));
    store.set(BG_KEY, kind);
    if (skinView) skinView.setBackground(kind);
  }

  function ensureSkinView() {
    if (skinView) return skinView;
    try {
      skinView = window.SkinView.create(el.skinCanvas);
      chooseBackground(store.get(BG_KEY) || 'cerezal');
    } catch (e) {
      setSkinMsg(`No se pudo iniciar el visor 3D: ${e.message}`, 'bad');
    }
    return skinView;
  }

  // Muestra la skin que corresponde a la cuenta/nombre actual (si no hay un PNG recién elegido).
  let refreshSeq = 0;
  async function refreshSkinPreview() {
    const view = ensureSkinView();
    if (!view || state.skinPicked) return;
    const seq = ++refreshSeq;
    const offline = state.accountType === 'offline';
    const name = el.username.value.trim();
    let cur = { ok: false };
    if (offline || state.msName) cur = await window.launcher.skinCurrent({ accountType: state.accountType, username: name });
    let note = '';
    if (!cur.ok && offline && state.hasSaved) {
      cur = await window.launcher.skinSaved();
      note = `«${name || 'tu nombre'}» aún no tiene skin en el servidor: pulsa Aplicar para ponerle esta.`;
    }
    if (seq !== refreshSeq || state.skinPicked) return;
    if (!cur.ok) {
      view.clear(); // sin skin: Steve/Alex, no la que se estaba mostrando antes
      el.skinFile.textContent = 'Ningún archivo (64x64)';
    } else {
      syncModel(cur.variant === 'slim' ? 'slim' : 'classic');
      view.show(cur.dataUrl, el.skinVariant.value);
      el.skinFile.textContent = note ? 'Tu última skin guardada' : (offline ? 'Skin actual en el servidor' : 'Skin actual de tu cuenta');
    }
    setSkinMsg(note, '');
  }

  $('open-skins').addEventListener('click', () => {
    el.skinModal.hidden = false;
    const view = ensureSkinView();
    if (view) view.pause(false);
    refreshSkinPreview();
  });
  let nameTimer = 0;
  el.username.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => { if (!el.skinModal.hidden) refreshSkinPreview(); }, 400);
  });
  el.tabOffline.addEventListener('click', () => { if (!el.skinModal.hidden) refreshSkinPreview(); });
  el.tabMicrosoft.addEventListener('click', () => { if (!el.skinModal.hidden) refreshSkinPreview(); });
  $('skin-close').addEventListener('click', () => {
    el.skinModal.hidden = true;
    el.bgMenu.hidden = true;
    if (skinView) skinView.pause(true); // no gastar GPU con el panel cerrado
  });

  // reproducir / pausar la animación de caminar
  el.skinPlay.addEventListener('click', () => {
    state.skinPlaying = !state.skinPlaying;
    el.skinPlay.classList.toggle('on', state.skinPlaying);
    el.skinPlay.setAttribute('aria-pressed', String(state.skinPlaying));
    if (skinView) skinView.setPlaying(state.skinPlaying);
  });

  // selector de fondo
  el.bgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.bgMenu.hidden = !el.bgMenu.hidden;
    el.bgBtn.setAttribute('aria-expanded', String(!el.bgMenu.hidden));
  });
  el.bgMenu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-bg]');
    if (!item) return;
    chooseBackground(item.dataset.bg);
    el.bgMenu.hidden = true;
  });
  document.addEventListener('click', () => { el.bgMenu.hidden = true; });

  // vistas: frente / 3/4 / lado / espalda
  document.querySelectorAll('#skin-views [data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#skin-views [data-view]').forEach((b) => b.classList.toggle('active', b === btn));
      if (skinView) skinView.setView(btn.dataset.view);
    });
  });

  el.skinVariant.addEventListener('change', () => syncModel(el.skinVariant.value));
  $('skin-copy').addEventListener('click', () => window.launcher.copy(config.skinCommand));

  $('skin-pick').addEventListener('click', async () => {
    const res = await window.launcher.skinPick();
    if (res.canceled) return;
    if (!res.ok) {
      state.skinPicked = false;
      el.skinFile.textContent = 'Ningún archivo (64x64)';
      setSkinMsg(res.error, 'bad');
    } else {
      state.skinPicked = true;
      el.skinFile.textContent = res.name;
      setSkinMsg('');
      const view = ensureSkinView();
      const variant = await window.SkinView.detectModel(res.dataUrl); // brazos finos o anchos, automático
      syncModel(variant);
      if (view) view.show(res.dataUrl, variant); // vista previa 3D del PNG elegido
    }
    render();
  });

  el.skinUpload.addEventListener('click', async () => {
    state.busy = true; render();
    setSkinMsg('Subiendo…');
    const res = await window.launcher.skinUpload({ variant: el.skinVariant.value, accountType: state.accountType, username: el.username.value.trim() });
    state.busy = false;
    if (res.ok && state.accountType === 'offline') { state.hasSaved = true; state.skinPicked = false; }
    setSkinMsg(res.ok ? (state.accountType === 'offline' ? '¡Listo! Entra al servidor y se verá (los demás la ven al reconectar).' : '¡Listo! Tu skin se actualizará en unos minutos.') : res.error, res.ok ? 'good' : 'bad');
    render();
  });

  // --- progreso del juego ---
  window.launcher.onLog(appendLog);
  window.launcher.onStage((name) => (el.stage.textContent = name));
  window.launcher.onProgress(setProgress);
  window.launcher.onState((s) => {
    const running = s === 'running';
    state.busy = running;
    el.play.textContent = running ? 'JUGANDO' : 'JUGAR';
    el.stage.textContent = running ? 'Minecraft en ejecución' : ' ';
    setProgress(0); // al abrirse el juego la barra deja de animarse
    render();
  });

  el.play.addEventListener('click', async () => {
    state.busy = true; render();
    el.play.textContent = 'PREPARANDO…';
    const res = await window.launcher.play({
      accountType: state.accountType,
      username: el.username.value.trim(),
      ramMb: Number(el.ram.value),
    });
    if (!res.ok) {
      appendLog(res.error);
      el.stage.textContent = res.error;
      el.play.textContent = 'JUGAR';
      state.busy = false;
      render();
    }
  });

  // --- novedades y actualizaciones (se consultan al abrir y cada pocos minutos) ---
  async function refreshNews() {
    const items = await window.launcher.news();
    if (items) renderNews(items);
  }
  async function refreshUpdate() {
    const u = await window.launcher.updateCheck();
    el.updBar.hidden = !u.available;
    if (!u.available) return;
    el.updBar.classList.toggle('required', Boolean(u.required));
    el.updText.textContent = u.required
      ? `Hay que actualizar a la versión ${u.version} para poder jugar.`
      : `Actualización disponible: versión ${u.version}.${u.notes ? ' ' + u.notes : ''}`;
    el.updBtn.hidden = !u.canOpen;
  }
  el.updBtn.addEventListener('click', () => window.launcher.updateOpen());
  refreshNews();
  refreshUpdate();
  setInterval(refreshNews, 5 * 60 * 1000);
  setInterval(refreshUpdate, 30 * 60 * 1000);

  refreshStatus();
  setInterval(refreshStatus, 30000);
}

main();
