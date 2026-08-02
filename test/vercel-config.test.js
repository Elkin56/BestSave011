// test/vercel-config.test.js
// Конфигурация Vercel.
//
// Появился после провалившегося деплоя: расписание `0 * * * *` (раз в час)
// отвергается бесплатным тарифом — «Hobby accounts are limited to daily
// Cron Jobs» — и падает ВЕСЬ деплой, а не только cron. Ошибку такого рода
// должен ловить тест, а не Vercel через минуту после git push.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

describe('vercel.json', () => {
  test('файл разбирается как JSON', () => {
    assert.equal(typeof cfg, 'object');
  });

  test('расписание cron запускается не чаще раза в сутки', () => {
    for (const c of cfg.crons || []) {
      const [min, hour, dom, mon, dow] = c.schedule.trim().split(/\s+/);

      // Час и минута обязаны быть конкретными: '*' или шаг в любом из них
      // означает несколько запусков в сутки.
      for (const [name, v] of [['минуты', min], ['часа', hour]]) {
        assert.doesNotMatch(v, /[*/,-]/,
          `в поле ${name} расписания «${c.schedule}» стоит «${v}» — ` +
          'это чаще раза в сутки, бесплатный тариф Vercel отвергнет деплой');
      }
      assert.ok(Number.isInteger(+min) && Number.isInteger(+hour),
        `нечисловые минута/час в «${c.schedule}»`);
      assert.equal([dom, mon, dow].every(Boolean), true,
        `в расписании «${c.schedule}» не пять полей`);
    }
  });

  test('у каждого cron есть обработчик', () => {
    const routes = readFileSync(join(ROOT, 'api/[...route].js'), 'utf8');
    for (const c of cfg.crons || []) {
      const seg = c.path.replace(/^\/api\//, '').split(/[/?]/)[0];
      assert.match(routes, new RegExp(`\\b${seg},`),
        `${c.path} не подключён в роутере — cron будет получать 404`);
    }
  });

  test('дневная сводка не зависит от точного часа запуска', () => {
    // При одном запуске в сутки поймать «ровно 9:00 у пользователя»
    // невозможно. Логика обязана сравнивать с моментом, а не с часом.
    const d = readFileSync(join(ROOT, 'lib/digest.js'), 'utf8');
    assert.match(d, /lastDailyMoment/);
    assert.doesNotMatch(d, /localHour\([^)]*\) === DAILY_HOUR/,
      'сравнение с точным часом ломает дневную сводку на суточном cron');
  });
});
