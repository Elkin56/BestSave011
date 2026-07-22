// api/me.js
// Профиль: настоящие имя/username/аватар из проверенного initData
// плюс счётчики по архиву. Платежей в бесплатной версии нет.

import { requireAuth, signResourceToken } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  const u = req.tgUser;

  try {
    await ensureSchema();

    // Считаем только видимые пользователю копии: в чате, подключённом
    // несколькими людьми, чужие сообщения в счётчики попадать не должны.
    const MINE = `
      FROM message m
      JOIN chat_link cl ON cl.chat_id = m.chat_id
      JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
      WHERE ${VISIBLE}`;

    const [agg, biz] = await Promise.all([
      q(`SELECT
           (SELECT COUNT(*)::int FROM chat_link cl2
            JOIN app_user au2 ON au2.id = cl2.user_id WHERE au2.tg_id = $1) AS chats,
           (SELECT COUNT(*)::int ${MINE}) AS messages,
           (SELECT COUNT(*)::int ${MINE} AND m.is_deleted) AS deleted,
           (SELECT MIN(linked_at) FROM chat_link cl3
            JOIN app_user au3 ON au3.id = cl3.user_id WHERE au3.tg_id = $1) AS since`,
        [u.id]),
      q(`SELECT is_enabled, connected_at FROM business_connection
         WHERE user_tg_id = $1 ORDER BY connected_at DESC LIMIT 1`, [u.id]),
    ]);

    const a = agg.rows[0] || {};
    res.status(200).json({
      user: {
        id: u.id,
        firstName: u.first_name || null,
        lastName: u.last_name || null,
        username: u.username || null,
        // photo_url приходит в initData не всегда — фронтенд рисует букву, если пусто
        photoUrl: u.photo_url || null,
        isPremium: Boolean(u.is_premium),
      },
      archive: {
        chats: a.chats || 0,
        messages: a.messages || 0,
        deleted: a.deleted || 0,
        since: a.since || null,
      },
      business: {
        connected: Boolean(biz.rows[0]?.is_enabled),
        since: biz.rows[0]?.connected_at || null,
      },
      // Короткоживущий токен для ссылок на медиа, аватар и выгрузку.
      // Заменяет передачу initData в адресе: срок жизни 6 часов и привязка
      // к этому пользователю.
      resourceToken: signResourceToken(u.id, process.env.BOT_TOKEN),
      plan: {
        name: 'Бесплатная версия',
        balance: 0,
        // Платежей пока нет — интерфейс не показывает кнопок оплаты
        paymentsEnabled: false,
      },
    });
  } catch (e) {
    console.error('GET /me:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
