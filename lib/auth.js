// lib/auth.js
// Проверка Telegram Mini App initData: HMAC-SHA256 по схеме WebAppData.
// Это то же ядро, что в основном проекте (auth/telegram-init-data.ts),
// перенесённое под serverless и покрытое отдельными тестами.

import crypto from 'node:crypto';

const MAX_AGE_SEC = 24 * 60 * 60; // сутки: перехваченный initData не должен жить вечно
const CLOCK_SKEW_SEC = 60;        // допуск на рассинхрон часов клиента

/**
 * Проверяет подпись и возраст initData.
 * @returns {{ ok: true, user: object } | { ok: false, reason: string }}
 */
export function verifyInitData(initData, botToken, now = Math.floor(Date.now() / 1000)) {
  if (!initData || typeof initData !== 'string') {
    return { ok: false, reason: 'empty initData' };
  }
  if (!botToken) {
    return { ok: false, reason: 'server misconfigured: no bot token' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no hash' };

  params.delete('hash');

  // data_check_string: пары key=value, отсортированные по ключу, через \n
  const pairs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dcs = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secretKey).update(dcs).digest('hex');

  // timing-safe сравнение: строки одной длины, иначе timingSafeEqual бросит
  const a = Buffer.from(calc, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad signature' };
  }

  // Возраст: auth_date не старше суток и не из будущего
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: 'no auth_date' };
  }
  const age = now - authDate;
  if (age < -CLOCK_SKEW_SEC) return { ok: false, reason: 'auth_date in future' };
  if (age > MAX_AGE_SEC) return { ok: false, reason: 'initData expired' };

  // Парсим пользователя
  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return { ok: false, reason: 'bad user json' };
  }
  if (!user || typeof user.id !== 'number') {
    return { ok: false, reason: 'no user id' };
  }

  return { ok: true, user };
}

/**
 * Достаёт initData из заголовка Authorization: "tma <initData>".
 */
export function initDataFromHeader(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = /^tma\s+(.+)$/i.exec(auth);
  return m ? m[1] : null;
}

// ─── Токен для ресурсных ссылок ───
// В <img>, <audio> и ссылку на скачивание заголовок не поставить, а класть
// в адрес сам initData плохо: он оседает в логах, истории и Referer, и он
// долгоживущий (сутки). Вместо этого выдаём короткий токен, привязанный
// к конкретному пользователю, с собственным сроком жизни.

const TOKEN_TTL_SEC = 6 * 60 * 60;

function tokenSig(payload, botToken) {
  // Ключ выводим из токена бота, а не используем его напрямую — тот же приём,
  // что в схеме WebAppData: утечка подписи не раскрывает сам токен.
  const key = crypto.createHmac('sha256', 'BestSaveResource').update(botToken).digest();
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

export function signResourceToken(userId, botToken, now = Math.floor(Date.now() / 1000)) {
  if (!botToken) return null;
  const exp = now + TOKEN_TTL_SEC;
  const payload = `${userId}.${exp}`;
  return `${payload}.${tokenSig(payload, botToken)}`;
}

export function verifyResourceToken(token, botToken, now = Math.floor(Date.now() / 1000)) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'no token' };
  if (!botToken) return { ok: false, reason: 'server misconfigured' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };

  const [rawId, rawExp, sig] = parts;
  const payload = `${rawId}.${rawExp}`;
  const expected = tokenSig(payload, botToken);

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad token signature' };
  }

  const exp = Number(rawExp);
  const userId = Number(rawId);
  if (!Number.isFinite(exp) || !Number.isFinite(userId)) {
    return { ok: false, reason: 'malformed token' };
  }
  if (now > exp) return { ok: false, reason: 'token expired' };

  return { ok: true, userId };
}

/**
 * Обёртка для API-роутов: проверяет initData, кладёт user в req.tgUser.
 * Возвращает true, если запрос авторизован; иначе сам отвечает 401 и возвращает false.
 */
export function requireAuth(req, res) {
  const token = process.env.BOT_TOKEN;
  const initData = initDataFromHeader(req);
  const result = verifyInitData(initData, token);
  if (!result.ok) {
    res.status(401).json({ error: 'unauthorized', reason: result.reason });
    return false;
  }
  req.tgUser = result.user;
  return true;
}

/**
 * Авторизация ресурсных запросов (<img>, <audio>, скачивание).
 * Принимает либо обычный заголовок с initData, либо ?t=<токен>.
 * В req.tgUser кладёт минимум — id: остальные поля профиля здесь не нужны.
 */
export function requireResourceAuth(req, res) {
  const botToken = process.env.BOT_TOKEN;

  const initData = initDataFromHeader(req);
  if (initData) {
    const r = verifyInitData(initData, botToken);
    if (r.ok) { req.tgUser = r.user; return true; }
  }

  const t = typeof req.query?.t === 'string' ? req.query.t : null;
  const r = verifyResourceToken(t, botToken);
  if (!r.ok) {
    res.status(401).json({ error: 'unauthorized', reason: r.reason });
    return false;
  }
  req.tgUser = { id: r.userId };
  return true;
}

// ─── Доступ владельца ───

// Для админки initData должен быть свежим. Обычные экраны терпят сутки, но
// здесь это слишком длинное окно: утёкший initData (лог, скриншот, DevTools)
// давал бы сутки доступа к метрикам всего продукта. Час — практичный
// компромисс: сессия в Mini App живёт меньше, а повторить перехват сложнее.
const ADMIN_MAX_AGE_SEC = 60 * 60;

/**
 * Разбор списка владельцев из ADMIN_TG_IDS.
 * Принимаются ТОЛЬКО целые числа: опечатка вроде "admin" или пустая строка
 * не должна превращаться в запись, с которой что-то случайно совпадёт.
 */
export function parseAdminIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

/**
 * Доступ к панели владельца.
 * Проверок три, и все обязательны:
 *   1. подпись initData (нельзя подделать без токена бота),
 *   2. свежесть не больше часа (сужает окно повтора),
 *   3. id в списке ADMIN_TG_IDS.
 *
 * Посторонним отвечает 404: 403 подтвердил бы существование эндпоинта.
 * Любая попытка — успешная или нет — пишется в лог как след для разбора.
 */
export function requireAdmin(req, res) {
  const deny = (reason) => {
    console.warn(`admin: отказ — ${reason}`);
    res.status(404).json({ error: 'not found' });
    return false;
  };

  const initData = initDataFromHeader(req);
  const result = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!result.ok) return deny(result.reason);

  // Свежесть: считаем возраст отдельно, строже общего правила.
  // Подпись уже проверена, поэтому auth_date здесь заведомо подлинный.
  const authDate = Number(new URLSearchParams(initData).get('auth_date'));
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isFinite(authDate) || age > ADMIN_MAX_AGE_SEC) {
    return deny(`устаревший initData (${age}s) у ${result.user.id}`);
  }

  const admins = parseAdminIds(process.env.ADMIN_TG_IDS);
  if (admins.length === 0) return deny('ADMIN_TG_IDS не задан — доступ закрыт для всех');

  if (!admins.includes(String(result.user.id))) {
    // Именно это стоит видеть в логах: кто-то знает про эндпоинт
    return deny(`ПОПЫТКА ВХОДА от ${result.user.id} (@${result.user.username || '—'})`);
  }

  console.log(`admin: вход ${result.user.id}`);
  req.tgUser = result.user;
  return true;
}
