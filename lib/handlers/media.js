// api/media.js
// Отдаёт файл вложения из архива: фото, голосовое, видео, кружок.
//
// Работает и для УДАЛЁННЫХ сообщений: file_id, сохранённый ботом в момент
// получения, остаётся действительным у Telegram — файл скачивается,
// даже если сообщение в чате уже стёрто.
//
// Токен бота наружу не утекает: файл проксируется через этот эндпоинт,
// прямая ссылка api.telegram.org/file/bot<TOKEN>/... клиенту не отдаётся.
//
// Авторизация: initData в ?auth= (заголовок в <img>/<audio> поставить нельзя),
// плюс проверка, что чат привязан именно этим пользователем.

import { requireResourceAuth } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

const MIME = {
  photo: 'image/jpeg',
  voice: 'audio/ogg',
  video: 'video/mp4',
  video_note: 'video/mp4',
  animation: 'video/mp4',
  sticker: 'image/webp',
  document: 'application/octet-stream',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireResourceAuth(req, res)) return;

  const { chatId, msgId } = req.query;
  if (!chatId || !msgId) return res.status(400).json({ error: 'chatId and msgId required' });

  const token = process.env.BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'server misconfigured' });

  try {
    await ensureSchema();

    // Доступ: сообщение должно быть ВИДИМЫМ этому пользователю.
    // Проверки «чат привязан» недостаточно: в чате, подключённом несколькими
    // людьми, по id сообщения можно было вытащить чужое вложение.
    const { rows } = await q(
      `SELECT m.media_file_id, m.media_type
       FROM message m
       JOIN chat c       ON c.id = m.chat_id
       JOIN chat_link cl ON cl.chat_id = c.id
       JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
       WHERE c.tg_chat_id = $2 AND m.id = $3 AND ${VISIBLE}`,
      [req.tgUser.id, chatId, Number(msgId)]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'not your chat' });

    const { media_file_id: fileId, media_type: mediaType } = rows[0];
    if (!fileId) {
      // Сообщение сохранено версией бота до поддержки файлов — честно говорим
      return res.status(404).json({ error: 'file not archived' });
    }

    // getFile → путь → скачиваем и отдаём
    const gf = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    }).then((r) => r.json());

    if (!gf.ok || !gf.result?.file_path) {
      return res.status(502).json({ error: 'telegram getFile failed', reason: gf.description || null });
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${gf.result.file_path}`);
    if (!fileRes.ok) return res.status(502).json({ error: 'telegram file fetch failed' });

    const buf = Buffer.from(await fileRes.arrayBuffer());
    const ext = gf.result.file_path.split('.').pop()?.toLowerCase() || '';
    const byExt = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
      oga:'audio/ogg', ogg:'audio/ogg', mp3:'audio/mpeg', mp4:'video/mp4', gif:'image/gif' }[ext];

    res.setHeader('content-type', byExt || MIME[mediaType] || 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.status(200).send(buf);
  } catch (e) {
    console.error('GET /media:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
