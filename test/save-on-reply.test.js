// test/save-on-reply.test.js
// Сохранение по ответу.
//
// Защищаются правила, которые легко сломать правкой «по мелочи»:
//   1. срабатывает ЛЮБОЙ ответ на файл — точка равна абзацу;
//   2. ответ на текст и на стикер не срабатывает (иначе архив завалит мусором);
//   3. у кружка нет подписи — она обязана уйти отдельным сообщением;
//   4. в подписи нет parse_mode, поэтому имя вида «<b>» ничего не ломает.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  replyTargetForSave, replyGistOf, buildCaption, sendSavedCopy, SAVEABLE,
} from '../lib/save-on-reply.js';

/* ── фикстуры ── */

const photo = (id = 'FILE_PHOTO') => ({
  message_id: 10,
  date: 1753440000,
  from: { id: 5, first_name: 'Аня' },
  photo: [
    { file_id: id + '_s', file_unique_id: 'u_s' },
    { file_id: id, file_unique_id: 'u_big' },
  ],
});

const videoNote = () => ({
  message_id: 11,
  date: 1753440000,
  from: { id: 5, first_name: 'Аня' },
  video_note: { file_id: 'FILE_NOTE', file_unique_id: 'u_note' },
});

const reply = (target, text = '.') => ({
  message_id: 12,
  date: 1753440100,
  from: { id: 7, first_name: 'Иван' },
  chat: { id: -100, type: 'supergroup', title: 'Работа' },
  text,
  reply_to_message: target,
});

// Клиент Telegram-заглушка: собирает вызовы вместо сети.
function fakeTg(ok = true) {
  const calls = [];
  const fn = async (method, payload) => {
    calls.push({ method, payload });
    return ok ? { ok: true, result: { message_id: 999 } } : { ok: false };
  };
  fn.calls = calls;
  return fn;
}

/* ─────────────────────────────────────────────
   1. Что считается жестом «сохрани»
   ───────────────────────────────────────────── */

describe('replyTargetForSave', () => {
  test('точка в ответ на фото — это команда сохранить', () => {
    const target = photo();
    assert.equal(replyTargetForSave(reply(target, '.')), target);
  });

  test('любой другой текст ответа работает так же', () => {
    for (const t of ['?', 'ок', '🙂', 'сохрани пожалуйста', '']) {
      assert.ok(replyTargetForSave(reply(photo(), t)), `должен сработать: "${t}"`);
    }
  });

  test('все обещанные типы файлов поддержаны', () => {
    const cases = {
      photo: photo(),
      video: { message_id: 1, date: 1, video: { file_id: 'v' } },
      voice: { message_id: 1, date: 1, voice: { file_id: 'a' } },
      video_note: videoNote(),
      animation: { message_id: 1, date: 1, animation: { file_id: 'g' } },
      document: { message_id: 1, date: 1, document: { file_id: 'd' } },
    };
    for (const [type, msg] of Object.entries(cases)) {
      assert.ok(SAVEABLE.has(type), `${type} должен быть в SAVEABLE`);
      assert.ok(replyTargetForSave(reply(msg)), `${type} должен сохраняться`);
    }
  });

  test('не срабатывает без ответа, на текст и на стикер', () => {
    assert.equal(replyTargetForSave({ text: 'привет' }), null);
    assert.equal(replyTargetForSave(reply({ message_id: 1, date: 1, text: 'привет' })), null);
    assert.equal(
      replyTargetForSave(reply({ message_id: 1, date: 1, sticker: { file_id: 's' } })), null,
      'ответ на стикер — обычный разговор, а не просьба сохранить'
    );
    assert.equal(replyTargetForSave(null), null);
    assert.equal(replyTargetForSave({}), null);
  });

  test('файл без file_id не сохраняется молча-битым', () => {
    assert.equal(replyTargetForSave(reply({ message_id: 1, date: 1, video: {} })), null);
  });

  test('у фото берётся максимальный размер, а не превью', () => {
    const target = replyTargetForSave(reply(photo()));
    assert.equal(target.photo[target.photo.length - 1].file_id, 'FILE_PHOTO');
  });
});

/* ─────────────────────────────────────────────
   2. Выжимка ответа
   ───────────────────────────────────────────── */

