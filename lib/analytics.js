// lib/analytics.js
// Чистые функции: превращают выборки из архива в карточки «Событий».
// Вынесены отдельно, чтобы тестировать без базы.
//
// Принцип: показываем ТОЛЬКО то, что реально посчитано по архиву.
// Если данных на карточку не хватает — карточка не появляется вовсе,
// вместо того чтобы рисовать правдоподобную выдумку.

/**
 * Детерминированная выборка n элементов по номеру дня.
 * Тасование Фишера–Йетса: всегда завершается за n-1 шагов.
 * (Раньше здесь был while с отбраковкой — он вешал вкладку намертво.)
 */
export function pickDaily(arr, seed, n) {
  const take = Math.min(Math.max(0, n | 0), arr.length);
  const idx = arr.map((_, i) => i);
  let s = (seed | 0) || 1;
  const next = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx.slice(0, take).map((i) => arr[i]);
}

export const dayNumber = (now = Date.now()) => Math.floor(now / 86400000);

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const MONTHS_NOM = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

export function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getDate()} ${MONTHS_RU[dt.getMonth()]} ${dt.getFullYear()}`;
}

export function formatMonth(ym) {
  // ym: 'YYYY-MM'
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym));
  if (!m) return String(ym);
  return `${MONTHS_NOM[Number(m[2]) - 1]} ${m[1]}`;
}

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

export const msgWord = (n) => plural(n, 'сообщение', 'сообщения', 'сообщений');
export const dayWord = (n) => plural(n, 'день', 'дня', 'дней');

/**
 * Строит карточки из уже посчитанных базой данных.
 * @param {object} raw — результаты SQL-агрегаций
 * @returns {Array} карточки, только те, для которых хватило данных
 */
export function buildEventCards(raw) {
  const cards = [];

  // 1. Самый плотный день против среднего
  if (raw.busiestDay && raw.avgPerDay > 0 && raw.busiestDay.count > 0) {
    const ratio = raw.busiestDay.count / raw.avgPerDay;
    // Показываем, только если день действительно выделяется
    if (ratio >= 1.5 && raw.busiestDay.count >= 10) {
      cards.push({
        kind: 'busiest',
        icon: 'bolt',
        color: 'gold',
        title: 'Необычный день',
        date: formatDate(raw.busiestDay.day),
        big: `${raw.busiestDay.count}`,
        label: msgWord(raw.busiestDay.count) + ' за сутки',
        delta: `+${Math.round((ratio - 1) * 100)}%`,
        sub: `к вашему обычному дню (${raw.avgPerDay.toFixed(1)} в среднем)`,
      });
    }
  }

  // 2. Начало переписки в конкретном чате
  for (const f of raw.firsts || []) {
    if (!f.firstDate) continue;
    const lines = [];
    if (f.firstText) {
      const t = f.firstText.length > 70 ? f.firstText.slice(0, 70) + '…' : f.firstText;
      lines.push(['Первое сообщение', `«${t}»`]);
    }
    if (f.firstPhoto) lines.push(['Первое фото', formatDate(f.firstPhoto)]);
    if (f.firstVoice) lines.push(['Первое голосовое', formatDate(f.firstVoice)]);
    if (!lines.length) continue;
    cards.push({
      kind: 'first',
      icon: 'clock',
      color: 'green',
      title: 'Всё началось',
      chat: f.title,
      date: formatDate(f.firstDate),
      lines,
    });
  }

  // 3. Пик общения по месяцу
  for (const p of raw.peaks || []) {
    if (!p.month || p.count < 5) continue;
    cards.push({
      kind: 'peak',
      icon: 'fire',
      color: 'red',
      title: 'Пик общения',
      chat: p.title,
      big: formatMonth(p.month),
      label: `${p.count} ${msgWord(p.count)} за месяц`,
      sub: 'самый плотный месяц в этом чате',
    });
  }

  // 4. Всего сообщений в чате
  for (const t of raw.totals || []) {
    if (!t.count || t.count < 20) continue;
    const days = t.days || 1;
    const perDay = t.count / days;
    cards.push({
      kind: 'total',
      icon: 'chat',
      color: 'blue',
      title: `Чат: ${t.title}`,
      big: String(t.count),
      label: msgWord(t.count) + ' в архиве',
      sub: `в среднем ${perDay.toFixed(1)} в день`,
    });
  }

  // 5. Ночная переписка
  if (raw.latestNight?.at) {
    const dt = new Date(raw.latestNight.at);
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    cards.push({
      kind: 'night',
      icon: 'moon',
      color: 'violet',
      title: 'Ночная переписка',
      big: `${hh}:${mm}`,
      label: 'самое позднее сообщение',
      sub: [formatDate(dt), raw.latestNight.title].filter(Boolean).join(', '),
    });
  }

  // 6. Серия дней подряд
  if (raw.streak >= 3) {
    cards.push({
      kind: 'streak',
      icon: 'fire',
      color: 'gold',
      title: 'Серия',
      big: `${raw.streak} ${dayWord(raw.streak)}`,
      label: 'подряд с перепиской',
      sub: 'самая длинная за время архива',
    });
  }

  // 7. Сохранённое удалённое
  if (raw.deletedTotal > 0) {
    cards.push({
      kind: 'saved',
      icon: 'trash',
      color: 'red',
      title: 'Спасено из удалённых',
      big: String(raw.deletedTotal),
      label: msgWord(raw.deletedTotal) + ' удалили — копии остались',
      sub: 'их больше нет в Telegram, но они есть у вас',
    });
  }

  return cards;
}

/**
 * Итоговая подборка на сегодня: детерминированная, меняется раз в сутки.
 */
export function todaysEvents(raw, n = 4, now = Date.now()) {
  const all = buildEventCards(raw);
  return pickDaily(all, dayNumber(now), n);
}
