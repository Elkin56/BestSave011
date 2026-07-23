// test/access.test.js
// Проверки разграничения доступа.
//
// Главный сценарий, из-за которого всё это писалось:
// Алиса и Боб — оба пользователи BestSave с подключённым Telegram Business.
// Оба переписываются с Карлом. Строка chat уникальна по tg_chat_id, поэтому
// обе переписки попадают в ОДИН chat_id. Раньше это означало, что Алиса
// читала переписку Боба с Карлом, включая удалённые сообщения.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { signResourceToken, verifyResourceToken } from '../lib/auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* ─────────────────────────────────────────────
   1. Модель видимости
   ───────────────────────────────────────────── */

// Точная копия правила из lib/db.js (VISIBLE), выраженная в JS.
// Если правило в SQL меняют — этот тест должен меняться осознанно.
function canSee(message, viewerTgId, link) {
  return message.owner_tg_id === viewerTgId ||
    (message.owner_tg_id === null && !link.via_business);
}

describe('видимость сообщений', () => {
  const ALICE = 1001, BOB = 2002, CARL = 3003;
  const bizLink = { via_business: true };
  const groupLink = { via_business: false };

  test('Алиса не видит копию Боба в общем личном чате с Карлом', () => {
    const bobsCopy = { owner_tg_id: BOB, text: 'переписка Боба с Карлом' };
    assert.equal(canSee(bobsCopy, ALICE, bizLink), false);
    assert.equal(canSee(bobsCopy, BOB, bizLink), true);
  });

  test('удалённое сообщение чужого архива тоже недоступно', () => {
    const bobsDeleted = { owner_tg_id: BOB, is_deleted: true };
    assert.equal(canSee(bobsDeleted, ALICE, bizLink), false);
  });

  test('свой личный архив виден владельцу', () => {
    const alicesCopy = { owner_tg_id: ALICE };
    assert.equal(canSee(alicesCopy, ALICE, bizLink), true);
  });

  test('сообщения группы общие для всех подключивших', () => {
    const groupMsg = { owner_tg_id: null };
    assert.equal(canSee(groupMsg, ALICE, groupLink), true);
    assert.equal(canSee(groupMsg, BOB, groupLink), true);
    assert.equal(canSee(groupMsg, CARL, groupLink), true);
  });

  test('бесхозная копия в личном чате не видна никому', () => {
    // Так помечены сообщения, накопленные до разделения архивов:
    // владельца задним числом не установить, показывать наугад нельзя.
    const legacy = { owner_tg_id: null };
    assert.equal(canSee(legacy, ALICE, bizLink), false);
    assert.equal(canSee(legacy, BOB, bizLink), false);
  });

  test('спорные копии (owner 0) не совпадают ни с одним реальным tg id', () => {
    const quarantined = { owner_tg_id: 0 };
    for (const viewer of [ALICE, BOB, CARL]) {
      assert.equal(canSee(quarantined, viewer, bizLink), false);
    }
  });
});

/* ─────────────────────────────────────────────
   2. Ресурсные токены
   ───────────────────────────────────────────── */

describe('токен для медиа и выгрузки', () => {
  const SECRET = 'test-bot-token:AAA';

  test('свой токен проходит проверку и возвращает того же пользователя', () => {
    const t = signResourceToken(555, SECRET);
    const r = verifyResourceToken(t, SECRET);
    assert.equal(r.ok, true);
    assert.equal(r.userId, 555);
  });

  test('подменённый id не проходит — подпись покрывает его', () => {
    const t = signResourceToken(555, SECRET);
    const forged = t.replace(/^555\./, '999.');
    assert.equal(verifyResourceToken(forged, SECRET).ok, false);
  });

  test('токен, подписанный чужим ключом, отклоняется', () => {
    const t = signResourceToken(555, 'другой-токен');
    assert.equal(verifyResourceToken(t, SECRET).ok, false);
  });

  test('просроченный токен отклоняется', () => {
    const t = signResourceToken(555, SECRET, 1_000_000);
    const r = verifyResourceToken(t, SECRET, 1_000_000 + 7 * 3600);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'token expired');
  });

  test('срок нельзя продлить — он входит в подпись', () => {
    const t = signResourceToken(555, SECRET, 1_000_000);
    const [id, , sig] = t.split('.');
    const extended = `${id}.${1_000_000 + 99_999}.${sig}`;
    assert.equal(verifyResourceToken(extended, SECRET).ok, false);
  });

  test('мусор вместо токена не роняет проверку', () => {
    for (const bad of ['', 'abc', 'a.b', '1.2.3.4', null, undefined, 42]) {
      assert.equal(verifyResourceToken(bad, SECRET).ok, false);
    }
  });
});

