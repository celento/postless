import {addHistory} from './history.js';
import {executeRequest} from './executor.js';
import {loadConfig} from './config.js';
import {loadEnvironments, loadRequest} from './storage.js';
import {resolveRequest} from './variables.js';
import type {RequestDefinition, ResponseResult} from './types.js';

export async function fire(
  request: RequestDefinition,
  options: {environment?: string; cwd?: string; requestId?: string; onProgress?: (bytes: number) => void} = {},
): Promise<ResponseResult> {
  const cwd = options.cwd ?? process.cwd();
  const environments = await loadEnvironments(cwd);
  const environment = options.environment ?? environments.default ?? Object.keys(environments.environments)[0] ?? 'default';
  const variables = environments.environments[environment];
  if (!variables) throw new Error(`Environment not found: ${environment}`);
  const resolved = resolveRequest(request, variables);
  const config = await loadConfig();
  try {
    const response = await executeRequest(resolved, {cwd, environment, config, onProgress: options.onProgress});
    await addHistory({requestId: options.requestId, request, environment, response}, cwd);
    return response;
  } catch (error: any) {
    await addHistory({requestId: options.requestId, request, environment, error: error.message}, cwd);
    throw error;
  }
}

export async function fireSaved(id: string, environment?: string, cwd = process.cwd()): Promise<ResponseResult> {
  const record = await loadRequest(id, cwd);
  return fire(record.request!, {cwd, environment, requestId: record.id});
}

export * from './clipboard.js';
export * from './config.js';
export * from './cookies.js';
export * from './curl.js';
export * from './errors.js';
export * from './executor.js';
export * from './format.js';
export * from './history.js';
export * from './paths.js';
export * from './postman.js';
export * from './search.js';
export * from './storage.js';
export * from './types.js';
export * from './variables.js';
