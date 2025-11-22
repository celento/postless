import {parse as shellParse} from 'shell-quote';
import type {CurlParseResult, RequestDefinition, ResolvedRequest} from './types.js';

function words(command: string): string[] {
  return shellParse(command, (key) => `$${key}`)
    .filter((value): value is string => typeof value === 'string');
}

function attached(token: string, short: string): string | undefined {
  return token.startsWith(short) && token.length > short.length ? token.slice(short.length) : undefined;
}

export function parseCurl(command: string): CurlParseResult {
  const tokens = words(command.trim().replace(/^\$\s*/, ''));
  if (tokens[0]?.toLowerCase() !== 'curl') throw new Error('Paste a command beginning with curl.');
  const request: RequestDefinition = {type: 'http', method: 'GET', url: '', headers: {}};
  const unsupported: string[] = [];
  const data: string[] = [];
  const form: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = () => tokens[++index] ?? '';
    if (token === '-X' || token === '--request') request.method = next().toUpperCase() as RequestDefinition['method'];
    else if (attached(token, '-X')) request.method = attached(token, '-X')!.toUpperCase() as RequestDefinition['method'];
    else if (token === '-H' || token === '--header') {
      const value = next();
      const separator = value.indexOf(':');
      if (separator > 0) request.headers![value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
    } else if (attached(token, '-H')) {
      const value = attached(token, '-H')!;
      const separator = value.indexOf(':');
      if (separator > 0) request.headers![value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(token)) data.push(next());
    else if (attached(token, '-d')) data.push(attached(token, '-d')!);
    else if (token === '-u' || token === '--user') {
      const [user, ...pass] = next().split(':');
      request.auth = {basic: {user: user ?? '', pass: pass.join(':')}};
    } else if (token === '-F' || token === '--form') form.push(next());
    else if (attached(token, '-F')) form.push(attached(token, '-F')!);
    else if (token === '-L' || token === '--location') request.follow_redirects = true;
    else if (token === '--compressed' || token === '-s' || token === '--silent' || token === '-S' || token === '--show-error') {
      // Transport/presentation flags do not change the saved request.
    } else if (token.startsWith('-')) {
      unsupported.push(token);
      if (['--connect-timeout', '--max-time', '-o', '--output', '--proxy', '-x', '--cert', '--key'].includes(token) && tokens[index + 1]) next();
    } else if (!request.url) request.url = token;
  }
  if (!request.url) throw new Error('The curl command has no URL.');
  if (data.length) {
    request.body = data.join('&');
    if (request.method === 'GET') request.method = 'POST';
  }
  if (form.length) {
    request.form = form;
    if (request.method === 'GET') request.method = 'POST';
  }
  if (!Object.keys(request.headers!).length) delete request.headers;
  return {request, unsupported};
}

function quote(value: string): string {
  if (/^[\w@%+=:,./{}~-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function toCurl(request: ResolvedRequest): string {
  const parts = ['curl', '-X', request.method, quote(request.url)];
  const headers = {...request.headers};
  if (request.auth?.bearer) headers.authorization = `Bearer ${request.auth.bearer}`;
  if (request.auth?.header) headers[request.auth.header.name] = request.auth.header.value;
  for (const [name, value] of Object.entries(headers)) parts.push('-H', quote(`${name}: ${value}`));
  if (request.auth?.basic) parts.push('-u', quote(`${request.auth.basic.user}:${request.auth.basic.pass}`));
  if (request.body !== undefined) parts.push('--data-raw', quote(request.body));
  if (request.body_file) parts.push('--data-binary', quote(`@${request.body_file}`));
  for (const field of request.form ?? []) parts.push('-F', quote(field));
  if (request.follow_redirects) parts.push('-L');
  return parts.join(' ');
}
