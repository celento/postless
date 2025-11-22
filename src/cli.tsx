import React from 'react';
import {render} from 'ink';
import {fireSaved, importPostman} from './core/index.js';
import {App} from './tui/app.js';

const HELP = `postless — a local-first terminal HTTP client

Usage:
  postless                         Open the interactive client
  postless fire <request> [--env] Fire a saved request headlessly
  postless import <collection>    Import a Postman v2.1 collection
  postless --help                 Show this help
  postless --version              Show the version

Examples:
  postless fire auth/login --env prod
  postless import collection.json
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { process.stdout.write('0.1.0\n'); return; }
  if (args[0] === 'fire') {
    const id = args[1];
    if (!id || id.startsWith('-')) throw new Error('Usage: postless fire <request> [--env <name>]');
    const response = await fireSaved(id, option(args, '--env'));
    process.stdout.write(response.body);
    if (!response.body.endsWith('\n')) process.stdout.write('\n');
    if (response.status >= 400) process.exitCode = 1;
    return;
  }
  if (args[0] === 'import') {
    const file = args[1];
    if (!file) throw new Error('Usage: postless import <postman-collection.json>');
    const report = await importPostman(file);
    process.stdout.write(`Imported ${report.written.length} request(s).\n`);
    for (const id of report.written) process.stdout.write(`  + ${id}\n`);
    if (report.variables.length) process.stdout.write(`Variables: ${report.variables.join(', ')} (environment: imported)\n`);
    if (report.skipped.length) {
      process.stdout.write('Skipped features:\n');
      for (const item of report.skipped) process.stdout.write(`  - ${item}\n`);
    }
    return;
  }
  if (args.length) throw new Error(`Unknown command: ${args.join(' ')}\n\n${HELP}`);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The interactive client needs a TTY. Use `postless fire` for headless mode.');
  const instance = render(<App />);
  await instance.waitUntilExit();
}

main().catch((error: any) => {
  process.stderr.write(`postless: ${error.message}\n`);
  process.exitCode = 1;
});
