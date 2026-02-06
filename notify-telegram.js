#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const SENT_MESSAGES_DIR = path.join(__dirname, 'sent-messages');

function showHelp() {
  console.log(`
📤 Telegram Notifier

Отправка уведомлений в Telegram через Bot API

ИСПОЛЬЗОВАНИЕ:
  notify-telegram [опции] "текст сообщения"
  notify-telegram -f <файл> ["caption"]

ОПЦИИ:
  -m, --markdown    Использовать Markdown форматирование
  -f, --file        Отправить файл (auto-detect: audio/voice/document)
  -v, --voice       Отправить как голосовое сообщение (ogg/wav)
  -a, --audio       Отправить как аудиофайл
  -h, --help        Показать эту справку

ПРИМЕРЫ:
  # Простое сообщение
  notify-telegram "Task completed"

  # С Markdown форматированием
  notify-telegram --markdown "*Bold* text and \`code\`"

  # Отправить файл
  notify-telegram -f /path/to/file.wav "Voice sample"

  # Отправить как голосовое сообщение
  notify-telegram -v /path/to/audio.wav

ПРИМЕЧАНИЕ:
  - Сообщения логируются локально в sent-messages/
`);
}

async function sendMessage(text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not found in .env');
  }

  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID not found in .env');
  }

  const bot = new TelegramBot(token);

  const sendOptions = {};
  if (options.markdown) {
    sendOptions.parse_mode = 'Markdown';
  }

  await bot.sendMessage(chatId, text, sendOptions);
}

async function sendFile(filePath, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not found in .env');
  }

  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID not found in .env');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const bot = new TelegramBot(token);
  const ext = path.extname(filePath).toLowerCase();
  const caption = options.caption || '';

  // Determine file type
  const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
  const voiceExts = ['.ogg', '.oga'];

  if (options.voice || (options.autoDetect && voiceExts.includes(ext))) {
    // Send as voice message
    await bot.sendVoice(chatId, filePath, { caption });
  } else if (options.audio || (options.autoDetect && audioExts.includes(ext))) {
    // Send as audio file
    await bot.sendAudio(chatId, filePath, { caption });
  } else {
    // Send as document
    await bot.sendDocument(chatId, filePath, { caption });
  }
}

function logMessage(text) {
  if (!fs.existsSync(SENT_MESSAGES_DIR)) {
    fs.mkdirSync(SENT_MESSAGES_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const filename = `${timestamp.replace(/[:.]/g, '-')}.txt`;
  const filepath = path.join(SENT_MESSAGES_DIR, filename);

  fs.writeFileSync(filepath, `${timestamp}\n\n${text}\n`);

  return filename;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    showHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const useMarkdown = args.includes('-m') || args.includes('--markdown');
  const sendAsVoice = args.includes('-v') || args.includes('--voice');
  const sendAsAudio = args.includes('-a') || args.includes('--audio');
  const fileIndex = args.findIndex(arg => arg === '-f' || arg === '--file');

  // File sending mode
  if (fileIndex !== -1 || sendAsVoice || sendAsAudio) {
    let filePath;
    let caption = '';

    if (fileIndex !== -1) {
      filePath = args[fileIndex + 1];
      // Remaining args after file path are caption
      const captionArgs = args.slice(fileIndex + 2).filter(arg => !arg.startsWith('-'));
      caption = captionArgs.join(' ');
    } else {
      // -v or -a mode: next non-flag arg is file path
      const nonFlagArgs = args.filter(arg => !arg.startsWith('-'));
      filePath = nonFlagArgs[0];
      caption = nonFlagArgs.slice(1).join(' ');
    }

    if (!filePath) {
      console.error('❌ Не указан путь к файлу');
      showHelp();
      process.exit(1);
    }

    try {
      console.log(`📤 Отправка файла: ${filePath}...`);

      await sendFile(filePath, {
        voice: sendAsVoice,
        audio: sendAsAudio,
        autoDetect: !sendAsVoice && !sendAsAudio,
        caption
      });

      logMessage(`[FILE] ${filePath}\n${caption}`);
      console.log('✅ Файл отправлен');

    } catch (error) {
      console.error(`❌ Ошибка: ${error.message}`);
      process.exit(1);
    }
    return;
  }

  // Text message mode
  const messageArgs = args.filter(arg => !arg.startsWith('-'));

  if (messageArgs.length === 0) {
    console.error('❌ Не указан текст сообщения');
    showHelp();
    process.exit(1);
  }

  const message = messageArgs.join(' ');

  try {
    console.log('📤 Отправка сообщения...');

    await sendMessage(message, { markdown: useMarkdown });

    const filename = logMessage(message);

    console.log('✅ Сообщение отправлено');

  } catch (error) {
    console.error(`❌ Ошибка: ${error.message}`);
    process.exit(1);
  }
}

main();
