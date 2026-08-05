// test/erase-admin.test.js
// Очистка архива: пользователем и владельцем продукта.
//
// Здесь защищаются не столько функции, сколько границы. Удаление чужих
// данных — самая опасная возможность в продукте, и ослабить её можно
// одной невинной правкой:
//   1. панель владельца не должна начать отдавать содержимое переписки;
//   2. удаление не должно стать бесследным;
//   3. человек должен узнавать, что его архив очистили;
//   4. подтверждение должно требоваться на каждом разрушительном пути.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const erase = read('lib/handlers/erase.js');
const adminErase = read('lib/handlers/admin-erase.js');
const storage = read('lib/handlers/storage.js');
const db = read('lib/db.js');
const app = read('public/app.js');
const routes = read('api/[...route].js');

/* ─────────────────────────────────────────────
   1. Доступ
   ───────────────────────────────────────────── */

describe('доступ к разрушительным маршрутам', () => {
  test('админские маршруты требуют requireAdmin, а не обычной авторизации', () => {
    for (const [name, src] of [['admin-erase', adminErase], ['storage', storage]]) {
      assert.match(src, /requireAdmin\(req, res\)/, name);
      assert.doesNotMatch(src, /requireAuth\(/, `${name}: requireAuth здесь недостаточно`);
    }
  });

  test('маршруты подключены к роутеру', () => {
    assert.match(routes, /'admin-erase': adminErase/);
    assert.match(routes, /\bstorage,/);
  });

  test('пользовательская очистка идёт под обычной авторизацией', () => {
    assert.match(erase, /requireAuth\(req, res\)/);
  });
});

/* ─────────────────────────────────────────────
   2. Подтверждение
   ───────────────────────────────────────────── */

describe('подтверждение обязательно', () => {
  test('каждый разрушительный маршрут требует слово подтверждения', () => {
    for (const [name, src, word] of [
      ['erase', erase, 'УДАЛИТЬ'],
      ['admin-erase', adminErase, 'УДАЛИТЬ'],
      ['storage', storage, 'ОЧИСТИТЬ'],
    ]) {
      assert.match(src, /confirmation required/, name);
      assert.ok(src.includes(word), `${name}: нет слова ${word}`);
    }
  });

  test('очистка чужого архива не срабатывает без явного tgId', () => {
    assert.match(adminErase, /tgId required/);
    assert.match(adminErase, /\^\\d\+\$/, 'tgId должен проверяться как число');
  });

  test('уборка не запускается с пустым списком категорий', () => {
    assert.match(storage, /nothing selected/);
    assert.match(storage, /SWEEP_KEYS\.includes/, 'категории должны фильтроваться по белому списку');
  });

  test('в интерфейсе каждое удаление проходит через диалог', () => {
    assert.match(app, /function confirmDanger/);
    for (const fn of ['eraseChat', 'eraseAll', 'adminErase', 'runSweep']) {
      const body = app.slice(app.indexOf(`function ${fn}(`));
      assert.match(body.slice(0, 900), /confirmDanger\(/, `${fn} удаляет без подтверждения`);
    }
  });
});

/* ─────────────────────────────────────────────
   3. Граница приватности
   ───────────────────────────────────────────── */

describe('владелец продукта не получает доступ к переписке', () => {
  test('админские ответы не содержат текстов и названий чатов', () => {
    for (const [name, src] of [['admin-erase', adminErase], ['storage', storage]]) {
      assert.doesNotMatch(src, /\bm\.text\b|message\.text|chat_title|c\.title/, name);
      assert.doesNotMatch(src, /SELECT[\s\S]{0,200}\btext\b/i, `${name}: выборка текста сообщений`);
    }
  });

  test('очистка чата возвращает счётчик, а не содержимое', () => {
    const fn = db.slice(db.indexOf('export async function eraseChatForUser'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /messages: msgs\.rowCount/);
    assert.doesNotMatch(body, /SELECT[^;]*\btext\b/i);
  });

  test('чужой чат неотличим от несуществующего', () => {
    // Разные ответы позволили бы перебором выяснить, какие чаты есть у других.
    const fn = db.slice(db.indexOf('export async function eraseChatForUser'));
    assert.match(fn.slice(0, 1400), /if \(!rows\.length\) return null/);
    assert.match(erase, /chat not found/);
  });
});

/* ─────────────────────────────────────────────
   4. Следы и уведомление
   ───────────────────────────────────────────── */

describe('удаление не бесследно', () => {
  test('есть журнал действий владельца', () => {
    assert.match(db, /CREATE TABLE IF NOT EXISTS admin_action/);
    assert.match(db, /export async function logAdminAction/);
  });

  test('обе админские операции пишутся в журнал', () => {
    assert.match(adminErase, /logAdminAction\(/);
    assert.match(storage, /logAdminAction\(/);
  });

  test('журнал переживает удаление пользователя', () => {
    // Если бы записи уходили вместе с пользователем, журнал пустел бы ровно
    // тогда, когда он нужен.
    const fn = db.slice(db.indexOf('export async function eraseUserData'));
    assert.doesNotMatch(fn.slice(0, 1200), /DELETE FROM admin_action/);
  });

  test('бот сообщает человеку об очистке его архива', () => {
    assert.match(adminErase, /sendMessage/);
    assert.match(adminErase, /администратором/);
  });
});

/* ─────────────────────────────────────────────
   5. Что именно чистится
   ───────────────────────────────────────────── */

describe('уборка хранилища трогает только мусор', () => {
  test('каждая категория ограничена данными без владельца', () => {
    const block = db.slice(db.indexOf('const SWEEP = {'), db.indexOf('export const SWEEP_KEYS'));
    // Признак мусора: либо нет владельца, либо запись протухла.
    for (const m of block.matchAll(/del: `([\s\S]*?)`/g)) {
      const sql = m[1];
      assert.ok(/NOT EXISTS|interval/.test(sql),
        `удаление без условия «нет владельца»:\n${sql}`);
    }
  });

  test('нет автоудаления архива по сроку', () => {
    // Политика обещает, что архив живёт, пока владелец сам его не удалит.
    // Срок хранения ввести можно, но это правка политики, а не уборка.
    const block = db.slice(db.indexOf('const SWEEP = {'), db.indexOf('export const SWEEP_KEYS'));
    assert.doesNotMatch(block, /DELETE FROM message m?\s*WHERE\s+m?\.?sent_at/i);
    assert.match(storage, /автоудаления|срок хранения/);
  });

  test('чаты чистятся раньше сообщений — иначе счёт разойдётся с каскадом', () => {
    const fn = db.slice(db.indexOf('export async function storageSweep'));
    assert.match(fn.slice(0, 700), /SWEEP_KEYS\.filter/);
    const keys = db.slice(db.indexOf('const SWEEP = {'));
    assert.ok(keys.indexOf('orphanChats') < keys.indexOf('orphanMessages'),
      'порядок категорий важен: чаты удаляются каскадом вместе с сообщениями');
  });
});

/* ─────────────────────────────────────────────
   6. Область действия пользовательской очистки
   ───────────────────────────────────────────── */

describe('очистка чата не задевает других участников', () => {
  test('удаление ограничено копиями владельца', () => {
    const fn = db.slice(db.indexOf('export async function eraseChatForUser'));
    assert.match(fn.slice(0, 1600), /DELETE FROM message WHERE chat_id = \$1 AND owner_tg_id = \$2/);
  });

  test('чат удаляется, только если не осталось владельцев', () => {
    const fn = db.slice(db.indexOf('export async function eraseChatForUser'));
    assert.match(fn.slice(0, 2000), /NOT EXISTS \(SELECT 1 FROM chat_link/);
  });

  test('интерфейс честно предупреждает об области действия', () => {
    assert.match(app, /Удаляется только ваша копия/);
  });
});
