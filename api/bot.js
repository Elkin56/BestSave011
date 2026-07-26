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
  getBusinessConnection, linkBusinessChat, getUserSettings, updateBotAdminFlag,
  replaceMediaFileId,
  // isQuietNow импортируется отдельно: чистая функция без БД
  firstSeenMedia,
  // приглашения (счётчик друзей; условием доступа больше не являются)
  userExists, addReferral, countReferrals,
  // сохранение по ответу
  claimSavedByReply, releaseSavedByReply, saveTargetsForChat,
} from '../lib/db.js';
import { isQuietNow } from '../lib/quiet.js';
import {
  mediaTypeOf, mediaFileIdOf, mediaUniqueIdOf, forwardOriginDate,
  MEDIA_RU, fmtWhen, chatTitleOf, senderNameOf,
} from '../lib/media-info.js';
import { replyTargetForSave, replyGistOf, buildCaption, sendSavedCopy } from '../lib/save-on-reply.js';
import { parseRefPayload, inviteLink, shareUrl, pluralFriends } from '../lib/invite.js';
import { isSelfDestructing, getTTL } from '../lib/self-destruct.js';

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

// Разбор вложений (mediaTypeOf, mediaFileIdOf, mediaUniqueIdOf,
// forwardOriginDate, MEDIA_RU, fmtWhen, chatTitleOf) живёт в lib/media-info.js:
// теперь этим пользуется не только архивация, но и сохранение по ответу.

// Медиа, которое имеет смысл проверять на «свежесть».
// Стикеры и документы исключены: их повтор — обычное дело, а не обман.
const FAKE_CHECKED = new Set(['photo', 'video', 'voice', 'video_note', 'animation']);

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

  // ── нажатия на inline-кнопки (проверка условий доступа) ──
  if (update.callback_query) return onCallback(update.callback_query);

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
// Отключённое подключение владельца НЕ даёт: пользователь отозвал доступ,
// значит архивация должна прекратиться, а не продолжаться по инерции.
const bizCache = new Map();
async function ownerOf(connId) {
  if (!connId) return null;
  if (bizCache.has(connId)) return bizCache.get(connId);
  const bc = await getBusinessConnection(connId);
  const owner = bc?.is_enabled && bc?.user_tg_id ? Number(bc.user_tg_id) : null;
  bizCache.set(connId, owner);
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

// ─── приглашения ───
//
// Условий доступа в боте больше нет: ни подписки на канал, ни трёх друзей.
// Осталась только личная ссылка — поделиться, если человек сам захочет.

// Нажатия inline-кнопок. Своих кнопок с callback_data у бота сейчас нет,
// но апдейт приходить может (кнопка из старого сообщения в чьей-то истории) —
// отвечаем, чтобы у человека не крутились часы на кнопке.
async function onCallback(cq) {
  await tg('answerCallbackQuery', { callback_query_id: cq.id });
}

// Засчитать приглашение по deep-link /start ref<id>.
// Считается только НОВЫЙ человек: иначе давний пользователь открывал бы
// чужие ссылки и раздавал приглашения из воздуха.
async function creditReferral(payload, from) {
  const inviter = parseRefPayload(payload);
  if (!inviter || !from?.id || inviter === from.id) return;

  const existed = await db(() => userExists(from.id));
  // existed === null означает, что база не ответила: в этом случае лучше
  // не засчитать честного друга, чем засчитать несуществующего.
  if (existed !== false) return;

  const added = await db(() => addReferral(inviter, from.id));
  if (!added) return;

  const total = await db(() => countReferrals(inviter));
  const who = from.first_name ? `${from.first_name} ` : '';

  await tg('sendMessage', {
    chat_id: inviter,
    text: `🤝 ${who}перешёл по вашей ссылке — спасибо!\n\n` +
      `Всего по ней пришло: ${total} ${pluralFriends(total)}.`,
  });
}

// ─── команды ───
async function onCommand(msg) {
  const isPrivate = msg.chat.type === 'private';
  // В группе команда приходит как "/start@bestsaves_bot" — отрезаем имя бота.
  const cmd = msg.text.split(/[\s@]/)[0].toLowerCase();
  // Полезная нагрузка deep-link: "/start ref123456".
  const payload = msg.text.split(/\s+/)[1] || '';

  // Порядок важен: реферал считается до upsertUser, потому что признак
  // «новый человек» существует ровно до момента, когда мы его записали.
  if (cmd === '/start' && isPrivate && payload) {
    await creditReferral(payload, msg.from);
  }

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
          '💾 Быстрое сохранение: ответьте в подключённом чате на любой файл — ' +
          'хоть точкой — и его копия придёт сюда.\n\n' +
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
        '💾 ОТВЕТ = СОХРАНИТЬ\n' +
        'Ответьте в подключённом чате на фото, видео, голосовое, кружок, GIF ' +
        'или файл — хоть точкой. Копия сразу придёт сюда, в личку со мной.\n' +
        'Отключается в приложении: Настройки → Сохранение по ответу.\n\n' +
        'Чужие переписки, где вас нет, я не вижу — и не пытаюсь.\n\n' +
        '🤝 /invite — ссылка, чтобы позвать друзей.',
    });
    return;
  }

  if (cmd === '/invite') {
    if (!isPrivate) return;
    const tgId = msg.from?.id;
    const me = await getMe();
    // Счётчик остался как приятная мелочь, а не как условие: архив открыт
    // сразу и никак от числа приглашённых не зависит.
    const total = (await db(() => countReferrals(tgId))) || 0;

    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text:
        (total > 0
          ? `🤝 По вашей ссылке пришло ${total} ${pluralFriends(total)} — спасибо!`
          : '🤝 Если BestSave пригодился — расскажите о нём.') +
        '\n\nВаша личная ссылка:\n' + inviteLink(me?.username, tgId) +
        '\n\nНажмите кнопку ниже — Telegram сам предложит выбрать чат, ' +
        'текст со ссылкой уже готов.',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📤 Поделиться с друзьями', url: shareUrl(me?.username, tgId) }],
        ],
      },
      disable_web_page_preview: true,
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
      text: 'Команды: /start — начать, /invite — позвать друзей, /help — как это работает, /status — проверка связи.',
    });
  }
}

