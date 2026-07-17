/**
 * WebAuthn (Passkeys) for biometric / Windows Hello login.
 * Registration is gated by the setup PIN (787898) in /login/setup.
 * Login via passkey is an alternative to the TOTP login and logs in as root.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const SETUP_PIN = '787898';
const ROOT_USER = { id: 'kanamiisa', name: 'kanamiisa', displayName: 'kanamiisa' };

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

function rpInfo(request) {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

async function getCredentials(env) {
  const raw = await env.AUTH_KV.get('webauthn:creds', 'json');
  return Array.isArray(raw) ? raw : [];
}

export async function webauthnSetupBegin(env, request, pin) {
  if (pin !== SETUP_PIN) return { error: 'Неверный код доступа', status: 403 };
  const { rpID, origin } = rpInfo(request);
  const creds = await getCredentials(env);
  const options = await generateRegistrationOptions({
    rpName: 'kanamiisa',
    rpID,
    userName: ROOT_USER.name,
    userID: new TextEncoder().encode(ROOT_USER.id),
    userDisplayName: ROOT_USER.displayName,
    attestationType: 'none',
    excludeCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
    supportedAlgorithmIDs: [-7, -257],
  });
  const flowToken = crypto.randomUUID();
  await env.AUTH_KV.put(
    `webauthn:challenge:${flowToken}`,
    JSON.stringify({ challenge: options.challenge, type: 'reg' }),
    { expirationTtl: 300 }
  );
  return { options, flowToken };
}

export async function webauthnSetupFinish(env, request, flowToken, response) {
  const stored = await env.AUTH_KV.get(`webauthn:challenge:${flowToken}`, 'json');
  if (!stored || stored.type !== 'reg') return { error: 'Истёк запрос регистрации', status: 400 };
  const { rpID, origin } = rpInfo(request);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    return { error: 'Ошибка проверки: ' + e.message, status: 400 };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { error: 'Регистрация не подтверждена', status: 400 };
  }
  const ri = verification.registrationInfo;
  const creds = await getCredentials(env);
  const name = 'Устройство-' + crypto.randomUUID().slice(0, 8);
  creds.push({
    id: ri.credential.id,
    name,
    publicKey: bytesToB64url(ri.credential.publicKey),
    counter: ri.credential.counter,
    transports: (response && response.transports) || [],
  });
  await env.AUTH_KV.put('webauthn:creds', JSON.stringify(creds));
  await env.AUTH_KV.delete(`webauthn:challenge:${flowToken}`);
  return { ok: true, name };
}

export async function webauthnList(env, pin) {
  if (pin !== SETUP_PIN) return { error: 'Неверный код доступа', status: 403 };
  const creds = await getCredentials(env);
  return {
    credentials: creds.map((c) => ({ id: c.id, name: c.name || c.id.slice(0, 12) })),
  };
}

export async function webauthnDelete(env, pin, id) {
  if (pin !== SETUP_PIN) return { error: 'Неверный код доступа', status: 403 };
  const creds = await getCredentials(env);
  const filtered = creds.filter((c) => c.id !== id);
  if (filtered.length === creds.length) return { error: 'Ключ не найден', status: 404 };
  await env.AUTH_KV.put('webauthn:creds', JSON.stringify(filtered));
  return { ok: true };
}

export async function webauthnLoginBegin(env, request) {
  const { rpID, origin } = rpInfo(request);
  const creds = await getCredentials(env);
  if (!creds.length) return { error: 'Нет зарегистрированных ключей', status: 400 };
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: 'preferred',
  });
  const flowToken = crypto.randomUUID();
  await env.AUTH_KV.put(
    `webauthn:challenge:${flowToken}`,
    JSON.stringify({ challenge: options.challenge, type: 'auth' }),
    { expirationTtl: 300 }
  );
  return { options, flowToken };
}

export async function webauthnLoginFinish(env, request, flowToken, response) {
  const stored = await env.AUTH_KV.get(`webauthn:challenge:${flowToken}`, 'json');
  if (!stored || stored.type !== 'auth') return { error: 'Истёк запрос входа', status: 400 };
  const { rpID, origin } = rpInfo(request);
  const creds = await getCredentials(env);
  const cred = creds.find((c) => c.id === response.id);
  if (!cred) return { error: 'Ключ не найден', status: 400 };
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey: b64urlToBytes(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    return { error: 'Ошибка проверки: ' + e.message, status: 400 };
  }
  if (!verification.verified) return { error: 'Вход не подтверждён', status: 400 };
  cred.counter = verification.authenticationInfo.newCounter;
  await env.AUTH_KV.put('webauthn:creds', JSON.stringify(creds));
  await env.AUTH_KV.delete(`webauthn:challenge:${flowToken}`);
  return { ok: true };
}
