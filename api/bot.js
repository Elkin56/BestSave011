// api/bot.js
// Вебхук Telegram-бота.
//
// ДВА РЕЖИМА АРХИВАЦИИ:
//
// 1. Группы/каналы — бот добавлен участником и назначен админом.
//    Ловим новые сообщения и правки. Событие удаления боту НЕ приходит,
//    поэтому храним копии: удалённое видно потому, что мы сохранили его раньше.
//
// 2. Telegram Business — пользователь сам подключает бота в настройках
//    своего бизнес-аккаунта (Настройки → Telegram Business → Чат-боты).
//    Это ОФИЦИАЛЬНЫЙ путь к личным чатам, согласие даёт владелец аккаунта.
//    Здесь Telegram присылает deleted_business_messages — удаление ловится
//    по-настоящему, в момент удаления.
//    Требует Telegram Premium у пользователя и Business Mode у бота в BotFather.

import {
  ensureSchema, upsertUser, upsertChat, linkChat,
  saveMessage, applyEdit, saveBusinessConnection, markDeleted,
  getBusinessConnection, linkBusinessChat,
} from '../lib/db.js';

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

async function tg(method, payload) {
  const token = process.env.BOT_TOKEN;
  if (!token) { console.error('BOT_TOKEN не задан'); return { ok: false }; }
  try {
    const r = await fetch(API(token, method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await r.json();
    if (!json.ok) console.error('telegram api:', method, json.description);
    return json;
  } catch (e) {
    console.error('telegram fetch failed:', method, e?.message);
    return { ok: false };
  }
}

function mediaTypeOf(msg) {
  if (msg.photo) return 'photo';
  if (msg.video) return 'video';
  if (msg.voice) return 'voice';
  if (msg.video_note) return 'video_note';
  if (msg.document) return 'document';
  if (msg.animation) return 'animation';
  if (msg.sticker) return 'sticker';
  return null;
}

// Схему инициализируем один раз на тёплый контейнер, а не на каждый апдейт.
let schemaReady = false;

// Работа с БД НЕ должна мешать боту отвечать: если база недоступна,
// бот всё равно обязан ответить пользователю, а не молчать.
// Из-за этого раньше бот выглядел полностью мёртвым при проблеме с DATABASE_URL.
async function db(fn) {
  try {
    if (!schemaReady) { await ensureSchema(); schemaReady = true; }
    return await fn();
  } catch (e) {
    console.error('db error:', e?.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== secret) return res.status(401).json({ error: 'bad webhook secret' });
  }

  let update;
  try {
    update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'bad json' });
  }

  try {
    await route(update);
  } catch (e) {
    console.error('bot error:', e?.message, e?.stack);
  }
  return res.status(200).json({ ok: true });
}

async function route(update) {
  // ── Telegram Business ──
  if (update.business_connection) return onBusinessConnection(update.business_connection);
  if (update.business_message) return onBusinessMessage(update.business_message);
  if (update.edited_business_message) return onBusinessEdit(update.edited_business_message);
  if (update.deleted_business_messages) return onBusinessDeleted(update.deleted_business_messages);

  // ── бота добавили/сняли/сменили права ──
  if (update.my_chat_member) return onMyChatMember(update.my_chat_member);

  const msg = update.message || update.channel_post;
  const edited = update.edited_message || update.edited_channel_post;

  // ── команды: и в личке, и в группе ──
  // Раньше команды ловились только в личке, поэтому /start@bot в группе
  // молча уходил в архив — бот выглядел мёртвым.
  if (msg?.text?.startsWith('/')) return onCommand(msg);

  if (edited) return onEdit(edited);
  if (msg) return onGroupMessage(msg);
}

// Кэш бизнес-подключений в тёплом контейнере: владелец на каждое
// сообщение из БД — лишний запрос.
const bizCache = new Map();
async function ownerOf(connId) {
  if (!connId) return null;
  if (bizCache.has(connId)) return bizCache.get(connId);
  const bc = await getBusinessConnection(connId);
  const owner = bc?.user_tg_id ? Number(bc.user_tg_id) : null;
  if (owner) bizCache.set(connId, owner);
  return owner;
}

