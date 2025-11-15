export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface BasicAuth {user: string; pass: string}
export interface RequestAuth {
  bearer?: string;
  basic?: BasicAuth;
  header?: {name: string; value: string};
}

export interface RequestDefinition {
  type?: 'http';
  name?: string;
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  auth?: RequestAuth;
  body?: string;
  body_file?: string;
  form?: string[];
  timeout?: number;
  follow_redirects?: boolean;
}

export interface RequestRecord {
  id: string;
  name: string;
  folder: string;
  path: string;
  request?: RequestDefinition;
  error?: string;
}

export interface EnvironmentFile {
  default?: string;
  environments: Record<string, Record<string, string | number | boolean>>;
}

export interface ResolvedRequest extends Omit<RequestDefinition, 'headers' | 'auth'> {
  headers: Record<string, string>;
  auth?: RequestAuth;
}

export interface ResponseResult {
  status: number;
  statusText: string;
  headers: Record<string, string | string[]>;
  body: string;
  bytes: number;
  elapsedMs: number;
  contentType: string;
  binary: boolean;
  truncated: boolean;
  tempFile?: string;
  url: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  requestId?: string;
  request: RequestDefinition;
  environment: string;
  response?: ResponseResult;
  error?: string;
}

export interface PostlessConfig {
  timeout: number;
  followRedirects: boolean;
  tlsVerify: boolean;
  theme: 'auto' | 'dark' | 'light';
  keybindings: Record<string, string>;
}

export interface CurlParseResult {
  request: RequestDefinition;
  unsupported: string[];
}

export interface ImportReport {
  written: string[];
  skipped: string[];
  variables: string[];
}
