// api/pin.js
// Закрепление сообщения: способ не потерять важное среди тысяч.
//
// Закрепление принадлежит пользователю, а не сообщению: в общем чате
// один участник не должен закреплять другим (см. таблицу message_pin).
//
// POST { msgId, pinned: true|false, note?: string }

import { requireAuth } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

const NOTE_MAX = 200;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const msgId = Number(body.msgId);
  if (!Number.isInteger(msgId)) return res.status(400).json({ error: 'msgId required' });

  const tgId = req.tgUser.id;

  try {
    await ensureSchema();

    // Закреплять можно только то, что пользователю видно. Без этой проверки
    // по id можно было бы закрепить (и потом прочитать) чужое сообщение.
    const { rows } = await q(
      `SELECT m.id
       FROM message m
       JOIN chat_link cl ON cl.chat_id = m.chat_id
       JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
       WHERE m.id = $2 AND ${VISIBLE}
       LIMIT 1`,
      [tgId, msgId]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'not your message' });

    if (body.pinned === false) {
      await q(`DELETE FROM message_pin WHERE user_tg_id = $1 AND message_id = $2`, [tgId, msgId]);
      return res.status(200).json({ pinned: false });
    }

    const note = typeof body.note === 'string' ? body.note.slice(0, NOTE_MAX) : null;
    await q(
      `INSERT INTO message_pin (user_tg_id, message_id, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_tg_id, message_id) DO UPDATE SET note = EXCLUDED.note`,
      [tgId, msgId, note]
    );
    res.status(200).json({ pinned: true });
  } catch (e) {
    console.error('POST /pin:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
