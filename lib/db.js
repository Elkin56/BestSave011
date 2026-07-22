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

    CREATE INDEX IF NOT EXISTS idx_message_chat_sent ON message (chat_id, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_message_deleted ON message (chat_id) WHERE is_deleted;
    CREATE INDEX IF NOT EXISTS idx_bizconn_user ON business_connection (user_tg_id);
  `);
}

// ─── upsert-хелперы для бота ───

export async function upsertUser(tg) {
  const { rows } = await q(
    `INSERT INTO app_user (tg_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (tg_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name
     RETURNING id`,
    [tg.id, tg.username || null, tg.first_name || null]
  );
  return rows[0].id;
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
export async function saveMessage(m) {
  await q(
    `INSERT INTO message (chat_id, tg_msg_id, sender_tg_id, sender_name, text, media_type, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))
     ON CONFLICT (chat_id, tg_msg_id) DO NOTHING`,
    [m.chatId, m.tgMsgId, m.senderTgId, m.senderName, m.text, m.mediaType, m.sentAt]
  );
}

// Отредактированное сообщение: сохраняем старую версию и обновляем текст.
export async function applyEdit(m) {
  const { rows } = await q(
    `SELECT id, text FROM message WHERE chat_id = $1 AND tg_msg_id = $2`,
    [m.chatId, m.tgMsgId]
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
export async function markDeleted(chatId, tgMsgIds) {
  if (!tgMsgIds?.length) return 0;
  const { rowCount } = await q(
    `UPDATE message
     SET is_deleted = true, deleted_at = now()
     WHERE chat_id = $1 AND tg_msg_id = ANY($2::bigint[]) AND NOT is_deleted`,
    [chatId, tgMsgIds]
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
