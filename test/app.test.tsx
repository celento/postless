import React from 'react';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {render} from 'ink-testing-library';
import {describe, expect, it} from 'vitest';
import {App} from '../src/tui/app.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function project(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-'));
  process.env.POSTLESS_DATA_DIR = path.join(cwd, 'data');
  await fs.mkdir(path.join(cwd, '.postless', 'users'), {recursive: true});
  for (const n of ['alpha', 'bravo', 'charlie']) {
    await fs.writeFile(path.join(cwd, '.postless', `${n}.yaml`), `method: GET\nurl: https://x.test/${n}\n`);
  }
  await fs.writeFile(path.join(cwd, '.postless', 'users', 'list.yaml'), 'method: GET\nurl: https://x.test/users\n');
  return cwd;
}

describe('app interaction', () => {
  it('n in the response pane no longer hijacks to the new-request form', async () => {
    const view = render(<App cwd={await project()} />);
    await wait(200);
    view.stdin.write('\t');
    await wait(60);
    view.stdin.write('n');
    await wait(80);
    expect(view.lastFrame()).not.toContain('New request');
    view.unmount();
  });

  it('n in the tree pane still opens the new-request form', async () => {
    const view = render(<App cwd={await project()} />);
    await wait(200);
    view.stdin.write('n');
    await wait(80);
    expect(view.lastFrame()).toContain('New request');
    view.unmount();
  });

  it('a rejected prompt surfaces as a toast instead of killing the process', async () => {
    let crashed: unknown;
    const onRejection = (e: unknown) => { crashed = e; };
    process.on('unhandledRejection', onRejection);
    const view = render(<App cwd={await project()} />);
    await wait(200);
    view.stdin.write('a');
    await wait(60);
    view.stdin.write('..');
    await wait(60);
    view.stdin.write('\r');
    await wait(300);
    process.off('unhandledRejection', onRejection);
    expect(crashed).toBeUndefined();
    expect(view.lastFrame()).toContain('A valid name is required');
    view.unmount();
  });

  it('root-level requests are listed alphabetically, folders first', async () => {
    const view = render(<App cwd={await project()} />);
    await wait(200);
    const order = (view.lastFrame() ?? '').split('\n')
      .map((l) => l.match(/\b(users|alpha|bravo|charlie)\b/)?.[1]).filter(Boolean);
    expect(order).toEqual(['users', 'alpha', 'bravo', 'charlie']);
    view.unmount();
  });

  it('escape backs out of the response pane instead of doing nothing', async () => {
    const view = render(<App cwd={await project()} />);
    await wait(200);
    view.stdin.write('\t');
    await wait(60);
    expect(view.lastFrame()).toContain('j/k scroll');
    view.stdin.write('\x1b');
    await wait(80);
    expect(view.lastFrame()).toContain('↵ fire');
    view.unmount();
  });
});
