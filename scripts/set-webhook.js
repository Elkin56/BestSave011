// scripts/set-webhook.js
// Разовая привязка вебхука бота к вашему Vercel-домену.
// Запуск: BOT_TOKEN=... WEBHOOK_URL=https://ваш-проект.vercel.app/api/bot \
//         WEBHOOK_SECRET=... node scripts/set-webhook.js

const token = process.env.BOT_TOKEN;
const url = process.env.WEBHOOK_URL;
const secret = process.env.WEBHOOK_SECRET || '';

if (!token || !url) {
  console.error('Нужны BOT_TOKEN и WEBHOOK_URL в переменных окружения.');
  process.exit(1);
}

const body = {
  url,
  secret_token: secret || undefined,
  // Явно перечисляем нужные апдейты: сообщения, правки, статус бота в чате.
  // Без этого списка Telegram НЕ пришлёт business_*-события,
  // и личные чаты через Telegram Business работать не будут.
  allowed_updates: [
    'message', 'edited_message',
    'channel_post', 'edited_channel_post',
    'my_chat_member',
    'business_connection',
    'business_message',
    'edited_business_message',
    'deleted_business_messages',
  ],
  drop_pending_updates: true,
};

const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const json = await r.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 1);
