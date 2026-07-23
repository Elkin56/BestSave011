// api/setup.js
// Разовая привязка вебхука прямо из браузера — чтобы не возиться с командной строкой.
// Открывать: https://<проект>.vercel.app/api/setup?secret=<WEBHOOK_SECRET>
//
// Токен НЕ передаётся в адресе: он берётся из переменных окружения на сервере.
// В адресе только ваш WEBHOOK_SECRET, который вы сами задали в настройках Vercel.

export default async function handler(req, res) {
  const token = process.env.BOT_TOKEN;
  const secret = process.env.WEBHOOK_SECRET;

  if (!token) {
    return res.status(500).json({ error: 'BOT_TOKEN не задан в Environment Variables' });
  }
  if (!secret) {
    return res.status(500).json({
      error: 'WEBHOOK_SECRET не задан',
      hint: 'Добавьте WEBHOOK_SECRET в Vercel → Settings → Environment Variables, затем Redeploy',
    });
  }

  // Простая защита: без секрета эндпоинт ничего не делает.
  if (req.query.secret !== secret) {
    return res.status(401).json({
      error: 'Неверный секрет',
      hint: 'Откройте /api/setup?secret=ЗНАЧЕНИЕ_WEBHOOK_SECRET из настроек Vercel',
    });
  }

  // Адрес берём из самого запроса — не нужно вписывать домен руками.
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const webhookUrl = `${proto}://${host}/api/bot`;

  const allowed = [
    'message', 'edited_message',
    'channel_post', 'edited_channel_post',
    'my_chat_member',
    // Без этих четырёх личные чаты через Telegram Business работать не будут
    'business_connection',
    'business_message',
    'edited_business_message',
    'deleted_business_messages',
  ];

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: allowed,
        // Накопившиеся старые события отбрасываем, иначе бот разом ответит
        // на все команды, отправленные пока вебхука не было.
        drop_pending_updates: true,
      }),
    });
    const result = await r.json();

    if (!result.ok) {
      return res.status(502).json({ ok: false, telegram: result.description, webhookUrl });
    }

    // Сразу показываем итоговое состояние
    const infoR = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const info = await infoR.json();

    return res.status(200).json({
      ok: true,
      message: 'Вебхук привязан. Бот начал получать события.',
      webhookUrl,
      allowedUpdates: allowed,
      current: info.ok
        ? { url: info.result.url, pendingUpdates: info.result.pending_update_count }
        : null,
      next: [
        'Напишите боту /start в личке — он должен ответить.',
        'Для групп: BotFather → /setprivacy → Disable (иначе бот видит только команды).',
        'Для личных чатов: Настройки → Telegram Business → Чат-боты → выберите бота.',
        'Чат появится в приложении, когда в нём придёт первое НОВОЕ сообщение.',
      ],
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e?.message, webhookUrl });
  }
}
