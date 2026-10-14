import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TelegramBot from 'node-telegram-bot-api';

export const MAX_TEXT_LENGTH = 4096;
export const MAX_CAPTION_LENGTH = 1024;

const MEDIA_OPTIONS = new Map([
  ['-f', 'auto'], ['--file', 'auto'], ['-p', 'photo'], ['--photo', 'photo'],
  ['-V', 'video'], ['--video', 'video'], ['-v', 'voice'], ['--voice', 'voice'],
  ['-a', 'audio'], ['--audio', 'audio']
]);

export class NotifierError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NotifierError';
    this.code = code;
  }
}

export function normalizeMessageText(text) {
  return String(text).replace(/\\r\\n|\\n|\\r/g, '\n');
}

export function telegramLength(text) {
  return Array.from(text).reduce((length, character) => length + character.length, 0);
}

// Telegram's legacy Markdown limit applies to the displayed text after entities
// are parsed. This small scanner covers exactly the syntax accepted by --markdown;
// it does not transform the message or attempt to split formatted entities.
export function telegramMarkdownLength(source) {
  let visible = '';
  let cursor = 0;

  while (cursor < source.length) {
    if (source[cursor] === '\\' && '_*`['.includes(source[cursor + 1])) {
      visible += source[cursor + 1];
      cursor += 2;
      continue;
    }

    if (source.startsWith('```', cursor)) {
      const end = source.indexOf('```', cursor + 3);
      if (end !== -1) {
        const start = cursor + 3;
        const firstLineEnd = source.indexOf('\n', start);
        visible += firstLineEnd !== -1 && firstLineEnd < end
          ? source.slice(firstLineEnd + 1, end)
          : source.slice(start, end);
        cursor = end + 3;
        continue;
      }
    }

    if (source[cursor] === '`') {
      const end = source.indexOf('`', cursor + 1);
      if (end !== -1) {
        visible += source.slice(cursor + 1, end);
        cursor = end + 1;
        continue;
      }
    }

    if (source[cursor] === '*' || source[cursor] === '_') {
      const end = source.indexOf(source[cursor], cursor + 1);
      if (end !== -1) {
        visible += source.slice(cursor + 1, end);
        cursor = end + 1;
        continue;
      }
    }

    if (source[cursor] === '[') {
      const labelEnd = source.indexOf('](', cursor + 1);
      if (labelEnd !== -1) {
        let targetEnd = labelEnd + 2;
        while (targetEnd < source.length) {
          if (source[targetEnd] === '\\') targetEnd += 2;
          else if (source[targetEnd] === ')') break;
          else targetEnd += 1;
        }
        if (source[targetEnd] === ')') {
          visible += source.slice(cursor + 1, labelEnd);
          cursor = targetEnd + 1;
          continue;
        }
      }
    }

    const [character] = Array.from(source.slice(cursor));
    visible += character;
    cursor += character.length;
  }

  return telegramLength(visible);
}

function preparedTextLength(text, markdown) {
  return markdown ? telegramMarkdownLength(text) : telegramLength(text);
}

export function splitPlainText(text, limit = MAX_TEXT_LENGTH) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new NotifierError('invalid_limit', 'Лимит сообщения должен быть положительным целым числом.');
  }

  const characters = Array.from(text);
  const parts = [];
  let cursor = 0;
  while (cursor < characters.length) {
    let units = 0;
    let end = cursor;
    while (end < characters.length && units + characters[end].length <= limit) {
      units += characters[end].length;
      end += 1;
    }
    if (end === characters.length) {
      parts.push(characters.slice(cursor).join(''));
      break;
    }
    let boundary = end;
    while (boundary > cursor && !/\s/u.test(characters[boundary - 1])) boundary -= 1;
    if (boundary === cursor) {
      throw new NotifierError(
        'unsplittable_content',
        'Неделимая ссылка или другой фрагмент превышает лимит одного сообщения.'
      );
    }
    parts.push(characters.slice(cursor, boundary).join(''));
    cursor = boundary;
  }
  return parts;
}

export function buildTextOptions(markdown) {
  return markdown ? { parse_mode: 'Markdown' } : {};
}

export function resolveTarget(target = 'owner', env = process.env) {
  if (target !== 'owner' && target !== 'channel') {
    throw new NotifierError('invalid_target', 'Получатель должен быть owner или channel.');
  }
  const chatId = target === 'owner'
    ? (env.TELEGRAM_OWNER_CHAT_ID || env.TELEGRAM_CHAT_ID)
    : env.TELEGRAM_CHANNEL_CHAT_ID;
  if (!chatId) throw new NotifierError('target_not_configured', `Получатель ${target} не настроен.`);
  return { target, chatId: String(chatId) };
}

