#!/usr/bin/env node

import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log('🤖 Bot started. Send any message to the bot to get your chat_id...');

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;

  console.log(`\n✅ Chat ID found: ${chatId}`);
  console.log(`   User: ${username}`);
  console.log(`\nAdd this to your .env file:`);
  console.log(`TELEGRAM_OWNER_CHAT_ID=${chatId}`);

  bot.sendMessage(chatId, '✅ Chat ID detected! Check your terminal.');

  process.exit(0);
});
