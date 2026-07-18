/**
 * Mail module — real mailbox backed by Cloudflare Email Routing (inbound)
 * and Cloudflare Email Sending (outbound). Auth reuses the project's
 * session system (validateSession / session= cookie in AUTH_KV).
 */

import { validateSession } from './auth.js';
import PostalMime from 'postal-mime';
import nodemailer from 'nodemailer';

const SENDER = 'support@kanamiisa.uk';
const SENDER_NAME = 'kanamiisa';

// ============================================================
// API
// ============================================================

function json(data, status = 200) {
  return Response.json(data, { status });
}

async function getState(env) {
  const inbox = await env.MAIL_DB.prepare("SELECT COUNT(*) c, COALESCE(SUM(1-read),0) u FROM emails WHERE folder='inbox'").first();
  const sent = await env.MAIL_DB.prepare("SELECT COUNT(*) c FROM emails WHERE folder='sent'").first();
  const trash = await env.MAIL_DB.prepare("SELECT COUNT(*) c FROM emails WHERE folder='trash'").first();
  const aliases = await env.MAIL_DB.prepare(
    "SELECT recipient, COUNT(*) c, COALESCE(SUM(1-read),0) u FROM emails WHERE folder='inbox' GROUP BY recipient ORDER BY recipient"
  ).all();
  const total = await env.MAIL_DB.prepare("SELECT COUNT(*) c FROM emails").first();
  const starred = await env.MAIL_DB.prepare("SELECT COUNT(*) c FROM emails WHERE starred=1").first();
  return {
    folders: { inbox: inbox.c, inboxUnread: inbox.u, sent: sent.c, trash: trash.c },
    aliases: aliases.results,
    stats: { total: total.c, starred: starred.c },
  };
}

function snippet(body, n = 120) {
  const t = (body || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function stripHtml(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>(?=)/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
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
    const q = "%" + p.get("q").toLowerCase() + "%";
    where.push("(LOWER(sender) LIKE ? OR LOWER(recipient) LIKE ? OR LOWER(subject) LIKE ? OR LOWER(body) LIKE ?)");
    binds.push(q, q, q, q);
  }
  const sql = "SELECT id, sender, recipient, from_name, subject, body, date, read, starred, replied, folder, attachments FROM emails"
    + (where.length ? " WHERE " + where.join(" AND ") : "")
    + " ORDER BY id DESC";
  const { results } = await env.MAIL_DB.prepare(sql).bind(...binds).all();
  return results.map((m) => ({
    id: m.id, sender: m.sender, recipient: m.recipient, fromName: m.from_name, folder: m.folder,
    subject: m.subject, snippet: snippet(m.body), date: m.date, read: m.read, starred: m.starred,
    replied: m.replied, hasAttach: !!(m.attachments && m.attachments !== "[]" && m.attachments !== "null"),
  }));
}

async function setFlag(env, id, col, value) {
  await env.MAIL_DB.prepare(`UPDATE emails SET ${col} = ? WHERE id = ?`).bind(value, id).run();
  return json({ ok: true });
}

async function handleMailSend(request, env) {
  const data = await request.json().catch(() => ({}));
  const to = (data.to || "").trim();
  const subject = (data.subject || "").trim();
  const body = data.body || "";
  const html = data.html || "";
  const inReplyTo = data.inReplyTo || null;
  const replyTo = data.replyTo || null;
  if (!to) return json({ error: "no recipient" }, 400);
  if (!env.SMTP_HOST || !env.SMTP_PASS) return json({ error: "smtp not configured" }, 503);

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT || "587", 10),
    secure: env.SMTP_PORT === "465" || env.SMTP_SECURE === "1",
    auth: { user: env.SMTP_USER || env.MAIL_FROM || SENDER, pass: env.SMTP_PASS },
  });

  const attachments = (data.attachments || [])
    .filter((a) => a.content)
    .map((a) => ({
      filename: a.filename || "attachment",
      content: a.content,
      encoding: "base64",
      contentType: a.type || "application/octet-stream",
    }));

  try {
    const info = await transport.sendMail({
      from: { name: SENDER_NAME, address: env.MAIL_FROM || SENDER },
      to,
      subject: subject || "(без темы)",
      text: body,
      html: html || undefined,
      replyTo: replyTo || undefined,
      inReplyTo: inReplyTo || undefined,
      attachments,
    });
    const messageId = info && info.messageId ? info.messageId : null;
    await env.MAIL_DB.prepare(
      `INSERT INTO emails (folder, sender, recipient, from_name, subject, body, body_html, html, date, message_id, in_reply_to, attachments, read)
       VALUES ('sent', ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 1)`
    ).bind(
      SENDER, to, SENDER_NAME, subject, body, html || null, html ? 1 : 0, messageId, inReplyTo,
      JSON.stringify(attachments.map((a) => ({ name: a.filename, type: a.contentType, size: Math.ceil((a.content.length * 3) / 4) })))
    ).run();
    return json({ ok: true, messageId });
  } catch (e) {
    console.error("[mail] smtp send failed", e);
    return json({ error: e.message || "send failed" }, 500);
  }
}