// ─── бота добавили в чат ───
async function onMyChatMember(ev) {
  const status = ev.new_chat_member?.status;
  const wasStatus = ev.old_chat_member?.status;
  const chat = ev.chat;
  const actor = ev.from;

  if (status === 'left' || status === 'kicked') return;

  const isAdmin = status === 'administrator';

  // Доступ к архиву даём ТОЛЬКО тому, кто реально добавил бота в чат,
  // то есть при переходе «бота не было → бот в чате».
  // Иначе любой администратор, просто изменивший боту права, привязывал
  // чат к себе и получал весь архив, накопленный до его появления.
  const wasAbsent = !wasStatus || wasStatus === 'left' || wasStatus === 'kicked';

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
    if (wasAbsent) {
      const userId = await upsertUser(actor);
      await linkChat(userId, chatId, isAdmin);
    } else {
      // Права боту поменяли — обновляем флаг у уже существующих связей,
      // никому новых доступов не выдаём.
      await updateBotAdminFlag(chatId, isAdmin);
    }
  });
}

// ─── СОХРАНЕНИЕ ПО ОТВЕТУ ───
//
// Ответ на файл — это команда «сохрани». Копия уходит в личку владельцу архива
// вместе с подписью: что, откуда, когда и кто сохранил.
//
// Доступ к чату при этом НЕ расширяется: работает только там, где бот уже
// подключён — админом в группе или через Telegram Business самим владельцем
// аккаунта. Новых чатов бот так не видит.
//
// targets: [{ tgId, chatId, quietHours, quietFrom, quietTo, tzOffsetMin }]
//   tgId   — владелец архива (ключ дедупликации)
//   chatId — куда слать копию (личка с ботом)
async function runSaveOnReply({ msg, chatRowId, targets, ownerTgId = null }) {
  const media = replyTargetForSave(msg);
  if (!media || !targets?.length) return;

  const mediaType = mediaTypeOf(media);

  // Оригинал мог не попасть в архив: бота могли добавить в чат позже файла.
  // Раз уж мы держим его в руках — кладём, тогда он виден и в приложении.
  await db(() => saveMessage({
    chatId: chatRowId,
    tgMsgId: media.message_id,
    senderTgId: media.from?.id || media.sender_chat?.id || null,
    senderName: media.from?.first_name || media.sender_chat?.title || null,
    text: media.caption || null,
    mediaType,
    mediaFileId: mediaFileIdOf(media),
    mediaUniqueId: mediaUniqueIdOf(media),
    origSentAt: forwardOriginDate(media),
    ownerTgId,
    sentAt: media.date,
  }));

  const caption = buildCaption({
    mediaType,
    chatTitle: chatTitleOf(msg.chat),
    senderName: senderNameOf(media),
    sentAt: media.date,
    replierName: senderNameOf(msg),
    replyGist: replyGistOf(msg),
    origCaption: media.caption,
  });

  for (const t of targets) {
    // Дедупликация: на один файл могут ответить пятеро — копия нужна одна.
    // null означает «база не ответила»: тогда лучше прислать копию дважды,
    // чем не прислать вовсе. Продукт существует ради несохранённого файла.
    const claimed = await db(() => claimSavedByReply(t.tgId, chatRowId, media.message_id, mediaType));
    if (claimed === false) continue;

    const sent = await sendSavedCopy(tg, {
      chatId: t.chatId,
      media,
      caption,
      // Тихие часы не отменяют сохранение — файл может быть удалён к утру.
      // Отменяют только звук: сообщение придёт молча.
      silent: isQuietNow(t),
    });

    // Не доставили (бот заблокирован, лимит, сбой сети) — снимаем отметку,
    // иначе следующий ответ на этот же файл посчитает его уже сохранённым.
    if (!sent.ok && claimed === true) {
      await db(() => releaseSavedByReply(t.tgId, chatRowId, media.message_id));
    }
  }
}

