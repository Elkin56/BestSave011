// lib/gate.js
// Условия доступа: перед началом работы пользователь должен
//   1) подписаться на канал BestSave Community;
//   2) привести REQUIRED_INVITES друзей по личной ссылке.
//
// Два принципа, ради которых код выглядит именно так:
//
// • Гейт НЕ снимается задним числом. Как только оба условия выполнены,
//   ставим app_user.gate_passed_at и больше не проверяем ничего. Иначе
//   отписка от канала или сбой Telegram API отрезали бы человека от уже
//   собранного архива — данные его, а не наши.
//
// • Сбой проверки не запирает дверь молча. Если getChatMember не ответил,
//   возвращаем reason='unknown' и показываем это в интерфейсе, а не
//   выдаём «вы не подписаны».

export const REQUIRED_INVITES = Number(process.env.REQUIRED_INVITES || 3);

// Канал сообщества. Публичный @username или числовой id (-100…),
// если канал приватный. Бот обязан быть админом канала — иначе
// getChatMember вернёт ошибку прав.
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

// ─── подписка ───

// Статусы участника канала. 'left' и 'kicked' — не подписан.
// 'restricted' считается подпиской только при is_member: человек в канале,
// просто ограничен в правах.
export function isSubscribedStatus(status, isMember) {
  if (status === 'creator' || status === 'administrator' || status === 'member') return true;
  if (status === 'restricted') return Boolean(isMember);
  return false;
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

// ─── сборка состояния ───

/**
 * Единая форма состояния гейта — её отдаёт API и рисует интерфейс.
 * @param {{subscribed:boolean|null, invites:number, need:number,
 *          passedAt:Date|string|null, botUsername:string, tgId:number}} p
 */
export function gateState(p) {
  const need = Number.isFinite(p.need) ? p.need : REQUIRED_INVITES;
  const invites = Math.max(0, Number(p.invites) || 0);
  const already = Boolean(p.passedAt);

  // Ранее пройденный гейт закрыт навсегда: оба шага показываем выполненными,
  // чтобы интерфейс не пугал человека «вы отписались».
  const subscribed = already ? true : p.subscribed;

  return {
    passed: already || (subscribed === true && invites >= need),
    grandfathered: already,
    channel: {
      title: COMMUNITY_TITLE,
      url: communityUrl(),
      // true / false / null — null означает «проверить не удалось»
      subscribed: already ? true : (subscribed === null ? null : Boolean(subscribed)),
    },
    invites: {
      count: invites,
      need,
      left: Math.max(0, need - invites),
      link: inviteLink(p.botUsername, p.tgId),
      shareUrl: shareUrl(p.botUsername, p.tgId),
      text: SHARE_TEXT,
    },
  };
}

// Склонение для «осталось N друзей»
export function pluralFriends(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'друзей';
  if (b === 1) return 'друга';
  if (b >= 2 && b <= 4) return 'друга';
  return 'друзей';
}
