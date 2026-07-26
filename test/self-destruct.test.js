// test/self-destruct.test.js
// lib/self-destruct.js раньше проверялся только вручную (scripts/check-self-destruct.js,
// вывод в консоль). Из-за отсутствия юнит-тестов не была замечена рассинхронизация
// с api/webhook.js (файл импортировал функции, которых модуль не экспортировал,
// и падал уже при загрузке). Эти тесты фиксируют контракт модуля.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSelfDestructing,
  getTTL,
  getMediaFileId,
  getMediaUniqueId,
  getMediaType,
  prepareSelfDestructSave,
} from '../lib/self-destruct.js';

const photoTtl = (ttl = 8) => ({
  photo: [{ file_id: 'p_small', file_unique_id: 'u_small' },
          { file_id: 'p_big', file_unique_id: 'u_big', ttl_seconds: ttl }],
});
const videoNoteTtl = (ttl = 5) => ({
  video_note: { file_id: 'vn1', file_unique_id: 'u_vn', ttl_seconds: ttl },
});
const plainPhoto = () => ({
  photo: [{ file_id: 'p1', file_unique_id: 'u1' }],
});

describe('isSelfDestructing / getTTL', () => {
  test('фото с ttl_seconds распознаётся', () => {
    assert.equal(isSelfDestructing(photoTtl(12)), true);
    assert.equal(getTTL(photoTtl(12)), 12);
  });

  test('кружок, видео и голосовое с ttl_seconds тоже распознаются', () => {
    assert.equal(isSelfDestructing(videoNoteTtl(9)), true);
    assert.equal(getTTL(videoNoteTtl(9)), 9);
    assert.equal(isSelfDestructing({ video: { file_id: 'v', ttl_seconds: 3 } }), true);
    assert.equal(isSelfDestructing({ voice: { file_id: 'v', ttl_seconds: 3 } }), true);
  });

  test('обычное медиа без ttl_seconds — не самоуничтожающееся', () => {
    assert.equal(isSelfDestructing(plainPhoto()), false);
    assert.equal(getTTL(plainPhoto()), null);
  });

  test('пустое/undefined сообщение не падает', () => {
    assert.equal(isSelfDestructing(null), false);
    assert.equal(isSelfDestructing(undefined), false);
    assert.equal(getTTL(null), null);
  });

  test('ttl_seconds = 0 не считается активным таймером', () => {
    assert.equal(isSelfDestructing({ video: { file_id: 'v', ttl_seconds: 0 } }), false);
  });
});

describe('getMediaFileId / getMediaUniqueId / getMediaType', () => {
  test('у фото берётся максимальный размер (последний элемент массива)', () => {
    const msg = photoTtl(10);
    assert.equal(getMediaFileId(msg), 'p_big');
    assert.equal(getMediaUniqueId(msg), 'u_big');
  });

  test('тип определяется корректно для каждого вида медиа', () => {
    assert.equal(getMediaType(photoTtl()), 'photo');
    assert.equal(getMediaType(videoNoteTtl()), 'video_note');
    assert.equal(getMediaType({ voice: { file_id: 'x' } }), 'voice');
    assert.equal(getMediaType({}), null);
  });
});

describe('prepareSelfDestructSave', () => {
  test('без file_id сохранение отклоняется явной причиной', () => {
    const r = prepareSelfDestructSave({ photo: [] }, 111);
    assert.equal(r.saved, false);
    assert.equal(r.reason, 'no_file_id');
  });

  test('с file_id возвращает все поля, нужные для сохранения', () => {
    const r = prepareSelfDestructSave(photoTtl(7), 111);
    assert.equal(r.saved, true);
    assert.equal(r.isSelfDestruct, true);
    assert.equal(r.ttlSeconds, 7);
    assert.equal(r.mediaType, 'photo');
    assert.equal(r.fileId, 'p_big');
    assert.equal(r.ownerTgId, 111);
  });
});