function requireToken(env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new NotifierError('token_not_configured', 'Не настроен TELEGRAM_BOT_TOKEN.');
  }
  return env.TELEGRAM_BOT_TOKEN;
}

export function createClient(
  target = 'owner',
  env = process.env,
  botFactory = token => new TelegramBot(token)
) {
  const destination = resolveTarget(target, env);
  return {
    ...destination,
    bot: botFactory(requireToken(env))
  };
}

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value === '--') {
    throw new NotifierError('missing_option_value', `Для ${option} требуется значение.`);
  }
  return value;
}

export function parseArgs(args) {
  const parsed = {
    target: 'owner', preview: false, markdown: false, help: false,
    botIdentity: false, editMessageId: null, pinMessageId: null,
    mediaType: null, filePath: null, positional: []
  };
  let targetSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      parsed.positional.push(...args.slice(index + 1));
      break;
    }
    if (argument === '-h' || argument === '--help') parsed.help = true;
    else if (argument === '-m' || argument === '--markdown') parsed.markdown = true;
    else if (argument === '--preview' || argument === '--dry-run') parsed.preview = true;
    else if (argument === '--bot-identity') parsed.botIdentity = true;
    else if (argument === '-t' || argument === '--target') {
      if (targetSeen) throw new NotifierError('duplicate_option', 'Получатель указан несколько раз.');
      targetSeen = true;
      parsed.target = takeValue(args, index, argument);
      index += 1;
    } else if (argument === '-e' || argument === '--edit' || argument === '--pin') {
      const raw = takeValue(args, index, argument);
      if (!/^\d+$/u.test(raw) || Number(raw) <= 0) {
        throw new NotifierError('invalid_message_id', 'Нужен положительный message_id.');
      }
      const key = argument === '--pin' ? 'pinMessageId' : 'editMessageId';
      if (parsed[key]) throw new NotifierError('duplicate_option', `${argument} указана несколько раз.`);
      parsed[key] = Number(raw);
      index += 1;
    } else if (MEDIA_OPTIONS.has(argument)) {
      if (parsed.filePath) throw new NotifierError('multiple_media', 'Можно выбрать только один файл.');
      parsed.mediaType = MEDIA_OPTIONS.get(argument);
      parsed.filePath = takeValue(args, index, argument);
      index += 1;
    } else if (argument.startsWith('-')) {
      throw new NotifierError('unknown_option', 'Неизвестная опция. Для текста с дефиса используйте --.');
    } else parsed.positional.push(argument);
  }

  const operationCount = Number(Boolean(parsed.editMessageId))
    + Number(Boolean(parsed.pinMessageId)) + Number(Boolean(parsed.filePath));
  if (operationCount > 1) {
    throw new NotifierError('operation_conflict', 'Edit, pin и media нельзя объединять.');
  }
  const publicationIntent = targetSeen || parsed.preview || parsed.markdown || operationCount > 0
    || parsed.positional.length > 0;
  if (parsed.botIdentity && publicationIntent) {
    throw new NotifierError('bot_identity_conflict', '--bot-identity запускается отдельно.');
  }
  if (parsed.pinMessageId && (parsed.markdown || parsed.positional.length > 0)) {
    throw new NotifierError('pin_conflict', 'Для pin не нужны текст или форматирование.');
  }
  return parsed;
}

export function parseEditRequest(args) {
  const parsed = parseArgs(args);
  if (!parsed.editMessageId) return null;
  const text = normalizeMessageText(parsed.positional.join(' ')).trim();
  if (!text) throw new NotifierError('empty_text', 'Не указан новый текст сообщения.');
  return { messageId: parsed.editMessageId, text };
}

