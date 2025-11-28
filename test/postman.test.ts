import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {importPostman, loadEnvironments, loadRequests} from '../src/core/index.js';

describe('Postman import', () => {
  let cwd: string;
  beforeEach(async () => { cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'postless-postman-')); });
  afterEach(async () => { await fs.rm(cwd, {recursive: true, force: true}); });

  it('maps v2.1 folders, requests, auth, variables and reports scripts', async () => {
    const collection = {
      info: {name: 'Example', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},
      variable: [{key: 'base_url', value: 'https://example.test'}],
      item: [{name: 'Users', item: [{name: 'Create', event: [{listen: 'test'}], request: {
        method: 'POST', url: '{{base_url}}/users', header: [{key: 'content-type', value: 'application/json'}],
        auth: {type: 'bearer', bearer: [{key: 'token', value: '{{token}}'}]},
        body: {mode: 'raw', raw: '{"name":"Ada"}'},
      }}]}],
    };
    const file = path.join(cwd, 'collection.json');
    await fs.writeFile(file, JSON.stringify(collection));
    const report = await importPostman(file, cwd);
    expect(report.written).toEqual(['Users/Create']);
    expect(report.skipped[0]).toContain('scripts/tests');
    expect((await loadRequests(cwd))[0]?.request?.auth?.bearer).toBe('{{token}}');
    expect((await loadEnvironments(cwd)).environments.imported?.base_url).toBe('https://example.test');
  });
});
