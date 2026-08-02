// lib/handlers/gate.js
// GET/POST /api/gate — совместимость, не более.
//
// Условий доступа больше нет: подписка на канал и три приглашённых друга
// сняты. Маршрут оставлен намеренно — Mini App кэшируется у пользователя
// на устройстве, и клиент прошлой версии первым делом дёргает /api/gate.
// Если ответить 404, у таких людей приложение упадёт на старте вместо того,
// чтобы просто открыться.
//
// Поэтому отвечаем «всё выполнено» и ничего не проверяем: ни Telegram,
// ни базу. Через несколько релизов маршрут можно убрать совсем.

import { requireAuth } from '../auth.js';
import { COMMUNITY_TITLE, communityUrl } from '../invite.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  res.status(200).json({
    passed: true,
    grandfathered: true,
    channel: { title: COMMUNITY_TITLE, url: communityUrl(), subscribed: true },
    invites: { count: 0, need: 0, left: 0 },
  });
}
