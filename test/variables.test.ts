import {describe, expect, it} from 'vitest';
import {resolveRequest, resolveVariables} from '../src/core/index.js';

describe('variable resolution', () => {
  it('resolves request values and environment-backed secrets everywhere', () => {
    const request = resolveRequest({
      method: 'POST',
      url: '{{base}}/users/{{id}}',
      headers: {'x-token': '{{token}}'},
      auth: {bearer: '{{token}}'},
      body: '{"id":"{{id}}"}',
    }, {base: 'https://example.test', id: 7, token: '$TEST_SECRET'});
    expect(request).toMatchObject({
      url: 'https://example.test/users/7',
      headers: {'x-token': 'secret'},
      auth: {bearer: 'secret'},
      body: '{"id":"7"}',
    });
  });

  it('names every missing variable', () => {
    expect(() => resolveVariables('{{one}}/{{two}}', {})).toThrow('Missing variables: one, two');
  });
});
