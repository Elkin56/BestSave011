// api/activity.js
// Графики активности по одному чату: по часам суток, по дням недели
// и по дням за последний период.
//
// Считается только по видимым пользователю копиям (VISIBLE) — в чате,
// подключённом несколькими людьми, чужая переписка в графики не попадает.
//
// Часы приводятся к часовому поясу клиента (?tz=<смещение в минутах>):
// иначе «ночная активность» у пользователя из Самары считалась бы по UTC.

import { requireAuth } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

const DAYS_WINDOW = 30;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  const { chatId, filter = 'all' } = req.query;
  if (!chatId) return res.status(400).json({ error: 'chatId required' });

  // Смещение в минутах, как отдаёт getTimezoneOffset (со знаком минус к UTC).
  // Ограничиваем диапазоном реальных зон, чтобы не подставлять произвольное число.
  const tzRaw = Number(req.query.tz);
  const tzMin = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 14 * 60 ? -tzRaw : 0;

  try {
    await ensureSchema();
    const tgId = req.tgUser.id;

    const access = await q(
      `SELECT c.id FROM app_user u
       JOIN chat_link cl ON cl.user_id = u.id
       JOIN chat c ON c.id = cl.chat_id
       WHERE u.tg_id = $1 AND c.tg_chat_id = $2`,
      [tgId, chatId]
    );
    if (access.rows.length === 0) return res.status(403).json({ error: 'not your chat' });
    const internalId = access.rows[0].id;

    // Те же фильтры, что и в списке сообщений
    const extra = {
      deleted: 'AND m.is_deleted',
      edited: 'AND m.is_edited',
      media: "AND m.media_type IS NOT NULL",
      voices: "AND m.media_type IN ('voice','video_note')",
    }[filter] || '';

    // Локальное время = sent_at + смещение
    const LOCAL = `(m.sent_at + ($3 || ' minutes')::interval)`;

    const MINE = `
      FROM message m
      JOIN chat_link cl ON cl.chat_id = m.chat_id
      JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
      WHERE m.chat_id = $2 AND ${VISIBLE} ${extra}`;

    const [byHour, byWeekday, byDay, total] = await Promise.all([
      q(`SELECT EXTRACT(HOUR FROM ${LOCAL})::int AS k, COUNT(*)::int AS n
         ${MINE} GROUP BY 1`, [tgId, internalId, String(tzMin)]),

      // ISO: 1 — понедельник, 7 — воскресенье
      q(`SELECT EXTRACT(ISODOW FROM ${LOCAL})::int AS k, COUNT(*)::int AS n
         ${MINE} GROUP BY 1`, [tgId, internalId, String(tzMin)]),

      q(`SELECT ${LOCAL}::date AS k, COUNT(*)::int AS n
         ${MINE} AND m.sent_at > now() - ($4 || ' days')::interval
         GROUP BY 1 ORDER BY 1`,
        [tgId, internalId, String(tzMin), String(DAYS_WINDOW)]),

      // total не использует LOCAL, но параметр $3 обязан присутствовать
      // в запросе — иначе Postgres отвергнет лишний аргумент bind.
      q(`SELECT COUNT(*)::int AS n ${MINE} AND ($3 IS NOT NULL)`,
        [tgId, internalId, String(tzMin)]),
    ]);

    const hours = Array(24).fill(0);
    for (const r of byHour.rows) hours[r.k] = r.n;

    const weekdays = Array(7).fill(0);
    for (const r of byWeekday.rows) weekdays[r.k - 1] = r.n;

    // Дни без сообщений тоже нужны, иначе линия графика врёт о плотности
    const daily = [];
    const today = new Date();
    const byDate = new Map(
      byDay.rows.map((r) => [new Date(r.k).toISOString().slice(0, 10), r.n])
    );
    for (let i = DAYS_WINDOW - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
      daily.push({ day: d, count: byDate.get(d) || 0 });
    }

    res.status(200).json({
      total: total.rows[0]?.n || 0,
      hours,
      weekdays,
      daily,
      windowDays: DAYS_WINDOW,
    });
  } catch (e) {
    console.error('GET /activity:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
