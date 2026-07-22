import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDaily, buildEventCards, todaysEvents, formatMonth, msgWord, dayWord, formatDate }
  from '../lib/analytics.js';

test('pickDaily всегда завершается и не повторяет элементы', () => {
  const arr = [1,2,3,4,5,6,7,8];
  for (let d = 20000; d < 20500; d++) {
    const r = pickDaily(arr, d, 4);
    assert.equal(r.length, 4);
    assert.equal(new Set(r).size, 4);
  }
});

test('pickDaily стабилен в течение дня и меняется назавтра', () => {
  const arr = [1,2,3,4,5,6,7,8];
  assert.deepEqual(pickDaily(arr, 20651, 4), pickDaily(arr, 20651, 4));
  assert.notDeepEqual(pickDaily(arr, 20651, 4), pickDaily(arr, 20652, 4));
});

test('pickDaily не падает на пустом и коротком массиве', () => {
  assert.deepEqual(pickDaily([], 1, 4), []);
  assert.equal(pickDaily([1,2], 1, 4).length, 2);
});

test('склонения', () => {
  assert.equal(msgWord(1), 'сообщение');
  assert.equal(msgWord(3), 'сообщения');
  assert.equal(msgWord(5), 'сообщений');
  assert.equal(msgWord(11), 'сообщений');
  assert.equal(msgWord(21), 'сообщение');
  assert.equal(dayWord(2), 'дня');
  assert.equal(dayWord(47), 'дней');
});

test('formatMonth переводит YYYY-MM в русский месяц', () => {
  assert.equal(formatMonth('2025-08'), 'август 2025');
  assert.equal(formatMonth('2026-01'), 'январь 2026');
});

test('formatDate даёт русскую дату', () => {
  assert.equal(formatDate(new Date(2025, 7, 12)), '12 августа 2025');
});

test('пустой архив не даёт ни одной карточки', () => {
  assert.deepEqual(buildEventCards({ firsts: [], peaks: [], totals: [] }), []);
});

test('обычный день НЕ попадает в «необычные»', () => {
  const cards = buildEventCards({
    busiestDay: { day: new Date(2025, 7, 12), count: 12 },
    avgPerDay: 10, // всего в 1.2 раза больше — не выделяется
  });
  assert.equal(cards.filter(c => c.kind === 'busiest').length, 0);
});

test('действительно необычный день попадает и считает процент', () => {
  const cards = buildEventCards({
    busiestDay: { day: new Date(2025, 7, 12), count: 42 },
    avgPerDay: 10,
  });
  const c = cards.find(x => x.kind === 'busiest');
  assert.ok(c);
  assert.equal(c.delta, '+320%');
  assert.equal(c.big, '42');
});

test('чат с малым числом сообщений не даёт карточку «всего»', () => {
  const cards = buildEventCards({ totals: [{ title: 'Тест', count: 5, days: 2 }] });
  assert.equal(cards.filter(c => c.kind === 'total').length, 0);
});

test('карточка «всего» считает среднее в день', () => {
  const cards = buildEventCards({ totals: [{ title: 'Ксюша', count: 100, days: 10 }] });
  const c = cards.find(x => x.kind === 'total');
  assert.ok(c.sub.includes('10.0 в день'));
});

test('первое сообщение обрезается, если длинное', () => {
  const long = 'а'.repeat(200);
  const cards = buildEventCards({
    firsts: [{ title: 'Ч', firstDate: new Date(2021,2,14), firstText: long }],
  });
  const c = cards.find(x => x.kind === 'first');
  assert.ok(c.lines[0][1].length < 90);
  assert.ok(c.lines[0][1].endsWith('…»'));
});

test('серия меньше 3 дней не показывается', () => {
  assert.equal(buildEventCards({ streak: 2 }).filter(c=>c.kind==='streak').length, 0);
  assert.equal(buildEventCards({ streak: 5 }).filter(c=>c.kind==='streak').length, 1);
});

test('удалённые показываются только если они есть', () => {
  assert.equal(buildEventCards({ deletedTotal: 0 }).filter(c=>c.kind==='saved').length, 0);
  const c = buildEventCards({ deletedTotal: 12 }).find(x=>x.kind==='saved');
  assert.ok(c.label.includes('сообщений'));
});

test('todaysEvents отдаёт не больше запрошенного', () => {
  const raw = {
    deletedTotal: 5, streak: 10,
    totals: [{title:'A',count:100,days:5},{title:'B',count:200,days:5}],
    peaks: [{title:'A',month:'2025-08',count:50}],
  };
  assert.ok(todaysEvents(raw, 4).length <= 4);
});
