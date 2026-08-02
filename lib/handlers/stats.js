// api/stats.js
// Сводка по архиву для главного экрана — считается из реальных сообщений.
//
// Все запросы идут через chat_link текущего пользователя и правило VISIBLE:
// в чат, подключённый несколькими людьми, каждый видит только свои копии.

import { requireAuth } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

// Сообщения, доступные пользователю $1. Одна связь на пару (пользователь, чат),
// поэтому JOIN не размножает строки.
const MINE = `
  FROM message m
  JOIN chat_link cl ON cl.chat_id = m.chat_id
  JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
  WHERE ${VISIBLE}`;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  try {
    await ensureSchema();
    const tgId = req.tgUser.id;

    const [totals, activity, since] = await Promise.all([
      q(`SELECT
           COUNT(*)::int                                            AS total,
           COUNT(*) FILTER (WHERE m.is_deleted)::int                 AS deleted,
           COUNT(*) FILTER (WHERE m.is_edited)::int                  AS edited,
           COUNT(*) FILTER (WHERE m.media_type IS NOT NULL)::int     AS media,
           COUNT(*) FILTER (WHERE m.media_type = 'voice'
                            OR m.media_type = 'video_note')::int     AS voices
         ${MINE}`, [tgId]),

      // Последняя активность: что удалили или изменили недавно
      q(`SELECT m.is_deleted, m.is_edited, m.sender_name, c.title,
                COALESCE(m.deleted_at, m.edited_at, m.sent_at) AS at
         FROM message m
         JOIN chat_link cl ON cl.chat_id = m.chat_id
         JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
         JOIN chat c       ON c.id = m.chat_id
         WHERE ${VISIBLE} AND (m.is_deleted OR m.is_edited)
         ORDER BY COALESCE(m.deleted_at, m.edited_at, m.sent_at) DESC
         LIMIT 8`, [tgId]),

      q(`SELECT MIN(cl.linked_at) AS since, COUNT(*)::int AS chats
         FROM app_user u
         JOIN chat_link cl ON cl.user_id = u.id
         WHERE u.tg_id = $1`, [tgId]),
    ]);

    const t = totals.rows[0] || {};
    res.status(200).json({
      totals: {
        total: t.total || 0,
        deleted: t.deleted || 0,
        edited: t.edited || 0,
        media: t.media || 0,
        voices: t.voices || 0,
      },
      chats: since.rows[0]?.chats || 0,
      since: since.rows[0]?.since || null,
      activity: activity.rows.map((r) => ({
        who: r.sender_name || r.title || 'Кто-то',
        chat: r.title,
        what: r.is_deleted ? 'Удалено сообщение' : 'Изменено сообщение',
        tone: r.is_deleted ? 'red' : 'violet',
        at: r.at,
      })),
    });
  } catch (e) {
    console.error('GET /stats:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
