// test/digest.test.js
// Режим доставки уведомлений.
//
// Правила, которые легко сломать правкой «по мелочи»:
//   1. тихие часы КОПЯТ события, а не выбрасывают их (прежнее поведение
//      молча теряло ночные уведомления — это была потеря данных);
//   2. просроченная очередь уходит в любом случае, даже ночью и не в свой
//      час: иначе сбой cron превращается в вечное молчание;
//   3. одно событие приходит обычным текстом, а не «сводкой из 1 события».

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDigestDue, shouldQueue, noticeEnabled, buildDigest,
  normalizeMode, localHour, DAILY_HOUR, MODES,
} from '../lib/digest.js';

const at = (iso) => new Date(iso);
const ago = (now, hours) => new Date(now.getTime() - hours * 3600000);

// Полдень UTC — вне любых разумных тихих часов.
const NOON = at('2026-07-26T12:00:00Z');
const NIGHT = at('2026-07-26T02:00:00Z');

const base = { notifyMode: 'instant', quietHours: false, tzOffsetMin: 0 };
const quiet = { ...base, quietHours: true, quietFrom: 23, quietTo: 8 };

/* ─────────────────────────────────────────────
   1. Когда пора отправлять
   ───────────────────────────────────────────── */

describe('isDigestDue', () => {
  test('мгновенный режим — сразу', () => {
    assert.equal(isDigestDue(base, ago(NOON, 0), NOON), true);
  });

  test('почасовой ждёт час', () => {
    const s = { ...base, notifyMode: 'hourly' };
    assert.equal(isDigestDue(s, ago(NOON, 0.5), NOON), false);
    assert.equal(isDigestDue(s, ago(NOON, 1.2), NOON), true);
  });

  test('дневной срабатывает только в свой час', () => {
    const s = { ...base, notifyMode: 'daily' };
    const nine = at('2026-07-26T09:00:00Z');
    const ten = at('2026-07-26T10:00:00Z');
    assert.equal(isDigestDue(s, ago(nine, 5), nine), true);
    assert.equal(isDigestDue(s, ago(ten, 5), ten), false);
  });

  test('дневной считает час по поясу пользователя', () => {
    // Самара (+240): 09:00 местного = 05:00 UTC
    const s = { ...base, notifyMode: 'daily', tzOffsetMin: 240 };
    const utc5 = at('2026-07-26T05:00:00Z');
    assert.equal(localHour(240, utc5), DAILY_HOUR);
    assert.equal(isDigestDue(s, ago(utc5, 3), utc5), true);
  });

  test('молчаливый режим не отправляет никогда', () => {
    const s = { ...base, notifyMode: 'silent' };
    assert.equal(isDigestDue(s, ago(NOON, 100), NOON), false,
      'даже просроченное молчит: человек явно просил не писать');
  });

  test('тихие часы задерживают, но не выбрасывают', () => {
    assert.equal(isDigestDue(quiet, ago(NIGHT, 1), NIGHT), false, 'ночью молчим');
    assert.equal(isDigestDue(quiet, ago(NOON, 1), NOON), true, 'днём отдаём');
  });

  test('просроченное уходит вопреки тишине и режиму', () => {
    // Предохранитель на случай, если cron не отработал сутки.
    const s = { ...quiet, notifyMode: 'daily' };
    assert.equal(isDigestDue(s, ago(NIGHT, 30), NIGHT), true);
  });

  test('пустая очередь не повод для отправки', () => {
    assert.equal(isDigestDue(base, null, NOON), false);
  });

  test('неизвестный режим ведёт себя как мгновенный', () => {
    assert.equal(normalizeMode('чтототакое'), 'instant');
    assert.equal(normalizeMode(undefined), 'instant');
    for (const m of MODES) assert.equal(normalizeMode(m), m);
  });
});

/* ─────────────────────────────────────────────
   2. Копить или слать сразу
   ───────────────────────────────────────────── */

