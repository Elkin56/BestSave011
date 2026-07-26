// api/media.js
// Эндпоинт для скачивания сохраненных медиа

import { getPool } from '../lib/db.js';
import { requireResourceAuth } from '../lib/auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function handler(req, res) {
  // Авторизация через ресурсный токен
  if (!requireResourceAuth(req, res)) return;
  
  const { chatId, msgId, fileId } = req.query;
  const userTgId = req.tgUser.id;
  
  try {
    // Если передан fileId, скачиваем напрямую из Telegram
    if (fileId) {
      const botToken = process.env.BOT_TOKEN;
      const fileInfo = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
      );
      const fileData = await fileInfo.json();
      
      if (!fileData.ok) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
      const response = await fetch(fileUrl);
      
      // Устанавливаем заголовки
      const ext = path.extname(fileData.result.file_path);
      res.setHeader('Content-Type', getContentType(ext));
      res.setHeader('Content-Disposition', `attachment; filename="media${ext}"`);
      
      response.body.pipe(res);
      return;
    }
    
    // Иначе получаем file_id из базы
    if (!chatId || !msgId) {
      return res.status(400).json({ error: 'chatId and msgId required' });
    }
    
    const result = await getPool().query(
      `SELECT media_file_id, media_type, local_file_path 
       FROM message 
       WHERE chat_id = $1 AND tg_msg_id = $2 AND owner_tg_id = $3`,
      [chatId, msgId, userTgId]
    );
    
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Media not found' });
    }
    
    const { media_file_id, media_type, local_file_path } = result.rows[0];
    
    // Если есть локальная копия, отдаем её
    if (local_file_path && fs.existsSync(local_file_path)) {
      const ext = path.extname(local_file_path);
      res.setHeader('Content-Type', getContentType(ext));
      res.setHeader('Content-Disposition', `attachment; filename="media_${msgId}${ext}"`);
      
      const fileStream = fs.createReadStream(local_file_path);
      fileStream.pipe(res);
      return;
    }
    
    // Иначе скачиваем из Telegram
    if (!media_file_id) {
      return res.status(404).json({ error: 'File ID not available' });
    }
    
    const botToken = process.env.BOT_TOKEN;
    const fileInfo = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${media_file_id}`
    );
    const fileData = await fileInfo.json();
    
    if (!fileData.ok) {
      return res.status(404).json({ error: 'File not found in Telegram' });
    }
    
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const response = await fetch(fileUrl);
    
    const ext = path.extname(fileData.result.file_path) || `.${media_type || 'media'}`;
    res.setHeader('Content-Type', getContentType(ext));
    res.setHeader('Content-Disposition', `attachment; filename="media_${msgId}${ext}"`);
    
    response.body.pipe(res);
    
  } catch (error) {
    console.error('❌ Ошибка загрузки медиа:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function getContentType(ext) {
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}