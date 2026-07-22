// api/diag.js
// Диагностика: показывает состояние вебхука и бота без раскрытия токена.
// Открывать в браузере: https://<проект>.vercel.app/api/diag

export default async function handler(req, res) {
  // Диагностика раскрывает имя бота, адрес вебхука и текст ошибок Telegram —
  // посторонним это ни к чему. Доступ только по WEBHOOK_SECRET.
  const gate = process.env.WEBHOOK_SECRET;
  if (!gate || req.query.secret !== gate) {
    return res.status(401).json({
      error: 'unauthorized',
      hint: 'Откройте /api/diag?secret=ЗНАЧЕНИЕ_WEBHOOK_SECRET',
    });
  }

  const token = process.env.BOT_TOKEN;
  const out = {
    env: {
      BOT_TOKEN: Boolean(token),
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      WEBHOOK_SECRET: Boolean(process.env.WEBHOOK_SECRET),
    },
  };

  if (!token) {
    out.hint = 'BOT_TOKEN не задан в Environment Variables на Vercel.';
    return res.status(500).json(out);
  }

  try {
    const [meR, whR] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()),
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json()),
    ]);

    out.bot = meR.ok
      ? {
          username: meR.result.username,
          canJoinGroups: meR.result.can_join_groups,
          // false = Privacy Mode ВЫКЛЮЧЕН, бот видит все сообщения в группе
          privacyModeOn: meR.result.can_read_all_group_messages === false,
          supportsBusiness: meR.result.can_connect_to_business ?? null,
        }
      : { error: meR.description };

    const wh = whR.ok ? whR.result : null;
    out.webhook = wh
      ? {
          url: wh.url || null,
          isSet: Boolean(wh.url),
          pendingUpdates: wh.pending_update_count,
          lastError: wh.last_error_message || null,
          lastErrorDate: wh.last_error_date
            ? new Date(wh.last_error_date * 1000).toISOString()
            : null,
          allowedUpdates: wh.allowed_updates || 'все по умолчанию',
        }
      : { error: whR.description };

    // Подсказки по типичным поломкам
    const hints = [];
    if (!out.webhook.isSet) {
      hints.push('Вебхук НЕ привязан — бот не получает события. Запустите scripts/set-webhook.js');
    }
    if (out.bot.privacyModeOn) {
      hints.push('Privacy Mode включён — в группах бот видит только команды. BotFather → /setprivacy → Disable');
    }
    if (out.bot.supportsBusiness === false) {
      hints.push('Business Mode выключен — личные чаты недоступны. BotFather → /mybots → Bot Settings → Business Mode → Enable');
    }
    const allowed = out.webhook.allowedUpdates;
    if (Array.isArray(allowed) && !allowed.includes('business_message')) {
      hints.push('Вебхук не подписан на business_* — перезапустите set-webhook.js новой версией');
    }
    if (out.webhook.lastError) {
      hints.push(`Telegram сообщает об ошибке доставки: ${out.webhook.lastError}`);
    }
    out.hints = hints.length ? hints : ['Всё выглядит корректно.'];

    return res.status(200).json(out);
  } catch (e) {
    out.error = e?.message;
    return res.status(502).json(out);
  }
}
