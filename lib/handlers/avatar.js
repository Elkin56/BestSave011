// api/avatar.js
// Фотографии из Telegram: своя, собеседника или чата из списка.
//
// Три режима:
//   без параметров — свой аватар (id из проверенного initData)
//   ?peer=<id>     — аватар отправителя сообщения
//   ?chat=<id>     — фото чата для списка: у личных это аватар собеседника
//                    (в личном чате tg_chat_id совпадает с его id),
//                    у групп и каналов — фото самого чата через getChat
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

import { requireResourceAuth, parseAdminIds } from '../auth.js';
import { q, ensureSchema, VISIBLE } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireResourceAuth(req, res)) return;

  const token = process.env.BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'server misconfigured' });

  const api = (m) => `https://api.telegram.org/bot${token}/${m}`;
  const viewer = req.tgUser.id;

  // Что запрашиваем: свой аватар, аватар собеседника (?peer=) или
  // фото чата для списка (?chat=).
  let targetId = viewer;
  let chatFileId = null;

  const chatRaw = req.query?.chat;
  const peerRaw = req.query?.peer;

  if (chatRaw != null) {
    // ── Фото чата для списка ──
    const chatId = String(chatRaw);
    try {
      await ensureSchema();
      // Доступ: чат должен быть привязан этим пользователем
      const { rows } = await q(
        `SELECT c.tg_chat_id, c.type
         FROM app_user u
         JOIN chat_link cl ON cl.user_id = u.id
         JOIN chat c       ON c.id = cl.chat_id
         WHERE u.tg_id = $1 AND c.tg_chat_id = $2`,
        [viewer, chatId]
      );
      if (rows.length === 0) return res.status(403).json({ error: 'not your chat' });

      const type = rows[0].type;
      // В личном чате tg_chat_id совпадает с id собеседника, поэтому его
      // аватар берётся тем же способом, что и любой профиль.
      if (!type || type === 'private') {
        targetId = Number(chatId);
        if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'bad chat' });
      } else {
        // У групп и каналов своё фото — оно приходит в getChat
        const info = await fetch(api('getChat'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId }),
        }).then((r) => r.json()).catch(() => null);

        const photo = info?.result?.photo;
        if (!info?.ok || !photo) return res.status(404).json({ error: 'no chat photo' });
        chatFileId = photo.small_file_id || photo.big_file_id;
      }
    } catch (e) {
      console.error('GET /avatar chat-check:', e?.message);
      return res.status(500).json({ error: 'internal' });
    }
  } else if (peerRaw != null && String(peerRaw) !== String(viewer)) {
    // ── Аватар собеседника у сообщения ИЛИ пользователя в админ-списке ──
    const peer = Number(peerRaw);
    if (!Number.isFinite(peer)) return res.status(400).json({ error: 'bad peer' });

    try {
      await ensureSchema();

      // Владелец продукта видит аватары всех зарегистрированных пользователей
      // (для списка в админке). Остальные — только тех отправителей, что
      // встречаются в их собственном видимом архиве.
      const admins = parseAdminIds(process.env.ADMIN_TG_IDS);
      const isOwner = admins.includes(String(viewer));

      let allowed = false;
      if (isOwner) {
        const { rows } = await q(`SELECT 1 FROM app_user WHERE tg_id = $1 LIMIT 1`, [peer]);
        allowed = rows.length > 0;
      } else {
        const { rows } = await q(
          `SELECT 1
           FROM message m
           JOIN chat_link cl ON cl.chat_id = m.chat_id
           JOIN app_user u   ON u.id = cl.user_id AND u.tg_id = $1
           WHERE m.sender_tg_id = $2 AND ${VISIBLE}
           LIMIT 1`,
          [viewer, peer]
        );
        allowed = rows.length > 0;
      }
      if (!allowed) return res.status(403).json({ error: 'peer not accessible' });
    } catch (e) {
      console.error('GET /avatar peer-check:', e?.message);
      return res.status(500).json({ error: 'internal' });
    }
    targetId = peer;
  }

  try {
    // Для групп file_id уже известен из getChat, для профилей — ищем фото
    let fileId = chatFileId;

    if (!fileId) {
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
      fileId = sizes[Math.min(1, sizes.length - 1)].file_id;
    }

    const gf = await fetch(api('getFile'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
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
