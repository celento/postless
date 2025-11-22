import {spawnSync} from 'node:child_process';

export interface CopyResult {method: 'osc52' | 'native' | 'manual'; message: string}

export function copyToClipboard(value: string): CopyResult {
  if (process.stdout.isTTY && process.env.TERM !== 'dumb' && !process.env.POSTLESS_NO_OSC52) {
    const encoded = Buffer.from(value).toString('base64');
    process.stdout.write(`\u001b]52;c;${encoded}\u0007`);
    return {method: 'osc52', message: 'Copied with OSC 52.'};
  }
  const candidates: Array<[string, string[]]> = process.platform === 'darwin'
    ? [['pbcopy', []]]
    : process.platform === 'win32'
      ? [['clip.exe', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']]];
  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, {input: value, encoding: 'utf8'});
    if (!result.error && result.status === 0) return {method: 'native', message: `Copied with ${command}.`};
  }
  return {method: 'manual', message: `Clipboard unavailable. Copy manually:\n${value}`};
}
