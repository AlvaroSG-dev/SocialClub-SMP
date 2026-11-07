// Panel de administración (HTML estático). No contiene ningún secreto: la contraseña la escribes tú al entrar.
export const ADMIN_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel del launcher</title>
<style>
:root{color-scheme:dark;--bg:#171021;--card:#22172f;--line:#4a3a5c;--text:#fdf1f7;--muted:#c4abd1;--accent:#f7a8c8;--ink:#3a1230;--ok:#7ee0a5;--bad:#ff7a8c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif;padding:24px 16px}
main{max-width:760px;margin:0 auto;display:grid;gap:18px}h1{margin:0;font-size:24px;color:var(--accent)}h2{margin:0 0 10px;font-size:17px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
input,textarea{width:100%;background:#120b1b;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:9px 10px;font:inherit}
textarea{min-height:70px;resize:vertical}
button{background:var(--accent);color:var(--ink);border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}button.danger{background:transparent;color:var(--bad);border:1px solid var(--bad)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}.item{border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px}
.msg{min-height:20px;font-size:13px}.ok{color:var(--ok)}.bad{color:var(--bad)}.hint{font-size:13px;color:var(--muted);margin:0 0 8px}
</style></head><body><main>
<h1>Panel del launcher</h1>
<section id="login"><h2>Entrar</h2><label for="pw">Contraseña de administrador</label><input id="pw" type="password" autocomplete="current-password">
<div class="row"><button id="enter">Entrar</button><span class="msg" id="login-msg"></span></div></section>
<div id="panel" hidden>
<section><h2>Novedades</h2><p class="hint">Se muestran a todos los jugadores al abrir el launcher (el primero es el más reciente).</p>
<div id="news"></div><div class="row"><button class="ghost" id="add">+ Añadir mensaje</button><button id="save-news">Guardar novedades</button><span class="msg" id="news-msg"></span></div></section>
<section><h2>Actualización del launcher</h2><p class="hint">Cuando subas un instalador nuevo, pon aquí su versión y el enlace de descarga. A los jugadores con una versión anterior les saldrá el aviso.</p>
<label for="ver">Última versión (ej. 1.4.0)</label><input id="ver" placeholder="1.4.0">
<label for="url">Enlace de descarga (https)</label><input id="url" placeholder="https://github.com/.../releases/download/...">
<label for="notes">Qué hay de nuevo (opcional)</label><textarea id="notes"></textarea>
<label for="min">Versión mínima para jugar (opcional: quien tenga una menor no podrá jugar hasta actualizar)</label><input id="min" placeholder="">
<div class="row"><button id="save-launcher">Guardar actualización</button><span class="msg" id="launcher-msg"></span></div></section>
</div></main>
<script>
const $=(i)=>document.getElementById(i);let token='';
const api=async(method,path,body)=>{const r=await fetch(path,{method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('Error '+r.status));return j;};
const say=(id,t,ok)=>{const e=$(id);e.textContent=t||'';e.className='msg '+(t?(ok?'ok':'bad'):'');};
function addItem(n){const d=document.createElement('div');d.className='item';
for(const [k,l,ta] of [['title','Título'],['date','Fecha (ej. 2026-11-07)'],['text','Mensaje',true]]){
const lab=document.createElement('label');lab.textContent=l;const f=document.createElement(ta?'textarea':'input');f.dataset.k=k;f.value=(n&&n[k])||'';
if(k==='title')f.maxLength=80;if(k==='text')f.maxLength=600;d.append(lab,f);}
const row=document.createElement('div');row.className='row';
const up=document.createElement('button');up.className='ghost';up.textContent='Subir';up.onclick=()=>{if(d.previousElementSibling)d.parentNode.insertBefore(d,d.previousElementSibling)};
const del=document.createElement('button');del.className='danger';del.textContent='Borrar';del.onclick=()=>d.remove();
row.append(up,del);d.append(row);$('news').append(d);}
const readNews=()=>[...$('news').children].map(d=>({title:d.querySelector('[data-k=title]').value.trim(),date:d.querySelector('[data-k=date]').value.trim(),text:d.querySelector('[data-k=text]').value.trim()}));
async function load(){const s=await api('GET','/api/admin/state');$('news').textContent='';(s.news||[]).forEach(addItem);
const l=s.launcher||{};$('ver').value=l.version||'';$('url').value=l.url||'';$('notes').value=l.notes||'';$('min').value=l.minVersion||'';}
async function enter(){token=$('pw').value;try{await load();$('login').hidden=true;$('panel').hidden=false;try{sessionStorage.setItem('t',token)}catch(e){}}catch(e){say('login-msg',e.message,false)}}
$('enter').onclick=enter;$('pw').addEventListener('keydown',e=>{if(e.key==='Enter')enter()});
$('add').onclick=()=>addItem({date:new Date().toISOString().slice(0,10)});
$('save-news').onclick=async()=>{try{await api('PUT','/api/admin/news',{news:readNews()});say('news-msg','Guardado. Los jugadores lo verán al abrir el launcher.',true)}catch(e){say('news-msg',e.message,false)}};
$('save-launcher').onclick=async()=>{try{await api('PUT','/api/admin/launcher',{version:$('ver').value.trim(),url:$('url').value.trim(),notes:$('notes').value.trim(),minVersion:$('min').value.trim()});say('launcher-msg','Guardado.',true)}catch(e){say('launcher-msg',e.message,false)}};
try{const t=sessionStorage.getItem('t');if(t){$('pw').value=t;enter()}}catch(e){}
</script></body></html>`;
