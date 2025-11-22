import fs from 'node:fs/promises';
import {loadEnvironments, saveEnvironments, saveRequest} from './storage.js';
import type {ImportReport, RequestAuth, RequestDefinition} from './types.js';

function postmanUrl(value: any): string {
  if (typeof value === 'string') return value;
  if (typeof value?.raw === 'string') return value.raw;
  const protocol = value?.protocol ? `${value.protocol}://` : '';
  const host = Array.isArray(value?.host) ? value.host.join('.') : (value?.host ?? '');
  const pathValue = Array.isArray(value?.path) ? value.path.join('/') : (value?.path ?? '');
  const query = Array.isArray(value?.query)
    ? value.query.filter((item: any) => !item.disabled).map((item: any) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value ?? '')}`).join('&')
    : '';
  return `${protocol}${host}${pathValue ? `/${pathValue}` : ''}${query ? `?${query}` : ''}`;
}

function authFrom(value: any): RequestAuth | undefined {
  if (!value || value.type === 'noauth') return undefined;
  const fields = Object.fromEntries((value[value.type] ?? []).map((item: any) => [item.key, item.value]));
  if (value.type === 'bearer') return {bearer: String(fields.token ?? '')};
  if (value.type === 'basic') return {basic: {user: String(fields.username ?? ''), pass: String(fields.password ?? '')}};
  if (value.type === 'apikey') return {header: {name: String(fields.key ?? 'X-API-Key'), value: String(fields.value ?? '')}};
  return undefined;
}

function requestFrom(item: any, inheritedAuth?: any): RequestDefinition {
  const source = item.request;
  const request: RequestDefinition = {
    type: 'http',
    method: String(source.method ?? 'GET').toUpperCase() as RequestDefinition['method'],
    url: postmanUrl(source.url),
    headers: Object.fromEntries((source.header ?? []).filter((header: any) => !header.disabled).map((header: any) => [header.key, String(header.value ?? '')])),
    auth: authFrom(source.auth ?? inheritedAuth),
  };
  const body = source.body;
  if (body?.mode === 'raw') request.body = body.raw ?? '';
  else if (body?.mode === 'urlencoded') {
    request.body = (body.urlencoded ?? []).filter((field: any) => !field.disabled)
      .map((field: any) => `${encodeURIComponent(field.key)}=${encodeURIComponent(field.value ?? '')}`).join('&');
    request.headers = {...request.headers, 'content-type': 'application/x-www-form-urlencoded'};
  } else if (body?.mode === 'formdata') {
    request.form = (body.formdata ?? []).filter((field: any) => !field.disabled)
      .map((field: any) => `${field.key}=${field.type === 'file' ? `@${field.src}` : (field.value ?? '')}`);
  }
  if (!Object.keys(request.headers ?? {}).length) delete request.headers;
  return request;
}

export async function importPostman(file: string, cwd = process.cwd()): Promise<ImportReport> {
  const collection = JSON.parse(await fs.readFile(file, 'utf8'));
  const schema = collection?.info?.schema ?? '';
  if (!/v2\.1\.0/.test(schema)) throw new Error('Only Postman collection v2.1 files are supported.');
  const report: ImportReport = {written: [], skipped: [], variables: []};

  async function visit(items: any[], folders: string[], inheritedAuth?: any): Promise<void> {
    for (const item of items ?? []) {
      if (Array.isArray(item.item)) {
        await visit(item.item, [...folders, item.name ?? 'folder'], item.auth ?? inheritedAuth);
        continue;
      }
      if (!item.request) {
        report.skipped.push(`${[...folders, item.name ?? 'unnamed'].join('/')}: no request`);
        continue;
      }
      if (item.event?.length) report.skipped.push(`${[...folders, item.name].join('/')}: scripts/tests`);
      const request = requestFrom(item, inheritedAuth);
      const record = await saveRequest(request, item.name ?? 'request', folders.join('/'), cwd);
      report.written.push(record.id);
      const authType = item.request.auth?.type;
      if (authType && !['noauth', 'bearer', 'basic', 'apikey'].includes(authType)) {
        report.skipped.push(`${record.id}: ${authType} auth`);
      }
      const mode = item.request.body?.mode;
      if (mode && !['raw', 'urlencoded', 'formdata'].includes(mode)) report.skipped.push(`${record.id}: ${mode} body`);
    }
  }

  await visit(collection.item ?? [], [], collection.auth);
  if (collection.event?.length) report.skipped.push('collection-level scripts/tests');
  const variables = Object.fromEntries((collection.variable ?? []).map((item: any) => [item.key, item.value ?? '']));
  if (Object.keys(variables).length) {
    const environments = await loadEnvironments(cwd);
    environments.environments.imported = {...(environments.environments.imported ?? {}), ...variables};
    if (!environments.default || environments.default === 'default') environments.default = 'imported';
    await saveEnvironments(environments, cwd);
    report.variables = Object.keys(variables);
  }
  return report;
}
