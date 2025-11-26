import type {HttpMethod} from '../core/index.js';

/**
 * Semantic colour tokens. Everything the TUI draws resolves through here so the
 * palette can be retuned in one place instead of hunting down `color="cyan"`.
 */
export const t = {
  text: '#c3cbdd',
  muted: '#6a7289',
  faint: '#414860',
  rule: '#2b3145',
  accent: '#7aa2f7',
  accentDeep: '#3d5a8c',
  success: '#9ece6a',
  warning: '#e0af68',
  danger: '#f7768e',
  info: '#7dcfff',
  violet: '#bb9af7',
  orange: '#ff9e64',
  selection: '#26304a',
  onPill: '#0d1017',
} as const;

/** Method colours, borrowed from the convention REST tools have converged on. */
const methods: Record<HttpMethod, string> = {
  GET: t.success,
  POST: t.warning,
  PUT: t.info,
  PATCH: t.violet,
  DELETE: t.danger,
  HEAD: t.muted,
  OPTIONS: t.muted,
};

/** Abbreviated so the tree gutter stays a fixed 5 columns wide. */
const abbreviations: Record<HttpMethod, string> = {
  GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PATCH',
  DELETE: 'DEL', HEAD: 'HEAD', OPTIONS: 'OPTS',
};

export const METHOD_WIDTH = 5;

export function methodColor(method: string): string {
  return methods[method as HttpMethod] ?? t.muted;
}

export function methodLabel(method: string): string {
  return (abbreviations[method as HttpMethod] ?? method.slice(0, METHOD_WIDTH)).padEnd(METHOD_WIDTH);
}

export function statusColor(status: number): string {
  if (status >= 500) return t.danger;
  if (status >= 400) return t.warning;
  if (status >= 300) return t.info;
  if (status >= 200) return t.success;
  return t.muted;
}

/** JSON token palette, kept separate so highlighting reads as one family. */
export const syntax = {
  key: t.info,
  string: t.success,
  number: t.orange,
  literal: t.violet,
  punctuation: t.faint,
} as const;