describe('shouldQueue', () => {
  test('мгновенный днём шлёт напрямую', () => {
    assert.equal(shouldQueue(base, NOON), false);
  });

  test('мгновенный ночью копит — это и есть починка потери', () => {
    assert.equal(shouldQueue(quiet, NIGHT), true);
  });

  test('почасовой и дневной копят всегда', () => {
    assert.equal(shouldQueue({ ...base, notifyMode: 'hourly' }, NOON), true);
    assert.equal(shouldQueue({ ...base, notifyMode: 'daily' }, NOON), true);
  });

  test('молчаливый не копит: очередь, которую никто не заберёт, — утечка', () => {
    assert.equal(shouldQueue({ ...base, notifyMode: 'silent' }, NOON), false);
  });
});

/* ─────────────────────────────────────────────
   3. Какие события включены
   ───────────────────────────────────────────── */

describe('noticeEnabled', () => {
  test('уважает переключатели пользователя', () => {
    const s = { notifyMode: 'instant', notifyDeleted: true, notifyEdited: false, notifyFake: true };
    assert.equal(noticeEnabled(s, 'deleted'), true);
    assert.equal(noticeEnabled(s, 'edited'), false);
    assert.equal(noticeEnabled(s, 'fake'), true);
  });

  test('молчаливый режим перекрывает все переключатели', () => {
    const s = { notifyMode: 'silent', notifyDeleted: true, notifyEdited: true, notifyFake: true };
    for (const k of ['deleted', 'edited', 'fake']) assert.equal(noticeEnabled(s, k), false);
  });

  test('умолчания: удаление и фейк включены, правки нет', () => {
    assert.equal(noticeEnabled({}, 'deleted'), true);
    assert.equal(noticeEnabled({}, 'fake'), true);
    assert.equal(noticeEnabled({}, 'edited'), false);
  });
});

/* ─────────────────────────────────────────────
   4. Текст сводки
   ───────────────────────────────────────────── */

describe('buildDigest', () => {
  test('одно событие — обычное уведомление, без обёртки «сводка»', () => {
    const t = buildDigest([{ kind: 'deleted', chatTitle: 'Аня', count: 1 }]);
    assert.match(t, /удалили 1 сообщение/);
    assert.doesNotMatch(t, /Сводка/);
  });

  test('несколько событий группируются по чатам', () => {
    const t = buildDigest([
      { kind: 'deleted', chatTitle: 'Аня', count: 2 },
      { kind: 'edited', chatTitle: 'Аня', count: 1 },
      { kind: 'deleted', chatTitle: 'Работа', count: 3 },
    ]);
    assert.match(t, /Сводка/);
    assert.match(t, /«Аня» — 🗑 удалено 2, ✏️ изменено 1/);
    assert.match(t, /«Работа» — 🗑 удалено 3/);
    assert.match(t, /6 событий/, 'считаем сообщения, а не строки очереди');
  });

  test('дневная сводка подписана иначе', () => {
    const items = [{ kind: 'deleted', chatTitle: 'A', count: 1 },
                   { kind: 'deleted', chatTitle: 'B', count: 1 }];
    assert.match(buildDigest(items, { mode: 'daily' }), /за сутки/);
  });

  test('фейк-контроль сохраняет свой подробный текст', () => {
    const t = buildDigest([{ kind: 'fake', chatTitle: 'Аня', text: '⚠️ подробности' }]);
    assert.equal(t, '⚠️ подробности');
  });

  test('пустой список не порождает сообщения', () => {
    assert.equal(buildDigest([]), null);
    assert.equal(buildDigest(null), null);
  });

  test('склонения не ломаются', () => {
    const one = buildDigest([{ kind: 'deleted', chatTitle: 'A', count: 1 }]);
    const five = buildDigest([{ kind: 'deleted', chatTitle: 'A', count: 5 }]);
    assert.match(one, /1 сообщение/);
    assert.match(five, /5 сообщений/);
  });
});
