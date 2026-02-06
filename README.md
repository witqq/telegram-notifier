# telegram-notifier

CLI for sending notifications to Telegram via Bot API. Designed for scripts, agents, and automation — fire-and-forget one-liner.

## Install

```bash
git clone https://github.com/witqq/telegram-notifier.git
cd telegram-notifier
npm install
npm link
```

## Setup

1. Get a bot token from [@BotFather](https://t.me/BotFather)

2. Create `.env` from example:
```bash
cp .env.example .env
```

3. Get your chat ID:
```bash
node get-chat-id.js
# Send any message to the bot in Telegram
```

4. Fill in `.env`:
```
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
```

## Usage

```bash
# Simple message
notify-telegram "Deploy finished"

# Markdown formatting
notify-telegram --markdown "*Build failed*: \`exit code 1\`"

# Multiline
notify-telegram "Step 1: done
Step 2: in progress
Step 3: pending"

# Send file
notify-telegram -f ./report.pdf "Weekly report"

# Send as voice message
notify-telegram -v ./recording.ogg

# Send as audio
notify-telegram -a ./track.mp3 "New track"
```

## Options

```
-m, --markdown    Markdown formatting
-f, --file        Send file (auto-detects: audio/voice/document)
-v, --voice       Send as voice message (ogg/wav)
-a, --audio       Send as audio file
-h, --help        Show help
```

## How it works

- Sends via Telegram Bot API (`node-telegram-bot-api`)
- Credentials stored in `.env` (not tracked by git)
- Sent messages logged locally in `sent-messages/` (gitignored)
- Global command `notify-telegram` via `npm link`

## Requirements

- Node.js 18+
- Telegram bot token + chat ID

## Uninstall

```bash
npm unlink -g telegram-notifier
```
