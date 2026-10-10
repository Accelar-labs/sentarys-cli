import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS, helpText, parseArgs } from '../src/args.js';
import { resolveTargets } from '../src/commands.js';

const ok = (argv: string[]) => {
  const r = parseArgs(argv);
  assert.equal(r.kind, 'command', r.kind === 'error' ? r.message : r.kind);
  return (r as Extract<typeof r, { kind: 'command' }>).value;
};
const fails = (argv: string[], pattern: RegExp) => {
  const r = parseArgs(argv);
  assert.equal(r.kind, 'error');
  assert.match((r as { message: string }).message, pattern);
};

test('no arguments and --help show help', () => {
  assert.deepEqual(parseArgs([]), { kind: 'help' });
  assert.deepEqual(parseArgs(['--help']), { kind: 'help', command: undefined });
  assert.deepEqual(parseArgs(['help', 'post']), { kind: 'help', command: 'post' });
  assert.deepEqual(parseArgs(['download', '-h']), { kind: 'help', command: 'download' });
  assert.deepEqual(parseArgs(['--version']), { kind: 'version' });
});

test('unknown commands and options are rejected', () => {
  fails(['explode'], /Unknown command/);
  fails(['credits', '--nope'], /Unknown option --nope/);
  fails(['credits', '-z'], /Unknown option -z/);
});

test('aliases resolve to the command name', () => {
  assert.equal(ok(['whoami']).command, 'credits');
  assert.equal(ok(['ls']).command, 'projects');
  assert.equal(ok(['status', 'p1']).command, 'clips');
});

test('import parses link, template, range and wait', () => {
  const v = ok(['import', 'https://www.youtube.com/watch?v=abc', '-t', 'podcast', '--start', '60', '--end=600', '-w', '--json']);
  assert.deepEqual(v.positionals, ['https://www.youtube.com/watch?v=abc']);
  assert.deepEqual(v.flags, { template: 'podcast', start: 60, end: 600, wait: true, json: true });
});

test('import validates the link and the range', () => {
  fails(['import'], /Missing argument/);
  fails(['import', 'not a url'], /full link/);
  fails(['import', 'ftp://x.com/a'], /http/);
  fails(['import', 'https://youtu.be/x', '--start', '10'], /together/);
  fails(['import', 'https://youtu.be/x', '--start', '10', '--end', '5'], /after/);
  fails(['import', 'https://youtu.be/x', '--start', 'abc', '--end', '5'], /number/);
  fails(['import', 'https://youtu.be/x', '--template'], /needs a value/);
});

test('upload accepts --no-start', () => {
  const v = ok(['upload', './episode.mp4', '--no-start']);
  assert.equal(v.flags['no-start'], true);
  fails(['upload', 'a.mp4', 'b.mp4'], /Too many/);
});

test('clips takes an optional project id', () => {
  assert.deepEqual(ok(['clips']).positionals, []);
  assert.deepEqual(ok(['clips', 'proj1', '--wait']).flags, { wait: true });
});

test('download takes clip ids or --all, not both', () => {
  assert.deepEqual(ok(['download', 'p1', 'c1', 'c2', '-o', 'out']).positionals, ['p1', 'c1', 'c2']);
  assert.equal(ok(['download', 'p1', '--all']).flags.all, true);
  fails(['download', 'p1', 'c1', '--all'], /not both/);
  fails(['download'], /Missing argument/);
});

test('post collects targets and hashtags and validates them', () => {
  const v = ok(['post', 'p1', 'c1', '--to', 'tiktok,youtube', '--to', 'acc_3', '-c', 'New episode', '--hashtags', 'podcast, ai', '--at', '2026-11-01T15:00:00Z', '--tiktok-privacy', 'SELF_ONLY']);
  assert.deepEqual(v.flags.to, ['tiktok', 'youtube', 'acc_3']);
  assert.deepEqual(v.flags.hashtags, ['podcast', 'ai']);
  fails(['post', 'p1', 'c1', '-c', 'x'], /--to/);
  fails(['post', 'p1', 'c1', '--to', 'tiktok'], /caption/);
  fails(['post', 'p1', 'c1', '--to', 'a,b,c,d,e,f,g', '-c', 'x'], /At most 6/);
  fails(['post', 'p1', 'c1', '--to', 'tiktok', '-c', 'x', '--at', 'tomorrow'], /ISO time/);
  fails(['post', 'p1', 'c1', '--to', 'tiktok', '-c', 'x', '--at', '2026-11-01T15:00:00'], /timezone/);
  fails(['post', 'p1', 'c1', '--to', 'tiktok', '-c', 'x', '--tiktok-privacy', 'public'], /tiktok-privacy/);
  fails(['post', 'p1', 'c1', '--to', 'youtube', '-c', 'x', '--youtube-privacy', 'secret'], /youtube-privacy/);
  fails(['post', 'p1', 'c1', '--to', 'youtube', '-c', 'x', '--request-id', 'short'], /request-id/);
  fails(['post', 'p1'], /Missing argument/);
});

test('login checks the key shape', () => {
  assert.equal(ok(['login', '--key', 'snt_live_abcdefghijklmnop']).flags.key, 'snt_live_abcdefghijklmnop');
  fails(['login', '--key', 'sk-123'], /does not look like/);
  fails(['login', 'extra'], /Too many/);
});

test('-- ends options', () => {
  assert.deepEqual(ok(['upload', '--', '--weird-name.mp4']).positionals, ['--weird-name.mp4']);
});

test('help lists every command and command help lists its options', () => {
  const all = helpText(undefined, '1.0.0');
  for (const c of COMMANDS) assert.ok(all.includes(c.name), c.name);
  assert.match(helpText('post'), /--tiktok-privacy <value>/);
});

test('resolveTargets maps networks and ids to connected accounts', () => {
  const accounts = [
    { id: 'a1', provider: 'tiktok', status: 'ACTIVE', handle: '@me' },
    { id: 'a2', provider: 'youtube', status: 'ACTIVE', handle: 'Me' },
    { id: 'a3', provider: 'twitter', status: 'ACTIVE', handle: '@me' },
  ];
  assert.deepEqual(resolveTargets(['tiktok', 'a2', 'X', 'a1'], accounts), { ids: ['a1', 'a2', 'a3'] });
  assert.match(resolveTargets(['linkedin'], accounts).error ?? '', /No connected account/);
  const two = [...accounts, { id: 'a4', provider: 'tiktok', status: 'ACTIVE', handle: '@other' }];
  assert.match(resolveTargets(['tiktok'], two).error ?? '', /More than one/);
});