// ─── архивация в группе ───
async function onGroupMessage(msg) {
  // id чата возвращаем наружу: он же нужен сохранению по ответу,
  // а второй upsertChat на каждое сообщение — лишний поход в базу.
  const chatRowId = await db(async () => {
    const chatId = await upsertChat(msg.chat);
    const sender = msg.from || msg.sender_chat || {};
    await saveMessage({
      chatId,
      tgMsgId: msg.message_id,
      senderTgId: sender.id || null,
      senderName: sender.first_name || sender.title || null,
      text: msg.text || msg.caption || null,
      mediaType: mediaTypeOf(msg),
      mediaFileId: mediaFileIdOf(msg),
      sentAt: msg.date,
    });
    return chatId;
  });

  // Получатели в группе — те, кто этот чат подключил.
  if (!chatRowId || !replyTargetForSave(msg)) return;

  const owners = await db(() => saveTargetsForChat(chatRowId));
  if (!owners?.length) return;

  await runSaveOnReply({
    msg,
    chatRowId,
    // Личный чат с ботом имеет chat_id, равный tg id пользователя.
    targets: owners.map((o) => ({ ...o, chatId: o.tgId })),
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
    // Владельца выясняем ПЕРВЫМ делом. Без него сохранять нельзя:
    // копия без владельца стала бы «общей» и попала бы в архив постороннего,
    // подключённого к тому же собеседнику.
    const owner = await ownerOf(msg.business_connection_id);
    if (!owner) {
      console.warn('business: сообщение без активного подключения — не архивируем');
      return;
    }

    const chatId = await upsertChat(msg.chat);
    const sender = msg.from || {};
    const mediaType = mediaTypeOf(msg);
    const uniqueId = mediaUniqueIdOf(msg);
    const origDate = forwardOriginDate(msg);

    // ── Фейк-контроль ──
    // Ищем этот же файл в архиве владельца. Если он уже был — прислали повтор.
    // Сообщения самого владельца не проверяем: обман тут не при чём.
    const fromOwner = sender.id === owner;
    let firstSeen = null;
    if (!fromOwner && uniqueId && FAKE_CHECKED.has(mediaType)) {
      firstSeen = await firstSeenMedia(owner, uniqueId);
    }

    // ── Самоуничтожающиеся фото/видео/голосовые (таймер в личных чатах) ──
    // Telegram отдаёт TTL прямо в сообщении, но выданный при этом file_id
    // «горит» вместе с оригиналом: ни getFile, ни повторная отправка по
    // этому же file_id после этого не работают — иначе таймер ничего бы не
    // защищал. Единственное окно, где у нас есть доступ к самим байтам, —
    // прямо сейчас, пока апдейт свежий. Поэтому: скачиваем файл немедленно
    // и тут же перезаливаем его как НОВЫЙ файл в личку владельцу — это
    // создаёт обычный, не привязанный к таймеру file_id, который потом
    // нормально открывается в приложении.
    const selfDestruct = isSelfDestructing(msg);
    const ttlSeconds = selfDestruct ? getTTL(msg) : null;

    await saveMessage({
      chatId,
      tgMsgId: msg.message_id,
      senderTgId: sender.id || null,
      senderName: sender.first_name || null,
      text: msg.text || msg.caption || null,
      mediaType,
      mediaFileId: mediaFileIdOf(msg),
      mediaUniqueId: uniqueId,
      repeatOfAt: firstSeen?.at || null,
      origSentAt: origDate,
      ownerTgId: owner,
      sentAt: msg.date,
      isSelfDestruct: selfDestruct,
      ttlSeconds,
    });

    // Связываем чат с владельцем бизнес-аккаунта.
    // Без этой связи чат сохраняется, но не виден в приложении.
    await linkBusinessChat(owner, chatId);

    if (firstSeen || (origDate && !fromOwner)) {
      await notifyFake(owner, msg, mediaType, firstSeen, origDate);
    }

    if (selfDestruct && mediaFileIdOf(msg)) {
      await rearchiveSelfDestructMedia({
        owner, msg, mediaType, ttlSeconds,
        chatRowId: chatId,
      });
    }

    // ── Сохранение по ответу ──
    // В личном чате владелец один и известен точно, поэтому получатель ровно
    // один — сам владелец бизнес-аккаунта.
    if (replyTargetForSave(msg)) {
      const s = await getUserSettings(owner);
      if (!s.saveOnReply) return;
      const bc = await getBusinessConnection(msg.business_connection_id);
      if (!bc?.user_chat_id) return;

      await runSaveOnReply({
        msg,
        chatRowId: chatId,
        ownerTgId: owner,
        targets: [{ ...s, tgId: owner, chatId: Number(bc.user_chat_id) }],
      });
    }
  });
}

