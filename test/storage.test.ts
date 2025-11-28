import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {deleteFolder, loadRequests, moveRequest, renameFolder, renameRequest, saveRequest} from '../src/core/index.js';

describe('YAML collection storage', () => {
  let cwd: string;
  beforeEach(async () => { cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'postless-storage-')); });
  afterEach(async () => { await fs.rm(cwd, {recursive: true, force: true}); });

  it('saves, loads, renames, moves, and deletes collection items', async () => {
    const saved = await saveRequest({method: 'GET', url: 'https://example.test'}, 'List users', 'users', cwd);
    expect(saved.id).toBe('users/List-users');
    await renameRequest(saved.id, 'All users', cwd);
    await moveRequest('users/All-users', 'admin', cwd);
    await renameFolder('admin', 'internal', cwd);
    expect((await loadRequests(cwd)).map((item) => item.id)).toEqual(['internal/All-users']);
    await deleteFolder('internal', cwd);
    expect(await loadRequests(cwd)).toEqual([]);
  });

  it('keeps malformed YAML visible without crashing', async () => {
    await fs.mkdir(path.join(cwd, '.postless'), {recursive: true});
    await fs.writeFile(path.join(cwd, '.postless', 'broken.yaml'), 'method: [oops\nurl: nope');
    const [record] = await loadRequests(cwd);
    expect(record?.id).toBe('broken');
    expect(record?.request).toBeUndefined();
    expect(record?.error).toBeTruthy();
  });
});
