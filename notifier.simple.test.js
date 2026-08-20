import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MAX_CAPTION_LENGTH,
  MAX_TEXT_LENGTH,
  NotifierError,
  buildTextOptions,
  editMessage,
  normalizeMessageText,
  parseArgs,
  parseEditRequest,
  prepareOperation,
  resolveTarget,
  runCli,
  sendMessage,
  splitPlainText,
  telegramLength,
  telegramMarkdownLength
} from './notify-telegram.js';

function tempFile(t, extension = '.bin') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-notifier-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, `proof${extension}`);
  fs.writeFileSync(filePath, 'proof');
  return filePath;
}

test('protected text helpers and edit parsing remain compatible', async () => {
  assert.equal(normalizeMessageText('one\\n\\ntwo'), 'one\n\ntwo');
  assert.deepEqual(buildTextOptions(true), { parse_mode: 'Markdown' });
  assert.deepEqual(parseEditRequest(['--edit', '42', '--markdown', 'новый\\nтекст']), {
    messageId: 42, text: 'новый\nтекст'
  });
  const calls = [];
  const client = { chatId: 'owner', bot: {
    async sendMessage(...args) { calls.push(args); return { message_id: 1 }; },
    async editMessageText(...args) { calls.push(args); return true; }
  } };
  await sendMessage('text', { markdown: true }, client);
  await editMessage(42, 'edited', {}, client);
  assert.deepEqual(calls, [
    ['owner', 'text', { parse_mode: 'Markdown' }],
    ['edited', { chat_id: 'owner', message_id: 42 }]
  ]);

  const defaultCalls = [];
  await sendMessage('default owner', {
    env: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: 'legacy-owner' },
    botFactory: token => ({
      async sendMessage(...args) {
        defaultCalls.push(['send', token, ...args]);
        return { message_id: 2 };
      }
    })
  });
  await editMessage(2, 'default edit', {
    env: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: 'legacy-owner' },
    botFactory: token => ({
      async editMessageText(...args) {
        defaultCalls.push(['edit', token, ...args]);
        return true;
      }
    })
  });
  assert.deepEqual(defaultCalls, [
    ['send', 'token', 'legacy-owner', 'default owner', {}],
    ['edit', 'token', 'default edit', { chat_id: 'legacy-owner', message_id: 2 }]
  ]);
});

test('channel destination never falls back to owner or legacy configuration', () => {
  const env = { TELEGRAM_OWNER_CHAT_ID: 'private', TELEGRAM_CHAT_ID: 'legacy' };
  assert.deepEqual(resolveTarget('owner', env), { target: 'owner', chatId: 'private' });
  assert.throws(
    () => resolveTarget('channel', env),
    error => error instanceof NotifierError && error.code === 'target_not_configured'
  );
});

test('plain text splitting preserves content, Unicode and indivisible links', () => {
  const link = `https://example.invalid/${'a'.repeat(900)}`;
  const input = `${'🙂 слово '.repeat(500)}${link} конец`;
  const parts = splitPlainText(input);
  assert.equal(parts.join(''), input);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => telegramLength(part) <= MAX_TEXT_LENGTH));
  assert.equal(parts.filter(part => part.includes(link)).length, 1);
  assert.throws(
    () => splitPlainText(`https://example.invalid/${'x'.repeat(MAX_TEXT_LENGTH)}`),
    error => error instanceof NotifierError && error.code === 'unsplittable_content'
  );
});

test('formatting limits use displayed text after Telegram parses entities', t => {
  const formattedAtLimit = `*${'x'.repeat(MAX_TEXT_LENGTH)}*`;
  const acceptedFormatted = prepareOperation(parseArgs(['--markdown', formattedAtLimit]));
  assert.deepEqual(acceptedFormatted.parts, [formattedAtLimit]);
  assert.equal(acceptedFormatted.markdown, true);
  assert.ok(telegramLength(formattedAtLimit) > MAX_TEXT_LENGTH);
  assert.equal(telegramMarkdownLength(formattedAtLimit), MAX_TEXT_LENGTH);

  const otherEntitiesAtLimit = [
    `[${'x'.repeat(MAX_TEXT_LENGTH)}](https://example.invalid/${'y'.repeat(200)})`,
    `\`${'x'.repeat(MAX_TEXT_LENGTH)}\``,
    `\`\`\`javascript\n${'x'.repeat(MAX_TEXT_LENGTH)}\`\`\``
  ];
  for (const source of otherEntitiesAtLimit) {
    assert.ok(telegramLength(source) > MAX_TEXT_LENGTH);
    assert.equal(telegramMarkdownLength(source), MAX_TEXT_LENGTH);
    assert.deepEqual(
      prepareOperation(parseArgs(['--markdown', source])).parts,
      [source]
    );
  }

  const captionAtLimit = `_${'x'.repeat(MAX_CAPTION_LENGTH)}_`;
  const acceptedCaption = prepareOperation(parseArgs([
    '--markdown', '--photo', tempFile(t, '.png'), captionAtLimit
  ]));
  assert.ok(telegramLength(acceptedCaption.caption) > MAX_CAPTION_LENGTH);
  assert.equal(telegramMarkdownLength(acceptedCaption.caption), MAX_CAPTION_LENGTH);

  assert.throws(
    () => prepareOperation(parseArgs([
      '--markdown', `*${'x'.repeat(MAX_TEXT_LENGTH + 1)}*`
    ])),
    error => error instanceof NotifierError && error.code === 'formatted_text_too_long'
  );
  assert.throws(
    () => prepareOperation(parseArgs([
      '--markdown', '--edit', '2', `*${'x'.repeat(MAX_TEXT_LENGTH + 1)}*`
    ])),
    error => error instanceof NotifierError && error.code === 'edit_too_long'
  );
  assert.throws(
    () => prepareOperation(parseArgs([
      '--markdown', '--photo', tempFile(t, '.png'), `_${'x'.repeat(MAX_CAPTION_LENGTH + 1)}_`
    ])),
    error => error instanceof NotifierError && error.code === 'caption_too_long'
  );
});

