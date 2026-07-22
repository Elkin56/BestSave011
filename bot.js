// api/avatar.js
// Фотография профиля пользователя из Telegram — автоматически, без загрузки вручную.
//
// В initData поле photo_url приходит далеко не всегда (зависит от клиента и
// настроек приватности). Поэтому берём фото напрямую через Bot API:
// getUserProfilePhotos → getFile → отдаём картинку. id пользователя — из
// проверенного initData, чужой аватар так не запросить.
//
// Если фото нет (скрыто настройками приватности или не установлено) — 404,
// фронтенд показывает букву.

import { requireAuth } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  const token = process.env.BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'server misconfigured' });

  const api = (m) => `https://api.telegram.org/bot${token}/${m}`;

  try {
    const photos = await fetch(api('getUserProfilePhotos'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: req.tgUser.id, limit: 1 }),
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
