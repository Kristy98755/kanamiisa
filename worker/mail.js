/**
 * Mail module — emulated mailbox web client.
 * Auth reuses the project's session system (validateSession / session= cookie in AUTH_KV).
 * Sending is NOT implemented yet. Receiving is stubbed (Cloudflare Email Routing -> mailEmail).
 */

import { validateSession } from './auth.js';

// ============================================================
// API
// ============================================================

function json(data, status = 200) {
  return Response.json(data, { status });
}

async function getState(env) {
  const inbox = await env.MAIL_DB.prepare("SELECT COUNT(*) c, COALESCE(SUM(1-read),0) u FROM emails WHERE folder='inbox'").first();
  const trash = await env.MAIL_DB.prepare("SELECT COUNT(*) c FROM emails WHERE folder='trash'").first();
  const aliases = await env.MAIL_DB.prepare(
    "SELECT recipient, COUNT(*) c, COALESCE(SUM(1-read),0) u FROM emails WHERE folder='inbox' GROUP BY recipient ORDER BY recipient"
  ).all();
  const total = await env.MAIL_DB.prepare("SELECT COUNT(*) c FROM emails").first();
  const starred = await env.MAIL_DB.prepare("SELECT COUNT(*) c FROM emails WHERE starred=1").first();
  return {
    folders: { inbox: inbox.c, inboxUnread: inbox.u, trash: trash.c },
    aliases: aliases.results,
    stats: { total: total.c, starred: starred.c },
  };
}

