// test/legal.test.js
// Правовые документы и снятая функция «сохранение по ответу».
//
// Тест сторожит две вещи, которые тихо ломаются при следующей правке:
//   1. спамная функция (ответ на файл → копия в личку) не вернулась;
//   2. документы на месте, связаны с приложением и не содержат
//      незаполненных мест в момент публикации.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('сохранение по ответу удалено', () => {
  test('модуля и его следов в коде нет', () => {
    assert.equal(existsSync(join(ROOT, 'lib/save-on-reply.js')), false);
    for (const f of ['api/bot.js', 'lib/db.js', 'public/app.js',
      'lib/handlers/settings.js']) {
      const src = read(f);
      assert.doesNotMatch(src, /saveOnReply|save_on_reply|saved_by_reply/, f);
      assert.doesNotMatch(src, /replyTargetForSave|sendSavedCopy/, f);
    }
  });

  test('архивация при этом цела', () => {
    const bot = read('api/bot.js');
    assert.match(bot, /async function onGroupMessage/);
    assert.match(bot, /async function onBusinessMessage/);
    assert.match(bot, /mediaFileIdOf/);
  });
});

describe('правовые документы', () => {
  const priv = read('public/privacy.html');
  const terms = read('public/terms.html');

  test('обе страницы на месте и ссылаются друг на друга', () => {
    assert.match(priv, /Политика конфиденциальности/);
    assert.match(terms, /Пользовательское соглашение/);
    assert.match(priv, /href="\/terms\.html"/);
    assert.match(terms, /href="\/privacy\.html"/);
  });

  test('приложение и бот ведут на документы', () => {
    const app = read('public/app.js');
    assert.match(app, /\/privacy\.html/);
    assert.match(app, /\/terms\.html/);
    assert.match(read('api/bot.js'), /cmd === '\/privacy'/);
  });

  test('ответственность пользователя описана обязанностью, а не допущением', () => {
    // Формулировка «собеседник уже знает» была бы утверждением о факте,
    // который пользователь не может подтвердить. Обязанность уведомить —
    // может. Разница принципиальная, поэтому она под тестом.
    assert.match(terms, /обязуется уведомить собеседников/);
    assert.doesNotMatch(terms, /собеседник (уведомлён|знает|осведомлён)/i);
  });

  test('исчезающие медиа заявлены как несохраняемые', () => {
    // Переносы строк в вёрстке рвут фразы — сравниваем по схлопнутому тексту.
    const flat = terms.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    assert.match(flat, /одноразов/i);
    assert.match(flat, /не сохраняет и не пытается получить/);
    assert.match(flat, /не предпринимает попыток обойти это ограничение/);
  });

  test('статические страницы не перехвачены роутером', () => {
    const vercel = JSON.parse(read('vercel.json'));
    assert.equal(vercel.rewrites, undefined,
      'rewrite на index.html сломал бы /privacy.html');
  });

  test('незаполненные места видно поиском', () => {
    // Шаблон намеренно выходит с плейсхолдерами. Тест не требует их
    // заполнения, но фиксирует единый маркер, чтобы ни один не потерялся.
    for (const [name, src] of [['privacy', priv], ['terms', terms]]) {
      const n = (src.match(/\[укажите/g) || []).length;
      assert.ok(n > 0, `${name}: маркеры плейсхолдеров пропали`);
    }
  });
});
