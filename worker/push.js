/**
 * Web Push (Web Push Protocol + VAPID, no payload encryption).
 * The push message carries a `notification` member; the push service
 * displays it and the SW (`sw.js`) handles the click. Tag dedup guarantees
 * a single visible notification even if both the service and the SW show it.
 */

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivate(env) {
  const bytes = b64urlToBytes(env.VAPID_PRIVATE);
  return crypto.subtle.importKey('pkcs8', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function makeJwt(env, aud) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:support@kanamiisa.uk' };
  const enc = (o) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = enc(header) + '.' + enc(payload);
  const key = await importPrivate(env);
  const sigRaw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)));
  return input + '.' + bytesToB64url(sigRaw);
}

const SUBS_KEY = 'push:root';

export async function listSubscriptions(env) {
  const raw = await env.AUTH_KV.get(SUBS_KEY, 'json');
  return Array.isArray(raw) ? raw : [];
}

export async function storeSubscription(env, sub) {
  const subs = await listSubscriptions(env);
  const idx = subs.findIndex((s) => s.endpoint === sub.endpoint);
  if (idx >= 0) subs[idx] = sub; else subs.push(sub);
  await env.AUTH_KV.put(SUBS_KEY, JSON.stringify(subs));
}

export async function removeSubscription(env, endpoint) {
  if (!endpoint) return;
  const subs = (await listSubscriptions(env)).filter((s) => s.endpoint !== endpoint);
  await env.AUTH_KV.put(SUBS_KEY, JSON.stringify(subs));
}

export function getVapidPublic(env) {
  return env.VAPID_PUBLIC || '';
}

async function sendToOne(env, sub, title, body, url) {
  const endpoint = sub.endpoint;
  const aud = new URL(endpoint).origin;
  const jwt = await makeJwt(env, aud);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': '60',
      'Content-Type': 'application/json',
      'Authorization': 'WebPush ' + jwt,
      'Crypto-Key': 'p256ecdsa=' + env.VAPID_PUBLIC,
    },
    body: JSON.stringify({
      notification: {
        title,
        body,
        icon: '/k-logo.png',
        badge: '/k-logo.png',
        tag: 'newmail',
        click_action: url || '/mail',
        data: { url: url || '/mail' },
      },
    }),
  });
  if (res.status === 404 || res.status === 410) {
    await removeSubscription(env, endpoint);
    return false;
  }
  if (!res.ok) {
    console.warn('[push] send failed', res.status, await res.text().catch(() => ''));
    return false;
  }
  return true;
}

export async function sendPushToAll(env, title, body, url) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return;
  const subs = await listSubscriptions(env);
  for (const sub of subs) {
    try {
      await sendToOne(env, sub, title, body, url);
    } catch (e) {
      console.error('[push] error', e);
    }
  }
}

export async function sendNewMailPush(env, { address, isReply }) {
  const title = 'Kanami-isa mail service';
  const who = address || 'неизвестного';
  const body = (isReply ? 'Новое письмо (Re) от ' : 'Новое письмо от ') + who;
  await sendPushToAll(env, title, body, '/mail');
}
