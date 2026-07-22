// api/events.js
// «События» — мини-аналитика, посчитанная по реальному архиву.
// Подборка детерминированно меняется раз в сутки.
// Карточка появляется, только если для неё хватило данных: ничего не выдумываем.

import { requireAuth } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';
import { todaysEvents } from '../analytics.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  try {
    await ensureSchema();
    const tgId = req.tgUser.id;

    // Аналитика строится ТОЛЬКО по видимым пользователю копиям.
    // Иначе «самый плотный день» или «первое фото» могли бы выдать
    // содержимое чужой переписки в общем чате.
    const MINE = `
      FROM message m
      JOIN chat_link cl ON cl.chat_id = m.chat_id
      JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
      WHERE ${VISIBLE}`;

    // Все аналитические запросы строятся на видимых копиях (MINE),
    // включая вложенные подзапросы «первое фото / первое голосовое»:
    // иначе дата первого фото выдала бы факты чужой переписки.
    const [perDay, firsts, peaks, totals, night, deleted] = await Promise.all([
      // Сообщений по дням — отсюда самый плотный день и среднее
      q(`SELECT m.sent_at::date AS day, COUNT(*)::int AS count
         ${MINE}
         GROUP BY 1 ORDER BY 1`, [tgId]),

      // Начало переписки в каждом чате
      q(`WITH mine AS (
           SELECT m.id, m.chat_id, m.text, m.media_type, m.sent_at ${MINE}
         )
         SELECT c.title,
                MIN(x.sent_at) AS first_date,
                (SELECT text FROM mine t
                 WHERE t.chat_id = c.id AND t.text IS NOT NULL
                 ORDER BY t.sent_at LIMIT 1) AS first_text,
                (SELECT MIN(sent_at) FROM mine t
                 WHERE t.chat_id = c.id AND t.media_type = 'photo') AS first_photo,
                (SELECT MIN(sent_at) FROM mine t
                 WHERE t.chat_id = c.id AND t.media_type IN ('voice','video_note')) AS first_voice
         FROM mine x JOIN chat c ON c.id = x.chat_id
         GROUP BY c.id, c.title
         LIMIT 6`, [tgId]),

      // Самый плотный месяц в каждом чате
      q(`WITH mine AS (SELECT m.chat_id, m.sent_at ${MINE})
         SELECT title, month, count FROM (
           SELECT c.title,
                  to_char(x.sent_at, 'YYYY-MM') AS month,
                  COUNT(*)::int AS count,
                  ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY COUNT(*) DESC) AS rn
           FROM mine x JOIN chat c ON c.id = x.chat_id
           GROUP BY c.id, c.title, 2
         ) s WHERE rn = 1 ORDER BY count DESC LIMIT 5`, [tgId]),

      // Всего сообщений и охват в днях по чату
      q(`WITH mine AS (SELECT m.chat_id, m.sent_at ${MINE})
         SELECT c.title, COUNT(*)::int AS count,
                GREATEST(1, (MAX(x.sent_at)::date - MIN(x.sent_at)::date) + 1)::int AS days
         FROM mine x JOIN chat c ON c.id = x.chat_id
         GROUP BY c.id, c.title ORDER BY count DESC LIMIT 5`, [tgId]),

      // Самое позднее ночное сообщение (00:00–05:00)
      q(`WITH mine AS (SELECT m.chat_id, m.sent_at ${MINE})
         SELECT x.sent_at AS at, c.title
         FROM mine x JOIN chat c ON c.id = x.chat_id
         WHERE EXTRACT(HOUR FROM x.sent_at) BETWEEN 0 AND 5
         ORDER BY EXTRACT(HOUR FROM x.sent_at) DESC,
                  EXTRACT(MINUTE FROM x.sent_at) DESC
         LIMIT 1`, [tgId]),

      q(`SELECT COUNT(*)::int AS n ${MINE} AND m.is_deleted`, [tgId]),
    ]);

    // Серия дней подряд — считаем в JS, так проще и прозрачнее
    const days = perDay.rows.map((r) => new Date(r.day).getTime() / 86400000 | 0);
    let streak = 0, best = 0, prev = null;
    for (const d of days) {
      streak = prev !== null && d === prev + 1 ? streak + 1 : 1;
      if (streak > best) best = streak;
      prev = d;
    }

    const counts = perDay.rows.map((r) => r.count);
    const avgPerDay = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
    const busiest = perDay.rows.reduce(
      (m, r) => (!m || r.count > m.count ? { day: r.day, count: r.count } : m), null);

    const raw = {
      busiestDay: busiest,
      avgPerDay,
      streak: best,
      deletedTotal: deleted.rows[0]?.n || 0,
      firsts: firsts.rows.map((r) => ({
        title: r.title, firstDate: r.first_date, firstText: r.first_text,
        firstPhoto: r.first_photo, firstVoice: r.first_voice,
      })),
      peaks: peaks.rows.map((r) => ({ title: r.title, month: r.month, count: r.count })),
      totals: totals.rows.map((r) => ({ title: r.title, count: r.count, days: r.days })),
      latestNight: night.rows[0] ? { at: night.rows[0].at, title: night.rows[0].title } : null,
    };

    const cards = todaysEvents(raw, 4);
    res.status(200).json({
      cards,
      // Честно сообщаем, почему может быть пусто
      totalMessages: counts.reduce((a, b) => a + b, 0),
    });
  } catch (e) {
    console.error('GET /events:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
