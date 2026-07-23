// test/admin-security.test.js
// Атакующие тесты доступа в панель владельца.
//
// Здесь не проверяется «есть ли нужная строчка в коде» — здесь строятся
// настоящие запросы и делаются попытки войти: с подделанной подписью,
// с чужим id, с просроченным и повторно использованным initData.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireAdmin, parseAdminIds } from '../lib/auth.js';

const BOT_TOKEN = '7000000000:AAHtest-token-for-suite';
const OWNER = 111222333;      // владелец продукта
const STRANGER = 999888777;   // посторонний пользователь

/** Собирает ПОДЛИННЫЙ initData: так его подписывает Telegram. */
function makeInitData({ id, username = 'user', authDate = Math.floor(Date.now() / 1000),
                        token = BOT_TOKEN, extra = {} } = {}) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAEtest',
    user: JSON.stringify({ id, first_name: 'Test', username }),
    ...extra,
  });
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

/** Мок req/res: фиксируем статус и тело ответа. */
function mockReq(initData) {
  return { method: 'GET', headers: initData ? { authorization: 'tma ' + initData } : {}, query: {} };
}
function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** Попытка входа: возвращает { allowed, status } */
function tryEnter(initData) {
  const req = mockReq(initData);
  const res = mockRes();
  const allowed = requireAdmin(req, res);
  return { allowed, status: res.statusCode, body: res.body, user: req.tgUser };
}

// Глушим предупреждения: тесты специально вызывают отказы
let warn, log;
beforeEach(() => {
  warn = console.warn; log = console.log;
  console.warn = () => {}; console.log = () => {};
  process.env.BOT_TOKEN = BOT_TOKEN;
  process.env.ADMIN_TG_IDS = String(OWNER);
});
afterEach(() => { console.warn = warn; console.log = log; });

describe('владелец входит', () => {
  test('свежий подлинный initData владельца — доступ есть', () => {
    const r = tryEnter(makeInitData({ id: OWNER }));
    assert.equal(r.allowed, true);
    assert.equal(r.user.id, OWNER);
  });

  test('владелец среди нескольких админов', () => {
    process.env.ADMIN_TG_IDS = `555, ${OWNER} ,777`; // с пробелами
    assert.equal(tryEnter(makeInitData({ id: OWNER })).allowed, true);
  });
});

describe('посторонний не входит', () => {
  test('подлинный initData обычного пользователя — отказ', () => {
    const r = tryEnter(makeInitData({ id: STRANGER }));
    assert.equal(r.allowed, false);
    assert.equal(r.status, 404, 'должен быть 404, а не 403');
  });

  test('ответ не раскрывает причину отказа', () => {
    // Иначе по тексту можно понять, что эндпоинт существует и чем недоволен
    const r = tryEnter(makeInitData({ id: STRANGER }));
    assert.deepEqual(r.body, { error: 'not found' });
  });

  test('запрос вообще без авторизации — отказ', () => {
    const r = tryEnter(null);
    assert.equal(r.allowed, false);
    assert.equal(r.status, 404);
  });
});

describe('подделка подписи', () => {
  test('подмена id в готовом initData ломает подпись', () => {
    // Классическая атака: взять свой валидный initData и вписать чужой id
    const mine = makeInitData({ id: STRANGER });
    const forged = mine.replace(
      encodeURIComponent(JSON.stringify({ id: STRANGER, first_name: 'Test', username: 'user' })),
      encodeURIComponent(JSON.stringify({ id: OWNER, first_name: 'Test', username: 'user' }))
    );
    assert.notEqual(forged, mine, 'подстановка должна была произойти');
    assert.equal(tryEnter(forged).allowed, false);
  });

  test('initData, подписанный другим ботом, не проходит', () => {
    const other = makeInitData({ id: OWNER, token: '7000000000:AAOTHER-token' });
    assert.equal(tryEnter(other).allowed, false);
  });

  test('удаление hash не открывает дверь', () => {
    const p = new URLSearchParams(makeInitData({ id: OWNER }));
    p.delete('hash');
    assert.equal(tryEnter(p.toString()).allowed, false);
  });

  test('пустой и мусорный hash не проходят', () => {
    for (const bad of ['', 'deadbeef', '0'.repeat(64)]) {
      const p = new URLSearchParams(makeInitData({ id: OWNER }));
      p.set('hash', bad);
      assert.equal(tryEnter(p.toString()).allowed, false, `hash=${bad}`);
    }
  });

  test('дописанные поля ломают подпись', () => {
    // Подпись покрывает все поля, поэтому добавить своё нельзя
    const base = makeInitData({ id: OWNER });
    assert.equal(tryEnter(base + '&is_admin=true').allowed, false);
  });
});

