import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function projectDirectory(cwd = process.cwd()): string {
  return path.join(cwd, '.postless');
}

export function dataDirectory(): string {
  if (process.env.POSTLESS_DATA_DIR) return path.resolve(process.env.POSTLESS_DATA_DIR);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'postless');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? os.homedir(), 'postless');
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'postless');
}

export function configPath(): string {
  if (process.env.POSTLESS_CONFIG) return path.resolve(process.env.POSTLESS_CONFIG);
  const root = process.platform === 'win32'
    ? (process.env.APPDATA ?? os.homedir())
    : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  return path.join(root, 'postless', 'config.yaml');
}

export function projectKey(cwd = process.cwd()): string {
  return createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 16);
}
