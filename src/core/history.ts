import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {dataDirectory, projectKey} from './paths.js';
import type {HistoryEntry} from './types.js';

export function historyPath(cwd = process.cwd()): string {
  return path.join(dataDirectory(), 'projects', projectKey(cwd), 'history.json');
}

export async function loadHistory(cwd = process.cwd()): Promise<HistoryEntry[]> {
  try {
    const content = JSON.parse(await fs.readFile(historyPath(cwd), 'utf8'));
    return Array.isArray(content) ? content : [];
  } catch (error: any) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

export async function addHistory(
  entry: Omit<HistoryEntry, 'id' | 'timestamp'>,
  cwd = process.cwd(),
): Promise<HistoryEntry> {
  const history = await loadHistory(cwd);
  const next: HistoryEntry = {id: randomUUID(), timestamp: new Date().toISOString(), ...entry};
  if (next.response && next.response.body.length > 1_000_000) {
    next.response = {...next.response, body: `${next.response.body.slice(0, 1_000_000)}\n… history body truncated …`, truncated: true};
  }
  const destination = historyPath(cwd);
  await fs.mkdir(path.dirname(destination), {recursive: true});
  await fs.writeFile(destination, JSON.stringify([next, ...history].slice(0, 200), null, 2), {mode: 0o600});
  return next;
}

export async function clearHistory(cwd = process.cwd()): Promise<void> {
  try { await fs.unlink(historyPath(cwd)); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
}
