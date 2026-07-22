// api/messages.js
// Сообщения архива по чату. Требует initData И проверку, что чат привязан
// именно этим пользователем — иначе любой мог бы читать чужой архив по chatId.

import { requireAuth } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

const PAGE = 50;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  const chatId = req.query.chatId;
  const filter = req.query.filter || 'all'; // all | deleted | edited | media
  const before = req.query.before ? Number(req.query.before) : null;

  if (!chatId) return res.status(400).json({ error: 'chatId required' });

  try {
    await ensureSchema();
    const tgId = req.tgUser.id;

    // Проверка доступа: этот чат должен быть привязан этим пользователем.
    const access = await q(
      `SELECT c.id
       FROM app_user u
       JOIN chat_link cl ON cl.user_id = u.id
       JOIN chat c       ON c.id = cl.chat_id
       WHERE u.tg_id = $1 AND c.tg_chat_id = $2`,
      [tgId, chatId]
    );
    if (access.rows.length === 0) {
      return res.status(403).json({ error: 'not your chat' });
    }
    const internalChatId = access.rows[0].id;

    // $1 — смотрящий, $2 — чат. Правило видимости обязательно: без него
    // в общем чате были бы видны копии чужого архива.
    const where = [`m.chat_id = $2`, VISIBLE];
    const params = [tgId, internalChatId];
    if (filter === 'deleted') where.push('m.is_deleted');
    if (filter === 'edited') where.push('m.is_edited');
    if (filter === 'media') where.push('m.media_type IS NOT NULL');
    if (before) { params.push(before); where.push(`m.id < $${params.length}`); }

    params.push(PAGE);
    const { rows } = await q(
      `SELECT m.id, m.tg_msg_id, m.sender_name, m.text, m.media_type,
              (m.media_file_id IS NOT NULL) AS has_media,
              m.repeat_of_at, m.orig_sent_at,
              m.is_edited, m.is_deleted, m.sent_at, m.edited_at
       FROM message m
       JOIN chat_link cl ON cl.chat_id = m.chat_id
       JOIN app_user au ON au.id = cl.user_id AND au.tg_id = $1
       WHERE ${where.join(' AND ')}
       ORDER BY m.id DESC
       LIMIT $${params.length}`,
      params
    );

    res.status(200).json({
      messages: rows.map((r) => ({
        id: Number(r.id),
        senderName: r.sender_name,
        text: r.text,
        mediaType: r.media_type,
        hasMedia: Boolean(r.has_media),
        // Фейк-контроль: когда этот же файл уже встречался и когда был
        // отправлен оригинал, если сообщение переслано
        repeatOfAt: r.repeat_of_at,
        origSentAt: r.orig_sent_at,
        isEdited: r.is_edited,
        isDeleted: r.is_deleted,
        sentAt: r.sent_at,
        editedAt: r.edited_at,
      })),
      nextBefore: rows.length === PAGE ? Number(rows[rows.length - 1].id) : null,
    });
  } catch (e) {
    console.error('GET /messages:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
