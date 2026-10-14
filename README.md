# telegram-notifier

Small CLI for explicit private notifications and Telegram-channel publishing. It keeps owner and channel destinations separate and can preview a prepared operation without contacting Telegram.

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

3. Get the private owner chat ID:
```bash
node get-chat-id.js
# Send any message to the bot in Telegram
```

4. Fill in ignored `.env`:
```
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_OWNER_CHAT_ID=your_private_chat_id
TELEGRAM_CHANNEL_CHAT_ID=@your_channel_username
```

`TELEGRAM_CHAT_ID` remains a compatibility fallback for `owner` only. A `channel` command never falls back to it. Keep the bot token, owner destination, private channel IDs, and raw `.env` values out of Git, reports, screenshots, and public artifacts. An intentionally public channel username or link may appear in separately prepared public material.

Environment variables supplied by the caller take precedence over the same keys
in `.env`; values absent from the environment use the file defaults. To select
a different bot and private destination for one invocation, pass
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_CHAT_ID` in that process's environment.
For example, an application can set them in the `env` option of its child
process without changing the notifier's `.env` or later notifications.
Use the canonical `TELEGRAM_OWNER_CHAT_ID` for this override:
`TELEGRAM_CHAT_ID` is only a fallback and does not replace a configured owner ID.

## Usage

```bash
# Private owner message (owner is the default target)
notify-telegram --target owner "Deploy finished"

# Inspect a public post without network I/O
notify-telegram --target channel --preview "Release is ready"

# Publish after checking the preview
notify-telegram --target channel "Release is ready"

# Markdown and escaped line breaks
notify-telegram --target owner --markdown \
  "*Build failed*\\n\\nhttps://example.com/report"

# Edit a known channel message
notify-telegram --target channel --edit 12345 "Release is ready"

# Send a screenshot with a caption
notify-telegram --target channel --photo ./screen.png "Verified result"

# Pin the channel introduction
notify-telegram --target channel --pin 12345

# Resolve the configured bot's public identity without printing its token or target
notify-telegram --bot-identity

```

## Options

Run `notify-telegram --help` for a concise usage summary. The supported options are:

- `-t, --target owner|channel` chooses one explicit destination;
- `--preview` or `--dry-run` prepares and displays the operation without creating a Telegram client;
- `-m, --markdown` enables formatting for content that fits one Telegram message;
- `-e, --edit`, `-f, --file`, `-p, --photo`, `-V, --video`, `-v, --voice`, and `-a, --audio` select the supported operation;
- `--pin` pins a known message in the explicitly selected destination;
- `--bot-identity` is an exclusive command that returns the configured bot's public username;
- `--` ends option parsing, allowing text that starts with a hyphen.
- `-h, --help` prints the concise usage summary.

A video is sent with its width, height, duration and a JPEG preview, so Telegram shows the real frame and length before the file is downloaded. The notifier measures the file with `ffprobe`, cuts the preview with `ffmpeg` (at most 320 px on the longer side, taken at the third second or the middle of a shorter clip) and deletes the preview after sending. Without `ffprobe` or `ffmpeg` on `PATH` the video is still sent, but Telegram then shows a square placeholder until the file is downloaded.

## How it works

- `owner` resolves `TELEGRAM_OWNER_CHAT_ID`, with legacy `TELEGRAM_CHAT_ID` as an owner-only fallback. `channel` resolves only `TELEGRAM_CHANNEL_CHAT_ID`.
- Plain text is split only at whitespace boundaries without cutting Unicode characters, links, or other indivisible tokens. An oversized indivisible token is rejected. Formatted text is measured after Telegram Markdown entities are parsed and must fit one message; formatted captions use the same rule and must fit the caption limit.
- Preview validates the destination and local content but creates no Telegram client. It shows text parts, edit/pin message IDs, or the media filename and caption.
- Each live command performs only the requested Bot API operation. It does not keep delivery state or retry automatically. If the result is uncertain, inspect Telegram before deciding whether to repeat it.
- Successful sends, edits and pins print `message_id=<number>`. Failures print a fixed safe class and guidance without forwarding the raw Telegram or library error. An unknown-outcome failure (`delivery_failed`) also names its cause as symbolic codes only, for example `Причина: EFATAL, ECONNRESET.` or `HTTP 502`; library messages are never printed because they can contain the bot token.
- The global `notify-telegram` command is provided through `npm link`.

## Development checks

```bash
npm test
node notify-telegram.js --help
```

## Requirements

- Node.js 18+
- Telegram bot token and an owner and/or channel destination, depending on the selected target

## Uninstall

```bash
npm unlink -g telegram-notifier
```