test('channel preview prepares text and media without creating a Telegram client', async t => {
  const output = [];
  let clients = 0;
  const code = await runCli(['--target', 'channel', '--preview', 'Пост\\nhttps://example.com'], {
    env: { TELEGRAM_CHANNEL_CHAT_ID: '@channel' },
    botFactory() { clients += 1; throw new Error('must not run'); },
    output: value => output.push(value),
    errorOutput: value => assert.fail(value)
  });
  assert.equal(code, 0);
  assert.equal(clients, 0);
  assert.deepEqual(JSON.parse(output.join('\n')), {
    preview: true, target: 'channel', kind: 'text',
    parts: ['Пост\nhttps://example.com'], markdown: false
  });
  output.length = 0;
  const mediaPath = tempFile(t, '.png');
  assert.equal(await runCli(['--target', 'channel', '--preview', '--photo', mediaPath, 'Подпись'], {
    env: { TELEGRAM_CHANNEL_CHAT_ID: '@channel' },
    botFactory() { clients += 1; throw new Error('must not run'); },
    output: value => output.push(value), errorOutput: value => assert.fail(value)
  }), 0);
  assert.equal(clients, 0);
  assert.deepEqual(JSON.parse(output.join('\n')), {
    preview: true, target: 'channel', kind: 'media',
    mediaType: 'photo', fileName: 'proof.png', caption: 'Подпись', markdown: false
  });
});

test('text and edit operations use only the selected channel', async () => {
  const calls = [];
  const bot = {
    async sendMessage(...args) { calls.push(['send', ...args]); return { message_id: 10 }; },
    async editMessageText(...args) { calls.push(['edit', ...args]); return true; }
  };
  const dependencies = {
    env: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHANNEL_CHAT_ID: '@channel' },
    botFactory: () => bot,
    output() {}, errorOutput: value => assert.fail(value)
  };
  assert.equal(await runCli(['--target', 'channel', '--markdown', '*text*'], dependencies), 0);
  assert.equal(await runCli(['--target', 'channel', '--edit', '10', 'updated'], dependencies), 0);
  assert.deepEqual(calls, [
    ['send', '@channel', '*text*', { parse_mode: 'Markdown' }],
    ['edit', 'updated', { chat_id: '@channel', message_id: 10 }]
  ]);
});

test('default owner delivers every text part, prints ids and rejects an invalid response', async () => {
  const firstPart = 'a '.repeat(2048);
  const sent = [];
  const output = [];
  let nextId = 20;
  const code = await runCli([`${firstPart}end`], {
    env: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: 'legacy-owner' },
    botFactory: () => ({ async sendMessage(...args) {
      sent.push(args);
      nextId += 1;
      return { message_id: nextId };
    } }),
    output: value => output.push(value), errorOutput: value => assert.fail(value)
  });
  assert.equal(code, 0);
  assert.deepEqual(sent, [
    ['legacy-owner', firstPart, {}],
    ['legacy-owner', 'end', {}]
  ]);
  assert.deepEqual(output, ['message_id=21', 'message_id=22']);

  const errors = [];
  const invalidCode = await runCli(['text'], {
    env: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_OWNER_CHAT_ID: 'owner' },
    botFactory: () => ({ async sendMessage() { return {}; } }),
    output: value => assert.fail(value), errorOutput: value => errors.push(value)
  });
  assert.equal(invalidCode, 1);
  assert.deepEqual(errors, ['Ошибка [invalid_response]: Telegram не вернул корректный message_id.']);
});

test('every protected media mode uses its matching Telegram operation and caption', async t => {
  const cases = [
    ['--photo', 'sendPhoto', '.png'], ['--video', 'sendVideo', '.mp4'],
    ['--voice', 'sendVoice', '.ogg'], ['--audio', 'sendAudio', '.mp3'],
    ['--file', 'sendDocument', '.pdf']
  ];
  for (const [option, method, extension] of cases) {
    const calls = [];
    const bot = {};
    for (const name of ['sendPhoto', 'sendVideo', 'sendVoice', 'sendAudio', 'sendDocument']) {
      bot[name] = async (...args) => { calls.push([name, ...args]); return { message_id: 7 }; };
    }
    const filePath = tempFile(t, extension);
    const code = await runCli(['--target', 'channel', option, filePath, 'Подпись'], {
      env: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHANNEL_CHAT_ID: '@channel' },
      botFactory: () => bot, output() {}, errorOutput: value => assert.fail(value)
    });
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], method);
    assert.equal(calls[0][1], '@channel');
    assert.equal(calls[0][2], filePath);
    assert.equal(calls[0][3].caption, 'Подпись');
  }
});

