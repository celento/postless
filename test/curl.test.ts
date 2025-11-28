import {describe, expect, it} from 'vitest';
import {parseCurl, toCurl} from '../src/core/index.js';

describe('curl interoperability', () => {
  it('imports common flags and reports unsupported flags', () => {
    const result = parseCurl(`curl -L -XPOST 'https://example.test/users' -H 'Content-Type: application/json' -u user:pass --data-raw '{"name":"Ada"}' --proxy http://proxy.test`);
    expect(result.request).toMatchObject({
      method: 'POST', url: 'https://example.test/users', follow_redirects: true,
      headers: {'Content-Type': 'application/json'},
      auth: {basic: {user: 'user', pass: 'pass'}}, body: '{"name":"Ada"}',
    });
    expect(result.unsupported).toEqual(['--proxy']);
  });

  it('exports a shell-safe reproducing command', () => {
    const command = toCurl({method: 'POST', url: 'https://example.test', headers: {'x-name': "O'Reilly"}, body: '{"ok":true}'});
    expect(command).toContain("'x-name: O'\"'\"'Reilly'");
    expect(parseCurl(command).request).toMatchObject({method: 'POST', body: '{"ok":true}'});
  });

  it('imports multipart form fields', () => {
    expect(parseCurl('curl https://example.test/upload -F name=Ada -F file=@avatar.png').request)
      .toMatchObject({method: 'POST', form: ['name=Ada', 'file=@avatar.png']});
  });
});