export async function handleMailApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/mail/api/test-telegram" && request.method === "GET") {
    await notifyTelegram(env, { address: "test@example.com", isReply: false, subject: "Тест уведомления" });
    return json({ ok: true });
  }

  if (path === "/mail/api/state" && request.method === "GET") return json(await getState(env));

  if (path === "/mail/api/send" && request.method === "POST") return handleMailSend(request, env);

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
   return json({ error: "not found" }, 404);
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

async function notifyTelegram(env, { address, isReply, subject }) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const who = address || 'неизвестного';
  let text = (isReply ? 'Новое письмо (Re) от ' : 'Новое письмо от ') + who;
  if (subject) text += '\n«' + subject + '»';
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error('[mail] telegram notify failed', e);
  }
}

// Inbound email path — real handler driven by Cloudflare Email Routing.
export async function mailEmail(message, env, ctx) {
  ctx.waitUntil((async () => {
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      const email = await PostalMime.parse(raw);
      const text = email.text || (email.html ? stripHtml(email.html) : "") || "";
      let dateStr = null;
      if (email.date) {
        const dt = new Date(email.date);
        if (!isNaN(dt)) dateStr = dt.toISOString().slice(0, 19).replace("T", " ");
      }
      if (!dateStr) dateStr = new Date().toISOString().slice(0, 19).replace("T", " ");
      const atts = (email.attachments || []).map((a) => ({
        name: a.filename || "attachment",
        type: a.mimeType || "application/octet-stream",
        size: a.size || 0,
      }));
      await env.MAIL_DB.prepare(
        `INSERT INTO emails (folder, sender, recipient, from_name, subject, body, body_html, html, date, message_id, in_reply_to, reply_to, attachments, read)
         VALUES ('inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      ).bind(
        email.from?.address || message.from,
        message.to,
        email.from?.name || null,
        email.subject || "(без темы)",
        text,
        email.html || null,
        email.html ? 1 : 0,
        dateStr,
        email.messageId || null,
        email.inReplyTo || null,
        email.replyTo?.address || null,
        JSON.stringify(atts)
      ).run();
       console.log(`[mail] stored inbound ${message.from} -> ${message.to}: ${email.subject}`);

        try {
          await notifyTelegram(env, {
            address: email.from?.address || message.from,
            isReply: /^\s*re:/i.test(email.subject || ''),
            subject: email.subject || '',
          });
        } catch (te) {
          console.error('[mail] telegram failed', te);
        }
    } catch (e) {
      console.error("[mail] parse failed", e);
      try {
        await env.MAIL_DB.prepare(
          "INSERT INTO emails (folder, sender, recipient, subject, body, date, read) VALUES ('inbox', ?, ?, ?, ?, datetime('now'), 0)"
        ).bind(message.from, message.to, "(не удалось разобрать письмо)", "(raw body unavailable)").run();
      } catch (_) {}
    }
  })());
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
  body { margin:0; font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif; background:#0f1115; color:#e6e6e6; overflow-x:hidden; }
  header { padding:10px 16px; background:#171a21; border-bottom:1px solid #262b36; display:flex; gap:10px; align-items:center; }
   header b { font-size:16px; }
   .navlink { color:#cdd3dd; text-decoration:none; font-size:13px; padding:6px 10px; border-radius:8px; }
   .navlink:hover { background:#1b1f27; }
   .hamburger { display:none; background:none; border:0; color:#e6e6e6; font-size:22px; cursor:pointer; padding:4px 8px; }
   .drawer-actions { display:none; }
   .drawer-nav { display:none; }
  .wrap { display:grid; grid-template-columns: 250px 380px 1fr; height: calc(100vh - 45px); }
  .col { overflow:auto; border-right:1px solid #262b36; }
  .col.view { border-right:0; padding:22px; }
  .side { padding:10px; }
  .side h4 { margin:14px 6px 6px; color:#7c8696; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  .nav { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer; }
  .nav:hover { background:#1b1f27; }
  .nav.active { background:#06231f; box-shadow: inset 3px 0 0 #00f5d4, 0 0 18px rgba(0,245,212,.14); }
  .nav .count { margin-left:auto; color:#9aa4b2; font-size:12px; }
  .nav .unread { background:#00f5d4; color:#04120f; border-radius:999px; padding:0 7px; font-size:11px; font-weight:600; box-shadow:0 0 10px rgba(0,245,212,.5); }
  .search { width:100%; padding:8px 10px; margin:6px 0; background:#0c0e13; color:#e6e6e6; border:1px solid #2a2f3a; border-radius:8px; }
  .side .btn { width:100%; margin-top:6px; }
  .toolbar { display:flex; gap:6px; padding:8px 12px; border-bottom:1px solid #262b36; align-items:center; flex-wrap:wrap; }
  .toolbar input[type=checkbox]{ width:18px; height:18px; accent-color:#00f5d4; flex-shrink:0; }
  .btn { background:#00f5d4; color:#04120f; border:0; padding:7px 12px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600; box-shadow: 0 0 18px rgba(0,245,212,.6); display:inline-flex; align-items:center; gap:5px; }
  .btn.ghost { background:#0c2a27; color:#7df3e6; box-shadow:0 0 14px rgba(0,245,212,.22); }
  .btn:disabled { opacity:.45; cursor:not-allowed; box-shadow:none; }
  .btn.star-btn { font-size:18px; line-height:1; padding:4px 8px; }
  .tb-icon { width:18px; height:18px; fill:currentColor; display:none; }
  .item { display:flex; gap:8px; padding:10px 12px; border-bottom:1px solid #1a1e26; cursor:pointer; align-items:flex-start; }
  .item:hover { background:#161a22; }
  .item.active { background:#06231f; box-shadow: inset 3px 0 0 #00f5d4, 0 0 18px rgba(0,245,212,.14); }
  .item .star { cursor:pointer; color:#5b6472; }
  .item .star.on { color:#ffc94d; }
  .item .main { min-width:0; flex:1; }
  .item .row1 { display:flex; gap:8px; align-items:center; }
  .item .s { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .item.unread .s::before { content:"●"; color:#00f5d4; margin-right:6px; font-size:10px; text-shadow:0 0 8px rgba(0,245,212,.8); }
  .item .sub { color:#9aa4b2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .item .meta { margin-left:auto; color:#6b7280; font-size:12px; white-space:nowrap; }
  .badge { font-size:10px; padding:1px 6px; border-radius:6px; background:#06231f; color:#7df3e6; }
  .att { color:#c9a227; }
  .replied { color:#5fbf7f; font-size:11px; }
  .empty { color:#6b7280; padding:30px; text-align:center; }
  .msg h2 { margin:0 0 6px; overflow-wrap:anywhere; word-break:break-word; }
  .msg .hdr { color:#9aa4b2; margin-bottom:14px; overflow-wrap:anywhere; word-break:break-word; }
  .msg .body { white-space:pre-wrap; background:#0c0e13; border:1px solid #20262f; border-radius:10px; padding:14px; overflow-wrap:anywhere; word-break:break-word; }
  .chips { margin-top:14px; }
  .chip { display:inline-flex; gap:6px; align-items:center; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; background:#1a2230; border:1px solid #2a3344; border-radius:8px; padding:5px 10px; margin:4px 4px 0 0; font-size:12px; }
  .note { color:#ffcf8e; font-size:12px; margin-top:14px; }
  .item input[type=checkbox]{ width:18px; height:18px; accent-color:#00f5d4; flex-shrink:0; }
  .compose label { display:block; color:#7c8696; font-size:12px; margin:6px 2px 2px; }
  .mail-back { display:none; }
  .drawer-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:49; }
  body.drawer-open .drawer-overlay { display:block; }
  @media (max-width: 820px) {
    header { flex-wrap:wrap; row-gap:6px; padding:8px 12px; align-items:center; }
    header .navlink { display:none; }
    header #stat { display:none; }
    .hamburger { display:inline-flex; margin-left:auto; }
    .wrap { grid-template-columns:1fr; height:calc(100vh - 41px); overflow-x:hidden; }
    .col.side {
      position:fixed; top:0; left:0; bottom:0; width:280px; background:#171a21; z-index:50;
      border-right:1px solid #262b36;
      display:flex; flex-direction:column; gap:6px;
      padding:12px;
      transform:translateX(-100%);
      transition: transform .22s ease;
      overflow-y:auto;
      min-width:0;
    }
    body.drawer-open .col.side { transform:translateX(0); }
    .col.side h4 { margin:10px 0 4px; color:#7c8696; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
    .col.side .search { width:100%; margin:0 0 4px; }
    .col.side .btn.side-clear { display:block; width:100%; }
   .drawer-actions { display:flex; flex-direction:column; gap:6px; margin-top:auto; padding-top:12px; border-top:1px solid #262b36; }
   .drawer-nav { display:flex; flex-direction:column; gap:4px; margin-top:8px; padding-top:8px; border-top:1px solid #262b36; }
   .drawer-nav-link { color:#cdd3dd; text-decoration:none; font-size:13px; padding:8px 10px; border-radius:8px; }
   .drawer-nav-link:hover { background:#1b1f27; }
    .side .nav {
      white-space:nowrap;
      border:1px solid #2a2f3a;
      border-radius:999px;
      padding:6px 13px;
      min-width:0;
      max-width:100%;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .side .nav:hover { background:#1b1f27; }
    .side .nav.active {
      background:#06231f;
      border-color:#00f5d4;
      box-shadow:0 0 14px rgba(0,245,212,.35);
    }
    .toolbar .btn { padding:6px 8px; font-size:18px; }
    .toolbar .tb-icon { display:inline-block; }
    .toolbar .tb-text { display:none; }
    .toolbar { overflow-x:auto; min-width:0; flex-wrap:nowrap; justify-content:space-between; align-items:center; }
    .toolbar input[type=checkbox] { flex-shrink:0; }
    .item { min-width:0; }
    .item .main { min-width:0; }
    .col.view { display:none; }
    .wrap > div:nth-child(2) { display:flex; flex-direction:column; min-height:0; min-width:0; overflow-x:hidden; }
    .wrap #list { height:auto !important; flex:1 1 auto; min-width:0; overflow-x:hidden; }
    body.mail-open .col.side,
    body.mail-open .wrap > div:nth-child(2) { display:none; }
    body.mail-open .col.view {
      display:block; position:fixed; inset:41px 0 0 0; background:#0f1115; overflow:auto; z-index:40;
      padding:14px 14px 80px; border-right:0;
      animation: mailSlide .22s ease;
    }
    .mail-back { display:inline-flex; align-items:center; gap:6px; margin-bottom:14px; }
  }
  @keyframes mailSlide { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
</style>
</head>
<body>
<header>
  <b>Kanami-isa Mail Service</b>
  <span style="flex:1"></span>
   <a class="navlink" href="/stenographist/panel.html">Панель</a>
   <a class="navlink" href="/stenographist/index.html">Стенографист</a>
   <span id="stat" style="color:#7c8696; font-size:12px;"></span>
   <button class="hamburger" id="hamburger">☰</button>
</header>
<div class="drawer-overlay" id="drawerOverlay"></div>
<div class="wrap">
  <div class="col side" id="side"></div>
  <div>
    <div class="toolbar">
      <input type="checkbox" id="selall" title="Выбрать все">
      <button class="btn ghost" data-act="read"><svg class="tb-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span class="tb-text">Прочитано</span></button>
      <button class="btn ghost" data-act="unread"><svg class="tb-icon" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2 7l10 6 10-6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="19" cy="6" r="3" fill="#00f5d4" stroke="#00f5d4" stroke-width="0.5"/></svg><span class="tb-text">Непрочитано</span></button>
      <button class="btn ghost star-btn" data-act="star">★</button>
      <button class="btn ghost star-btn" data-act="unstar">☆</button>
      <button class="btn ghost" data-act="delete"><svg class="tb-icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg><span class="tb-text">Удалить</span></button>
      <button class="btn ghost" id="refresh"><svg class="tb-icon" viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg><span class="tb-text">Обновить</span></button>
      <button class="btn" id="compose-btn"><svg class="tb-icon" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg><span class="tb-text">Написать</span></button>
    </div>
    <div class="col" id="list" style="height:calc(100vh - 45px - 45px);"></div>
  </div>
  <div class="col view" id="view"><div class="empty">Выберите письмо слева.</div></div>
</div>

<div id="compose" class="compose" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:50; align-items:flex-start; justify-content:center; padding-top:40px;">
  <div style="background:#171a21; border:1px solid #262b36; border-radius:12px; width:min(640px,92vw); max-height:90vh; overflow:auto; padding:16px;">
    <div style="display:flex;align-items:center;margin-bottom:6px;"><b style="font-size:15px;">Новое письмо</b><span style="flex:1"></span><button class="btn ghost" id="c-close">Закрыть</button></div>
    <label>Кому</label><input id="c-to" class="search" style="margin-bottom:8px;">
    <label>Тема</label><input id="c-subject" class="search" style="margin-bottom:8px;">
    <label>Текст</label><textarea id="c-body" style="width:100%;min-height:160px;background:#0c0e13;color:#e6e6e6;border:1px solid #2a2f3a;border-radius:8px;padding:10px;font:14px/1.5 system-ui;"></textarea>
    <label>Вложения</label><input id="c-files" type="file" multiple style="margin:4px 0 12px;color:#cdd3dd;">
    <div id="c-err" class="note" style="display:none"></div>
    <button class="btn" id="c-send">Отправить</button>
  </div>
</div>

<script>
function el(tag, attrs, ...kids){
  const e = document.createElement(tag);
  if(attrs) for(const k in attrs){
    const v = attrs[k];
    if(k === 'class') e.className = v;
    else if(k === 'html') e.innerHTML = v;
    else if(k === 'style' && typeof v === 'object') e.setAttribute('style', Object.entries(v).map(([x,y])=>x+':'+y).join(';'));
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
  const search = el('input', { class:'search', placeholder:'Поиск…', autocapitalize:'off', autocomplete:'off', spellcheck:'false', inputmode:'search', oninput: debounce(() => { S.q = search.value; S.alias=null; S.folder='inbox'; loadMessages(); }, 300) });
  side.appendChild(search);

  const mk = (label, count, unread, active, onclick) => {
    const n = el('div', { class:'nav' + (active?' active':''), onclick },
      el('span', null, label),
      unread ? el('span', { class:'unread' }, String(unread)) : (count!=null ? el('span', { class:'count' }, String(count)) : null)
    );
    return n;
  };
  side.appendChild(el('h4', null, 'Папки'));
  side.appendChild(mk('Входящие', st.folders.inbox, st.folders.inboxUnread, S.folder==='inbox' && !S.alias, () => { S.folder='inbox'; S.alias=null; document.body.classList.remove('drawer-open'); loadState(); loadMessages(); }));
  side.appendChild(mk('Отправленные', st.folders.sent, null, S.folder==='sent', () => { S.folder='sent'; S.alias=null; document.body.classList.remove('drawer-open'); loadState(); loadMessages(); }));
  side.appendChild(mk('Корзина', st.folders.trash, null, S.folder==='trash', () => { S.folder='trash'; S.alias=null; document.body.classList.remove('drawer-open'); loadState(); loadMessages(); }));
  side.appendChild(el('h4', null, 'Ящики (алиасы)'));
  for(const a of st.aliases){
    side.appendChild(mk(a.recipient, a.c, a.u, S.alias===a.recipient, ((rec)=>() => { S.alias=rec; S.folder='inbox'; document.body.classList.remove('drawer-open'); loadState(); loadMessages(); })(a.recipient)));
  }
   side.appendChild(el('button', { class:'btn ghost side-clear', onclick: () => clearFolder() }, 'Очистить папку'));
   if (st.folders.trash > 0) side.appendChild(el('button', { class:'btn ghost side-clear', onclick: () => clearFolder('trash') }, 'Очистить корзину'));
   side.appendChild(el('div', { class:'drawer-nav' },
     el('a', { class:'drawer-nav-link', href:'/stenographist/panel.html' }, 'Панель'),
     el('a', { class:'drawer-nav-link', href:'/stenographist/index.html' }, 'Стенографист')
   ));
   side.appendChild(el('div', { class:'drawer-actions' },
     el('button', { class:'btn ghost', onclick: async () => { await fetch('/mail/api/test-telegram').catch(()=>{}); } }, '📨 Тест Telegram'),
     el('button', { class:'btn ghost', onclick: async () => { await fetch('/login/api/logout', {method:'POST'}).catch(()=>{}); location.href='/login?from=mail'; } }, 'Выйти')
   ));
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
  if(!list.length){ box.appendChild(el('div', { class:'empty' }, 'Пусто.')); return; }
  for(const m of list){
    const who = (S.folder==='sent') ? m.recipient : (m.fromName ? m.fromName + ' <' + m.sender + '>' : m.sender);
    const row = el('div', { class:'item' + (m.read?'':' unread') + (S.openId===m.id?' active':''), onclick: () => open(m.id) },
      el('input', { type:'checkbox', class:'rowcb', 'data-id': m.id, onclick:(e)=>{ e.stopPropagation(); if(e.target.checked) S.selected.add(m.id); else S.selected.delete(m.id); } }),
      el('span', { class:'star' + (m.starred?' on':''), onclick:(e)=>{ e.stopPropagation(); toggleStar(m.id, !m.starred); } }, m.starred?'★':'☆'),
      el('div', { class:'main' },
        el('div', { class:'row1' },
          el('span', { class:'s' }, who),
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
  document.body.classList.add('mail-open');
  document.body.classList.remove('drawer-open');
  const m = await api('/mail/api/messages/' + id);
  const v = document.getElementById('view');
  v.innerHTML = '';
  const atts = (m.attachments && m.attachments !== 'null') ? JSON.parse(m.attachments||'[]') : [];
  const chips = atts.length ? el('div', { class:'chips' }, atts.map(a => el('span', { class:'chip' }, '📎 ' + a.name + ' (' + ((a.size||0)/1024).toFixed(0) + ' KB)'))) : null;

  const bodyWrap = el('div', { class:'body' }, m.body || '(нет текстовой части)');
  const msg = el('div', { class:'msg' },
    el('h2', null, m.subject || '(без темы)'),
    el('div', { class:'hdr' }, 'от ' + m.sender + '  →  ' + m.recipient + '  ·  ' + fmtDate(m.date)),
    bodyWrap
  );
  if (m.body_html) {
    const htmlBtn = el('button', { class:'btn ghost', style:{marginTop:'10px'}, onclick: () => {
      const ifr = el('iframe', { sandbox:'', style:{width:'100%',minHeight:'320px',border:'1px solid #20262f',borderRadius:'10px',background:'#fff'} });
      ifr.srcdoc = m.body_html;
      bodyWrap.replaceWith(ifr);
      htmlBtn.remove();
    } }, 'Показать как HTML');
    msg.appendChild(htmlBtn);
  }
  if (chips) msg.appendChild(chips);
  if (S.folder !== 'sent') {
    msg.appendChild(el('div', { class:'chips' }, el('button', { class:'btn', onclick: () => reply(m) }, 'Ответить')));
  }
  const backBtn = el('button', { class:'btn ghost mail-back', onclick: () => document.body.classList.remove('mail-open') }, '← Назад');
  msg.prepend(backBtn);
  v.appendChild(msg);
  loadMessages();
}
async function reply(m){
  compose({ to: m.sender, subject: 'Re: ' + (m.subject || ''), inReplyTo: m.message_id, body: '\\n\\n--- исходное письмо ---\\n' + (m.body||'') });
}
async function toggleStar(id, value){
  await api('/mail/api/messages/' + id + '/star', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ value }) });
  loadState(); loadMessages();
}
async function clearFolder(folder){
  folder = folder || S.folder;
  const name = folder === 'trash' ? 'Корзина' : 'Входящие';
  if(!confirm('Очистить папку «' + name + '»? Это безвозвратно.')) return;
  await api('/mail/api/clear', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ folder }) });
  S.selected.clear(); S.openId=null;
  document.body.classList.remove('mail-open');
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
function compose(prefill){
  prefill = prefill || {};
  document.getElementById('c-to').value = prefill.to || '';
  document.getElementById('c-subject').value = prefill.subject || '';
  document.getElementById('c-body').value = prefill.body || '';
  document.getElementById('c-files').value = '';
  document.getElementById('c-err').style.display = 'none';
  document.getElementById('compose').dataset.inReplyTo = prefill.inReplyTo || '';
  document.getElementById('compose').style.display = 'flex';
  document.getElementById('c-to').focus();
}
function closeCompose(){ document.getElementById('compose').style.display='none'; }
function showErr(msg){ const e=document.getElementById('c-err'); e.textContent=msg; e.style.display='block'; }
function fileToB64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>{ const b=r.result.split(',')[1]; res(b); }; r.onerror=rej; r.readAsDataURL(file); }); }
async function sendMail(){
  const to = document.getElementById('c-to').value.trim();
  const subject = document.getElementById('c-subject').value.trim();
  const body = document.getElementById('c-body').value;
  const inReplyTo = document.getElementById('compose').dataset.inReplyTo || null;
  if(!to){ showErr('Укажите получателя'); return; }
  const files = document.getElementById('c-files').files;
  const attachments = [];
  for(const f of files){ attachments.push({ filename: f.name, type: f.type || 'application/octet-stream', content: await fileToB64(f) }); }
  const btn = document.getElementById('c-send'); btn.disabled = true;
  try{
    const r = await fetch('/mail/api/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to, subject, body, inReplyTo, attachments }) });
    const j = await r.json();
    if(!r.ok){ showErr(j.error || 'Ошибка отправки'); btn.disabled=false; return; }
    closeCompose(); S.folder='sent'; S.alias=null; loadState(); loadMessages();
  }catch(e){ showErr(e.message); btn.disabled=false; }
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
document.getElementById('compose-btn').addEventListener('click', () => compose());
document.getElementById('c-close').addEventListener('click', closeCompose);
document.getElementById('c-send').addEventListener('click', sendMail);
function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

document.getElementById('hamburger').addEventListener('click', () => {
  document.body.classList.toggle('drawer-open');
});
document.getElementById('drawerOverlay').addEventListener('click', () => {
  document.body.classList.remove('drawer-open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.body.classList.remove('drawer-open');
});

loadState();
loadMessages();
</script>
<script src="/js/auto-logout.js"></script>
</body>
</html>`;