// Сообщение владельцу о несвежем медиа.
// Формулировки осторожные: повтор файла — факт, а вот умысел — нет.
// Человек мог просто переслать сам себе или отправить то же фото повторно.
async function notifyFake(owner, msg, mediaType, firstSeen, origDate) {
  const bc = await getBusinessConnection(msg.business_connection_id);
  if (!bc?.user_chat_id) return;

  const s = await getUserSettings(owner);
  if (!s.notifyFake) return;
  // Тихие часы: ночью не пишем. Событие уже сохранено в архиве —
  // пользователь увидит его утром в приложении, ничего не теряется.
  if (isQuietNow(s)) return;

  const what = MEDIA_RU[mediaType] || 'медиа';
  const who = chatTitleOf(msg.chat);
  let text;

  if (firstSeen) {
    text = `⚠️ В чате «${who}» пришло ${what}, которое уже есть в вашем архиве.\n\n` +
      `Впервые: ${fmtWhen(firstSeen.at)}` +
      (firstSeen.chat && firstSeen.chat !== who ? ` (чат «${firstSeen.chat}»)` : '') +
      `\n\nЭто тот же самый файл, а не похожий. Он мог быть отправлен повторно ` +
      `и без умысла — решайте сами.`;
  } else {
    text = `ℹ️ В чате «${who}» переслали ${what}. Оригинал отправлен ${fmtWhen(origDate * 1000)}, ` +
      `то есть запись не новая.`;
  }

  await tg('sendMessage', { chat_id: Number(bc.user_chat_id), text });
}