describe('свежесть и повтор', () => {
  test('initData старше часа не пускает даже владельца', () => {
    const old = makeInitData({ id: OWNER, authDate: Math.floor(Date.now() / 1000) - 3601 });
    const r = tryEnter(old);
    assert.equal(r.allowed, false, 'просроченный initData должен отклоняться');
  });

  test('окно повтора сужено против общего суточного', () => {
    // Тот же initData прошёл бы обычную проверку (сутки), но не админскую
    const twoHours = makeInitData({ id: OWNER, authDate: Math.floor(Date.now() / 1000) - 7200 });
    assert.equal(tryEnter(twoHours).allowed, false);
  });

  test('свежий initData в пределах часа проходит', () => {
    const recent = makeInitData({ id: OWNER, authDate: Math.floor(Date.now() / 1000) - 1800 });
    assert.equal(tryEnter(recent).allowed, true);
  });

  test('дата из будущего отклоняется', () => {
    const future = makeInitData({ id: OWNER, authDate: Math.floor(Date.now() / 1000) + 600 });
    assert.equal(tryEnter(future).allowed, false);
  });
});

describe('конфигурация списка владельцев', () => {
  test('пустой ADMIN_TG_IDS закрывает доступ всем, включая владельца', () => {
    process.env.ADMIN_TG_IDS = '';
    assert.equal(tryEnter(makeInitData({ id: OWNER })).allowed, false);
  });

  test('отсутствующая переменная закрывает доступ', () => {
    delete process.env.ADMIN_TG_IDS;
    assert.equal(tryEnter(makeInitData({ id: OWNER })).allowed, false);
  });

  test('мусор в списке не создаёт лазеек', () => {
    // Пустые элементы и нечисловые значения отбрасываются, а не превращаются
    // в записи, с которыми что-то может случайно совпасть
    assert.deepEqual(parseAdminIds(',,  ,'), []);
    assert.deepEqual(parseAdminIds('admin,undefined,null,NaN'), []);
    assert.deepEqual(parseAdminIds('*'), []);
    assert.deepEqual(parseAdminIds('123abc'), []);
    assert.deepEqual(parseAdminIds(' 42 , 77 '), ['42', '77']);
  });

  test('звёздочка не работает как «все»', () => {
    process.env.ADMIN_TG_IDS = '*';
    assert.equal(tryEnter(makeInitData({ id: STRANGER })).allowed, false);
  });

  test('нельзя подобрать доступ, назвавшись username владельца', () => {
    // Сверка идёт по числовому id, а не по имени — username подделывается легко
    process.env.ADMIN_TG_IDS = String(OWNER);
    const r = tryEnter(makeInitData({ id: STRANGER, username: 'owner' }));
    assert.equal(r.allowed, false);
  });
});

describe('типы и краевые значения id', () => {
  test('id строкой не принимается', () => {
    // JSON с "id":"111222333" — проверка типа должна это отсечь
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: String(OWNER), first_name: 'T' }),
    });
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
    // Подпись подлинная, но тип id неверный — доступа быть не должно
    assert.equal(tryEnter(params.toString()).allowed, false);
  });

  test('загрязнение прототипа через user не проходит', () => {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: '{"id":' + STRANGER + ',"__proto__":{"id":' + OWNER + '}}',
    });
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
    assert.equal(tryEnter(params.toString()).allowed, false);
    // И глобальный прототип не затронут
    assert.equal({}.id, undefined);
  });
});

describe('изоляция от других способов авторизации', () => {
  test('ресурсный токен не открывает админку', () => {
    // Токен для картинок короче и выдаётся всем — он не должен работать здесь
    const req = { method: 'GET', headers: {}, query: { t: `${OWNER}.9999999999.abc` } };
    const res = mockRes();
    assert.equal(requireAdmin(req, res), false);
    assert.equal(res.statusCode, 404);
  });

  test('initData в query не принимается', () => {
    // Только заголовок: адресная строка попадает в логи и историю
    const req = { method: 'GET', headers: {}, query: { auth: makeInitData({ id: OWNER }) } };
    const res = mockRes();
    assert.equal(requireAdmin(req, res), false);
  });

  test('без BOT_TOKEN на сервере доступа нет', () => {
    const saved = process.env.BOT_TOKEN;
    delete process.env.BOT_TOKEN;
    assert.equal(tryEnter(makeInitData({ id: OWNER })).allowed, false);
    process.env.BOT_TOKEN = saved;
  });
});
