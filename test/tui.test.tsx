import React from 'react';
import {render} from 'ink-testing-library';
import {describe, expect, it} from 'vitest';
import {ResponseView} from '../src/tui/response-view.js';

describe('virtualized response viewer', () => {
  it('renders only visible lines from a large response', () => {
    const body = Array.from({length: 50_000}, (_, index) => `line ${index}`).join('\n');
    const view = render(<ResponseView
      response={{status: 200, statusText: 'OK', headers: {}, body, bytes: body.length, elapsedMs: 12, contentType: 'text/plain', binary: false, truncated: false, url: 'https://example.test'}}
      loading={false} progress={0} scroll={24_000} height={8} showHeaders={false} search="" matches={[]}
    />);
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('line 24000');
    expect(frame).toContain('line 24007');
    expect(frame).not.toContain('line 23999');
    expect(frame).not.toContain('line 24008');
  });
});
