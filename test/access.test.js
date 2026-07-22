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

  test('каждый обработчик, читающий message, применяет VISIBLE', () => {
    const offenders = [];
    for (const { name, src } of readHandlers()) {
      if (!READS_MESSAGES.test(src)) continue;
      // Правило может подставляться как ${VISIBLE} в шаблон или передаваться
      // идентификатором в список условий — важно, что оно импортировано
      // из lib/db.js и действительно используется.
      const imported = /import\s*\{[^}]*\bVISIBLE\b[^}]*\}\s*from\s*'\.\.\/db\.js'/.test(src);
      const used = (src.match(/\bVISIBLE\b/g) || []).length >= 2;
      if (!imported || !used) offenders.push(name);
    }
    assert.deepEqual(offenders, [],
      `эти обработчики читают message без фильтра владельца: ${offenders.join(', ')}`);
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