// Метод и поле для перезаливки каждого типа медиа. video_note/voice подписи
// не поддерживают — она уходит отдельным сообщением, как и в save-on-reply.js.
const REUPLOAD = {
  photo: { method: 'sendPhoto', field: 'photo', caption: true, resultKey: 'photo', pickLast: true },
  video: { method: 'sendVideo', field: 'video', caption: true, resultKey: 'video' },
  voice: { method: 'sendVoice', field: 'voice', caption: false, resultKey: 'voice' },
  video_note: { method: 'sendVideoNote', field: 'video_note', caption: false, resultKey: 'video_note' },
};

// Multipart-загрузка в Telegram (обычный tg() умеет только JSON и не годится
// для отправки самих байтов файла).
async function tgUpload(method, field, buf, filename, extra = {}) {
  const token = process.env.BOT_TOKEN;
  if (!token) { console.error('BOT_TOKEN не задан'); return { ok: false }; }
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  form.append(field, new Blob([buf]), filename);
  try {
    const r = await fetch(API(token, method), { method: 'POST', body: form });
    const json = await r.json();
    if (!json.ok) console.error('telegram upload:', method, json.description);
    return json;
  } catch (e) {
    console.error('telegram upload failed:', method, e?.message);
    return { ok: false };
  }
}

