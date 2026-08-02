// lib/invite.js
// Приглашения и ссылки на сообщество.
//
// Раньше этот модуль обслуживал условия доступа: подписку на канал и трёх
// приглашённых друзей. Условия сняты — архив открыт сразу. Осталась личная
// ссылка, по которой человек может позвать друзей, если сам захочет,
// и счётчик переходов. Ничего не блокирует.

// Канал сообщества — просто ссылка в интерфейсе. Подписка ни на что
// не влияет и нигде не проверяется.
export const COMMUNITY_CHAT = process.env.COMMUNITY_CHAT || '@bestsavee';
export const COMMUNITY_TITLE = process.env.COMMUNITY_TITLE || 'BestSave Community';

// Ссылка «человеку»: из @username делаем t.me, числовой id так не открыть —
// для приватного канала нужен COMMUNITY_URL с инвайт-ссылкой.
export function communityUrl(chat = COMMUNITY_CHAT, override = process.env.COMMUNITY_URL) {
  if (override) return override;
  const s = String(chat || '').trim();
  if (s.startsWith('@')) return `https://t.me/${s.slice(1)}`;
  if (s.startsWith('http')) return s;
  return 'https://t.me/bestsavee';
}

// ─── реферальная ссылка ───

// Полезная нагрузка deep-link. Только цифры: «ref» + tg id.
// Telegram разрешает в start-параметре A-Z a-z 0-9 _ -, так что формат безопасен.
export function refPayload(tgId) {
  return `ref${Number(tgId)}`;
}

// Разбор входящего payload. Возвращает id пригласившего или null.
// Мусор, отрицательные значения и переполнение отсекаем здесь, а не в боте.
export function parseRefPayload(payload) {
  const m = /^ref(\d{1,20})$/.exec(String(payload || '').trim());
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

export function inviteLink(botUsername, tgId) {
  const u = String(botUsername || 'bestsaves_bot').replace(/^@/, '');
  return `https://t.me/${u}?start=${refPayload(tgId)}`;
}

// Текст, который уходит другу вместе со ссылкой. Задача — заинтересовать
// за две секунды: сначала выгода, потом что это, потом призыв.
export const SHARE_TEXT =
  '👀 Собеседник удалил сообщение — а у меня оно осталось.\n\n' +
  'BestSave — личный архив переписки в Telegram. Он сохраняет всё ещё до того, ' +
  'как это исчезнет:\n' +
  '🗑 удалённые сообщения — видно, что именно стёрли\n' +
  '✏️ изменённые — с версией «до правки»\n' +
  '🔥 исчезающие фото, кружки и голосовые\n' +
  '🔁 присланное повторно — понятно, что фото не сегодняшнее\n\n' +
  'Работает внутри Telegram, без пересылок и скриншотов. ' +
  'Подключается за минуту и бесплатно.\n\n' +
  '👇 Забирай, потом спасибо скажешь';

// Ссылка на нативный шаринг Telegram: открывает выбор чата с готовым текстом.
export function shareUrl(botUsername, tgId, text = SHARE_TEXT) {
  const link = inviteLink(botUsername, tgId);
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

// Склонение: «1 друг / 2 друга / 5 друзей»
export function pluralFriends(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'друзей';
  if (b === 1) return 'друга';
  if (b >= 2 && b <= 4) return 'друга';
  return 'друзей';
}
