// test/gate.test.js
// Условия доступа: разбор реферальных ссылок, статусы подписки и сборка
// состояния гейта.
//
// Главное, что здесь защищается, — три правила, которые легко сломать правкой
// «по мелочи»:
//   1. пройденный гейт больше не пересматривается;
//   2. «проверить не удалось» (null) не то же самое, что «не подписан» (false);
//   3. в payload реферальной ссылки не пролезает ничего, кроме id.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseRefPayload, refPayload, inviteLink, shareUrl,
  isSubscribedStatus, gateState, communityUrl, pluralFriends, SHARE_TEXT,
} from '../lib/gate.js';

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

describe('isSubscribedStatus', () => {
  test('участники канала считаются подписанными', () => {
    for (const s of ['creator', 'administrator', 'member']) {
      assert.equal(isSubscribedStatus(s), true, s);
    }
  });

  test('вышедшие и забаненные — нет', () => {
    for (const s of ['left', 'kicked', undefined, null, 'что-то новое']) {
      assert.equal(isSubscribedStatus(s), false, String(s));
    }
  });

  test('restricted зависит от is_member', () => {
    assert.equal(isSubscribedStatus('restricted', true), true);
    assert.equal(isSubscribedStatus('restricted', false), false);
  });
});

/* ─────────────────────────────────────────────
   3. Сборка состояния
   ───────────────────────────────────────────── */

const base = { need: 3, botUsername: 'b', tgId: 1, passedAt: null };

describe('gateState', () => {
  test('оба условия выполнены — проход', () => {
    const s = gateState({ ...base, subscribed: true, invites: 3 });
    assert.equal(s.passed, true);
    assert.equal(s.invites.left, 0);
  });

  test('одного условия мало', () => {
    assert.equal(gateState({ ...base, subscribed: true, invites: 2 }).passed, false);
    assert.equal(gateState({ ...base, subscribed: false, invites: 5 }).passed, false);
  });

  test('приглашений больше нормы — left не уходит в минус', () => {
    const s = gateState({ ...base, subscribed: true, invites: 10 });
    assert.equal(s.invites.left, 0);
  });

  test('отрицательное и нечисловое количество приводится к нулю', () => {
    assert.equal(gateState({ ...base, subscribed: true, invites: -4 }).invites.count, 0);
    assert.equal(gateState({ ...base, subscribed: true, invites: NaN }).invites.count, 0);
  });

  // Ради этого правила гейт вообще устроен через отметку в БД: человек,
  // однажды выполнивший условия, не должен терять доступ к своему архиву.
  test('пройденный гейт не пересматривается', () => {
    const s = gateState({ ...base, subscribed: false, invites: 0, passedAt: new Date() });
    assert.equal(s.passed, true);
    assert.equal(s.grandfathered, true);
    assert.equal(s.channel.subscribed, true, 'отписка не откатывает доступ');
  });

  // null должен доезжать до интерфейса как есть: показать «вы не подписаны»
  // тому, у кого просто не ответил Telegram, — худший из возможных ответов.
  test('неизвестный статус подписки не превращается в false', () => {
    const s = gateState({ ...base, subscribed: null, invites: 3 });
    assert.equal(s.channel.subscribed, null);
    assert.equal(s.passed, false);
  });

  test('ссылка на приглашение персональная', () => {
    const s = gateState({ ...base, subscribed: true, invites: 0, botUsername: 'bs', tgId: 77 });
    assert.match(s.invites.link, /start=ref77$/);
  });
});

describe('pluralFriends', () => {
  test('склонения', () => {
    const cases = [[1,'друга'],[2,'друга'],[4,'друга'],[5,'друзей'],[11,'друзей'],
      [14,'друзей'],[21,'друга'],[25,'друзей'],[0,'друзей']];
    for (const [n, want] of cases) assert.equal(pluralFriends(n), want, `${n}`);
  });
});

/* ─────────────────────────────────────────────
   4. Защита маршрутов
   ───────────────────────────────────────────── */

describe('роутер закрывает данные архива', () => {
  const router = readFileSync(join(ROOT, 'api/[...route].js'), 'utf8');

  // Список гейтом закрытых маршрутов легко забыть дополнить, добавляя
  // новый эндпоинт. Тест напоминает об этом до продакшена.
  test('все выдающие архив маршруты в GATED', () => {
    const gated = /const GATED = new Set\(\[([\s\S]*?)\]\)/.exec(router);
    assert.ok(gated, 'GATED не найден');
    for (const r of ['stats', 'chats', 'messages', 'activity', 'events',
      'export', 'media', 'avatar', 'pin', 'settings', 'erase']) {
      assert.match(gated[1], new RegExp(`'${r}'`), `${r} должен быть закрыт гейтом`);
    }
  });

  test('сам экран условий и профиль гейтом не закрыты', () => {
    const gated = /const GATED = new Set\(\[([\s\S]*?)\]\)/.exec(router)[1];
    for (const r of ['gate', 'me', 'health', 'bot-info']) {
      assert.doesNotMatch(gated, new RegExp(`'${r}'`), `${r} закрывать нельзя`);
    }
  });

  test('владелец гейт не проходит', () => {
    assert.match(router, /parseAdminIds\(process\.env\.ADMIN_TG_IDS\)/);
  });
});

describe('вебхук получает нажатия кнопок', () => {
  // Без callback_query в allowed_updates кнопка «Проверить» под экраном
  // условий молча не работает — Telegram просто не пришлёт апдейт.
  for (const f of ['lib/handlers/setup.js', 'scripts/set-webhook.js']) {
    test(f, () => {
      assert.match(readFileSync(join(ROOT, f), 'utf8'), /'callback_query'/);
    });
  }
});
