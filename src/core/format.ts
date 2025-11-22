import {createTwoFilesPatch} from 'diff';
import type {ResponseResult} from './types.js';

export function formatBody(body: string, contentType: string): string {
  if (/json/i.test(contentType)) {
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
  }
  if (/xml|html/i.test(contentType)) {
    let depth = 0;
    return body.replace(/>\s*</g, '>\n<').split('\n').map((line) => {
      const trimmed = line.trim();
      if (/^<\//.test(trimmed)) depth = Math.max(0, depth - 1);
      const output = `${'  '.repeat(depth)}${trimmed}`;
      if (/^<[^!?/][^>]*[^/]>/i.test(trimmed) && !/<\/[^>]+>$/.test(trimmed)) depth += 1;
      return output;
    }).join('\n');
  }
  return body;
}

export function diffResponses(previous: ResponseResult, current: ResponseResult): string {
  return createTwoFilesPatch(
    'previous', 'current',
    formatBody(previous.body, previous.contentType),
    formatBody(current.body, current.contentType),
    `${previous.status} ${previous.statusText}`,
    `${current.status} ${current.statusText}`,
    {context: 3},
  );
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

export interface FoldedLine {text: string; sourceIndex: number; folded?: boolean}

export function jsonNodeEnd(lines: string[], start: number): number | undefined {
  const first = lines[start];
  if (!first || !/[{[]/.test(first)) return undefined;
  let depth = 0;
  let opened = false;
  for (let index = start; index < lines.length; index += 1) {
    const structural = lines[index]!.replace(/"(?:\\.|[^"\\])*"/g, '');
    for (const character of structural) {
      if (character === '{' || character === '[') { depth += 1; opened = true; }
      if (character === '}' || character === ']') depth -= 1;
    }
    if (opened && depth === 0) return index > start ? index : undefined;
  }
  return undefined;
}

export function foldJsonLines(lines: string[], foldedStarts: Set<number>): FoldedLine[] {
  const output: FoldedLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (foldedStarts.has(index)) {
      const end = jsonNodeEnd(lines, index);
      if (end !== undefined) {
        const suffix = lines[end]!.trim().replace(/^[}\]]/, '').trim();
        output.push({text: `${lines[index]} … ${end - index - 1} line${end - index - 1 === 1 ? '' : 's'} … ${lines[end]!.trim()[0]}${suffix}`, sourceIndex: index, folded: true});
        index = end;
        continue;
      }
    }
    output.push({text: lines[index]!, sourceIndex: index});
  }
  return output;
}
