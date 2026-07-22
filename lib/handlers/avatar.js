// api/avatar.js
// Фотография профиля из Telegram — своя или собеседника из чата.
//
// Свой аватар: user_id берётся из проверенного initData.
//
// Аватар собеседника (?peer=<tg id>): бот запрашивает фото через
// getUserProfilePhotos. Чтобы нельзя было тянуть фото ПРОИЗВОЛЬНОГО
// человека по id, доступ ограничен: peer должен реально присутствовать
// как отправитель в архиве, видимом смотрящему. То есть показать можно
// только тех, с кем пользователь и так переписывается и чьи сообщения
// уже у него в архиве.
//
// Если фото нет (скрыто приватностью или не установлено) — 404,
// фронтенд показывает букву.

import { requireResourceAuth } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireResourceAuth(req, res)) return;

  const token = process.env.BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'server misconfigured' });

  const api = (m) => `https://api.telegram.org/bot${token}/${m}`;
  const viewer = req.tgUser.id;

  // Чей аватар: свой по умолчанию, либо собеседника по ?peer=
  let targetId = viewer;
  const peerRaw = req.query?.peer;
  if (peerRaw != null && String(peerRaw) !== String(viewer)) {
    const peer = Number(peerRaw);
    if (!Number.isFinite(peer)) return res.status(400).json({ error: 'bad peer' });

    try {
      await ensureSchema();
      // Доступ: этот отправитель должен встречаться в видимых смотрящему
      // сообщениях. Чужой id, которого нет в его архиве, — отказ.
      const { rows } = await q(
        `SELECT 1
         FROM message m
         JOIN chat_link cl ON cl.chat_id = m.chat_id
         JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
         WHERE m.sender_tg_id = $2 AND ${VISIBLE}
         LIMIT 1`,
        [viewer, peer]
      );
      if (rows.length === 0) return res.status(403).json({ error: 'peer not in your archive' });
    } catch (e) {
      console.error('GET /avatar peer-check:', e?.message);
      return res.status(500).json({ error: 'internal' });
    }
    targetId = peer;
  }

  try {
    const photos = await fetch(api('getUserProfilePhotos'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: targetId, limit: 1 }),
    }).then((r) => r.json());

    const sizes = photos?.result?.photos?.[0];
    if (!photos?.ok || !sizes?.length) {
      return res.status(404).json({ error: 'no profile photo' });
    }

    // Средний размер — достаточно для аватара, быстрее большого
    const size = sizes[Math.min(1, sizes.length - 1)];

    const gf = await fetch(api('getFile'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: size.file_id }),
    }).then((r) => r.json());

    if (!gf?.ok || !gf.result?.file_path) {
      return res.status(502).json({ error: 'telegram getFile failed' });
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${gf.result.file_path}`);
    if (!fileRes.ok) return res.status(502).json({ error: 'telegram file fetch failed' });

    const buf = Buffer.from(await fileRes.arrayBuffer());
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=1800'); // полчаса кэша
    res.status(200).send(buf);
  } catch (e) {
    console.error('GET /avatar:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
