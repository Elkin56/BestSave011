// lib/digest.js
// Режим доставки уведомлений: сразу, раз в час, раз в день или молча.
//
// Зачем: при активной переписке уведомления об удалении и правках сыплются
// по одному и превращаются в спам. Дайджест копит события и отдаёт их одним
// сообщением.
//
// Побочный выигрыш — тихие часы. Раньше ночное событие просто НЕ отправлялось
// («увидит утром в приложении»), то есть уведомление молча терялось. Теперь
// оно встаёт в очередь и приходит, когда тишина закончится.
//
// Модуль чистый: ни базы, ни сети. Всё решается по настройкам и времени,
// поэтому проверяется тестами без окружения.

import { isQuietNow } from './quiet.js';

export const MODES = ['instant', 'hourly', 'daily', 'silent'];
export const DEFAULT_MODE = 'instant';

// Час местного времени, в который уходит дневная сводка.
export const DAILY_HOUR = 9;

// Предохранитель: если cron не отработал (сбой, смена тарифа, пауза проекта),
// накопленное не должно лежать вечно. Через сутки с лишним отдаём в любом
// случае — лучше сводка не в свой час, чем молчание.
const STALE_HOURS = 25;

export function normalizeMode(v) {
  return MODES.includes(v) ? v : DEFAULT_MODE;
}

/**
 * Последний наступивший момент «DAILY_HOUR по местному времени».
 * Если сейчас позже него — сегодняшний, иначе вчерашний.
 *
 * Нужен потому, что дневная сводка не может ловить ровно свой час: cron на
 * бесплатном тарифе Vercel запускается раз в сутки, а попутный сброс на
 * вебхуке случается когда придётся. Сравнение «событие старше последних
 * девяти утра» самокорректируется: сводка уйдёт при первой же возможности
 * после срока, а не пропадёт до завтра.
 */
export function lastDailyMoment(tzOffsetMin, now = new Date(), hour = DAILY_HOUR) {
  const off = Number(tzOffsetMin) || 0;
  const local = new Date(now.getTime() + off * 60000);
  const moment = new Date(local);
  moment.setUTCHours(hour, 0, 0, 0);          // «hour:00» в местной шкале
  if (moment > local) moment.setUTCDate(moment.getUTCDate() - 1);
  return new Date(moment.getTime() - off * 60000);   // обратно в UTC
}

/** Местный час пользователя. tzOffsetMin — минуты к востоку от UTC. */
export function localHour(tzOffsetMin, now = new Date()) {
  const off = Number(tzOffsetMin);
  const min = now.getTime() / 60000 + (Number.isFinite(off) ? off : 0);
  return Math.floor(((min / 60) % 24 + 24) % 24);
}

/**
 * Пора ли отправлять накопленное.
 *
 * @param s        настройки пользователя (notifyMode, тихие часы, tzOffsetMin)
 * @param oldestAt время самого раннего события в очереди
 * @param now      момент времени — параметром ради тестов
 */
export function isDigestDue(s, oldestAt, now = new Date()) {
  if (!oldestAt) return false;

  const mode = normalizeMode(s?.notifyMode);
  if (mode === 'silent') return false;

  const ageH = (now.getTime() - new Date(oldestAt).getTime()) / 3600000;

  // Просроченное отдаём независимо от режима, тишины и часа.
  if (ageH >= STALE_HOURS) return true;

  // Тихие часы держат очередь: ничего не теряем, просто ждём утра.
  if (isQuietNow(s, now)) return false;

  if (mode === 'instant') return true;
  if (mode === 'hourly') return ageH >= 1;
  // Всё, что накопилось до последних девяти утра, отдаём; более свежее ждёт
  // завтрашней сводки.
  if (mode === 'daily') {
    return new Date(oldestAt) <= lastDailyMoment(s?.tzOffsetMin, now);
  }
  return false;
}

/** Копить ли событие в очереди вместо немедленной отправки. */
export function shouldQueue(s, now = new Date()) {
  const mode = normalizeMode(s?.notifyMode);
  if (mode === 'silent') return false;          // не копим и не шлём
  if (mode !== 'instant') return true;
  return isQuietNow(s, now);                    // мгновенный режим ночью — в очередь
}

/** Включён ли этот тип уведомления в настройках. */
export function noticeEnabled(s, kind) {
  if (normalizeMode(s?.notifyMode) === 'silent') return false;
  if (kind === 'deleted') return s?.notifyDeleted !== false;
  if (kind === 'edited') return Boolean(s?.notifyEdited);
  if (kind === 'fake') return s?.notifyFake !== false;
  return false;
}

// ─── сборка текста ───

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

export const msgWord = (n) => plural(n, 'сообщение', 'сообщения', 'сообщений');

/**
 * Текст сводки из накопленных событий.
 *
 * @param items [{ kind, chatTitle, count, at }]
 *
 * Группируем по чату, а не по типу: человек думает категориями «что было
 * в переписке с Аней», а не «сколько всего правок за день».
 */
export function buildDigest(items, { mode = 'hourly' } = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;

  // Одно событие — обычное уведомление, без обёртки «сводка».
  if (list.length === 1) return buildSingle(list[0]);

  const byChat = new Map();
  for (const it of list) {
    const key = it.chatTitle || 'чат';
    const acc = byChat.get(key) || { deleted: 0, edited: 0, fake: 0 };
    acc[it.kind] = (acc[it.kind] || 0) + (Number(it.count) || 1);
    byChat.set(key, acc);
  }

  const total = list.reduce((n, it) => n + (Number(it.count) || 1), 0);
  const head = mode === 'daily' ? '📋 Сводка за сутки' : '📋 Сводка';

  const lines = [`${head}: ${total} ${plural(total, 'событие', 'события', 'событий')}`, ''];

  for (const [chat, acc] of byChat) {
    const parts = [];
    if (acc.deleted) parts.push(`🗑 удалено ${acc.deleted}`);
    if (acc.edited) parts.push(`✏️ изменено ${acc.edited}`);
    if (acc.fake) parts.push(`⚠️ повтор медиа: ${acc.fake}`);
    lines.push(`«${chat}» — ${parts.join(', ')}`);
  }

  lines.push('', 'Всё сохранено в архиве — откройте приложение, чтобы посмотреть.');
  return lines.join('\n');
}

/** Одиночное событие — прежние формулировки, чтобы тон не менялся. */
function buildSingle(it) {
  const chat = it.chatTitle || 'чат';
  const n = Number(it.count) || 1;

  if (it.kind === 'deleted') {
    return `🗑 В чате «${chat}» удалили ${n} ${msgWord(n)}. ` +
      'Копии остались в вашем архиве BestSave.';
  }
  if (it.kind === 'edited') {
    return `✏️ В чате «${chat}» изменили сообщение. Версия «до» сохранена в архиве.`;
  }
  if (it.kind === 'fake') {
    // Текст собран при постановке в очередь: там были известны детали
    // (когда файл приходил впервые, из какого чата).
    return it.text || `⚠️ В чате «${chat}» пришло медиа, которое уже есть в архиве.`;
  }
  return null;
}

// Подписи режимов для интерфейса — один источник для приложения и бота.
export const MODE_LABEL = {
  instant: 'Сразу',
  hourly: 'Раз в час',
  daily: 'Раз в день',
  silent: 'Только в приложении',
};

export const MODE_HINT = {
  instant: 'Каждое событие приходит отдельным сообщением',
  hourly: 'Накопленное за час — одним сообщением',
  daily: `Одна сводка утром, в ${DAILY_HOUR}:00 по вашему времени`,
  silent: 'Бот не пишет вообще — события видны только здесь',
};
