// lib/handlers/cron.js
// GET /api/cron — отправка накопленных уведомлений.
//
// Основной сброс очереди делает вебхук бота попутно с обработкой апдейтов.
// Этот маршрут закрывает дыру: если человеку никто не пишет, вебхук молчит,
// и накопленное лежало бы до следующего сообщения. Cron будит очередь
// независимо от активности.
//
// Доступ: заголовок Vercel Cron либо WEBHOOK_SECRET в параметре — чтобы
// маршрут нельзя было дёргать снаружи ради нагрузки на базу.

import { flushDigests } from '../../api/bot.js';

export default async function handler(req, res) {
  const secret = process.env.WEBHOOK_SECRET;

  // Vercel помечает собственные вызовы cron этим заголовком.
  const fromVercelCron = Boolean(req.headers?.['x-vercel-cron']);
  const bySecret = Boolean(secret) && req.query?.secret === secret;

  if (!fromVercelCron && !bySecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    // Лимит выше, чем у вебхука: здесь никто не ждёт ответа, а функции
    // в vercel.json отведено до 60 секунд.
    const r = await flushDigests({ limit: 200 });
    res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('cron:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
