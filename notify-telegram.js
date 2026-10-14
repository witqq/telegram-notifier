#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { runCli } from './notifier.js';
export * from './notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const isMainModule = process.argv[1]
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);

if (isMainModule) process.exitCode = await runCli(process.argv.slice(2));
