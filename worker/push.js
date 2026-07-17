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

function concatBytes(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function u16be(n) {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

function strToBytes(s) {
  return new TextEncoder().encode(s);
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

// RFC 8188 aes128gcm encryption of a push payload for a given subscription.
async function encryptPayload(sub, payloadStr) {
  const p256dh = b64urlToBytes(sub.keys.p256dh);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephemeralPub = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const recipientPub = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', namedCurve: 'P-256', public: recipientPub },
    ephemeral.privateKey, 256
  ));

  const hkdf = await crypto.subtle.importKey('raw', shared, { name: 'HKDF' }, false, ['deriveBits']);
  const context = concatBytes(u16be(p256dh.length), p256dh, u16be(ephemeralPub.length), ephemeralPub);
  const cekInfo = concatBytes(strToBytes('Content-Encoding: aes128gcm'), new Uint8Array([0]), strToBytes('WebPush: info'), new Uint8Array([0]), context);
  const nonceInfo = concatBytes(strToBytes('Content-Encoding: nonce'), new Uint8Array([0]), strToBytes('WebPush: info'), new Uint8Array([0]), context);
  const cek = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo }, hkdf, 128));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, hkdf, 96));

  const plaintext = concatBytes(strToBytes(payloadStr), new Uint8Array([0]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concatBytes(salt, rs, new Uint8Array([ephemeralPub.length]), ephemeralPub, ciphertext);
}

async function sendToOne(env, sub, title, body, url) {
  const endpoint = sub.endpoint;
  const aud = new URL(endpoint).origin;
  const jwt = await makeJwt(env, aud);

  const payload = JSON.stringify({
    title,
    body,
    icon: '/k-logo.png',
    badge: '/k-logo.png',
    tag: 'newmail',
    url: url || '/mail',
  });

  const bodyBytes = await encryptPayload(sub, payload);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': '60',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization': 'WebPush ' + jwt,
      'Crypto-Key': 'p256ecdsa=' + env.VAPID_PUBLIC,
    },
    body: bodyBytes,
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
