import {PostlessError} from './errors.js';
import type {RequestAuth, RequestDefinition, ResolvedRequest} from './types.js';

const pattern = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function resolveVariables(value: string, variables: Record<string, unknown>, env = process.env): string {
  const missing = new Set<string>();
  const resolved = value.replace(pattern, (_match, key: string) => {
    let candidate = variables[key];
    if (typeof candidate === 'string' && candidate.startsWith('$')) candidate = env[candidate.slice(1)];
    if (candidate === undefined || candidate === null || candidate === '') {
      missing.add(key);
      return `{{${key}}}`;
    }
    return String(candidate);
  });
  if (missing.size) {
    throw new PostlessError(`Missing variable${missing.size > 1 ? 's' : ''}: ${[...missing].join(', ')}`, 'MISSING_VARIABLE');
  }
  return resolved;
}

function resolveAuth(auth: RequestAuth | undefined, vars: Record<string, unknown>): RequestAuth | undefined {
  if (!auth) return undefined;
  return {
    bearer: auth.bearer === undefined ? undefined : resolveVariables(auth.bearer, vars),
    basic: auth.basic ? {
      user: resolveVariables(auth.basic.user, vars),
      pass: resolveVariables(auth.basic.pass, vars),
    } : undefined,
    header: auth.header ? {
      name: resolveVariables(auth.header.name, vars),
      value: resolveVariables(auth.header.value, vars),
    } : undefined,
  };
}

export function resolveRequest(request: RequestDefinition, variables: Record<string, unknown>): ResolvedRequest {
  return {
    ...request,
    url: resolveVariables(request.url, variables),
    headers: Object.fromEntries(Object.entries(request.headers ?? {}).map(([key, value]) => [
      resolveVariables(key, variables), resolveVariables(String(value), variables),
    ])),
    auth: resolveAuth(request.auth, variables),
    body: request.body === undefined ? undefined : resolveVariables(request.body, variables),
    body_file: request.body_file === undefined ? undefined : resolveVariables(request.body_file, variables),
    form: request.form?.map((item) => resolveVariables(item, variables)),
  };
}
