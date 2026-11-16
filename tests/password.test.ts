import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

test('password hashes are salted and verify without accepting a wrong password', async () => {
  const first = await hashPassword('ExamplePassword123!');
  const second = await hashPassword('ExamplePassword123!');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('ExamplePassword123!', first), true);
  assert.equal(await verifyPassword('incorrect', first), false);
});

test('existing seed hashes remain compatible', async () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const hash = `scrypt$${salt}$${scryptSync('FunchDemo2026!', salt, 64).toString('hex')}`;
  assert.equal(await verifyPassword('FunchDemo2026!', hash), true);
});

test('plaintext and malformed stored passwords are rejected', async () => {
  for (const value of ['password', '', 'scrypt$bad$bad', 'scrypt$' + 'a'.repeat(32) + '$' + 'g'.repeat(128)]) {
    assert.equal(await verifyPassword('password', value), false);
  }
});