/* ─────────────────────────────────────────────
   3. Регрессионный сканер запросов
   ───────────────────────────────────────────── */
// Главная защита от повторения бага: любой новый запрос, читающий message,
// обязан ограничить выборку владельцем. Тест смотрит исходники, а не БД,
// поэтому работает и без подключения к Postgres.

const HANDLERS = join(ROOT, 'lib', 'handlers');

function readHandlers() {
  return readdirSync(HANDLERS)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ name: f, src: readFileSync(join(HANDLERS, f), 'utf8') }));
}

describe('запросы к message ограничены владельцем', () => {
  const READS_MESSAGES = /FROM\s+message\b/i;

  // Единственное исключение: панель владельца считает агрегаты по всей базе.
  // Оно безопасно ровно до тех пор, пока оттуда не возвращаются строки —
  // это проверяется отдельно тестом «только агрегаты» ниже.
  const AGGREGATE_ONLY = new Set(['admin.js']);

  test('каждый обработчик, читающий message, применяет VISIBLE', () => {
    const offenders = [];
    for (const { name, src } of readHandlers()) {
      if (!READS_MESSAGES.test(src)) continue;
      if (AGGREGATE_ONLY.has(name)) continue;
      const imported = /import\s*\{[^}]*\bVISIBLE\b[^}]*\}\s*from\s*'\.\.\/db\.js'/.test(src);
      const used = (src.match(/\bVISIBLE\b/g) || []).length >= 2;
      if (!imported || !used) offenders.push(name);
    }
    assert.deepEqual(offenders, [],
      `эти обработчики читают message без фильтра владельца: ${offenders.join(', ')}`);
  });

  test('исключение из правила возвращает только агрегаты', () => {
    // Страховка для AGGREGATE_ONLY: если однажды в админку добавят выборку
    // строк, тест упадёт и заставит либо убрать её, либо пересмотреть решение.
    for (const name of AGGREGATE_ONLY) {
      const src = readFileSync(join(HANDLERS, name), 'utf8');
      // Каждое поле в SELECT из message должно быть агрегатом или датой,
      // а звёздочка и выборка колонок сообщений запрещены.
      assert.doesNotMatch(src, /SELECT\s+\*/i, `${name}: SELECT * запрещён`);
      assert.doesNotMatch(src, /\bSELECT\s+m\.\w+\s*(,|FROM)/i,
        `${name}: выборка колонок сообщений запрещена`);
      // Отсутствие LIMIT-выборок строк из message
      assert.doesNotMatch(src, /FROM\s+message[\s\S]{0,200}?\bLIMIT\b/i,
        `${name}: выборка строк из message запрещена`);
    }
  });

  test('в обработчиках не осталось выборки только по chat_id', () => {
    // Прежний небезопасный приём: chat_id IN (<чаты пользователя>) без учёта
    // владельца — именно он и открывал чужие переписки.
    const offenders = [];
    for (const { name, src } of readHandlers()) {
      if (/chat_id\s+IN\s+\(\$\{scope\}\)/i.test(src)) offenders.push(name);
    }
    assert.deepEqual(offenders, []);
  });

  test('ресурсные обработчики не принимают initData из адреса', () => {
    // ?auth=<initData> заменён на короткоживущий токен
    for (const { name, src } of readHandlers()) {
      assert.equal(/query\.auth/.test(src), false, `${name} читает initData из query`);
    }
  });
});

