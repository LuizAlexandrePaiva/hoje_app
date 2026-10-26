import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, normalizeCode, formatCode, deriveKeys, encrypt, decrypt, CODE_LENGTH } from '../app/js/core/vault.js';
import { scenario } from './fixtures.js';

test('código: 24 caracteres do alfabeto, sempre diferente', () => {
  const a = generateCode();
  const b = generateCode();
  assert.equal(a.length, CODE_LENGTH);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{24}$/);
  assert.notEqual(a, b);
  assert.equal(formatCode('ABCDEFGHJKMNPQRSTVWXYZ01'), 'ABCD EFGH JKMN PQRS TVWX YZ01');
});

test('código: aceita digitação imprecisa e recusa inválidos', () => {
  const code = 'K7QM3XRA9TBD2VHN6PWC4FJE';
  assert.equal(normalizeCode('k7qm 3xra 9tbd 2vhn 6pwc 4fje'), code);
  assert.equal(normalizeCode('K7QM-3XRA-9TBD-2VHN-6PWC-4FJE'), code);
  assert.equal(normalizeCode('O0IL' + code.slice(4)), '0011' + code.slice(4)); // O→0, I/L→1
  assert.equal(normalizeCode('curto'), null);
  assert.equal(normalizeCode(code.slice(0, 23) + 'U'), null); // U não existe no alfabeto
});

test('chaves: mesmo código gera mesmo id; códigos diferentes, ids diferentes', async () => {
  const a1 = await deriveKeys('K7QM3XRA9TBD2VHN6PWC4FJE');
  const a2 = await deriveKeys('K7QM3XRA9TBD2VHN6PWC4FJE');
  const b = await deriveKeys('K7QM3XRA9TBD2VHN6PWC4FJF');
  assert.match(a1.id, /^[0-9a-f]{64}$/);
  assert.equal(a1.id, a2.id);
  assert.notEqual(a1.id, b.id);
});

test('cifra e decifra os dados; o envelope não contém texto legível', async () => {
  const state = scenario();
  const { key } = await deriveKeys(generateCode());
  const env = await encrypt(state, key);
  assert.equal(env.v, 1);
  assert.ok(!env.ct.includes('Conta'));
  assert.deepEqual(await decrypt(env, key), state);
});

test('código errado ou envelope adulterado não abre', async () => {
  const { key } = await deriveKeys('K7QM3XRA9TBD2VHN6PWC4FJE');
  const { key: other } = await deriveKeys('K7QM3XRA9TBD2VHN6PWC4FJF');
  const env = await encrypt({ a: 1 }, key);
  await assert.rejects(decrypt(env, other));
  const tampered = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith('AAA=') ? 'BAA=' : 'AAA=') };
  await assert.rejects(decrypt(tampered, key));
});
