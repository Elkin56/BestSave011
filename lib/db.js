// lib/db.js
// Слой доступа к Postgres (Neon/Supabase/Vercel Postgres — любой по DATABASE_URL).
// Пул переиспользуется между вызовами serverless-функции в рамках одного контейнера.

import pg from 'pg';

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString,
      // Managed Postgres (Neon/Supabase) требует SSL
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 3, // serverless: держим пул маленьким
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

export async function q(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// ─── Схема ───
// Идемпотентная инициализация. Вызывается ботом при старте и роутом /api/health.
// В проде схему обычно катят миграциями; для триала bootstrap на месте — приемлемо.

export async function ensureSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS app_user (
      id           BIGSERIAL PRIMARY KEY,
      tg_id        BIGINT UNIQUE NOT NULL,
      username     TEXT,
      first_name   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS chat (
      id           BIGSERIAL PRIMARY KEY,
      tg_chat_id   BIGINT UNIQUE NOT NULL,
      title        TEXT,
      type         TEXT,                         -- group | supergroup | channel
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Кто из пользователей привязал какой чат (многие-ко-многим).
    CREATE TABLE IF NOT EXISTS chat_link (
      user_id      BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      chat_id      BIGINT NOT NULL REFERENCES chat(id) ON DELETE CASCADE,
      bot_is_admin BOOLEAN NOT NULL DEFAULT false, -- может ли бот читать все сообщения
      linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, chat_id)
    );

    CREATE TABLE IF NOT EXISTS message (
      id           BIGSERIAL PRIMARY KEY,
      chat_id      BIGINT NOT NULL REFERENCES chat(id) ON DELETE CASCADE,
      tg_msg_id    BIGINT NOT NULL,
      sender_tg_id BIGINT,
      sender_name  TEXT,
      text         TEXT,
      media_type   TEXT,                         -- photo | video | voice | document | null
      is_edited    BOOLEAN NOT NULL DEFAULT false,
      is_deleted   BOOLEAN NOT NULL DEFAULT false, -- ставится, когда узнаём об удалении
      sent_at      TIMESTAMPTZ NOT NULL,
      edited_at    TIMESTAMPTZ,
      deleted_at   TIMESTAMPTZ,                  -- когда узнали об удалении
      biz_conn_id  TEXT,                         -- если пришло через Business
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (chat_id, tg_msg_id)
    );

    -- История версий отредактированных сообщений: храним «до».
    CREATE TABLE IF NOT EXISTS message_revision (
      id          BIGSERIAL PRIMARY KEY,
      message_id  BIGINT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      text        TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Подключение бота к бизнес-аккаунту пользователя.
    -- Даёт легальный доступ к ЛИЧНЫМ чатам: пользователь сам включает бота
    -- в настройках Telegram Business. Согласие даёт владелец аккаунта.
    CREATE TABLE IF NOT EXISTS business_connection (
      id            TEXT PRIMARY KEY,          -- business_connection_id от Telegram
      user_tg_id    BIGINT NOT NULL,           -- владелец бизнес-аккаунта
      user_chat_id  BIGINT,                    -- личка с владельцем
      can_reply     BOOLEAN NOT NULL DEFAULT false,
      is_enabled    BOOLEAN NOT NULL DEFAULT true,
      connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Миграция для баз, созданных прошлой версией: CREATE TABLE IF NOT EXISTS
    -- не добавляет колонки в существующую таблицу.
    ALTER TABLE message ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;
    ALTER TABLE message ADD COLUMN IF NOT EXISTS biz_conn_id TEXT;
    ALTER TABLE chat_link ADD COLUMN IF NOT EXISTS via_business BOOLEAN NOT NULL DEFAULT false;

    -- file_id медиа от Telegram: по нему бот может скачать файл даже после
    -- удаления сообщения в чате. У сообщений, сохранённых до этой версии,
    -- колонка пустая — их файлы восстановить нельзя, и интерфейс говорит об этом честно.
    ALTER TABLE message ADD COLUMN IF NOT EXISTS media_file_id TEXT;

    -- ══ ВЛАДЕЛЕЦ АРХИВНОЙ КОПИИ ══
    -- Критично для приватности. Строка chat уникальна по tg_chat_id, поэтому
    -- ДВА разных пользователя BestSave, переписывающиеся с ОДНИМ И ТЕМ ЖЕ
    -- человеком через Telegram Business, попадали в один и тот же chat_id —
    -- и видели переписку друг друга.
    --
    -- Теперь у каждой копии есть владелец:
    --   owner_tg_id = <tg id>  — личный архив: виден ТОЛЬКО этому пользователю
    --   owner_tg_id IS NULL    — сообщение группы/канала: общее для участников,
    --                            которые и так видят его в самом Telegram
    ALTER TABLE message ADD COLUMN IF NOT EXISTS owner_tg_id BIGINT;

    -- ── Фейк-контроль ──
    -- file_unique_id стабилен у Telegram для одного и того же физического файла
    -- во всех чатах. Если он уже встречался в архиве, значит прислали повтор,
    -- а не свежую запись.
    ALTER TABLE message ADD COLUMN IF NOT EXISTS media_unique_id TEXT;
    -- Когда этот же файл впервые попал в архив (заполняется при обнаружении повтора)
    ALTER TABLE message ADD COLUMN IF NOT EXISTS repeat_of_at TIMESTAMPTZ;
    -- Дата оригинала для пересланных сообщений: Telegram отдаёт её честно
    ALTER TABLE message ADD COLUMN IF NOT EXISTS orig_sent_at TIMESTAMPTZ;

    -- Настройки уведомлений (бот пишет в личку при удалении/изменении в Business-чатах)
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS notify_deleted BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS notify_edited  BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS notify_fake    BOOLEAN NOT NULL DEFAULT true;

    -- ── Тихие часы ──
    -- Ночью бот не пишет. Время считается в поясе пользователя, поэтому
    -- храним смещение в минутах от UTC (как отдаёт клиент, со знаком «плюс
    -- к востоку»: Самара +240). Границы тоже хранимые — по умолчанию 23:00–08:00,
    -- но их можно поменять, не трогая схему.
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS quiet_hours BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS quiet_from  SMALLINT NOT NULL DEFAULT 23;
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS quiet_to    SMALLINT NOT NULL DEFAULT 8;
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS tz_offset_min INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false;

    -- ── Условия доступа (гейт) ──
    -- Момент, когда пользователь впервые выполнил оба условия. Ставится один
    -- раз и больше не пересчитывается: архив уже собран и принадлежит человеку,
    -- отписка от канала не должна его отбирать.
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS gate_passed_at TIMESTAMPTZ;

    -- Кто кого привёл. invited_tg_id — первичный ключ, а не пара:
    -- один и тот же человек засчитывается ровно одному пригласившему и
    -- ровно один раз, сколько бы ссылок он ни открыл.
    CREATE TABLE IF NOT EXISTS referral (
      invited_tg_id BIGINT PRIMARY KEY,
      inviter_tg_id BIGINT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_referral_inviter ON referral (inviter_tg_id);

    -- ── Закреплённые сообщения ──
    -- Отдельной таблицей, а не флагом в message: в групповом чате строка
    -- сообщения общая для всех участников, и флаг закрепил бы её сразу всем.
    -- Здесь закрепление принадлежит конкретному пользователю.
    CREATE TABLE IF NOT EXISTS message_pin (
      user_tg_id BIGINT NOT NULL,
      message_id BIGINT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      note       TEXT,
      pinned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_tg_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_chat_sent ON message (chat_id, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_message_deleted ON message (chat_id) WHERE is_deleted;
    CREATE INDEX IF NOT EXISTS idx_bizconn_user ON business_connection (user_tg_id);
    -- Поиск повторов идёт всегда в пределах архива одного владельца
    CREATE INDEX IF NOT EXISTS idx_message_fingerprint
      ON message (owner_tg_id, media_unique_id) WHERE media_unique_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_pin_user ON message_pin (user_tg_id, pinned_at DESC);
  `);

  // Разбор ранее накопленных данных выполняем отдельно: часть шагов зависит
  // от результата предыдущих, а один DDL-блок этого не позволяет.
  await migrateOwnership();
}

// Разовая миграция владения для баз, заполненных прошлой версией.
async function migrateOwnership() {
  // 1. Личные (Business) чаты, у которых ровно ОДИН подключивший пользователь —
  //    владелец однозначен, проставляем его.
  await q(`
    UPDATE message m
    SET owner_tg_id = s.tg_id
    FROM (
      SELECT cl.chat_id, MIN(u.tg_id) AS tg_id
      FROM chat_link cl
      JOIN app_user u ON u.id = cl.user_id
      WHERE cl.via_business
      GROUP BY cl.chat_id
      HAVING COUNT(DISTINCT u.tg_id) = 1
    ) s
    WHERE m.chat_id = s.chat_id AND m.owner_tg_id IS NULL
  `);

  // 2. Личные чаты, где подключившихся НЕСКОЛЬКО — ровно тот случай, из-за
  //    которого возникла утечка. Кому принадлежит каждая копия, задним числом
  //    установить нельзя, поэтому такие сообщения не показываются НИКОМУ:
  //    выдать их наугад означало бы показать чужую переписку.
  //    Данные не удаляются — помечаются как спорные (owner_tg_id = 0).
  const amb = await q(`
    UPDATE message m
    SET owner_tg_id = 0
    FROM (
      SELECT cl.chat_id
      FROM chat_link cl
      JOIN app_user u ON u.id = cl.user_id
      WHERE cl.via_business
      GROUP BY cl.chat_id
      HAVING COUNT(DISTINCT u.tg_id) > 1
    ) s
    WHERE m.chat_id = s.chat_id AND m.owner_tg_id IS NULL
  `);
  if (amb.rowCount) {
    console.warn(`ownership: ${amb.rowCount} сообщений в общих личных чатах помечены спорными и скрыты`);
  }

  // 3. Уникальность — теперь с учётом владельца. Прежнее ограничение
  //    UNIQUE (chat_id, tg_msg_id) не только не разделяло архивы, но и ТЕРЯЛО
  //    данные: у разных владельцев нумерация сообщений своя, номера совпадали,
  //    и ON CONFLICT DO NOTHING молча отбрасывал вторую копию.
  await q(`ALTER TABLE message DROP CONSTRAINT IF EXISTS message_chat_id_tg_msg_id_key`);
  await q(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_message_owner_chat_msg
      ON message (chat_id, tg_msg_id, COALESCE(owner_tg_id, -1))
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_message_owner ON message (owner_tg_id)`);
}

// ── Правило видимости ──
// Единственное место, где оно задано. Все читающие запросы обязаны его
// использовать — за этим следит тест test/access.test.js.
//
// $1 везде — tg_id того, кто смотрит.
export const VISIBLE = `(m.owner_tg_id = $1 OR (m.owner_tg_id IS NULL AND NOT cl.via_business))`;

// ─── upsert-хелперы для бота ───

export async function upsertUser(tg) {
  const { rows } = await q(
    `INSERT INTO app_user (tg_id, username, first_name, is_premium)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tg_id) DO UPDATE SET username = EXCLUDED.username,
       first_name = EXCLUDED.first_name, is_premium = EXCLUDED.is_premium
     RETURNING id`,
    [tg.id, tg.username || null, tg.first_name || null, Boolean(tg.is_premium)]
  );
  return rows[0].id;
}

// ─── Условия доступа ───

// Был ли пользователь известен ДО этого захода. Нужно, чтобы реферал
// засчитывался только за нового человека: иначе давний пользователь мог бы
// открыть чужую ссылку и подарить приглашение из воздуха.
export async function userExists(tgId) {
  const { rows } = await q('SELECT 1 FROM app_user WHERE tg_id = $1', [tgId]);
  return rows.length > 0;
}

/**
 * Засчитать приглашение. Возвращает true, только если оно новое.
 * Самоприглашение и повторный переход по ссылке отсекаются здесь,
 * а не на стороне бота, — правило одно и живёт в одном месте.
 */
export async function addReferral(inviterTgId, invitedTgId) {
  const inviter = Number(inviterTgId), invited = Number(invitedTgId);
  if (!inviter || !invited || inviter === invited) return false;

  // Если приглашённый сам кого-то привёл раньше — это уже действующий
  // пользователь, а не новичок: цепочку «сам себя по кругу» так не построить.
  const { rowCount } = await q(
    `INSERT INTO referral (invited_tg_id, inviter_tg_id)
     VALUES ($1, $2) ON CONFLICT (invited_tg_id) DO NOTHING`,
    [invited, inviter]
  );
  return rowCount > 0;
}

export async function countReferrals(tgId) {
  const { rows } = await q(
    'SELECT COUNT(*)::int AS n FROM referral WHERE inviter_tg_id = $1', [tgId]
  );
  return rows[0]?.n || 0;
}

export async function getGatePassedAt(tgId) {
  const { rows } = await q('SELECT gate_passed_at FROM app_user WHERE tg_id = $1', [tgId]);
  return rows[0]?.gate_passed_at || null;
}

// Ставится один раз: COALESCE не даёт перезаписать более раннюю отметку.
export async function markGatePassed(tgId) {
  await q(
    `UPDATE app_user SET gate_passed_at = COALESCE(gate_passed_at, now())
     WHERE tg_id = $1`, [tgId]
  );
}

export async function upsertChat(tgChat) {
  // У личных чатов нет title — там имя собеседника в first_name/last_name.
  // Без этого Business-чаты показывались бы как «Без названия».
  const title =
    tgChat.title ||
    [tgChat.first_name, tgChat.last_name].filter(Boolean).join(' ') ||
    (tgChat.username ? '@' + tgChat.username : null);

  const { rows } = await q(
    `INSERT INTO chat (tg_chat_id, title, type)
     VALUES ($1, $2, $3)
     ON CONFLICT (tg_chat_id) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, chat.title),
       type = EXCLUDED.type
     RETURNING id`,
    [tgChat.id, title, tgChat.type || null]
  );
  return rows[0].id;
}

export async function linkChat(userId, chatId, botIsAdmin, viaBusiness = false) {
  await q(
    `INSERT INTO chat_link (user_id, chat_id, bot_is_admin, via_business)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, chat_id) DO UPDATE SET
       bot_is_admin = EXCLUDED.bot_is_admin,
       via_business = chat_link.via_business OR EXCLUDED.via_business`,
    [userId, chatId, botIsAdmin, viaBusiness]
  );
}

// Сохранить входящее сообщение (архивация). Идемпотентно по (chat_id, tg_msg_id).
// Обновить признак «бот админ» у уже существующих привязок чата,
// НЕ создавая новых: смена прав бота не должна раздавать доступ к архиву.
export async function updateBotAdminFlag(chatId, isAdmin) {
  await q(`UPDATE chat_link SET bot_is_admin = $2 WHERE chat_id = $1`, [chatId, isAdmin]);
}

// Сохранить входящее сообщение (архивация).
// ownerTgId: tg id владельца личного архива, либо null для группы/канала.
// Идемпотентно по (chat_id, tg_msg_id, владелец).
export async function saveMessage(m) {
  await q(
    `INSERT INTO message (chat_id, tg_msg_id, sender_tg_id, sender_name, text, media_type,
                          media_file_id, media_unique_id, repeat_of_at, orig_sent_at,
                          owner_tg_id, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12))
     ON CONFLICT (chat_id, tg_msg_id, COALESCE(owner_tg_id, -1)) DO NOTHING`,
    [m.chatId, m.tgMsgId, m.senderTgId, m.senderName, m.text, m.mediaType,
     m.mediaFileId || null, m.mediaUniqueId || null, m.repeatOfAt || null,
     m.origSentAt ? new Date(m.origSentAt * 1000) : null,
     m.ownerTgId ?? null, m.sentAt]
  );
}

// ─── Фейк-контроль ───

// Когда этот же файл впервые появился в архиве ЭТОГО владельца.
// Область поиска ограничена владельцем: чужой архив не должен участвовать
// ни в проверке, ни в выдаче даты.
export async function firstSeenMedia(ownerTgId, mediaUniqueId) {
  if (!ownerTgId || !mediaUniqueId) return null;
  const { rows } = await q(
    `SELECT m.sent_at, c.title
     FROM message m
     JOIN chat c ON c.id = m.chat_id
     WHERE m.owner_tg_id = $1 AND m.media_unique_id = $2
     ORDER BY m.sent_at ASC
     LIMIT 1`,
    [ownerTgId, mediaUniqueId]
  );
  return rows[0] ? { at: rows[0].sent_at, chat: rows[0].title } : null;
}

// ─── Настройки пользователя ───

export async function getUserSettings(tgId) {
  const { rows } = await q(
    `SELECT notify_deleted, notify_edited, notify_fake,
            quiet_hours, quiet_from, quiet_to, tz_offset_min
     FROM app_user WHERE tg_id = $1`,
    [tgId]
  );
  const r = rows[0];
  return {
    notifyDeleted: r ? Boolean(r.notify_deleted) : true,
    notifyEdited: r ? Boolean(r.notify_edited) : false,
    notifyFake: r ? Boolean(r.notify_fake) : true,
    quietHours: r ? Boolean(r.quiet_hours) : false,
    quietFrom: r ? Number(r.quiet_from) : 23,
    quietTo: r ? Number(r.quiet_to) : 8,
    tzOffsetMin: r ? Number(r.tz_offset_min) : 0,
  };
}

export async function setUserSettings(tgId, s) {
  await q(
    `INSERT INTO app_user (tg_id, notify_deleted, notify_edited, notify_fake,
                           quiet_hours, quiet_from, quiet_to, tz_offset_min)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tg_id) DO UPDATE SET
       notify_deleted = EXCLUDED.notify_deleted,
       notify_edited = EXCLUDED.notify_edited,
       notify_fake = EXCLUDED.notify_fake,
       quiet_hours = EXCLUDED.quiet_hours,
       quiet_from = EXCLUDED.quiet_from,
       quiet_to = EXCLUDED.quiet_to,
       tz_offset_min = EXCLUDED.tz_offset_min`,
    [tgId, Boolean(s.notifyDeleted), Boolean(s.notifyEdited), Boolean(s.notifyFake),
     Boolean(s.quietHours), Number(s.quietFrom ?? 23), Number(s.quietTo ?? 8),
     Number(s.tzOffsetMin ?? 0)]
  );
}

/**
 * Полное удаление данных пользователя.
 *
 * Убирает: его личный архив (сообщения с owner_tg_id = его id, вместе с
 * версиями правок по каскаду), привязки чатов, бизнес-подключения и саму
 * учётную запись.
 *
 * Сообщения групп (owner_tg_id IS NULL) остаются, если чат привязан кем-то
 * ещё: это общий архив других участников, и стирать его по просьбе одного
 * человека нельзя. Чаты, у которых после отвязки не осталось владельцев,
 * удаляются вместе с сообщениями.
 *
 * Возвращает, сколько чего удалено — чтобы показать пользователю факт,
 * а не просто «готово».
 */
export async function eraseUserData(tgId) {
  const { rows: userRows } = await q(`SELECT id FROM app_user WHERE tg_id = $1`, [tgId]);
  if (!userRows.length) return { messages: 0, chats: 0, connections: 0 };
  const userId = userRows[0].id;

  // 1. Личный архив (message_revision уходит каскадом)
  const msgs = await q(`DELETE FROM message WHERE owner_tg_id = $1`, [tgId]);

  // 2. Отвязка чатов
  const links = await q(`DELETE FROM chat_link WHERE user_id = $1`, [userId]);

  // 3. Осиротевшие чаты — вместе с их сообщениями (каскадом)
  await q(`DELETE FROM chat c
           WHERE NOT EXISTS (SELECT 1 FROM chat_link cl WHERE cl.chat_id = c.id)`);

  // 4. Бизнес-подключения
  const conns = await q(`DELETE FROM business_connection WHERE user_tg_id = $1`, [tgId]);

  // 5. Учётная запись вместе с настройками
  await q(`DELETE FROM app_user WHERE id = $1`, [userId]);

  return {
    messages: msgs.rowCount || 0,
    chats: links.rowCount || 0,
    connections: conns.rowCount || 0,
  };
}

// Тихие часы живут в lib/quiet.js (чистая функция без БД).
// Ре-экспорт: вызывающий код может импортировать её и отсюда.
export { isQuietNow } from './quiet.js';


// Отредактированное сообщение: сохраняем старую версию и обновляем текст.
// Ищем строго в архиве ТОГО ЖЕ владельца — иначе правка у одного пользователя
// перезаписала бы копию другого в общем чате.
export async function applyEdit(m) {
  const owner = m.ownerTgId ?? null;
  const { rows } = await q(
    `SELECT id, text FROM message
     WHERE chat_id = $1 AND tg_msg_id = $2 AND owner_tg_id IS NOT DISTINCT FROM $3`,
    [m.chatId, m.tgMsgId, owner]
  );
  if (rows.length === 0) {
    // Правку увидели, а оригинала нет — сохраняем как есть.
    await saveMessage(m);
    return;
  }
  const prev = rows[0];
  await q(
    `INSERT INTO message_revision (message_id, text) VALUES ($1, $2)`,
    [prev.id, prev.text]
  );
  await q(
    `UPDATE message SET text = $1, is_edited = true, edited_at = to_timestamp($2) WHERE id = $3`,
    [m.text, m.editedAt, prev.id]
  );
}


// ─── Telegram Business ───

export async function saveBusinessConnection(bc) {
  await q(
    `INSERT INTO business_connection (id, user_tg_id, user_chat_id, can_reply, is_enabled, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       can_reply = EXCLUDED.can_reply,
       is_enabled = EXCLUDED.is_enabled,
       updated_at = now()`,
    [bc.id, bc.userTgId, bc.userChatId, bc.canReply, bc.isEnabled]
  );
}

// Пометить сообщения удалёнными. В Business-режиме Telegram ПРИСЫЛАЕТ
// событие удаления — в отличие от групп, где такого события у ботов нет.
// Помечаем только копии этого владельца: удаление у одного пользователя
// не должно трогать архив другого в том же чате.
export async function markDeleted(chatId, tgMsgIds, ownerTgId = null) {
  if (!tgMsgIds?.length) return 0;
  const { rowCount } = await q(
    `UPDATE message
     SET is_deleted = true, deleted_at = now()
     WHERE chat_id = $1 AND tg_msg_id = ANY($2::bigint[])
       AND owner_tg_id IS NOT DISTINCT FROM $3
       AND NOT is_deleted`,
    [chatId, tgMsgIds, ownerTgId]
  );
  return rowCount;
}


// Достать владельца бизнес-подключения по его id.
export async function getBusinessConnection(id) {
  const { rows } = await q(
    `SELECT id, user_tg_id, user_chat_id, is_enabled FROM business_connection WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Привязать чат к владельцу бизнес-аккаунта.
// Без этого личные чаты сохранялись в базу, но НЕ попадали в /api/chats —
// приложение показывало пустой экран, хотя архив шёл.
export async function linkBusinessChat(ownerTgId, chatId) {
  const { rows } = await q(
    `INSERT INTO app_user (tg_id) VALUES ($1)
     ON CONFLICT (tg_id) DO UPDATE SET tg_id = EXCLUDED.tg_id
     RETURNING id`,
    [ownerTgId]
  );
  const userId = rows[0].id;
  await linkChat(userId, chatId, true, true);
  return userId;
}