describe('replyGistOf', () => {
  test('точку показывает как есть', () => {
    assert.equal(replyGistOf({ text: '.' }), '.');
  });

  test('длинный текст обрезает', () => {
    const g = replyGistOf({ text: 'а'.repeat(200) });
    assert.ok(g.length <= 60);
    assert.ok(g.endsWith('…'));
  });

  test('переводы строк схлопывает', () => {
    assert.equal(replyGistOf({ text: 'да\n\n  нет' }), 'да нет');
  });

  test('ответ без текста описывается типом', () => {
    assert.equal(replyGistOf({ voice: { file_id: 'x' } }), 'голосовое');
    assert.equal(replyGistOf({}), 'без текста');
  });
});

/* ─────────────────────────────────────────────
   3. Подпись
   ───────────────────────────────────────────── */

describe('buildCaption', () => {
  const base = {
    mediaType: 'photo',
    chatTitle: 'Работа',
    senderName: 'Аня',
    sentAt: 1753440000,
    replierName: 'Иван',
    replyGist: '.',
  };

  test('содержит суть: что, где, от кого и кто сохранил', () => {
    const c = buildCaption(base);
    assert.match(c, /Сохранено: фото/);
    assert.match(c, /Работа/);
    assert.match(c, /Аня/);
    assert.match(c, /Иван/);
    assert.match(c, /Ответ: Иван — «\.»/);
  });

  test('не превышает лимит подписи Telegram', () => {
    const c = buildCaption({ ...base, origCaption: 'x'.repeat(5000) });
    assert.ok(c.length <= 1024, `длина ${c.length}`);
  });

  test('переживает пустые поля без «undefined» в тексте', () => {
    const c = buildCaption({ mediaType: 'voice' });
    assert.doesNotMatch(c, /undefined|null|NaN/);
    assert.match(c, /голосовое/);
  });

  test('разметку не интерпретируем — parse_mode не используется', () => {
    // Имя пользователя приходит от постороннего человека. Если однажды
    // кто-то включит parse_mode, этот тест не даст сделать это молча.
    const c = buildCaption({ ...base, senderName: '<b>x</b>', replyGist: '*_`' });
    assert.match(c, /<b>x<\/b>/);
    assert.match(c, /\*_`/);
  });
});

/* ─────────────────────────────────────────────
   4. Отправка копии
   ───────────────────────────────────────────── */

describe('sendSavedCopy', () => {
  test('фото уходит одним сообщением с подписью', async () => {
    const tg = fakeTg();
    const r = await sendSavedCopy(tg, { chatId: 7, media: photo(), caption: 'подпись' });

    assert.equal(r.ok, true);
    assert.equal(tg.calls.length, 1, 'лишних сообщений быть не должно');
    assert.equal(tg.calls[0].method, 'sendPhoto');
    assert.equal(tg.calls[0].payload.photo, 'FILE_PHOTO');
    assert.equal(tg.calls[0].payload.caption, 'подпись');
    assert.equal(tg.calls[0].payload.chat_id, 7);
  });

  test('у кружка подпись уходит отдельным ответом — иначе она бы пропала', async () => {
    const tg = fakeTg();
    await sendSavedCopy(tg, { chatId: 7, media: videoNote(), caption: 'подпись' });

    assert.deepEqual(tg.calls.map((c) => c.method), ['sendVideoNote', 'sendMessage']);
    assert.equal(tg.calls[0].payload.caption, undefined, 'sendVideoNote подпись не принимает');
    assert.equal(tg.calls[1].payload.text, 'подпись');
    assert.equal(tg.calls[1].payload.reply_to_message_id, 999);
  });

  test('тихие часы глушат звук, но не отменяют доставку', async () => {
    const tg = fakeTg();
    const r = await sendSavedCopy(tg, { chatId: 7, media: photo(), caption: 'c', silent: true });
    assert.equal(r.ok, true);
    assert.equal(tg.calls[0].payload.disable_notification, true);
  });

  test('отказ Telegram возвращается как неуспех, а не как исключение', async () => {
    const tg = fakeTg(false);
    const r = await sendSavedCopy(tg, { chatId: 7, media: photo(), caption: 'c' });
    assert.equal(r.ok, false);
    assert.equal(r.messageId, null);
    assert.equal(tg.calls.length, 1, 'после отказа подпись досылать некуда');
  });

  test('без chatId или без файла ничего не отправляется', async () => {
    const tg = fakeTg();
    assert.equal((await sendSavedCopy(tg, { chatId: null, media: photo(), caption: 'c' })).ok, false);
    assert.equal((await sendSavedCopy(tg, { chatId: 7, media: { text: 'x' }, caption: 'c' })).ok, false);
    assert.equal(tg.calls.length, 0);
  });
});