// getMe с кэшем в тёплом контейнере
let meCache = null;
async function getMe() {
  if (meCache) return meCache;
  const r = await tg('getMe', {});
  meCache = r?.result || null;
  return meCache;
}

// ─── команды ───
async function onCommand(msg) {
  const isPrivate = msg.chat.type === 'private';
  // В группе команда приходит как "/start@bestsaves_bot" — отрезаем имя бота.
  const cmd = msg.text.split(/[\s@]/)[0].toLowerCase();

  if (msg.from) await db(() => upsertUser(msg.from));

  if (cmd === '/start') {
    if (isPrivate) {
      const me = await getMe();
      const uname = me?.username ? '@' + me.username : 'этого бота';
      await tg('sendMessage', {
        chat_id: msg.chat.id,
        text:
          '👋 Привет! Я BestSave — сохраняю ваши переписки.\n\n' +
          'Два способа подключения:\n\n' +
          '📁 ГРУППЫ И КАНАЛЫ\n' +
          'Добавьте меня в чат и назначьте администратором — начну сохранять сообщения.\n\n' +
          '💬 ЛИЧНЫЕ ЧАТЫ (Telegram Business)\n' +
          'Настройки → Telegram Business → Чат-боты → впишите ' + uname + '\n' +
          'Так я архивирую ваши личные переписки и ловлю удаление сообщений. ' +
          'Требуется Telegram Premium.\n\n' +
          'Открыть архив — кнопка меню слева.',
      });
    } else {
      // Ответ в группе — именно его не хватало, бот молчал на /start@bot
      const me = await getMe();
      let isAdmin = false;
      if (me?.id) {
        const r = await tg('getChatMember', { chat_id: msg.chat.id, user_id: me.id });
        isAdmin = r?.result?.status === 'administrator';
      }
      await tg('sendMessage', {
        chat_id: msg.chat.id,
        text: isAdmin
          ? '✅ Я здесь и уже сохраняю сообщения этого чата.\n\n' +
            'Удалят или изменят — копия останется в вашем архиве.'
          : '👋 Я в чате, но пока вижу только команды.\n\n' +
            'Чтобы сохранять сообщения, назначьте меня администратором. ' +
            'Без этого Telegram не отдаёт мне переписку — ограничение платформы.',
      });
    }
    return;
  }

  if (cmd === '/help') {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text:
        'Что я умею:\n\n' +
        '📁 В группах и каналах (нужны права админа):\n' +
        '• сохраняю новые сообщения и медиа\n' +
        '• храню версию «до» при редактировании\n' +
        '• удалённое остаётся в архиве, потому что копия уже сохранена\n\n' +
        '💬 В личных чатах через Telegram Business:\n' +
        '• то же самое, плюс ловлю удаление в момент удаления\n' +
        '• подключение: Настройки → Telegram Business → Чат-боты\n' +
        '• нужен Telegram Premium\n\n' +
        'Чужие переписки, где вас нет, я не вижу — и не пытаюсь.',
    });
    return;
  }

  if (cmd === '/status') {
    const me = await getMe();
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text:
        `Я на связи ✅\n` +
        `Бот: @${me?.username || '?'}\n` +
        `Тип чата: ${isPrivate ? 'личный' : msg.chat.type}\n` +
        `ID чата: ${msg.chat.id}`,
    });
    return;
  }

  if (isPrivate) {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: 'Команды: /start — начать, /help — как это работает, /status — проверка связи.',
    });
  }
}

// ─── бота добавили в чат ───
async function onMyChatMember(ev) {
  const status = ev.new_chat_member?.status;
  const chat = ev.chat;
  const actor = ev.from;

  if (status === 'left' || status === 'kicked') return;

  const isAdmin = status === 'administrator';

  // Сначала отвечаем пользователю, потом пишем в БД: ответ важнее и
  // не должен зависеть от доступности базы.
  await tg('sendMessage', {
    chat_id: chat.id,
    text: isAdmin
      ? '✅ Готово! Я подключён к этому чату и начал архив.\n\n' +
        'Теперь я сохраняю новые сообщения. Если что-то удалят или изменят — ' +
        'копия останется у вас в BestSave.'
      : '⚠️ Я добавлен, но пока вижу только команды.\n\n' +
        'Чтобы архивировать все сообщения, сделайте меня администратором. ' +
        'Без этого Telegram не отдаёт мне переписку — это ограничение платформы.',
  });

  await db(async () => {
    const chatId = await upsertChat(chat);
    const userId = await upsertUser(actor);
    await linkChat(userId, chatId, isAdmin);
  });
}