describe('запись сообщений привязана к владельцу', () => {
  const db = readFileSync(join(ROOT, 'lib', 'db.js'), 'utf8');
  const bot = readFileSync(join(ROOT, 'api', 'bot.js'), 'utf8');

  test('saveMessage пишет owner_tg_id', () => {
    assert.match(db, /INSERT INTO message[\s\S]*owner_tg_id/);
  });

  test('уникальность учитывает владельца', () => {
    // Иначе копии разных владельцев с одинаковым tg_msg_id затирали бы друг друга
    assert.match(db, /ON CONFLICT \(chat_id, tg_msg_id, COALESCE\(owner_tg_id, -1\)\)/);
    assert.doesNotMatch(db, /ON CONFLICT \(chat_id, tg_msg_id\) DO NOTHING/);
  });

  test('markDeleted и applyEdit ограничены владельцем', () => {
    const markDeleted = db.slice(db.indexOf('export async function markDeleted'));
    assert.match(markDeleted.slice(0, 600), /owner_tg_id IS NOT DISTINCT FROM/);
    const applyEdit = db.slice(db.indexOf('export async function applyEdit'));
    assert.match(applyEdit.slice(0, 600), /owner_tg_id IS NOT DISTINCT FROM/);
  });

  test('бот не архивирует Business-сообщение без активного подключения', () => {
    const fn = bot.slice(bot.indexOf('async function onBusinessMessage'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // Владелец определяется раньше сохранения и при отсутствии — выход
    assert.ok(body.indexOf('ownerOf') < body.indexOf('saveMessage'),
      'владелец должен определяться до сохранения');
    assert.match(body, /if \(!owner\)/);
  });

  test('смена прав бота не выдаёт доступ к архиву группы', () => {
    const fn = bot.slice(bot.indexOf('async function onMyChatMember'));
    assert.match(fn.slice(0, 1600), /wasAbsent/);
  });
});

/* ─────────────────────────────────────────────
   4. Фейк-контроль и активность
   ───────────────────────────────────────────── */

describe('фейк-контроль', () => {
  const db = readFileSync(join(ROOT, 'lib', 'db.js'), 'utf8');
  const bot = readFileSync(join(ROOT, 'api', 'bot.js'), 'utf8');

  test('поиск повтора ограничен архивом владельца', () => {
    // Иначе бот сообщал бы «файл уже был», опираясь на чужую переписку,
    // и тем самым выдавал факт её существования.
    const fn = db.slice(db.indexOf('export async function firstSeenMedia'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /WHERE m\.owner_tg_id = \$1/);
  });

  test('отпечаток файла сохраняется отдельно от file_id', () => {
    // file_id у одного и того же файла разный для разных ботов и чатов,
    // сравнивать по нему нельзя — нужен file_unique_id
    assert.match(bot, /function mediaUniqueIdOf/);
    assert.match(bot, /file_unique_id/);
    assert.match(db, /INSERT INTO message[\s\S]*media_unique_id/);
  });

  test('свои же сообщения на фейк не проверяются', () => {
    const fn = bot.slice(bot.indexOf('async function onBusinessMessage'));
    assert.match(fn.slice(0, 2000), /fromOwner/);
  });

  test('проверяются только медиа, где повтор осмыслен', () => {
    // Стикеры повторяются постоянно — предупреждать о них бессмысленно
    const m = /const FAKE_CHECKED = new Set\(\[([^\]]*)\]\)/.exec(bot);
    assert.ok(m, 'список проверяемых типов не найден');
    assert.ok(!m[1].includes('sticker'));
    assert.ok(m[1].includes('video_note'));
  });
});

describe('графики активности', () => {
  const src = readFileSync(join(ROOT, 'lib', 'handlers', 'activity.js'), 'utf8');

  test('запрос ограничен владельцем', () => {
    assert.match(src, /import \{[^}]*VISIBLE[^}]*\} from '\.\.\/db\.js'/);
    assert.ok((src.match(/\bVISIBLE\b/g) || []).length >= 2);
  });

  test('чужой чат недоступен', () => {
    assert.match(src, /not your chat/);
  });

  test('часовой пояс не подставляется в SQL напрямую', () => {
    // tz приходит от клиента: он проверяется на число и диапазон,
    // а в запрос уходит параметром, а не склейкой строк
    assert.match(src, /Number\.isFinite\(tzRaw\)/);
    assert.match(src, /Math\.abs\(tzRaw\) <= 14 \* 60/);
  });
});

