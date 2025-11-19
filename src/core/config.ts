import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {configPath} from './paths.js';
import type {PostlessConfig} from './types.js';

export const DEFAULT_CONFIG: PostlessConfig = {
  timeout: 30_000,
  followRedirects: true,
  tlsVerify: true,
  theme: 'auto',
  keybindings: {},
};

export async function loadConfig(file = configPath()): Promise<PostlessConfig> {
  try {
    const parsed = YAML.parse(await fs.readFile(file, 'utf8')) ?? {};
    return {...DEFAULT_CONFIG, ...parsed, keybindings: {...DEFAULT_CONFIG.keybindings, ...(parsed.keybindings ?? {})}};
  } catch (error: any) {
    if (error.code === 'ENOENT') return {...DEFAULT_CONFIG};
    throw new Error(`Could not read config ${file}: ${error.message}`);
  }
}

export async function writeDefaultConfig(file = configPath()): Promise<void> {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, YAML.stringify(DEFAULT_CONFIG), {mode: 0o600});
}
