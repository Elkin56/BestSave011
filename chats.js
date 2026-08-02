// api/bot-info.js
// Отдаёт публичную информацию о боте (username), чтобы фронтенд строил
// ссылку t.me/<bot>?startgroup=... не по захардкоженной строке, а по факту.
// Источник истины — Telegram getMe: сервер знает токен, значит знает и имя бота.
// Username пользователя тут НЕ подходит: нужен именно бот, а не тот, кто открыл app.

let cached = null; // живёт в тёплом контейнере, getMe не дёргаем на каждый запрос

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const token = process.env.BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'BOT_TOKEN not set' });

  if (cached) return res.status(200).json(cached);

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await r.json();
    if (!data.ok || !data.result?.username) {
      return res.status(502).json({ error: 'getMe failed' });
    }
    cached = {
      username: data.result.username,
      name: data.result.first_name || null,
      id: data.result.id,
    };
    // Кэш на CDN на час: username бота меняется крайне редко.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(cached);
  } catch (e) {
    console.error('bot-info:', e?.message);
    return res.status(502).json({ error: 'telegram unreachable' });
  }
}