// ─── архивация в группе ───
async function onGroupMessage(msg) {
  await db(async () => {
    const chatId = await upsertChat(msg.chat);
    const sender = msg.from || msg.sender_chat || {};
    await saveMessage({
      chatId,
      tgMsgId: msg.message_id,
      senderTgId: sender.id || null,
      senderName: sender.first_name || sender.title || null,
      text: msg.text || msg.caption || null,
      mediaType: mediaTypeOf(msg),
      sentAt: msg.date,
    });
  });
}

async function onEdit(msg) {
  await db(async () => {
    const chatId = await upsertChat(msg.chat);
    await applyEdit({
      chatId,
      tgMsgId: msg.message_id,
      text: msg.text || msg.caption || null,
      editedAt: msg.edit_date || msg.date,
    });
  });
}

// ═══ TELEGRAM BUSINESS ═══

// Пользователь подключил (или отключил) бота в настройках бизнес-аккаунта.
async function onBusinessConnection(bc) {
  const enabled = bc.is_enabled !== false;
  // rights пришло в Bot API 9.0; can_reply оставлен для совместимости
  const canReply = bc.rights?.can_reply ?? bc.can_reply ?? false;

  bizCache.delete(bc.id);
  await db(() => saveBusinessConnection({
    id: bc.id,
    userTgId: bc.user?.id,
    userChatId: bc.user_chat_id,
    canReply,
    isEnabled: enabled,
  }));

  if (bc.user_chat_id) {
    await tg('sendMessage', {
      chat_id: bc.user_chat_id,
      text: enabled
        ? '✅ Бизнес-подключение активно!\n\n' +
          'Теперь я архивирую ваши личные переписки: сохраняю сообщения, ' +
          'храню версии «до» при редактировании и ловлю удаление в момент удаления.\n\n' +
          'Открыть архив — в приложении BestSave.'
        : '🔌 Бизнес-подключение отключено. Новые сообщения я больше не сохраняю. ' +
          'Всё, что уже в архиве, остаётся на месте.',
    });
  }
}

// Новое сообщение в личном чате через бизнес-подключение.
async function onBusinessMessage(msg) {
  await db(async () => {
    const chatId = await upsertChat(msg.chat);
    const sender = msg.from || {};
    await saveMessage({
      chatId,
      tgMsgId: msg.message_id,
      senderTgId: sender.id || null,
      senderName: sender.first_name || null,
      text: msg.text || msg.caption || null,
      mediaType: mediaTypeOf(msg),
      sentAt: msg.date,
    });

    // КЛЮЧЕВОЕ: связываем чат с владельцем бизнес-аккаунта.
    // Без этой связи чат сохраняется, но не виден в приложении.
    const owner = await ownerOf(msg.business_connection_id);
    if (owner) await linkBusinessChat(owner, chatId);
  });
}

async function onBusinessEdit(msg) {
  await db(async () => {
    const chatId = await upsertChat(msg.chat);
    const owner = await ownerOf(msg.business_connection_id);
    if (owner) await linkBusinessChat(owner, chatId);
    await applyEdit({
      chatId,
      tgMsgId: msg.message_id,
      text: msg.text || msg.caption || null,
      editedAt: msg.edit_date || msg.date,
    });
  });
}

// НАСТОЯЩЕЕ событие удаления — доступно только в Business-режиме.
async function onBusinessDeleted(ev) {
  await db(async () => {
    const chatId = await upsertChat(ev.chat);
    const owner = await ownerOf(ev.business_connection_id);
    if (owner) await linkBusinessChat(owner, chatId);
    const n = await markDeleted(chatId, ev.message_ids || []);
    console.log(`business: помечено удалёнными ${n} сообщений в чате ${ev.chat?.id}`);
  });
}
