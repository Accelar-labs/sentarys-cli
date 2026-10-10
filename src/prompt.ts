import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Reads one line without echoing it on a terminal; reads piped stdin as is. */
export function readSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tty = Boolean(process.stdin.isTTY);
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stderr.write(chunk);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: tty });
    if (tty) process.stderr.write(question);
    muted = true;
    rl.once('line', (line) => {
      resolve(line.trim());
      if (tty) process.stderr.write('\n');
      rl.close();
    });
    rl.once('close', () => resolve(''));
    rl.once('SIGINT', () => { rl.close(); reject(new Error('Canceled')); });
  });
}