/* ─────────────────────────────────────────────
   5. Аватар собеседника (?peer=)
   ───────────────────────────────────────────── */

describe('аватар собеседника', () => {
  const src = readFileSync(join(ROOT, 'lib', 'handlers', 'avatar.js'), 'utf8');
  const msgs = readFileSync(join(ROOT, 'lib', 'handlers', 'messages.js'), 'utf8');

  test('чужой peer тянется только если он есть в архиве смотрящего', () => {
    // Без этой проверки по /api/avatar?peer=<любой id> можно было бы
    // получить фото произвольного пользователя Telegram.
    assert.match(src, /import \{[^}]*VISIBLE[^}]*\} from '\.\.\/db\.js'/);
    assert.match(src, /m\.sender_tg_id = \$2 AND \$\{VISIBLE\}/);
    assert.match(src, /peer not in your archive/);
  });

  test('нечисловой peer отклоняется до похода в Telegram', () => {
    assert.match(src, /Number\.isFinite\(peer\)/);
  });

  test('фото чата отдаётся только для привязанных чатов', () => {
    // Иначе по /api/avatar?chat=<любой id> можно было бы получить
    // аватар произвольного чата или человека
    assert.match(src, /WHERE u\.tg_id = \$1 AND c\.tg_chat_id = \$2/);
    assert.match(src, /not your chat/);
  });

  test('тип чата решает, чьё фото запрашивать', () => {
    // В личном чате tg_chat_id совпадает с id собеседника,
    // у групп фото берётся через getChat
    assert.match(src, /type === 'private'/);
    assert.match(src, /getChat/);
  });

  test('нечисловой chat не уходит в Telegram', () => {
    assert.match(src, /Number\.isFinite\(targetId\)/);
  });

  test('senderId отдаётся строкой, а не числом', () => {
    // BIGINT в JSON теряет точность как number — сериализуем строкой
    assert.match(msgs, /senderId: r\.sender_tg_id \? String\(r\.sender_tg_id\) : null/);
  });
});

/* ─────────────────────────────────────────────
   6. Тихие часы
   ───────────────────────────────────────────── */

import { isQuietNow } from '../lib/quiet.js';

