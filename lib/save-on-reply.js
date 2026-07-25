// lib/save-on-reply.js
// «Сохранение по ответу».
//
// Жест: в подключённом чате кто-то прислал файл (фото, видео, голосовое,
// кружок, GIF, документ), а собеседник ОТВЕТИЛ на это сообщение — хоть точкой.
// Ответ и есть команда «сохрани». Бот присылает копию файла в личку владельцу
// архива и подписывает её: что, откуда, когда и кто нажал.
//
// Почему копия отправляется по file_id, а не через copyMessage: бот не состоит
// в личном чате бизнес-аккаунта, copyMessage оттуда не работает. file_id же
// принадлежит боту и остаётся рабочим даже после удаления оригинала — именно
// на этом держится вся продуктовая идея.
//
// Модуль не ходит в сеть и в базу сам: клиент Telegram передаётся параметром.
// Из-за этого всё, кроме самой отправки, проверяется тестами без окружения.

import { mediaTypeOf, mediaFileIdOf, MEDIA_RU, fmtWhen } from './media-info.js';

// Что имеет смысл сохранять по ответу.
// Стикеры исключены намеренно: ответ на стикер — обычный разговор, а не
// просьба его сохранить. Иначе архив завалило бы мусором.
export const SAVEABLE = new Set([
  'photo', 'video', 'voice', 'video_note', 'animation', 'document',
]);

// Метод отправки и имя поля для каждого типа.
// caption: поддерживает ли метод подпись. У кружков и стикеров её нет —
// для них подпись уходит отдельным сообщением-ответом.
const SEND = {
  photo: { method: 'sendPhoto', field: 'photo', caption: true },
  video: { method: 'sendVideo', field: 'video', caption: true },
  voice: { method: 'sendVoice', field: 'voice', caption: true },
  video_note: { method: 'sendVideoNote', field: 'video_note', caption: false },
  animation: { method: 'sendAnimation', field: 'animation', caption: true },
  document: { method: 'sendDocument', field: 'document', caption: true },
};

const CAPTION_LIMIT = 1024;

/**
 * Является ли сообщение жестом «сохрани это».
 * Возвращает исходное сообщение с файлом либо null.
 *
 * Требования: это ответ, в ответе есть файл сохраняемого типа и у файла есть
 * file_id. Текст самого ответа не важен — точка считается наравне с абзацем.
 */
export function replyTargetForSave(msg) {
  const target = msg?.reply_to_message;
  if (!target) return null;
  const type = mediaTypeOf(target);
  if (!type || !SAVEABLE.has(type)) return null;
  if (!mediaFileIdOf(target)) return null;
  return target;
}

/** Короткая выжимка из ответа — чтобы в подписи было видно, чем ответили. */
export function replyGistOf(msg, limit = 60) {
  const raw = (msg?.text || msg?.caption || '').replace(/\s+/g, ' ').trim();
  if (raw) return raw.length > limit ? raw.slice(0, limit - 1) + '…' : raw;
  const type = mediaTypeOf(msg);
  return type ? MEDIA_RU[type] || 'медиа' : 'без текста';
}

/** Подпись к сохранённой копии. Plain text: parse_mode не используем, поэтому
 *  ни имя, ни текст ответа не могут сломать разметку или подделать её. */
export function buildCaption(info) {
  const what = MEDIA_RU[info.mediaType] || 'медиа';
  const lines = [
    `💾 Сохранено: ${what}`,
    [
      info.chatTitle ? `Чат «${info.chatTitle}»` : null,
      info.senderName ? `от ${info.senderName}` : null,
      info.sentAt ? fmtWhen(info.sentAt * 1000) : null,
    ].filter(Boolean).join(' · '),
  ];

  if (info.replierName) {
    // Имя ставим после двоеточия: в русском «Ответ Ивана» требует склонения,
    // а имя приходит от Telegram в именительном падеже.
    lines.push(`↩️ Ответ: ${info.replierName} — «${info.replyGist || '…'}»`);
  }
  if (info.origCaption) {
    const c = String(info.origCaption).replace(/\s+/g, ' ').trim();
    if (c) lines.push('', `Подпись: ${c}`);
  }

  const text = lines.join('\n');
  return text.length > CAPTION_LIMIT ? text.slice(0, CAPTION_LIMIT - 1) + '…' : text;
}

/**
 * Отправить копию файла в личку и подписать её.
 *
 * @param tg      клиент: (method, payload) => Promise<{ ok, result }>
 * @param chatId  куда слать (личка владельца архива)
 * @param media   исходное сообщение с файлом
 * @param caption готовая подпись
 * @param silent  тихие часы: доставить без звука, но доставить
 *
 * Возвращает { ok, messageId }. Ошибку не бросает: не доставленное
 * уведомление не должно ронять обработку апдейта.
 */
export async function sendSavedCopy(tg, { chatId, media, caption, silent = false }) {
  const type = mediaTypeOf(media);
  const spec = SEND[type];
  const fileId = mediaFileIdOf(media);
  if (!spec || !fileId || !chatId) return { ok: false, messageId: null };

  const payload = {
    chat_id: chatId,
    [spec.field]: fileId,
    disable_notification: Boolean(silent),
  };
  if (spec.caption) payload.caption = caption;

  const sent = await tg(spec.method, payload);
  if (!sent?.ok) return { ok: false, messageId: null };

  const messageId = sent.result?.message_id || null;

  // Кружок подпись не принимает — досылаем её ответом на саму копию,
  // чтобы в личке они читались одним блоком.
  if (!spec.caption) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: caption,
      reply_to_message_id: messageId,
      disable_notification: Boolean(silent),
      allow_sending_without_reply: true,
    });
  }

  return { ok: true, messageId };
}
