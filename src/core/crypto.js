import { base64ToBytes, bytesToBase64 } from "./base64.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function requireCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable.");
  }

  return globalThis.crypto;
}

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  requireCrypto().getRandomValues(bytes);
  return bytes;
}

async function importPasswordKey(password) {
  return requireCrypto().subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
}

export async function deriveKeyFromPassword(password, saltBytes, iterations = 100000) {
  const passwordKey = await importPasswordKey(password);
  return requireCrypto().subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKey(key) {
  const rawKey = await requireCrypto().subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(rawKey));
}

export async function importKey(encodedKey) {
  return requireCrypto().subtle.importKey(
    "raw",
    base64ToBytes(encodedKey),
    {
      name: "AES-GCM"
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function normalizeAdditionalData(additionalData) {
  if (additionalData === undefined || additionalData === null) {
    return undefined;
  }

  return typeof additionalData === "string"
    ? encoder.encode(additionalData)
    : additionalData;
}

export function createAesGcmParams(iv, additionalData) {
  const params = {
    name: "AES-GCM",
    iv
  };
  const normalizedAdditionalData = normalizeAdditionalData(additionalData);
  if (normalizedAdditionalData !== undefined) {
    params.additionalData = normalizedAdditionalData;
  }
  return params;
}

async function encryptBytes(bytes, key, additionalData) {
  const iv = randomBytes(12);
  const ciphertext = await requireCrypto().subtle.encrypt(
    createAesGcmParams(iv, additionalData),
    key,
    bytes
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptBytes(blob, key, additionalData) {
  const plaintext = await requireCrypto().subtle.decrypt(
    createAesGcmParams(base64ToBytes(blob.iv), additionalData),
    key,
    base64ToBytes(blob.ciphertext)
  );

  return new Uint8Array(plaintext);
}

export async function encryptString(value, key, additionalData) {
  return encryptBytes(encoder.encode(value), key, additionalData);
}

export async function decryptString(blob, key, additionalData) {
  const bytes = await decryptBytes(blob, key, additionalData);
  return decoder.decode(bytes);
}

export async function encryptJson(value, key, additionalData) {
  return encryptString(JSON.stringify(value), key, additionalData);
}

export async function decryptJson(blob, key, additionalData) {
  const plaintext = await decryptString(blob, key, additionalData);
  return JSON.parse(plaintext);
}
