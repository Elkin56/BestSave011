// test/ui-wiring.test.js
// Связность интерфейса: у каждого интерактивного атрибута есть обработчик.
//
// Появился после реального бага: разметка выбора режима доставки была
// добавлена, селектор делегата обновлён, а ветку `if (el.dataset.mode)`
// забыли — кнопки рисовались и не работали. Ни один тест этого не поймал,
// потому что все проверяли логику, а не проводку между разметкой и кодом.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');

// camelCase, в котором атрибут виден коду: data-clear-search → clearSearch
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

describe('проводка интерфейса', () => {
  // Оформительские: разметка их использует, обработчик — нет.
  const DECOR = new Set(['stagger', 'count']);

  // Модификаторы: читаются с элемента, который поймал клик по ДРУГОМУ
  // атрибуту (например, data-unlink на кнопке с data-erasechat).
  // Требовать для них отдельной ветки бессмысленно, но и молча пропускать
  // нельзя: проверяем, что каждый действительно читается в коде.
  const MODIFIERS = new Set(['unlink', 'amode', 'on']);

  const used = [...new Set([...app.matchAll(/data-([a-z-]+)\s*=/g)].map((m) => m[1]))]
    .filter((a) => !DECOR.has(a));

  test('каждый модификатор где-то читается', () => {
    for (const a of used.filter((x) => MODIFIERS.has(x))) {
      assert.match(app, new RegExp(`dataset\\.${camel(a)}\\b`),
        `data-${a} размечен, но нигде не читается`);
    }
  });

  test('каждый data-атрибут разметки перечислен в делегате кликов', () => {
    const sel = /const el = e\.target\.closest\('([^']+)'\)/.exec(app);
    assert.ok(sel, 'делегат кликов не найден');
    for (const a of used.filter((x) => !MODIFIERS.has(x))) {
      assert.ok(sel[1].includes(`[data-${a}]`), `data-${a} не ловится делегатом`);
    }
  });

  test('каждый пойманный атрибут имеет ветку обработки', () => {
    const sel = /const el = e\.target\.closest\('([^']+)'\)/.exec(app)[1];
    for (const m of sel.matchAll(/\[data-([a-z-]+)\]/g)) {
      const key = camel(m[1]);
      assert.match(app, new RegExp(`el\\.dataset\\.${key}\\b`),
        `data-${m[1]} ловится, но не обрабатывается — кнопка будет мёртвой`);
    }
  });

  test('выбор режима доставки доведён до конца', () => {
    // Три звена: разметка, делегат, обработчик. Разрыв любого — мёртвые кнопки.
    assert.match(app, /data-mode="\$\{key\}"/);
    assert.match(app, /el\.dataset\.mode/);
    assert.match(app, /async function setMode/);
    assert.match(app, /notifyMode: mode|S\.settings\.notifyMode = mode/);
  });
});
