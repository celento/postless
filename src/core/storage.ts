import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {PostlessError} from './errors.js';
import {projectDirectory} from './paths.js';
import {HTTP_METHODS, type EnvironmentFile, type RequestDefinition, type RequestRecord} from './types.js';

function safeSegment(value: string): string {
  const sanitized = value.trim().replace(/\.ya?ml$/i, '').replace(/[^\w .-]+/g, '-').replace(/\s+/g, '-');
  if (!sanitized || sanitized === '.' || sanitized === '..') throw new PostlessError('A valid name is required.', 'INVALID_NAME');
  return sanitized;
}

function safeFolder(folder = ''): string {
  return folder.split(/[\\/]+/).filter(Boolean).map(safeSegment).join(path.sep);
}

export function validateRequest(input: any): RequestDefinition {
  if (!input || typeof input !== 'object') throw new Error('Expected a YAML object.');
  const method = String(input.method ?? 'GET').toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(method)) throw new Error(`Unsupported HTTP method: ${method}`);
  if (typeof input.url !== 'string' || !input.url.trim()) throw new Error('A non-empty URL is required.');
  if (input.type && input.type !== 'http') throw new Error(`Unsupported request type: ${input.type}`);
  if (input.headers && (typeof input.headers !== 'object' || Array.isArray(input.headers))) throw new Error('headers must be a mapping.');
  return {
    ...input,
    type: 'http',
    method,
    url: input.url,
    headers: input.headers ? Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k, String(v)])) : undefined,
  } as RequestDefinition;
}

async function walk(root: string, directory: string, output: RequestRecord[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directory, {withFileTypes: true});
  } catch (error: any) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === 'environments.yaml' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, fullPath, output);
    } else if (/\.ya?ml$/i.test(entry.name)) {
      const relative = path.relative(root, fullPath);
      const id = relative.replace(/\.ya?ml$/i, '').split(path.sep).join('/');
      const record: RequestRecord = {
        id,
        name: path.basename(entry.name).replace(/\.ya?ml$/i, '').replace(/-/g, ' '),
        folder: path.dirname(relative) === '.' ? '' : path.dirname(relative).split(path.sep).join('/'),
        path: fullPath,
      };
      try {
        record.request = validateRequest(YAML.parse(await fs.readFile(fullPath, 'utf8')));
      } catch (error: any) {
        record.error = error.message;
      }
      output.push(record);
    }
  }
}

export async function loadRequests(cwd = process.cwd()): Promise<RequestRecord[]> {
  const records: RequestRecord[] = [];
  await walk(projectDirectory(cwd), projectDirectory(cwd), records);
  return records;
}

export async function loadRequest(id: string, cwd = process.cwd()): Promise<RequestRecord> {
  const normalized = id.replace(/\.ya?ml$/i, '');
  const records = await loadRequests(cwd);
  const record = records.find((item) => item.id === normalized);
  if (!record) throw new PostlessError(`Saved request not found: ${id}`, 'NOT_FOUND');
  if (!record.request) throw new PostlessError(`Malformed request ${id}: ${record.error}`, 'MALFORMED_REQUEST');
  return record;
}

export async function saveRequest(
  request: RequestDefinition,
  name: string,
  folder = '',
  cwd = process.cwd(),
): Promise<RequestRecord> {
  const valid = validateRequest(request);
  const root = projectDirectory(cwd);
  const destinationFolder = path.join(root, safeFolder(folder));
  const destination = path.join(destinationFolder, `${safeSegment(name)}.yaml`);
  await fs.mkdir(destinationFolder, {recursive: true});
  await fs.writeFile(destination, YAML.stringify(valid, {lineWidth: 0}), 'utf8');
  return {
    id: path.relative(root, destination).replace(/\.ya?ml$/i, '').split(path.sep).join('/'),
    name: safeSegment(name).replace(/-/g, ' '),
    folder: safeFolder(folder).split(path.sep).join('/'),
    path: destination,
    request: valid,
  };
}

export async function deleteRequest(id: string, cwd = process.cwd()): Promise<void> {
  const record = await loadRequest(id, cwd);
  await fs.unlink(record.path);
}

export async function createFolder(folder: string, cwd = process.cwd()): Promise<string> {
  const target = path.join(projectDirectory(cwd), safeFolder(folder));
  await fs.mkdir(target, {recursive: true});
  return target;
}

export async function deleteFolder(folder: string, cwd = process.cwd()): Promise<void> {
  const normalized = safeFolder(folder);
  if (!normalized) throw new PostlessError('Cannot delete the collection root.', 'INVALID_NAME');
  await fs.rm(path.join(projectDirectory(cwd), normalized), {recursive: true});
}

export async function renameFolder(folder: string, name: string, cwd = process.cwd()): Promise<string> {
  const normalized = safeFolder(folder);
  if (!normalized) throw new PostlessError('Cannot rename the collection root.', 'INVALID_NAME');
  const source = path.join(projectDirectory(cwd), normalized);
  const target = path.join(path.dirname(source), safeSegment(name));
  await fs.rename(source, target);
  return target;
}

export async function moveRequest(id: string, folder: string, cwd = process.cwd()): Promise<string> {
  const record = await loadRequest(id, cwd);
  const targetFolder = path.join(projectDirectory(cwd), safeFolder(folder));
  await fs.mkdir(targetFolder, {recursive: true});
  const target = path.join(targetFolder, path.basename(record.path));
  await fs.rename(record.path, target);
  return target;
}

export async function renameRequest(id: string, name: string, cwd = process.cwd()): Promise<string> {
  const record = await loadRequest(id, cwd);
  const target = path.join(path.dirname(record.path), `${safeSegment(name)}.yaml`);
  await fs.rename(record.path, target);
  return target;
}

export async function loadEnvironments(cwd = process.cwd()): Promise<EnvironmentFile> {
  const file = path.join(projectDirectory(cwd), 'environments.yaml');
  try {
    const parsed = YAML.parse(await fs.readFile(file, 'utf8')) ?? {};
    const environments = parsed.environments ?? {};
    if (typeof environments !== 'object' || Array.isArray(environments)) throw new Error('environments must be a mapping.');
    return {default: parsed.default ?? Object.keys(environments)[0], environments};
  } catch (error: any) {
    if (error.code === 'ENOENT') return {default: 'default', environments: {default: {}}};
    throw new PostlessError(`Malformed environments.yaml: ${error.message}`, 'MALFORMED_ENVIRONMENTS', error);
  }
}

export async function saveEnvironments(environments: EnvironmentFile, cwd = process.cwd()): Promise<void> {
  const root = projectDirectory(cwd);
  await fs.mkdir(root, {recursive: true});
  await fs.writeFile(path.join(root, 'environments.yaml'), YAML.stringify(environments, {lineWidth: 0}), 'utf8');
}
