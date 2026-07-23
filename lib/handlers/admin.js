// api/admin.js
// Панель владельца: эксплуатационные метрики продукта.
//
// ГРАНИЦА, заданная намеренно: эндпоинт НЕ отдаёт содержимое переписки —
// ни текстов, ни медиа, ни названий чатов (название личного чата выдаёт,
// с кем человек общается). В политике конфиденциальности написано, что
// архив виден только владельцу; встроенное чтение чужих сообщений сделало
// бы это утверждение неправдой. Здесь только счётчики и метаданные.
//
// Доступ: список Telegram ID в переменной окружения ADMIN_TG_IDS
// (через запятую). Проверяется по подписанному initData плюс отдельное,
// более строгое требование свежести — см. requireAdmin в lib/auth.js.

import { requireAdmin } from '../auth.js';
import { q, ensureSchema } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  // Подпись + свежесть не старше часа + список ADMIN_TG_IDS.
  // Отказ отвечает 404 и пишется в лог. Подробности — в lib/auth.js.
  if (!requireAdmin(req, res)) return;

  try {
    await ensureSchema();

    const [users, growth, chats, messages, volume, conns, storage, settings] = await Promise.all([
      // Пользователи
      q(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today,
                COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int  AS week,
                COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS month
         FROM app_user`),

      // Регистрации по дням за 30 дней — для графика роста
      q(`SELECT created_at::date AS day, COUNT(*)::int AS n
         FROM app_user
         WHERE created_at > now() - interval '30 days'
         GROUP BY 1 ORDER BY 1`),

      // Чаты по типам
      q(`SELECT COALESCE(c.type,'private') AS type, COUNT(DISTINCT c.id)::int AS n
         FROM chat c JOIN chat_link cl ON cl.chat_id = c.id
         GROUP BY 1 ORDER BY 2 DESC`),

      // Сообщения: объём и структура
      q(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today,
                COUNT(*) FILTER (WHERE is_deleted)::int AS deleted,
                COUNT(*) FILTER (WHERE is_edited)::int  AS edited,
                COUNT(*) FILTER (WHERE media_type IS NOT NULL)::int AS media,
                COUNT(*) FILTER (WHERE owner_tg_id = 0)::int AS quarantined
         FROM message`),

      // Активность по дням — нагрузка на систему
      q(`SELECT created_at::date AS day, COUNT(*)::int AS n
         FROM message
         WHERE created_at > now() - interval '14 days'
         GROUP BY 1 ORDER BY 1`),

      // Бизнес-подключения: сколько живых
      q(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_enabled)::int AS enabled
         FROM business_connection`),

      // Размер базы — на бесплатных тарифах это главный потолок
      q(`SELECT pg_database_size(current_database())::bigint AS db_bytes,
                (SELECT pg_total_relation_size('message'))::bigint AS msg_bytes,
                (SELECT COALESCE(SUM(pg_column_size(text)),0) FROM message)::bigint AS text_bytes`),

      // Какими настройками реально пользуются
      q(`SELECT COUNT(*) FILTER (WHERE notify_deleted)::int AS notify_deleted,
                COUNT(*) FILTER (WHERE notify_edited)::int  AS notify_edited,
                COUNT(*) FILTER (WHERE notify_fake)::int    AS notify_fake,
                COUNT(*) FILTER (WHERE quiet_hours)::int    AS quiet_hours
         FROM app_user`),
    ]);

    // Активные: у кого за неделю в архив что-то пришло.
    // Считаем по владельцам личных архивов и по привязкам групп.
    const active = await q(
      `SELECT COUNT(DISTINCT owner_tg_id)::int AS n
       FROM message
       WHERE owner_tg_id IS NOT NULL AND owner_tg_id <> 0
         AND created_at > now() - interval '7 days'`
    );

    const s = storage.rows[0] || {};
    res.status(200).json({
      users: users.rows[0],
      activeWeek: active.rows[0]?.n || 0,
      growth: growth.rows.map((r) => ({ day: r.day, n: r.n })),
      chats: chats.rows,
      messages: messages.rows[0],
      volume: volume.rows.map((r) => ({ day: r.day, n: r.n })),
      connections: conns.rows[0],
      storage: {
        dbBytes: Number(s.db_bytes || 0),
        messagesBytes: Number(s.msg_bytes || 0),
        textBytes: Number(s.text_bytes || 0),
      },
      settings: settings.rows[0],
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('GET /admin:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