// Файл с таймером самоуничтожения. У полученного file_id уже сейчас может не
// быть доступа через getFile — Telegram не даёт скачивать TTL-медиа так же
// свободно, как обычное, это часть их гарантии приватности. Поэтому здесь
// НЕ полагаемся на file_id вообще: скачиваем сырые байты (может не выйти —
// тогда честно логируем и молчим, подделывать успех нет смысла) и заливаем
// их заново как отдельное сообщение владельцу. Новый file_id, который вернёт
// Telegram на этот аплоад, уже обычный — им заменяем в БД TTL-шный.
async function rearchiveSelfDestructMedia({ owner, msg, mediaType, ttlSeconds, chatRowId }) {
  const spec = REUPLOAD[mediaType];
  const fileId = mediaFileIdOf(msg);
  if (!spec || !fileId) return;

  const bc = await getBusinessConnection(msg.business_connection_id);
  if (!bc?.user_chat_id) return;

  const token = process.env.BOT_TOKEN;
  if (!token) return;

  const gf = await tg('getFile', { file_id: fileId });
  if (!gf.ok || !gf.result?.file_path) {
    console.warn(`self-destruct: getFile отказал для ${owner} (${gf.description || 'нет причины'}) — ` +
      `похоже, Telegram уже закрыл доступ к TTL-файлу, копию сделать не удалось`);
    return;
  }

  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${gf.result.file_path}`);
  if (!fileRes.ok) {
    console.warn(`self-destruct: не удалось скачать файл для ${owner} (HTTP ${fileRes.status})`);
    return;
  }
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const filename = gf.result.file_path.split('/').pop() || 'file';

  const s = await getUserSettings(owner);
  const what = MEDIA_RU[mediaType] || 'медиа';
  const who = chatTitleOf(msg.chat);
  const ttlText = ttlSeconds ? ` · таймер ${ttlSeconds} сек` : '';
  const caption = `⏳ Самоуничтожающееся ${what} из чата «${who}»${ttlText} — сохранено до истечения таймера.`;

  const extra = {
    chat_id: Number(bc.user_chat_id),
    disable_notification: isQuietNow(s) ? 'true' : undefined,
  };
  if (spec.caption) extra.caption = caption;

  const sent = await tgUpload(spec.method, spec.field, buf, filename, extra);
  if (!sent?.ok) {
    console.warn(`self-destruct: не удалось перезалить копию владельцу ${owner}`);
    return;
  }

  // Кружок/голосовое подпись не приняли — досылаем отдельным сообщением-ответом.
  if (!spec.caption) {
    await tg('sendMessage', {
      chat_id: Number(bc.user_chat_id),
      text: caption,
      reply_to_message_id: sent.result?.message_id,
      disable_notification: isQuietNow(s),
      allow_sending_without_reply: true,
    });
  }

  // Достаём новый, уже не TTL-шный file_id из ответа Telegram и заменяем
  // им обречённый оригинал — теперь /api/media сможет его открыть.
  const resultObj = sent.result?.[spec.resultKey];
  const newFileId = spec.pickLast && Array.isArray(resultObj)
    ? resultObj[resultObj.length - 1]?.file_id
    : resultObj?.file_id;
  if (newFileId) {
    await db(() => replaceMediaFileId(chatRowId, msg.message_id, owner, newFileId));
  }
}

async function onBusinessEdit(msg) {
  await db(async () => {
    const owner = await ownerOf(msg.business_connection_id);
    if (!owner) return;

    const chatId = await upsertChat(msg.chat);
    await linkBusinessChat(owner, chatId);
    await applyEdit({
      chatId,
      tgMsgId: msg.message_id,
      text: msg.text || msg.caption || null,
      mediaType: mediaTypeOf(msg),
      mediaFileId: mediaFileIdOf(msg),
      ownerTgId: owner,
      editedAt: msg.edit_date || msg.date,
      sentAt: msg.date,
    });

    // Уведомление об изменении — только если пользователь включил его в настройках
    const bc = await getBusinessConnection(msg.business_connection_id);
    if (bc?.user_chat_id) {
      const s = await getUserSettings(owner);
      if (s.notifyEdited && !isQuietNow(s)) {
        const who = chatTitleOf(msg.chat);
        await tg('sendMessage', {
          chat_id: Number(bc.user_chat_id),
          text: `✏️ В чате «${who}» изменили сообщение. Версия «до» сохранена в архиве.`,
        });
      }
    }
  });
}

// НАСТОЯЩЕЕ событие удаления — доступно только в Business-режиме.
async function onBusinessDeleted(ev) {
  await db(async () => {
    const owner = await ownerOf(ev.business_connection_id);
    if (!owner) return;

    const chatId = await upsertChat(ev.chat);
    await linkBusinessChat(owner, chatId);
    // Помечаем удалёнными только копии этого владельца
    const n = await markDeleted(chatId, ev.message_ids || [], owner);
    console.log(`business: помечено удалёнными ${n} сообщений в чате ${ev.chat?.id}`);

    // Уведомление об удалении (по умолчанию включено, выключается в настройках)
    if (n > 0) {
      const bc = await getBusinessConnection(ev.business_connection_id);
      if (bc?.user_chat_id) {
        const s = await getUserSettings(owner);
        if (s.notifyDeleted && !isQuietNow(s)) {
          const who = chatTitleOf(ev.chat);
          await tg('sendMessage', {
            chat_id: Number(bc.user_chat_id),
            text: `🗑 В чате «${who}» удалили ${n} ${n === 1 ? 'сообщение' : n < 5 ? 'сообщения' : 'сообщений'}. Копии остались в вашем архиве BestSave.`,
          });
        }
      }
    }
  });
}