describe('тихие часы', () => {
  // Самара: UTC+4 → смещение +240 минут
  const samara = { quietHours: true, quietFrom: 23, quietTo: 8, tzOffsetMin: 240 };
  const at = (utc) => new Date(utc);

  test('выключенные тихие часы не молчат никогда', () => {
    const off = { ...samara, quietHours: false };
    assert.equal(isQuietNow(off, at('2026-07-23T21:00:00Z')), false); // 01:00 по Самаре
  });

  test('окно через полночь: 01:00 местного — тихо', () => {
    // 21:00 UTC = 01:00 следующего дня в Самаре
    assert.equal(isQuietNow(samara, at('2026-07-23T21:00:00Z')), true);
  });

  test('23:00 ровно — уже тихо', () => {
    // 19:00 UTC = 23:00 по Самаре
    assert.equal(isQuietNow(samara, at('2026-07-23T19:00:00Z')), true);
  });

  test('08:00 ровно — уже можно писать', () => {
    // 04:00 UTC = 08:00 по Самаре
    assert.equal(isQuietNow(samara, at('2026-07-23T04:00:00Z')), false);
  });

  test('07:59 — ещё тихо', () => {
    assert.equal(isQuietNow(samara, at('2026-07-23T03:59:00Z')), true);
  });

  test('день — не тихо', () => {
    // 10:00 UTC = 14:00 по Самаре
    assert.equal(isQuietNow(samara, at('2026-07-23T10:00:00Z')), false);
  });

  test('часовой пояс действительно учитывается', () => {
    const utc = { ...samara, tzOffsetMin: 0 };
    const moment = at('2026-07-23T21:00:00Z'); // 01:00 в Самаре, 21:00 по UTC
    assert.equal(isQuietNow(samara, moment), true);   // тихо у самарца
    assert.equal(isQuietNow(utc, moment), false);     // но не у пользователя UTC
  });

  test('отрицательное смещение (западнее UTC)', () => {
    const ny = { quietHours: true, quietFrom: 23, quietTo: 8, tzOffsetMin: -240 };
    // 04:00 UTC = 00:00 в Нью-Йорке → тихо
    assert.equal(isQuietNow(ny, at('2026-07-23T04:00:00Z')), true);
    // 16:00 UTC = 12:00 → не тихо
    assert.equal(isQuietNow(ny, at('2026-07-23T16:00:00Z')), false);
  });

  test('обычное окно внутри суток (1→6) тоже работает', () => {
    const day = { quietHours: true, quietFrom: 1, quietTo: 6, tzOffsetMin: 0 };
    assert.equal(isQuietNow(day, at('2026-07-23T03:00:00Z')), true);
    assert.equal(isQuietNow(day, at('2026-07-23T07:00:00Z')), false);
    assert.equal(isQuietNow(day, at('2026-07-23T23:00:00Z')), false);
  });

  test('пустое окно (from === to) тишины не даёт', () => {
    const empty = { quietHours: true, quietFrom: 8, quietTo: 8, tzOffsetMin: 0 };
    assert.equal(isQuietNow(empty, at('2026-07-23T08:00:00Z')), false);
  });
});

describe('уведомления уважают тихие часы', () => {
  const bot = readFileSync(join(ROOT, 'api', 'bot.js'), 'utf8');

  test('все три уведомления проверяют тишину', () => {
    // Удаление, изменение и фейк-контроль — ни одно не должно будить ночью
    const gates = bot.match(/isQuietNow\(s\)/g) || [];
    assert.ok(gates.length >= 3, `ожидалось 3+ проверок, найдено ${gates.length}`);
  });
});