function inferMediaType(filePath, requested) {
  if (requested !== 'auto') return requested;
  const extension = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) return 'photo';
  if (['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(extension)) return 'video';
  if (['.ogg', '.oga'].includes(extension)) return 'voice';
  if (['.mp3', '.wav', '.m4a', '.flac'].includes(extension)) return 'audio';
  return 'document';
}

export function prepareOperation(parsed) {
  if (parsed.pinMessageId) return { kind: 'pin', messageId: parsed.pinMessageId };
  const text = normalizeMessageText(parsed.positional.join(' '));
  if (parsed.filePath) {
    let stats;
    try { stats = fs.statSync(parsed.filePath); } catch { /* converted to a safe error below */ }
    if (!stats?.isFile()) throw new NotifierError('file_not_readable', 'Указанный файл недоступен.');
    if (preparedTextLength(text, parsed.markdown) > MAX_CAPTION_LENGTH) {
      throw new NotifierError('caption_too_long', 'Подпись превышает лимит Telegram.');
    }
    return {
      kind: 'media', mediaType: inferMediaType(parsed.filePath, parsed.mediaType),
      filePath: parsed.filePath, fileName: path.basename(parsed.filePath),
      caption: text, markdown: parsed.markdown
    };
  }
  if (!text.trim()) throw new NotifierError('empty_text', 'Текст сообщения пуст.');
  if (parsed.editMessageId) {
    if (preparedTextLength(text, parsed.markdown) > MAX_TEXT_LENGTH) {
      throw new NotifierError('edit_too_long', 'Редактируемый текст превышает лимит Telegram.');
    }
    return { kind: 'edit', messageId: parsed.editMessageId, text, markdown: parsed.markdown };
  }
  if (parsed.markdown && telegramMarkdownLength(text) > MAX_TEXT_LENGTH) {
    throw new NotifierError(
      'formatted_text_too_long',
      'Длинный форматированный текст нужно сократить или отправить без разметки.'
    );
  }
  return {
    kind: 'text',
    parts: parsed.markdown ? [text] : splitPlainText(text),
    markdown: parsed.markdown
  };
}

export function previewOperation(target, prepared) {
  return {
    preview: true, target, kind: prepared.kind,
    ...(prepared.kind === 'text' ? { parts: prepared.parts } : {}),
    ...(prepared.kind === 'edit' ? { messageId: prepared.messageId, text: prepared.text } : {}),
    ...(prepared.kind === 'pin' ? { messageId: prepared.messageId } : {}),
    ...(prepared.kind === 'media' ? {
      mediaType: prepared.mediaType, fileName: prepared.fileName, caption: prepared.caption
    } : {}),
    markdown: Boolean(prepared.markdown)
  };
}

export function getMessageId(result, fallbackMessageId) {
  const messageId = result && typeof result === 'object'
    ? (result.message_id ?? fallbackMessageId) : fallbackMessageId;
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new NotifierError('invalid_response', 'Telegram не вернул корректный message_id.');
  }
  return messageId;
}

export async function sendMessage(
  text,
  options = {},
  client = createClient(options.target || 'owner', options.env || process.env, options.botFactory)
) {
  return client.bot.sendMessage(client.chatId, text, buildTextOptions(options.markdown));
}

export async function editMessage(
  messageId,
  text,
  options = {},
  client = createClient(options.target || 'owner', options.env || process.env, options.botFactory)
) {
  return client.bot.editMessageText(text, {
    chat_id: client.chatId, message_id: messageId, ...buildTextOptions(options.markdown)
  });
}

// Telegram draws a square placeholder with "00:00" for a video sent without
// width, height, duration and a thumbnail, until the client downloads the file.
// These helpers measure the file with ffprobe and cut a JPEG preview with ffmpeg.
// Both tools are optional: without them the video is sent as before.
export const THUMBNAIL_MAX_SIDE = 320;

function runTool(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

export const defaultMediaTools = {
  probeVideo(filePath, run = runTool) {
    const report = JSON.parse(run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:stream_side_data=rotation:format=duration',
      '-of', 'json', filePath
    ]));
    const stream = report.streams?.[0] || {};
    let width = Number(stream.width);
    let height = Number(stream.height);
    const rotation = Math.abs(Number(stream.side_data_list?.find(item => 'rotation' in item)?.rotation) || 0);
    if (rotation === 90 || rotation === 270) [width, height] = [height, width];
    const duration = Number(report.format?.duration);
    if (!(width > 0 && height > 0)) return null;
    return { width, height, duration: duration > 0 ? Math.round(duration) : undefined };
  },
  makeThumbnail(filePath, directory, duration, run = runTool) {
    const target = path.join(directory, 'thumbnail.jpg');
    // Past the usual fade-in, so the preview is not an empty first frame.
    const seek = duration ? Math.min(3, duration / 2) : 0;
    run('ffmpeg', [
      '-v', 'error', '-y', '-ss', String(seek), '-i', filePath, '-frames:v', '1',
      '-vf', `scale=${THUMBNAIL_MAX_SIDE}:${THUMBNAIL_MAX_SIDE}:force_original_aspect_ratio=decrease`,
      '-q:v', '5', target
    ]);
    return fs.statSync(target).isFile() ? target : null;
  }
};

export function prepareVideoOptions(filePath, tools = defaultMediaTools) {
  let meta = null;
  try { meta = tools.probeVideo(filePath); } catch { return { options: {}, cleanup() {} }; }
  if (!meta) return { options: {}, cleanup() {} };
  const options = { width: meta.width, height: meta.height };
  if (meta.duration) options.duration = meta.duration;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-notifier-thumb-'));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const thumbnail = tools.makeThumbnail(filePath, directory, meta.duration);
    if (thumbnail) options.thumb = thumbnail;
  } catch { /* a missing preview must not block delivery */ }
  return { options, cleanup };
}