function snippet(body, n = 120) {
  const t = (body || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

async function listMessages(env, url) {
  const p = url.searchParams;
  const where = [];
  const binds = [];
  if (p.get("folder")) { where.push("folder = ?"); binds.push(p.get("folder")); }
  if (p.get("alias")) { where.push("recipient = ?"); binds.push(p.get("alias")); }
  if (p.get("unread") === "1") where.push("read = 0");
  if (p.get("starred") === "1") where.push("starred = 1");
  if (p.get("q")) {
    where.push("(sender LIKE ? OR subject LIKE ? OR body LIKE ?)");
    binds.push("%" + p.get("q") + "%", "%" + p.get("q") + "%", "%" + p.get("q") + "%");
  }
  const sql = "SELECT id, sender, recipient, subject, body, date, read, starred, replied, attachments FROM emails"
    + (where.length ? " WHERE " + where.join(" AND ") : "")
    + " ORDER BY id DESC";
  const { results } = await env.MAIL_DB.prepare(sql).bind(...binds).all();
  return results.map((m) => ({
    id: m.id, sender: m.sender, recipient: m.recipient, subject: m.subject,
    snippet: snippet(m.body), date: m.date, read: m.read, starred: m.starred,
    replied: m.replied, hasAttach: !!(m.attachments && m.attachments !== "[]" && m.attachments !== "null"),
  }));
}

async function setFlag(env, id, col, value) {
  await env.MAIL_DB.prepare(`UPDATE emails SET ${col} = ? WHERE id = ?`).bind(value, id).run();
  return json({ ok: true });
}

export async function handleMailApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/mail/api/state" && request.method === "GET") return json(await getState(env));

  if (path === "/mail/api/messages" && request.method === "GET") return json(await listMessages(env, url));

  let m;
  if ((m = path.match(/^\/mail\/api\/messages\/(\d+)$/)) && request.method === "GET") {
    const msg = await env.MAIL_DB.prepare("SELECT * FROM emails WHERE id = ?").bind(m[1]).first();
    if (!msg) return json({ error: "not found" }, 404);
    await env.MAIL_DB.prepare("UPDATE emails SET read = 1 WHERE id = ?").bind(m[1]).run();
    return json(msg);
  }
  if ((m = path.match(/^\/mail\/api\/messages\/(\d+)\/read$/)) && request.method === "POST") {
    const { value } = await request.json().catch(() => ({}));
    return setFlag(env, m[1], "read", value ? 1 : 0);
  }
  if ((m = path.match(/^\/mail\/api\/messages\/(\d+)\/star$/)) && request.method === "POST") {
    const { value } = await request.json().catch(() => ({}));
    return setFlag(env, m[1], "starred", value ? 1 : 0);
  }
  if ((m = path.match(/^\/mail\/api\/messages\/(\d+)\/delete$/)) && request.method === "POST") {
    await env.MAIL_DB.prepare("UPDATE emails SET folder = 'trash' WHERE id = ?").bind(m[1]).run();
    return json({ ok: true });
  }
  if (path === "/mail/api/bulk" && request.method === "POST") {
    const { ids, action } = await request.json();
    if (action === "delete") {
      for (const id of ids) {
        const row = await env.MAIL_DB.prepare("SELECT folder FROM emails WHERE id = ?").bind(id).first();
        if (!row) continue;
        if (row.folder === "trash") {
          await env.MAIL_DB.prepare("DELETE FROM emails WHERE id = ?").bind(id).run();
        } else {
          await env.MAIL_DB.prepare("UPDATE emails SET folder = 'trash' WHERE id = ?").bind(id).run();
        }
      }
      return json({ ok: true, count: ids.length });
    }
    const map = { read: ["read", 1], unread: ["read", 0], star: ["starred", 1], unstar: ["starred", 0] };
    const op = map[action];
    if (!op) return json({ error: "bad action" }, 400);
    for (const id of ids) await env.MAIL_DB.prepare(`UPDATE emails SET ${op[0]} = ? WHERE id = ?`).bind(op[1], id).run();
    return json({ ok: true, count: ids.length });
  }
  if (path === "/mail/api/clear" && request.method === "POST") {
    const { folder } = await request.json();
    await env.MAIL_DB.prepare("DELETE FROM emails WHERE folder = ?").bind(folder || "inbox").run();
    return json({ ok: true });
  }
  if (path === "/mail/api/seed" && request.method === "POST") return json(await seed(env));

  return json({ error: "not found" }, 404);
}

async function seed(env) {
  await env.MAIL_DB.prepare("DELETE FROM emails").run();
  const samples = [
    ["alice@example.com", "Вопрос по ценам", "Здравствуйте! Сколько стоит подписка? Уточните, пожалуйста.", 0, 1, 0, null],
    ["bob@example.org", "Баг при отправке формы", "Страница падает с ошибкой при сабмите. Скриншот во вложении.", 0, 0, 0, JSON.stringify([{ name: "error.png", size: 184320 }])],
    ["carol@example.net", "Сотрудничество", "Предлагаем совместный проект. Свяжитесь с нами.", 1, 0, 0, null],
    ["dave@example.com", "Счёт №1023", "Выставлен счёт на оплату. PDF во вложении.", 0, 1, 1, JSON.stringify([{ name: "invoice.pdf", size: 248000 }])],
    ["erin@example.io", "Отзыв", "Спасибо, всё отлично работает!", 1, 0, 0, null],
    ["frank@example.ru", "Спам-подозрение", "Это письмо выглядит как фишинг.", 0, 0, 0, null],
    ["grace@example.de", "Демо-запрос", "Хотим посмотреть демо вашего решения.", 0, 0, 0, null],
    ["heidi@example.fr", "Возврат", "Хочу оформить возврат заказа.", 1, 1, 0, null],
    ["ivan@example.pl", "Партнёрство", "Интересует партнёрская программа.", 0, 0, 0, null],
    ["judy@example.es", "Техподдержка", "Не могу войти в аккаунт после обновления.", 0, 1, 0, JSON.stringify([{ name: "logs.txt", size: 4096 }])],
    ["ken@example.it", "Поздравление", "С днём рождения вашего проекта!", 1, 0, 0, null],
    ["liam@example.ca", "Оптовый заказ", "Нужна партия товара, обсудим условия.", 0, 0, 0, null],
  ];
  const aliasPool = ["sales@kanamiisa.uk", "hello@kanamiisa.uk", "abc123@kanamiisa.uk", "support@kanamiisa.uk"];
  let i = 0;
  for (const [sender, subject, body, read, starred, replied, att] of samples) {
    const recipient = aliasPool[i % aliasPool.length];
    const daysAgo = Math.floor(i / 2);
    await env.MAIL_DB.prepare(
      "INSERT INTO emails (folder, sender, recipient, subject, body, attachments, date, read, starred, replied) VALUES ('inbox', ?, ?, ?, ?, ?, datetime('now', ?), ?, ?, ?)"
    ).bind(sender, recipient, subject, body, att, `-${daysAgo} days`, read, starred, replied).run();
    i++;
  }
  return { ok: true, inserted: samples.length };
}

// ============================================================
// Router (auth-gated by the project's session system)
// ============================================================

export async function mailFetch(request, env) {
  const session = await validateSession(request, env);
  const url = new URL(request.url);
  const isApi = url.pathname.startsWith("/mail/api/");

  if (!session) {
    if (isApi) return json({ error: "unauthorized" }, 401);
    return Response.redirect(new URL("/login?from=mail", request.url), 302);
  }

  if (!session.is_root) {
    if (isApi) return json({ error: "unauthorized" }, 401);
    return Response.redirect(new URL("/login?from=mail", request.url), 302);
  }

  if (url.pathname === "/mail" || url.pathname === "/mail/") {
    return new Response(MAIL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  if (isApi) return handleMailApi(request, env);
  return new Response("Not found", { status: 404 });
}

// Inbound email path — STUB. Real worker will store here via Cloudflare Email Routing.
export async function mailEmail(message, env, ctx) {
  const subject = message.headers.get("subject") || "(no subject)";
  console.log(`[mail] inbound email ${message.from} -> ${message.to}: ${subject}`);
  ctx.waitUntil(
    env.MAIL_DB.prepare(
      "INSERT INTO emails (sender, recipient, subject, body, date) VALUES (?, ?, ?, ?, datetime('now'))"
    ).bind(message.from, message.to, subject, "(raw body stored on real worker)").run()
  );
}

// ============================================================
// Web UI
// ============================================================

export const MAIL_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kanamiisa mail</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif; background:#0f1115; color:#e6e6e6; }
  header { padding:10px 16px; background:#171a21; border-bottom:1px solid #262b36; display:flex; gap:10px; align-items:center; }
   header b { font-size:16px; }
   .navlink { color:#cdd3dd; text-decoration:none; font-size:13px; padding:6px 10px; border-radius:8px; }
   .navlink:hover { background:#1b1f27; }
  .pill { font-size:11px; padding:1px 8px; border-radius:999px; background:#3a2a12; color:#ffcf8e; }
  .wrap { display:grid; grid-template-columns: 250px 380px 1fr; height: calc(100vh - 45px); }
  .col { overflow:auto; border-right:1px solid #262b36; }
  .col.view { border-right:0; padding:22px; }
  .side { padding:10px; }
  .side h4 { margin:14px 6px 6px; color:#7c8696; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  .nav { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer; }
  .nav:hover { background:#1b1f27; }
  .nav.active { background:#1d2840; }
  .nav .count { margin-left:auto; color:#9aa4b2; font-size:12px; }
  .nav .unread { background:#2563eb; color:#fff; border-radius:999px; padding:0 7px; font-size:11px; }
  .search { width:100%; padding:8px 10px; margin:6px 0; background:#0c0e13; color:#e6e6e6; border:1px solid #2a2f3a; border-radius:8px; }
  .side .btn { width:100%; margin-top:6px; }
  .toolbar { display:flex; gap:6px; padding:8px 10px; border-bottom:1px solid #262b36; align-items:center; flex-wrap:wrap; }
  .btn { background:#2563eb; color:#fff; border:0; padding:7px 12px; border-radius:8px; cursor:pointer; font-size:13px; }
  .btn.ghost { background:#222732; color:#cdd3dd; }
  .btn:disabled { opacity:.45; cursor:not-allowed; }
  .item { display:flex; gap:8px; padding:10px 12px; border-bottom:1px solid #1a1e26; cursor:pointer; align-items:flex-start; }
  .item:hover { background:#161a22; }
  .item.active { background:#1b2438; }
  .item .star { cursor:pointer; color:#5b6472; }
  .item .star.on { color:#ffc94d; }
  .item .main { min-width:0; flex:1; }
  .item .row1 { display:flex; gap:8px; align-items:center; }
  .item .s { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .item.unread .s::before { content:"●"; color:#4f9dff; margin-right:6px; font-size:10px; }
  .item .sub { color:#9aa4b2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .item .meta { margin-left:auto; color:#6b7280; font-size:12px; white-space:nowrap; }
  .badge { font-size:10px; padding:1px 6px; border-radius:6px; background:#22304a; color:#9cc4ff; }
  .att { color:#c9a227; }
  .replied { color:#5fbf7f; font-size:11px; }
  .empty { color:#6b7280; padding:30px; text-align:center; }
  .msg h2 { margin:0 0 6px; }
  .msg .hdr { color:#9aa4b2; margin-bottom:14px; }
  .msg .body { white-space:pre-wrap; background:#0c0e13; border:1px solid #20262f; border-radius:10px; padding:14px; }
  .chips { margin-top:14px; }
  .chip { display:inline-flex; gap:6px; align-items:center; background:#1a2230; border:1px solid #2a3344; border-radius:8px; padding:5px 10px; margin:4px 4px 0 0; font-size:12px; }
  .note { color:#ffcf8e; font-size:12px; margin-top:14px; }
  input[type=checkbox]{ width:15px; height:15px; accent-color:#2563eb; }
</style>
</head>
<body>
<header>
  <b>kanamiisa mail</b><span class="pill">эмуляция</span>
  <span style="flex:1"></span>
  <a class="navlink" href="/stenographist/panel.html">Панель</a>
  <a class="navlink" href="/stenographist/index.html">Стенографист</a>
  <button class="btn ghost" id="logout">Выйти</button>
  <span id="stat" style="color:#7c8696; font-size:12px;"></span>
</header>
<div class="wrap">
  <div class="col side" id="side"></div>
  <div>
    <div class="toolbar">
      <input type="checkbox" id="selall" title="Выбрать все">
      <button class="btn ghost" data-act="read">Прочитано</button>
      <button class="btn ghost" data-act="unread">Непрочитано</button>
      <button class="btn ghost" data-act="star">★</button>
      <button class="btn ghost" data-act="unstar">☆</button>
      <button class="btn ghost" data-act="delete">Удалить</button>
      <button class="btn ghost" id="refresh">Обновить</button>
      <button class="btn" disabled title="отправка не реализована">Написать</button>
    </div>
    <div class="col" id="list" style="height:calc(100vh - 45px - 45px);"></div>
  </div>
  <div class="col view" id="view"><div class="empty">Выберите письмо слева.</div></div>
</div>

<script>
function el(tag, attrs, ...kids){
  const e = document.createElement(tag);
  if(attrs) for(const k in attrs){
    const v = attrs[k];
    if(k === 'class') e.className = v;
    else if(k === 'html') e.innerHTML = v;
    else if(k.slice(0,2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if(v !== false && v != null) e.setAttribute(k, v);
  }
  for(const c of kids){ if(c == null) continue; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  return e;
}
function fmtDate(s){ try { return new Date(s.replace(' ','T')+'Z').toLocaleString(); } catch(e){ return s; } }

const S = { folder:'inbox', alias:null, q:'', selected:new Set(), openId:null };

async function api(path, opts){
  const r = await fetch(path, opts);
  if(r.status === 401){ location.href = '/login?from=mail'; throw new Error('unauthorized'); }
  return r.json();
}
async function loadState(){
  const st = await api('/mail/api/state');
  const side = document.getElementById('side');
  side.innerHTML = '';
  const search = el('input', { class:'search', placeholder:'Поиск…', oninput: debounce(() => { S.q = search.value; S.alias=null; S.folder='inbox'; loadMessages(); }, 300) });
  side.appendChild(search);

  const mk = (label, count, unread, active, onclick) => {
    const n = el('div', { class:'nav' + (active?' active':''), onclick },
      el('span', null, label),
      unread ? el('span', { class:'unread' }, String(unread)) : (count!=null ? el('span', { class:'count' }, String(count)) : null)
    );
    return n;
  };
  side.appendChild(el('h4', null, 'Папки'));
  side.appendChild(mk('Входящие', st.folders.inbox, st.folders.inboxUnread, S.folder==='inbox' && !S.alias, () => { S.folder='inbox'; S.alias=null; loadMessages(); }));
  side.appendChild(mk('Корзина', st.folders.trash, null, S.folder==='trash', () => { S.folder='trash'; S.alias=null; loadMessages(); }));
  side.appendChild(el('h4', null, 'Ящики (алиасы)'));
  for(const a of st.aliases){
    side.appendChild(mk(a.recipient, a.c, a.u, S.alias===a.recipient, ((rec)=>() => { S.alias=rec; S.folder='inbox'; loadMessages(); })(a.recipient)));
  }
  side.appendChild(el('button', { class:'btn', onclick: seed }, 'Сидировать'));
  side.appendChild(el('button', { class:'btn ghost', onclick: () => clearFolder() }, 'Очистить папку'));
  if (st.folders.trash > 0) side.appendChild(el('button', { class:'btn ghost', onclick: () => clearFolder('trash') }, 'Очистить корзину'));
  document.getElementById('stat').textContent = 'всего: ' + st.stats.total + ' · ★ ' + st.stats.starred;
}
async function loadMessages(){
  document.getElementById('selall').checked = false;
  const qs = new URLSearchParams();
  qs.set('folder', S.folder);
  if(S.alias) qs.set('alias', S.alias);
  if(S.q) qs.set('q', S.q);
  const list = await api('/mail/api/messages?' + qs.toString());
  const box = document.getElementById('list');
  box.innerHTML = '';
  if(!list.length){ box.appendChild(el('div', { class:'empty' }, 'Пусто. Нажмите «Сидировать».')); return; }
  for(const m of list){
    const row = el('div', { class:'item' + (m.read?'':' unread') + (S.openId===m.id?' active':''), onclick: () => open(m.id) },
      el('input', { type:'checkbox', class:'rowcb', 'data-id': m.id, onclick:(e)=>{ e.stopPropagation(); if(e.target.checked) S.selected.add(m.id); else S.selected.delete(m.id); } }),
      el('span', { class:'star' + (m.starred?' on':''), onclick:(e)=>{ e.stopPropagation(); toggleStar(m.id, !m.starred); } }, m.starred?'★':'☆'),
      el('div', { class:'main' },
        el('div', { class:'row1' },
          el('span', { class:'s' }, m.sender),
          el('span', { class:'meta' }, fmtDate(m.date).split(',')[1] || fmtDate(m.date))
        ),
        el('div', { class:'sub' }, (m.subject||'(без темы)')),
        el('div', { class:'row1' },
          el('span', { class:'badge' }, m.recipient),
          m.hasAttach ? el('span', { class:'att', title:'вложение' }, '📎') : null,
          m.replied ? el('span', { class:'replied' }, 'отвечено') : null
        ),
        el('div', { class:'sub' }, m.snippet)
      )
    );
    box.appendChild(row);
  }
}
async function open(id){
  S.openId = id;
  const m = await api('/mail/api/messages/' + id);
  const v = document.getElementById('view');
  v.innerHTML = '';
  const atts = (m.attachments && m.attachments !== 'null') ? JSON.parse(m.attachments||'[]') : [];
  const chips = atts.length ? el('div', { class:'chips' }, atts.map(a => el('span', { class:'chip' }, '📎 ' + a.name + ' (' + (a.size/1024).toFixed(0) + ' KB)'))) : null;
  v.appendChild(el('div', { class:'msg' },
    el('h2', null, m.subject || '(без темы)'),
    el('div', { class:'hdr' }, 'от ' + m.sender + '  →  ' + m.recipient + '  ·  ' + fmtDate(m.date)),
    el('div', { class:'body' }, m.body || ''),
    chips,
    el('div', { class:'note' }, 'Ответ и отправка пока не реализованы (только эмуляция приёма).')
  ));
  loadMessages();
}
async function toggleStar(id, value){
  await api('/mail/api/messages/' + id + '/star', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ value }) });
  loadState(); loadMessages();
}
async function seed(){
  await api('/mail/api/seed', { method:'POST' });
  S.folder='inbox'; S.alias=null; S.q='';
  loadState(); loadMessages();
}
async function clearFolder(folder){
  folder = folder || S.folder;
  const name = folder === 'trash' ? 'Корзина' : 'Входящие';
  if(!confirm('Очистить папку «' + name + '»? Это безвозвратно.')) return;
  await api('/mail/api/clear', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ folder }) });
  S.selected.clear(); S.openId=null;
  loadState(); loadMessages();
  document.getElementById('view').innerHTML = '<div class="empty">Выберите письмо слева.</div>';
}
async function bulk(action){
  const ids = [...S.selected];
  if(!ids.length){ alert('Ничего не выбрано'); return; }
  await api('/mail/api/bulk', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids, action }) });
  S.selected.clear();
  document.getElementById('selall').checked = false;
  loadState(); loadMessages();
}
document.getElementById('selall').addEventListener('change', (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.item input.rowcb').forEach((cb) => {
    cb.checked = checked;
    const id = +cb.dataset.id;
    if (checked) S.selected.add(id); else S.selected.delete(id);
  });
});
document.querySelectorAll('.toolbar [data-act]').forEach(b => b.addEventListener('click', () => bulk(b.dataset.act)));
document.getElementById('refresh').addEventListener('click', () => { loadState(); loadMessages(); });
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/login/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});
function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

loadState();
loadMessages();
</script>
</body>
</html>`;
