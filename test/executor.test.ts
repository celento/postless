import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {CookieJar, DEFAULT_CONFIG, executeRequest, fire, loadHistory, type ResolvedRequest} from '../src/core/index.js';

describe('HTTP execution, cookies, history, and failures', () => {
  let cwd: string;
  let baseUrl: string;
  let server: http.Server;

  beforeAll(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'postless-executor-'));
    process.env.POSTLESS_DATA_DIR = path.join(cwd, 'data');
    process.env.POSTLESS_CONFIG = path.join(cwd, 'config.yaml');
    server = http.createServer((request, response) => {
      if (request.url?.startsWith('/redirect/')) {
        const count = Number(request.url.split('/').at(-1));
        if (count > 0) { response.statusCode = 302; response.setHeader('location', `/redirect/${count - 1}`); response.end(); }
        else { response.setHeader('content-type', 'text/plain'); response.end('redirected'); }
        return;
      }
      if (request.url === '/binary') {
        response.setHeader('content-type', 'application/octet-stream');
        response.end(Buffer.from([0, 1, 2, 3]));
        return;
      }
      if (request.url === '/slow') {
        setTimeout(() => { response.end('late'); }, 150);
        return;
      }
      if (request.url === '/cookie') {
        response.setHeader('set-cookie', ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/']);
        response.setHeader('content-type', 'application/json');
        response.end('{"stored":true}');
        return;
      }
      if (request.url === '/check-cookie') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({cookie: request.headers.cookie ?? null}));
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({method: request.method, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString()}));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(cwd, {recursive: true, force: true});
    delete process.env.POSTLESS_DATA_DIR;
    delete process.env.POSTLESS_CONFIG;
  });

  const execute = (request: ResolvedRequest, timeout = 1000) => executeRequest(request, {
    cwd, environment: 'test', config: {...DEFAULT_CONFIG, timeout},
  });

  it('sends auth and bodies and records response metadata', async () => {
    const result = await execute({method: 'POST', url: `${baseUrl}/echo`, headers: {}, auth: {bearer: 'token'}, body: 'hello'});
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({method: 'POST', authorization: 'Bearer token', body: 'hello'});
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('persists and sends environment-scoped cookies', async () => {
    await execute({method: 'GET', url: `${baseUrl}/cookie`, headers: {}});
    const result = await execute({method: 'GET', url: `${baseUrl}/check-cookie`, headers: {}});
    expect(JSON.parse(result.body).cookie).toContain('session=abc');
    expect((await CookieJar.open(cwd)).get('test')).toHaveLength(2);
  });

  it('follows at most ten redirects and gives binary bodies a saveable file', async () => {
    expect((await execute({method: 'GET', url: `${baseUrl}/redirect/10`, headers: {}})).body).toBe('redirected');
    await expect(execute({method: 'GET', url: `${baseUrl}/redirect/11`, headers: {}})).rejects.toMatchObject({code: 'TOO_MANY_REDIRECTS'});
    const binary = await execute({method: 'GET', url: `${baseUrl}/binary`, headers: {}});
    expect(binary).toMatchObject({binary: true, bytes: 4, truncated: false});
    expect(binary.tempFile).toBeTruthy();
    expect(await fs.readFile(binary.tempFile!)).toEqual(Buffer.from([0, 1, 2, 3]));
  });

  it('returns distinct timeout and connection-refused messages without crashing', async () => {
    await expect(execute({method: 'GET', url: `${baseUrl}/slow`, headers: {}}, 20)).rejects.toMatchObject({code: 'TIMEOUT'});
    const spare = http.createServer();
    await new Promise<void>((resolve) => spare.listen(0, '127.0.0.1', resolve));
    const address = spare.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    await new Promise<void>((resolve) => spare.close(() => resolve()));
    await expect(execute({method: 'GET', url, headers: {}})).rejects.toMatchObject({code: 'ECONNREFUSED'});
  });

  it('writes successful and failed sends to capped project history', async () => {
    await fire({method: 'GET', url: `${baseUrl}/echo`}, {cwd, environment: 'default', requestId: 'echo'});
    const spare = http.createServer();
    await new Promise<void>((resolve) => spare.listen(0, '127.0.0.1', resolve));
    const address = spare.address();
    const closedUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    await new Promise<void>((resolve) => spare.close(() => resolve()));
    await expect(fire({method: 'GET', url: closedUrl}, {cwd, environment: 'default', requestId: 'failure'})).rejects.toBeTruthy();
    const history = await loadHistory(cwd);
    expect(history).toHaveLength(2);
    expect(history[0]?.error).toContain('Connection refused');
    expect(history[1]?.response?.status).toBe(200);
  });
});
