/**
 * Client-side AES-GCM encrypt/decrypt for bookmark filter payloads.
 *
 * A bookmark's `filters` never leaves the browser in plain form — the API
 * only ever stores/returns the opaque { encrypted, iv } pair (see
 * createBookmark()/getBookmark() in ../api/filters.js). Same fixed
 * passphrase/salt/KDF as the earlier vanilla-JS implementation's
 * bmGetAESKey()/bmEncryptData()/bmDecryptData(), so a bookmark saved by
 * either implementation decrypts correctly in the other.
 */
const PASSPHRASE = 'Kenvue-PharmaVig-2024';
const SALT = 'kenvue-salt';

async function getAESKey() {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(PASSPHRASE),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Encrypts a plain object -> { encrypted, iv } (both base64 strings). */
export async function encryptBookmarkData(obj) {
  const key = await getAESKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(obj))
  );
  return { encrypted: bufToB64(cipherBuf), iv: bufToB64(iv) };
}

/** Reverses encryptBookmarkData() — { encrypted, iv } (base64) -> the original object. */
export async function decryptBookmarkData(encrypted, iv) {
  const key = await getAESKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(iv) },
    key,
    b64ToBuf(encrypted)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}
