// api/stats.js
// Сводка по архиву для главного экрана — считается из реальных сообщений.

import { requireAuth } from '../auth.js';
import { q, ensureSchema } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  try {
    await ensureSchema();
    const tgId = req.tgUser.id;

    // Все чаты, привязанные этим пользователем
    const scope = `
      SELECT c.id FROM app_user u
      JOIN chat_link cl ON cl.user_id = u.id
      JOIN chat c ON c.id = cl.chat_id
      WHERE u.tg_id = $1`;

    const [totals, activity, since] = await Promise.all([
      q(`SELECT
           COUNT(*)::int                                          AS total,
           COUNT(*) FILTER (WHERE is_deleted)::int                AS deleted,
           COUNT(*) FILTER (WHERE is_edited)::int                 AS edited,
           COUNT(*) FILTER (WHERE media_type IS NOT NULL)::int    AS media,
           COUNT(*) FILTER (WHERE media_type = 'voice'
                            OR media_type = 'video_note')::int    AS voices
         FROM message WHERE chat_id IN (${scope})`, [tgId]),

      // Последняя активность: что удалили или изменили недавно
      q(`SELECT m.is_deleted, m.is_edited, m.sender_name, c.title,
                COALESCE(m.deleted_at, m.edited_at, m.sent_at) AS at
         FROM message m
         JOIN chat c ON c.id = m.chat_id
         WHERE m.chat_id IN (${scope}) AND (m.is_deleted OR m.is_edited)
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
