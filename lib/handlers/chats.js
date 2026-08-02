// api/chats.js
// Список чатов, привязанных текущим пользователем. Требует валидный initData.

import { requireAuth } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return; // сам ответит 401

  try {
    await ensureSchema();
    const tgId = req.tgUser.id;

    // Счётчики считаются ТОЛЬКО по видимым этому пользователю копиям.
    // Иначе число сообщений и удалённых выдавало бы объём чужой переписки
    // в чате, подключённом сразу несколькими людьми.
    const { rows } = await q(
      `SELECT c.tg_chat_id, c.title, c.type, cl.bot_is_admin, cl.via_business, cl.linked_at,
              COUNT(m.id)                             AS total,
              COUNT(m.id) FILTER (WHERE m.is_deleted) AS deleted,
              COUNT(m.id) FILTER (WHERE m.is_edited)  AS edited
       FROM app_user u
       JOIN chat_link cl ON cl.user_id = u.id
       JOIN chat c       ON c.id = cl.chat_id
       LEFT JOIN message m ON m.chat_id = c.id AND ${VISIBLE}
       WHERE u.tg_id = $1
       GROUP BY c.tg_chat_id, c.title, c.type, cl.bot_is_admin, cl.via_business, cl.linked_at
       ORDER BY cl.linked_at DESC`,
      [tgId]
    );

    // Есть ли активное бизнес-подключение у этого пользователя
    const bc = await q(
      `SELECT id, is_enabled, connected_at FROM business_connection
       WHERE user_tg_id = $1 AND is_enabled ORDER BY connected_at DESC LIMIT 1`,
      [tgId]
    );

    res.status(200).json({
      businessConnected: bc.rows.length > 0,
      businessSince: bc.rows[0]?.connected_at || null,
      chats: rows.map((r) => ({
        chatId: String(r.tg_chat_id),
        title: r.title,
        type: r.type,
        botIsAdmin: r.bot_is_admin,
        viaBusiness: r.via_business,
        linkedAt: r.linked_at,
        stats: {
          total: Number(r.total),
          deleted: Number(r.deleted),
          edited: Number(r.edited),
        },
      })),
    });
  } catch (e) {
    console.error('GET /chats:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
