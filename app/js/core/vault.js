// Criptografia do backup na nuvem (WebCrypto; funciona no navegador e no Node).
// O código de recuperação é a única chave: dele saem o identificador do backup
// no servidor e a chave AES-GCM. O servidor só vê dados cifrados.

// Base32 de Crockford: sem I, L, O e U, para não confundir na hora de digitar
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 24; // 24 × 5 bits = 120 bits
const SALT = 'hoje-sync-v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle() {
  return globalThis.crypto.subtle;
}

/** Novo código aleatório, ex.: "K7QM 3XRA 9TBD 2VHN 6PWC 4FJE". */
export function generateCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

/** Aceita minúsculas, espaços e letras parecidas (O→0, I/L→1). Devolve null se inválido. */
export function normalizeCode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s.-]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

export function formatCode(code) {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Deriva { id, key } do código: id identifica o backup, key cifra os dados. */
export async function deriveKeys(code) {
  const base = await subtle().importKey('raw', enc.encode(code), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(SALT), info: enc.encode(info) });
  const idBits = await subtle().deriveBits(params('id'), base, 256);
  const key = await subtle().deriveKey(params('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { id: toHex(idBits), key };
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Cifra um objeto. Devolve o envelope que vai para o servidor. */
export async function encrypt(obj, key) {
  let bytes = enc.encode(JSON.stringify(obj));
  if (canZip) bytes = await pipe(bytes, new CompressionStream('gzip'));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { v: 1, z: canZip ? 1 : 0, iv: toBase64(iv), ct: toBase64(ct), updatedAt: new Date().toISOString() };
}

/** Decifra um envelope. Lança erro se a chave estiver errada ou os dados alterados. */
export async function decrypt(envelope, key) {
  if (!envelope || envelope.v !== 1) throw new Error('Formato de backup desconhecido');
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.ct));
  let bytes = new Uint8Array(plain);
  if (envelope.z) bytes = await pipe(bytes, new DecompressionStream('gzip'));
  return JSON.parse(dec.decode(bytes));
}
