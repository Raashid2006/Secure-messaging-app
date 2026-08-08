/* End-to-end encryption primitives.
 *
 * - Each user generates an ECDH P-256 keypair in the browser.
 * - The private key (JWK) is stored in localStorage, encrypted with an
 *   AES-GCM key derived from the user's password (PBKDF2).
 * - DMs: a shared AES-GCM key is derived via ECDH between the two parties.
 * - Group messages: encrypted once with a random session key, and the session
 *   key is individually wrapped for each recipient using ECDH shared secrets.
 */

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const AES_GCM = { name: 'AES-GCM', length: 256 };

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function utf8ToBytes(str) {
  return new TextEncoder().encode(str);
}

function bytesToUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

function randomBytes(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

export async function generateKeyPair() {
  return crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
}

export async function exportPublicKeyRaw(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return bytesToBase64(new Uint8Array(raw));
}

export async function importPublicKeyRaw(b64) {
  return crypto.subtle.importKey('raw', base64ToBytes(b64), ECDH, false, []);
}

export async function exportPrivateJwk(privateKey) {
  return crypto.subtle.exportKey('jwk', privateKey);
}

export async function importPrivateJwk(jwk) {
  return crypto.subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']);
}

/* ---------------- password-wrapped private key storage ---------------- */

export async function wrapPrivateKeyWithPassword(privateKey, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const pwKey = await crypto.subtle.importKey(
    'raw', utf8ToBytes(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    pwKey,
    AES_GCM,
    false,
    ['encrypt', 'decrypt']
  );
  const jwk = await exportPrivateJwk(privateKey);
  const ct = await crypto.subtle.encrypt(AES_GCM, aesKey, utf8ToBytes(JSON.stringify(jwk)));
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ct)),
  };
}

export async function unwrapPrivateKeyWithPassword(stored, password) {
  const salt = base64ToBytes(stored.salt);
  const iv = base64ToBytes(stored.iv);
  const pwKey = await crypto.subtle.importKey(
    'raw', utf8ToBytes(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    pwKey,
    AES_GCM,
    false,
    ['encrypt', 'decrypt']
  );
  const pt = await crypto.subtle.decrypt(AES_GCM, aesKey, base64ToBytes(stored.ct));
  const jwk = JSON.parse(bytesToUtf8(new Uint8Array(pt)));
  return importPrivateJwk(jwk);
}

export function saveWrappedKey(username, wrapped) {
  localStorage.setItem(`e2e:${username}`, JSON.stringify(wrapped));
}

export function loadWrappedKey(username) {
  const raw = localStorage.getItem(`e2e:${username}`);
  return raw ? JSON.parse(raw) : null;
}

/* ---------------- ECDH shared secret -> AES-GCM key ---------------- */

async function sharedAesKey(myPriv, theirPub) {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPub }, myPriv, 256
  );
  return crypto.subtle.importKey('raw', bits, AES_GCM, false, ['encrypt', 'decrypt']);
}

/* ---------------- encryption ---------------- */

export async function encryptDm(plaintext, myPriv, theirPub) {
  const key = await sharedAesKey(myPriv, theirPub);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8ToBytes(plaintext));
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ct)) };
}

export async function decryptDm(payload, myPriv, theirPub) {
  const key = await sharedAesKey(myPriv, theirPub);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data));
  return bytesToUtf8(new Uint8Array(pt));
}

export async function encryptGroup(plaintext, myPriv, members) {
  /* members: [{ id, pubKey }] */
  const sessionKey = await crypto.subtle.importKey(
    'raw', randomBytes(32), AES_GCM, true, ['encrypt', 'decrypt']
  );
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, utf8ToBytes(plaintext));

  const wrapped = {};
  for (const member of members) {
    const theirPub = await importPublicKeyRaw(member.pubKey);
    const wrapKey = await sharedAesKey(myPriv, theirPub);
    const wrapIv = randomBytes(12);
    const rawKey = await crypto.subtle.exportKey('raw', sessionKey);
    const wct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, wrapKey, rawKey);
    wrapped[member.id] = { iv: bytesToBase64(wrapIv), data: bytesToBase64(new Uint8Array(wct)) };
  }

  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ct)), wrapped };
}

export async function decryptGroup(payload, myPriv, fromPub, myId) {
  const mine = payload.wrapped && payload.wrapped[myId];
  if (!mine) throw new Error('Message was not encrypted for you');
  const theirPub = await importPublicKeyRaw(fromPub);
  const wrapKey = await sharedAesKey(myPriv, theirPub);
  const rawKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(mine.iv) }, wrapKey, base64ToBytes(mine.data));
  const sessionKey = await crypto.subtle.importKey(
    'raw', rawKey, AES_GCM, false, ['encrypt', 'decrypt']
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, sessionKey, base64ToBytes(payload.data));
  return bytesToUtf8(new Uint8Array(pt));
}
