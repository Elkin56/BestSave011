// lib/quiet.js
// Тихие часы — чистая логика без обращений к базе.
//
// Вынесено отдельно от db.js намеренно: функция не работает с Postgres,
// а так её можно импортировать и тестировать без драйвера и подключения.

/**
 * Тихо ли сейчас у пользователя.
 *
 * Окно может пересекать полночь (23→8), поэтому проверка идёт по двум
 * случаям: обычный интервал внутри суток и перевёрнутый через полночь.
 *
 * @param s   настройки: { quietHours, quietFrom, quietTo, tzOffsetMin }
 *            tzOffsetMin — минуты к востоку от UTC (Самара = +240)
 * @param now момент времени, параметром для тестируемости
 */
export function isQuietNow(s, now = new Date()) {
  if (!s?.quietHours) return false;

  const from = Number(s.quietFrom ?? 23);
  const to = Number(s.quietTo ?? 8);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (from === to) return false; // пустое окно — тишины нет

  const offset = Number(s.tzOffsetMin ?? 0);
  const localMin = (now.getTime() / 60000) + (Number.isFinite(offset) ? offset : 0);
  const hour = Math.floor(((localMin / 60) % 24 + 24) % 24);

  return from < to
    ? (hour >= from && hour < to)      // обычное окно, например 1→6
    : (hour >= from || hour < to);     // через полночь: 23→8
}