export async function executeOperation(prepared, client, mediaTools = defaultMediaTools) {
  const { bot, chatId } = client;
  if (prepared.kind === 'text') {
    const ids = [];
    for (const part of prepared.parts) {
      ids.push(getMessageId(await sendMessage(part, prepared, client)));
    }
    return ids;
  }
  if (prepared.kind === 'edit') {
    const result = await editMessage(prepared.messageId, prepared.text, prepared, client);
    return [getMessageId(result, prepared.messageId)];
  }
  if (prepared.kind === 'pin') {
    await bot.pinChatMessage(chatId, prepared.messageId, { disable_notification: true });
    return [prepared.messageId];
  }
  const method = `send${prepared.mediaType[0].toUpperCase()}${prepared.mediaType.slice(1)}`;
  const video = prepared.mediaType === 'video'
    ? prepareVideoOptions(prepared.filePath, mediaTools)
    : { options: {}, cleanup() {} };
  const options = {
    caption: prepared.caption,
    ...buildTextOptions(prepared.markdown),
    ...(prepared.mediaType === 'video' ? { supports_streaming: true, ...video.options } : {})
  };
  try {
    return [getMessageId(await bot[method](chatId, prepared.filePath, options))];
  } finally {
    video.cleanup();
  }
}

function safeFailure(error) {
  if (error instanceof NotifierError) return error;
  const body = error?.response?.body || error?.response?.data || {};
  const status = error?.response?.statusCode || body.error_code;
  if (status === 401 || status === 403) {
    return new NotifierError('authorization_failed', 'Telegram отклонил токен или права бота.');
  }
  if (status === 400 || status === 404) {
    return new NotifierError('request_rejected', 'Telegram отклонил получателя или параметры запроса.');
  }
  if (status === 429) {
    return new NotifierError('rate_limited', 'Telegram ограничил частоту. Проверьте канал перед ручным повтором.');
  }
  return new NotifierError(
    'delivery_failed',
    `Результат операции неизвестен. Проверьте Telegram перед повтором.${failureDetail(error, status)}`
  );
}

// Only symbolic codes and a numeric status are reported: error messages and response bodies of
// node-telegram-bot-api may contain the bot token (in request URLs) or the chat id.
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,40}$/u;

export function failureDetail(error, status) {
  const codes = [];
  for (const candidate of [error?.code, error?.cause?.code, error?.errno, error?.cause?.errno]) {
    if (typeof candidate === 'string' && SAFE_CODE.test(candidate) && !codes.includes(candidate)) {
      codes.push(candidate);
    }
  }
  if (Number.isInteger(status)) codes.push(`HTTP ${status}`);
  return codes.length ? ` Причина: ${codes.join(', ')}.` : '';
}

export function showHelp(output = console.log) {
  output(`
Telegram Notifier

notify-telegram [--target owner|channel] [--preview] [--markdown] "текст"
notify-telegram [--target owner|channel] --edit <message_id> "новый текст"
notify-telegram [--target owner|channel] --photo|--file|--video|--voice|--audio <путь> ["подпись"]
notify-telegram --target channel --pin <message_id>
notify-telegram --bot-identity

Опции: --target, --preview/--dry-run, --markdown, --edit, --pin,
       --file, --photo, --video, --voice, --audio, --bot-identity, --help
`);
}

export async function runCli(args, dependencies = {}) {
  const output = dependencies.output || console.log;
  const errorOutput = dependencies.errorOutput || console.error;
  const env = dependencies.env || process.env;
  const botFactory = dependencies.botFactory || (token => new TelegramBot(token));
  try {
    const parsed = parseArgs(args);
    if (parsed.help || args.length === 0) {
      showHelp(output);
      return parsed.help ? 0 : 1;
    }
    if (parsed.botIdentity) {
      const identity = await botFactory(requireToken(env)).getMe();
      if (!identity?.username) {
        throw new NotifierError('bot_identity_missing', 'Telegram не вернул публичное имя бота.');
      }
      output(`bot_username=@${String(identity.username).replace(/^@/u, '')}`);
      return 0;
    }
    const destination = resolveTarget(parsed.target, env);
    const prepared = prepareOperation(parsed);
    if (parsed.preview) {
      output(JSON.stringify(previewOperation(destination.target, prepared), null, 2));
      return 0;
    }
    const client = createClient(parsed.target, env, botFactory);
    const messageIds = await executeOperation(prepared, client, dependencies.mediaTools || defaultMediaTools);
    for (const messageId of messageIds) output(`message_id=${messageId}`);
    return 0;
  } catch (error) {
    const failure = safeFailure(error);
    errorOutput(`Ошибка [${failure.code}]: ${failure.message}`);
    return 1;
  }
}
