#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { ApiError } from './api.js';
import { helpText, parseArgs } from './args.js';
import * as cmd from './commands.js';

const version = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'version') { console.log(version); return 0; }
  if (parsed.kind === 'help') { console.log(helpText(parsed.command, version)); return 0; }
  if (parsed.kind === 'error') {
    console.error(parsed.message);
    return 2;
  }
  const { command, positionals, flags } = parsed.value;
  const ctx: cmd.Context = { version, json: Boolean(flags.json), out: (l) => console.log(l), err: (l) => console.error(l) };
  try {
    switch (command) {
      case 'login': await cmd.login(ctx, flags); break;
      case 'logout': await cmd.logout(ctx); break;
      case 'credits': await cmd.credits(ctx); break;
      case 'import': await cmd.importLink(ctx, positionals, flags); break;
      case 'upload': await cmd.upload(ctx, positionals, flags); break;
      case 'projects': await cmd.projects(ctx, flags); break;
      case 'clips': await cmd.clips(ctx, positionals, flags); break;
      case 'download': await cmd.download(ctx, positionals, flags); break;
      case 'accounts': await cmd.accounts(ctx); break;
      case 'post': await cmd.post(ctx, positionals, flags); break;
      case 'post-status': await cmd.postStatus(ctx, positionals); break;
      case 'cancel-post': await cmd.cancelPost(ctx, positionals); break;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ctx.json) console.error(JSON.stringify({ error: message, status: error instanceof ApiError ? error.status : undefined }));
    else console.error(`Error: ${message}`);
    return error instanceof ApiError && error.status === 402 ? 3 : 1;
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
