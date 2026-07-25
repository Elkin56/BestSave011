// test/invite.test.js
// Приглашения: разбор реферальных ссылок и сборка ссылок для шаринга.
//
// Условий доступа (подписка на канал + три друга) в проекте больше нет —
// тесты гейта убраны вместе с ним. Здесь осталось то, что продолжает работать:
// личная ссылка «позвать друзей» и счётчик переходов.
//
// Главное, что защищается: в payload реферальной ссылки не пролезает ничего,
// кроме id. Это единственное место, где число из внешнего мира едет в базу.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseRefPayload, refPayload, inviteLink, shareUrl,
  communityUrl, pluralFriends, SHARE_TEXT,
} from '../lib/invite.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ─────────────────────────────────────────────
   1. Реферальный payload
   ───────────────────────────────────────────── */

describe('parseRefPayload', () => {
  test('разбирает нормальную ссылку', () => {
    assert.equal(parseRefPayload('ref123456'), 123456);
    assert.equal(parseRefPayload('  ref7  '), 7);
  });

  test('отбрасывает мусор', () => {
    for (const bad of [
      '', null, undefined, 'ref', 'ref0', 'ref-5', 'ref1.5', 'ref 1',
      'REF123', 'xref123', 'ref123x', 'ref' + '9'.repeat(25),
      'ref123; DROP TABLE referral',
    ]) {
      assert.equal(parseRefPayload(bad), null, `должен отбросить: ${bad}`);
    }
  });

  test('round-trip с refPayload', () => {
    assert.equal(parseRefPayload(refPayload(42)), 42);
  });
});

describe('ссылки', () => {
  test('inviteLink кладёт payload в start-параметр', () => {
    assert.equal(inviteLink('mybot', 99), 'https://t.me/mybot?start=ref99');
  });

  test('@ в имени бота не удваивается', () => {
    assert.equal(inviteLink('@mybot', 99), 'https://t.me/mybot?start=ref99');
  });

  test('shareUrl кодирует ссылку и текст, ничего не ломая', () => {
    const u = new URL(shareUrl('mybot', 5));
    assert.equal(u.searchParams.get('url'), 'https://t.me/mybot?start=ref5');
    assert.equal(u.searchParams.get('text'), SHARE_TEXT);
  });

  test('communityUrl: @username → t.me, override побеждает', () => {
    assert.equal(communityUrl('@chan', undefined), 'https://t.me/chan');
    assert.equal(communityUrl('-1001', 'https://t.me/+abc'), 'https://t.me/+abc');
  });
});

/* ─────────────────────────────────────────────
   2. Статусы подписки
   ───────────────────────────────────────────── */

describe('pluralFriends', () => {
  test('склонения', () => {
    const cases = [[1,'друга'],[2,'друга'],[4,'друга'],[5,'друзей'],[11,'друзей'],
      [14,'друзей'],[21,'друга'],[25,'друзей'],[0,'друзей']];
    for (const [n, want] of cases) assert.equal(pluralFriends(n), want, `${n}`);
  });
});

/* ─────────────────────────────────────────────
   3. Условий доступа больше нет
   ───────────────────────────────────────────── */

describe('гейт снят полностью', () => {
  const router = readFileSync(join(ROOT, 'api/[...route].js'), 'utf8');
  const bot = readFileSync(join(ROOT, 'api/bot.js'), 'utf8');
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');

  // Гейт возвращается тихо: достаточно, чтобы кто-то восстановил проверку
  // «из лучших побуждений». Тест ловит это до продакшена.
  test('роутер никого не заворачивает', () => {
    assert.doesNotMatch(router, /GATED/);
    assert.doesNotMatch(router, /gate_required/);
    assert.doesNotMatch(router, /passesGate/);
  });

  test('бот не показывает экран условий', () => {
    assert.doesNotMatch(bot, /sendGateIfNeeded|gateKeyboard|gateText/);
    assert.doesNotMatch(bot, /REQUIRED_INVITES/);
    assert.doesNotMatch(bot, /Подписаться на/);
  });

  test('приложение открывается без проверок', () => {
    assert.doesNotMatch(app, /gate_required|S\.gate\b/);
    assert.doesNotMatch(app, /Условия/);
  });

  test('маршрут /api/gate остался ради старых клиентов и всегда пускает', () => {
    // Mini App кэшируется на устройстве: клиент прошлой версии первым делом
    // дёргает /api/gate. 404 уронил бы ему приложение на старте.
    const h = readFileSync(join(ROOT, 'lib/handlers/gate.js'), 'utf8');
    assert.match(h, /passed: true/);
    assert.match(router, /\bgate,/);
  });

  test('приглашения работают, но ничего не требуют', () => {
    assert.match(bot, /countReferrals/);
    assert.doesNotMatch(bot, /осталось \$\{left\}/);
  });
});
