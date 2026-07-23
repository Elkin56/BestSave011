// api/[...route].js
// Единый catch-all для всех прочих API-эндпоинтов.
//
// Почему через один файл: у Vercel Hobby лимит — 12 Serverless Functions.
// Раньше каждый api/*.js становился отдельной функцией (14 штук — превышение).
// Теперь эти обработчики лежат в lib/handlers/ (Vercel их за функции не считает),
// а этот роутер выбирает нужный по первому сегменту пути. Итого функций две:
// bot.js (вебхук с секретом Telegram) + этот роутер.
//
// Пути и поведение не меняются: /api/stats, /api/chats, /api/me, /api/events,
// /api/bot-info, /api/messages, /api/settings, /api/media, /api/avatar,
// /api/export, /api/health, /api/diag, /api/setup работают ровно так же.

import activity from '../lib/handlers/activity.js';
import admin from '../lib/handlers/admin.js';
import avatar from '../lib/handlers/avatar.js';
import botInfo from '../lib/handlers/bot-info.js';
import chats from '../lib/handlers/chats.js';
import diag from '../lib/handlers/diag.js';
import erase from '../lib/handlers/erase.js';
import events from '../lib/handlers/events.js';
import exportChat from '../lib/handlers/export.js';
import health from '../lib/handlers/health.js';
import me from '../lib/handlers/me.js';
import media from '../lib/handlers/media.js';
import messages from '../lib/handlers/messages.js';
import pin from '../lib/handlers/pin.js';
import settings from '../lib/handlers/settings.js';
import setup from '../lib/handlers/setup.js';
import stats from '../lib/handlers/stats.js';

// Ключ — первый сегмент пути после /api/. Ключи должны совпадать
// с прежними именами файлов, чтобы фронтенд не менять.
const routes = {
  activity,
  admin,
  avatar,
  'bot-info': botInfo,
  chats,
  diag,
  erase,
  events,
  export: exportChat,
  health,
  me,
  media,
  messages,
  pin,
  settings,
  setup,
  stats,
};

export default async function handler(req, res) {
  // req.query.route — массив сегментов из [...route]. Берём первый.
  // На всякий случай парсим и из url — на случай прямого вызова из тестов.
  const seg = Array.isArray(req.query?.route) ? req.query.route[0]
    : (req.url || '').replace(/^\/api\//, '').split(/[/?]/)[0];

  const fn = routes[seg];
  if (!fn) return res.status(404).json({ error: 'not found', route: seg || null });

  return fn(req, res);
}