describe('удаление данных', () => {
  const db = readFileSync(join(ROOT, 'lib', 'db.js'), 'utf8');
  const h = readFileSync(join(ROOT, 'lib', 'handlers', 'erase.js'), 'utf8');

  test('требуется явное подтверждение', () => {
    assert.match(h, /confirmation required/);
    assert.match(h, /body\.confirm !== CONFIRM_WORD/);
  });

  test('удаляется личный архив именно этого владельца', () => {
    const fn = db.slice(db.indexOf('export async function eraseUserData'));
    assert.match(fn.slice(0, 1400), /DELETE FROM message WHERE owner_tg_id = \$1/);
  });

  test('чужой общий архив не сносится', () => {
    // Групповые сообщения удаляются только вместе с осиротевшим чатом
    const fn = db.slice(db.indexOf('export async function eraseUserData'));
    assert.match(fn.slice(0, 1600), /NOT EXISTS \(SELECT 1 FROM chat_link/);
  });
});

/* ─────────────────────────────────────────────
   7. Админка
   ───────────────────────────────────────────── */

describe('панель владельца', () => {
  const src = readFileSync(join(ROOT, 'lib', 'handlers', 'admin.js'), 'utf8');
  const auth = readFileSync(join(ROOT, 'lib', 'auth.js'), 'utf8');

  // Поведение проверки доступа проверяется настоящими попытками входа
  // в test/admin-security.test.js. Здесь — только то, что атаками не ловится:
  // граница по содержимому и использование строгой калитки.

  test('используется строгая проверка, а не обычная авторизация', () => {
    assert.match(src, /requireAdmin\(req, res\)/);
    // requireAuth пустил бы любого авторизованного пользователя
    assert.doesNotMatch(src, /requireAuth\(req, res\)/);
  });

  test('калитка требует и список, и свежесть', () => {
    assert.match(auth, /ADMIN_TG_IDS/);
    assert.match(auth, /ADMIN_MAX_AGE_SEC/);
  });

  test('не отдаёт содержимое переписки', () => {
    // Никаких выборок текста, медиа-идентификаторов или названий чатов:
    // политика обещает, что архив виден только владельцу.
    assert.doesNotMatch(src, /SELECT[^;]*\bm\.text\b/i);
    assert.doesNotMatch(src, /media_file_id/);
    assert.doesNotMatch(src, /media_unique_id/);
    assert.doesNotMatch(src, /sender_name/);
    assert.doesNotMatch(src, /c\.title/);
  });

  test('текст читается только как размер, не как содержимое', () => {
    // pg_column_size(text) даёт объём в байтах — сам текст не покидает БД
    assert.match(src, /pg_column_size\(text\)/);
  });

  test('флаг isAdmin на клиенте не даёт прав', () => {
    const me = readFileSync(join(ROOT, 'lib', 'handlers', 'me.js'), 'utf8');
    assert.match(me, /isAdmin/);
    // Решение принимает сервер, независимо от присланного клиентом
    assert.match(auth, /admins\.includes\(String\(result\.user\.id\)\)/);
  });
});

/* ─────────────────────────────────────────────
   8. Закрепление и поиск
   ───────────────────────────────────────────── */

describe('закрепление сообщений', () => {
  const src = readFileSync(join(HANDLERS, 'pin.js'), 'utf8');
  const db = readFileSync(join(ROOT, 'lib', 'db.js'), 'utf8');

  test('закрепить можно только видимое сообщение', () => {
    // Иначе по перебору id закреплялось бы (и раскрывалось) чужое
    assert.match(src, /import \{[^}]*VISIBLE[^}]*\} from '\.\.\/db\.js'/);
    assert.match(src, /m\.id = \$2 AND \$\{VISIBLE\}/);
    assert.match(src, /not your message/);
  });

  test('закрепление принадлежит пользователю, а не сообщению', () => {
    // Флаг в message закрепил бы групповое сообщение сразу всем участникам
    assert.match(db, /CREATE TABLE IF NOT EXISTS message_pin/);
    assert.match(db, /PRIMARY KEY \(user_tg_id, message_id\)/);
    assert.doesNotMatch(db, /ALTER TABLE message ADD COLUMN IF NOT EXISTS is_pinned/);
  });

  test('нецелый msgId отклоняется', () => {
    assert.match(src, /Number\.isInteger\(msgId\)/);
  });

  test('заметка обрезается по длине', () => {
    assert.match(src, /slice\(0, NOTE_MAX\)/);
  });
});

describe('поиск по сообщениям', () => {
  const src = readFileSync(join(HANDLERS, 'messages.js'), 'utf8');

  test('поиск не обходит правило видимости', () => {
    // Условие поиска добавляется к тем же where, где живёт VISIBLE
    assert.match(src, /where\.push\(`m\.text ILIKE/);
    assert.ok((src.match(/\bVISIBLE\b/g) || []).length >= 2);
  });

  test('запрос уходит параметром, а не склейкой', () => {
    assert.match(src, /params\.push\(`%\$\{escaped\}%`\)/);
    assert.doesNotMatch(src, /ILIKE '%\$\{/);
  });

  test('спецсимволы LIKE экранируются', () => {
    // Без этого «%» от пользователя выбрал бы весь архив,
    // а «_» подменял бы любой символ
    assert.match(src, /replace\(\/\(\[\\\\%_\]\)\/g/);
  });

  test('длина запроса ограничена', () => {
    assert.match(src, /slice\(0, 100\)/);
  });

  test('фильтр закреплённых работает на сервере', () => {
    assert.match(src, /filter === 'pinned'/);
    assert.match(src, /LEFT JOIN message_pin p ON p\.message_id = m\.id AND p\.user_tg_id = \$1/);
  });

  test('голосовые фильтруются в запросе, а не после пагинации', () => {
    // Раньше клиент отбрасывал часть уже полученной страницы,
    // из-за чего выдача приходила неполной
    assert.match(src, /filter === 'voices'/);
  });
});