test('pin is a direct explicit operation and preview does not call Telegram', async () => {
  const calls = [];
  const dependencies = {
    env: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHANNEL_CHAT_ID: '@channel' },
    botFactory: () => ({ async pinChatMessage(...args) { calls.push(args); return true; } }),
    output() {}, errorOutput: value => assert.fail(value)
  };
  assert.equal(await runCli(['--target', 'channel', '--preview', '--pin', '55'], dependencies), 0);
  assert.equal(calls.length, 0);
  assert.equal(await runCli(['--target', 'channel', '--pin', '55'], dependencies), 0);
  assert.deepEqual(calls, [['@channel', 55, { disable_notification: true }]]);
});

test('bot identity is separate and returns only the public username', async () => {
  const output = [];
  const code = await runCli(['--bot-identity'], {
    env: { TELEGRAM_BOT_TOKEN: 'secret' },
    botFactory: () => ({ async getMe() { return { id: 123, username: 'moira_bot' }; } }),
    output: value => output.push(value), errorOutput: value => assert.fail(value)
  });
  assert.equal(code, 0);
  assert.deepEqual(output, ['bot_username=@moira_bot']);
  assert.throws(
    () => parseArgs(['--bot-identity', '--preview']),
    error => error instanceof NotifierError && error.code === 'bot_identity_conflict'
  );
});

test('local and remote errors expose only a fixed safe class and guidance', async () => {
  const missingPath = '/private/internal/PERSON-SENTINEL/missing.png';
  const localErrors = [];
  let localClients = 0;
  const localCode = await runCli(['--photo', missingPath], {
    env: { TELEGRAM_OWNER_CHAT_ID: 'owner' },
    botFactory() { localClients += 1; throw new Error('must not run'); },
    output: value => assert.fail(value), errorOutput: value => localErrors.push(value)
  });
  assert.equal(localCode, 1);
  assert.equal(localClients, 0);
  assert.deepEqual(localErrors, ['Ошибка [file_not_readable]: Указанный файл недоступен.']);
  assert.equal(localErrors.join('\n').includes(missingPath), false);

  const sentinels = [
    'TOKEN-SENTINEL', 'DESTINATION-SENTINEL', 'PERSON-SENTINEL',
    'private.internal', 'RAW-PAYLOAD-SENTINEL'
  ];
  const errors = [];
  let calls = 0;
  const code = await runCli(['--target', 'channel', 'PERSON-SENTINEL'], {
    env: {
      TELEGRAM_BOT_TOKEN: 'TOKEN-SENTINEL',
      TELEGRAM_CHANNEL_CHAT_ID: 'DESTINATION-SENTINEL'
    },
    botFactory: () => ({ async sendMessage() {
      calls += 1;
      const error = new Error(sentinels.join(' '));
      error.response = { statusCode: 500, body: { description: sentinels.join(' ') } };
      throw error;
    } }),
    output: value => assert.fail(value), errorOutput: value => errors.push(value)
  });
  assert.equal(code, 1);
  assert.equal(calls, 1);
  assert.match(errors.join('\n'), /\[delivery_failed\]/u);
  for (const sentinel of sentinels) assert.equal(errors.join('\n').includes(sentinel), false);

  for (const entry of [
    {
      statusCode: 429,
      body: { error_code: 429, parameters: { retry_after: 1 } },
      expected: 'rate_limited'
    },
    {
      statusCode: 400,
      body: { error_code: 400, description: "can't parse entities" },
      expected: 'request_rejected'
    }
  ]) {
    let statusCalls = 0;
    const statusErrors = [];
    const statusCode = await runCli(['--markdown', '*text*'], {
      env: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_OWNER_CHAT_ID: 'owner' },
      botFactory: () => ({ async sendMessage() {
        statusCalls += 1;
        const error = new Error('raw');
        error.response = { statusCode: entry.statusCode, body: entry.body };
        throw error;
      } }),
      output: value => assert.fail(value), errorOutput: value => statusErrors.push(value)
    });
    assert.equal(statusCode, 1);
    assert.equal(statusCalls, 1);
    assert.match(statusErrors.join('\n'), new RegExp(`\\[${entry.expected}\\]`, 'u'));
  }
});

test('CLI rejects conflicting operations and supports text beginning with a dash', () => {
  assert.throws(
    () => parseArgs(['--edit', '1', '--photo', 'proof.png', 'text']),
    error => error instanceof NotifierError && error.code === 'operation_conflict'
  );
  assert.deepEqual(parseArgs(['--', '-not-an-option']).positional, ['-not-an-option']);
});
