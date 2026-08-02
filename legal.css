// lib/media-info.js
// Разбор вложений Telegram-сообщения. Вынесено из api/bot.js, потому что
// теперь этим пользуются двое: архивация и «сохранение по ответу».
// Чистые функции без сети и базы — тестируются без окружения.

export function mediaTypeOf(msg) {
  if (!msg) return null;
  if (msg.photo) return 'photo';
  if (msg.video) return 'video';
  if (msg.voice) return 'voice';
  if (msg.video_note) return 'video_note';
  if (msg.document) return 'document';
  if (msg.animation) return 'animation';
  if (msg.sticker) return 'sticker';
  return null;
}

// file_id вложения: по нему бот скачивает файл через getFile и по нему же
// может переслать файл заново. Остаётся рабочим и после удаления сообщения.
export function mediaFileIdOf(msg) {
  if (!msg) return null;
  if (msg.photo?.length) return msg.photo[msg.photo.length - 1].file_id; // максимальный размер
  return (
    msg.video?.file_id || msg.voice?.file_id || msg.video_note?.file_id ||
    msg.document?.file_id || msg.animation?.file_id || msg.sticker?.file_id || null
  );
}

// file_unique_id — отпечаток файла. В отличие от file_id он одинаков для
// одного и того же физического файла в любых чатах и не меняется со временем.
export function mediaUniqueIdOf(msg) {
  if (!msg) return null;
  if (msg.photo?.length) return msg.photo[msg.photo.length - 1].file_unique_id;
  return (
    msg.video?.file_unique_id || msg.voice?.file_unique_id || msg.video_note?.file_unique_id ||
    msg.document?.file_unique_id || msg.animation?.file_unique_id || msg.sticker?.file_unique_id || null
  );
}

// Дата оригинала у пересланного сообщения — Telegram отдаёт её честно.
export function forwardOriginDate(msg) {
  return msg?.forward_origin?.date || msg?.forward_date || null;
}

export const MEDIA_RU = {
  photo: 'фото', video: 'видео', voice: 'голосовое',
  video_note: 'кружок', animation: 'GIF', document: 'файл', sticker: 'стикер',
};

export function fmtWhen(d) {
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Имя чата для уведомлений: у личных чатов нет title.
export function chatTitleOf(chat) {
  return chat?.title ||
    [chat?.first_name, chat?.last_name].filter(Boolean).join(' ') ||
    (chat?.username ? '@' + chat.username : 'чат');
}

// Имя отправителя: пользователь, канал или аноним.
export function senderNameOf(msg) {
  const s = msg?.from || msg?.sender_chat;
  return s?.first_name || s?.title || 'кто-то';
}
