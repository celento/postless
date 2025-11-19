import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Agent, fetch, FormData, Headers} from 'undici';
import {CookieJar} from './cookies.js';
import {friendlyNetworkError, PostlessError} from './errors.js';
import type {PostlessConfig, ResolvedRequest, ResponseResult} from './types.js';

const MAX_IN_MEMORY = 20 * 1024 * 1024;
const PREVIEW_BYTES = 512 * 1024;

function isTextContent(contentType: string): boolean {
  return /(^text\/|json|xml|html|javascript|x-www-form-urlencoded|graphql)/i.test(contentType);
}

function headerRecord(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  headers.forEach((value, key) => { result[key] = value; });
  const setCookies = (headers as any).getSetCookie?.() as string[] | undefined;
  if (setCookies?.length) result['set-cookie'] = setCookies;
  return result;
}

export async function executeRequest(
  request: ResolvedRequest,
  options: {
    config: PostlessConfig;
    environment: string;
    cwd?: string;
    jar?: CookieJar;
    onProgress?: (bytes: number) => void;
  },
): Promise<ResponseResult> {
  const cwd = options.cwd ?? process.cwd();
  let url: URL;
  try { url = new URL(request.url); } catch {
    throw new PostlessError(`Invalid URL: ${request.url}`, 'INVALID_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new PostlessError(`Unsupported URL protocol: ${url.protocol}`, 'INVALID_URL');

  const headers = new Headers(request.headers);
  const userCookie = headers.has('cookie');
  if (request.auth?.bearer) headers.set('authorization', `Bearer ${request.auth.bearer}`);
  if (request.auth?.basic) headers.set('authorization', `Basic ${Buffer.from(`${request.auth.basic.user}:${request.auth.basic.pass}`).toString('base64')}`);
  if (request.auth?.header) headers.set(request.auth.header.name, request.auth.header.value);
  const jar = options.jar ?? await CookieJar.open(cwd);
  if (!headers.has('cookie')) {
    const cookie = jar.header(url.href, options.environment);
    if (cookie) headers.set('cookie', cookie);
  }
  let body: string | Buffer | FormData | undefined = request.body;
  if (request.body_file) {
    const file = path.isAbsolute(request.body_file) ? request.body_file : path.join(cwd, request.body_file);
    body = await fs.readFile(file);
  }
  if (request.form?.length) {
    const form = new FormData();
    for (const field of request.form) {
      const separator = field.indexOf('=');
      if (separator < 1) continue;
      const name = field.slice(0, separator);
      const value = field.slice(separator + 1);
      if (value.startsWith('@')) {
        const file = path.isAbsolute(value.slice(1)) ? value.slice(1) : path.join(cwd, value.slice(1));
        const contents = await fs.readFile(file);
        form.append(name, new Blob([contents]), path.basename(file));
      } else form.append(name, value);
    }
    body = form;
    headers.delete('content-type');
  }
  if (['GET', 'HEAD'].includes(request.method)) body = undefined;

  const timeout = request.timeout ?? options.config.timeout;
  const dispatcher = new Agent({
    allowH2: true,
    connect: {rejectUnauthorized: options.config.tlsVerify},
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeout);
  const started = performance.now();
  try {
    const followRedirects = request.follow_redirects ?? options.config.followRedirects;
    let currentUrl = url;
    let currentMethod = request.method;
    let currentBody = body;
    let response;
    let cookiesChanged = false;
    for (let redirects = 0; ; redirects += 1) {
      if (!userCookie) {
        const cookie = jar.header(currentUrl.href, options.environment);
        if (cookie) headers.set('cookie', cookie);
        else headers.delete('cookie');
      }
      response = await fetch(currentUrl, {
        method: currentMethod,
        headers,
        body: currentBody,
        redirect: 'manual',
        signal: controller.signal,
        dispatcher,
      });
      const setCookies = (response.headers as any).getSetCookie?.() as string[] | undefined;
      if (setCookies?.length) {
        jar.setFromHeaders(setCookies, currentUrl.href, options.environment);
        cookiesChanged = true;
      }
      const location = response.headers.get('location');
      if (!followRedirects || !location || ![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects >= 10) throw new PostlessError('Too many redirects (limit: 10).', 'TOO_MANY_REDIRECTS');
      await response.body?.cancel();
      currentUrl = new URL(location, currentUrl);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET';
        currentBody = undefined;
        headers.delete('content-length');
      }
    }
    if (cookiesChanged) await jar.save();

    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    const preview: Uint8Array[] = [];
    let previewSize = 0;
    let total = 0;
    let tempFile: string | undefined;
    let fileHandle: fs.FileHandle | undefined;
    while (reader) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      options.onProgress?.(total);
      if (previewSize < PREVIEW_BYTES) {
        const slice = value.slice(0, PREVIEW_BYTES - previewSize);
        preview.push(slice);
        previewSize += slice.byteLength;
      }
      if (!fileHandle && total > MAX_IN_MEMORY) {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'postless-'));
        tempFile = path.join(directory, 'response.bin');
        fileHandle = await fs.open(tempFile, 'w');
        for (const chunk of chunks) await fileHandle.write(chunk);
        chunks.length = 0;
      }
      if (fileHandle) await fileHandle.write(value);
      else chunks.push(value);
    }
    await fileHandle?.close();

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const binary = !isTextContent(contentType);
    const bytes = total;
    const spilled = Boolean(tempFile);
    const inMemory = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    if (binary && !tempFile) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'postless-'));
      tempFile = path.join(directory, 'response.bin');
      await fs.writeFile(tempFile, inMemory);
    }
    const content = spilled ? Buffer.concat(preview.map((chunk) => Buffer.from(chunk))) : inMemory;
    const bodyText = binary
      ? `[binary response: ${bytes.toLocaleString()} bytes, ${contentType}]${tempFile ? `\nSaved to ${tempFile}` : ''}`
      : content.toString('utf8');
    return {
      status: response.status,
      statusText: response.statusText,
      headers: headerRecord(response.headers as unknown as Headers),
      body: bodyText,
      bytes,
      elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      contentType,
      binary,
      truncated: spilled,
      tempFile,
      url: response.url || currentUrl.href,
    };
  } catch (error) {
    throw friendlyNetworkError(error);
  } finally {
    clearTimeout(timer);
    await dispatcher.close();
  }
}
