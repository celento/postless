import {describe, expect, it} from 'vitest';
import {diffResponses, foldJsonLines, formatBody, fuzzySearch, type RequestRecord, type ResponseResult} from '../src/core/index.js';

const response = (body: string): ResponseResult => ({status: 200, statusText: 'OK', headers: {}, body, bytes: body.length, elapsedMs: 1, contentType: 'application/json', binary: false, truncated: false, url: 'https://example.test'});

describe('response inspection and search', () => {
  it('pretty prints and diffs JSON', () => {
    expect(formatBody('{"ok":true}', 'application/json')).toContain('\n  "ok": true\n');
    const diff = diffResponses(response('{"ok":true}'), response('{"ok":false}'));
    expect(diff).toContain('-  "ok": true');
    expect(diff).toContain('+  "ok": false');
  });

  it('folds the JSON node under a source line', () => {
    const lines = formatBody('{"user":{"name":"Ada","roles":["admin"]},"ok":true}', 'application/json').split('\n');
    const userLine = lines.findIndex((line) => line.includes('"user"'));
    const folded = foldJsonLines(lines, new Set([userLine]));
    expect(folded.find((line) => line.sourceIndex === userLine)?.text).toContain('lines … }');
    expect(folded.length).toBeLessThan(lines.length);
  });

  it('searches 1,000 requests within the product budget', () => {
    const records: RequestRecord[] = Array.from({length: 1000}, (_, index) => ({
      id: `users/get-${index}`, name: `get user ${index}`, folder: 'users', path: '',
      request: {method: 'GET', url: `https://example.test/users/${index}`},
    }));
    const started = performance.now();
    const result = fuzzySearch(records, 'user 999');
    const elapsed = performance.now() - started;
    expect(result[0]?.id).toBe('users/get-999');
    expect(elapsed).toBeLessThan(50);
  });
});
