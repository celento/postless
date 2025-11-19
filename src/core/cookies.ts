import fs from 'node:fs/promises';
import path from 'node:path';
import {dataDirectory, projectKey} from './paths.js';

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: string;
  secure: boolean;
  httpOnly: boolean;
  hostOnly: boolean;
}

interface CookieStore {environments: Record<string, Cookie[]>}

export class CookieJar {
  private store: CookieStore = {environments: {}};

  constructor(private readonly file: string) {}

  static async open(cwd = process.cwd()): Promise<CookieJar> {
    const jar = new CookieJar(path.join(dataDirectory(), 'projects', projectKey(cwd), 'cookies.json'));
    try {
      const parsed = JSON.parse(await fs.readFile(jar.file, 'utf8'));
      if (parsed?.environments) jar.store = parsed;
    } catch (error: any) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    return jar;
  }

  get(environment: string): Cookie[] {
    const now = Date.now();
    return (this.store.environments[environment] ?? []).filter((cookie) => !cookie.expires || Date.parse(cookie.expires) > now);
  }

  header(urlValue: string, environment: string): string | undefined {
    const url = new URL(urlValue);
    const cookies = this.get(environment).filter((cookie) => {
      const domain = cookie.domain.toLowerCase();
      const host = url.hostname.toLowerCase();
      const domainMatches = cookie.hostOnly ? host === domain : host === domain || host.endsWith(`.${domain}`);
      return domainMatches && url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === 'https:');
    });
    return cookies.length ? cookies.map(({name, value}) => `${name}=${value}`).join('; ') : undefined;
  }

  setFromHeaders(headers: string[], urlValue: string, environment: string): void {
    const url = new URL(urlValue);
    const existing = this.get(environment);
    for (const header of headers) {
      const parts = header.split(';').map((part) => part.trim());
      const pair = parts.shift();
      if (!pair) continue;
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const attributes = new Map(parts.map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index < 0 ? undefined : index).toLowerCase(), index < 0 ? '' : part.slice(index + 1)];
      }));
      const domainValue = attributes.get('domain')?.replace(/^\./, '');
      const cookie: Cookie = {
        name: pair.slice(0, separator),
        value: pair.slice(separator + 1),
        domain: domainValue ?? url.hostname,
        path: attributes.get('path') || '/',
        expires: attributes.get('expires') || (attributes.get('max-age') ? new Date(Date.now() + Number(attributes.get('max-age')) * 1000).toISOString() : undefined),
        secure: attributes.has('secure'),
        httpOnly: attributes.has('httponly'),
        hostOnly: !domainValue,
      };
      const index = existing.findIndex((item) => item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path);
      if (cookie.expires && Date.parse(cookie.expires) <= Date.now()) {
        if (index >= 0) existing.splice(index, 1);
      } else if (index >= 0) existing[index] = cookie;
      else existing.push(cookie);
    }
    this.store.environments[environment] = existing;
  }

  async clear(environment?: string): Promise<void> {
    if (environment) delete this.store.environments[environment];
    else this.store = {environments: {}};
    await this.save();
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), {recursive: true});
    await fs.writeFile(this.file, JSON.stringify(this.store, null, 2), {mode: 0o600});
  }
}
