// Тесты валидации initData. Запуск: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyInitData } from '../lib/auth.js';

const TOKEN = '123456:TEST_TOKEN';

function makeInitData(overrides = {}, token = TOKEN) {
  const user = JSON.stringify({ id: 42, first_name: 'Матео', username: 'mateo' });
  const params = new URLSearchParams({
    auth_date: String(overrides.auth_date ?? Math.floor(Date.now() / 1000)),
    query_id: 'AAtest',
    user,
  });
  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(pairs).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('валидный initData принимается', () => {
  const r = verifyInitData(makeInitData(), TOKEN);
  assert.equal(r.ok, true);
  assert.equal(r.user.id, 42);
});

test('подделанные данные отклоняются', () => {
  const good = makeInitData();
  const tampered = good.replace('mateo', 'hacker');
  assert.equal(verifyInitData(tampered, TOKEN).ok, false);
});

test('чужой токен отклоняется', () => {
  assert.equal(verifyInitData(makeInitData(), '999:OTHER').ok, false);
});

test('нет hash — отклоняется', () => {
  assert.equal(verifyInitData('user=%7B%7D&auth_date=1', TOKEN).ok, false);
});

test('протухший initData отклоняется', () => {
  const old = makeInitData({ auth_date: Math.floor(Date.now() / 1000) - 3 * 86400 });
  const r = verifyInitData(old, TOKEN);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'initData expired');
});

test('initData из будущего отклоняется', () => {
  const future = makeInitData({ auth_date: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(verifyInitData(future, TOKEN).ok, false);
});

test('свежий суточной давности — ещё валиден', () => {
  const almost = makeInitData({ auth_date: Math.floor(Date.now() / 1000) - 86400 + 30 });
  assert.equal(verifyInitData(almost, TOKEN).ok, true);
});

test('пустой initData отклоняется', () => {
  assert.equal(verifyInitData('', TOKEN).ok, false);
  assert.equal(verifyInitData(null, TOKEN).ok, false);
});

test('нет токена на сервере — отклоняется', () => {
  assert.equal(verifyInitData(makeInitData(), '').ok, false);
});
