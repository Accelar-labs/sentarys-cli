/**
 * Command line parsing, kept free of I/O so it can be tested on its own.
 */

export type FlagType = 'string' | 'boolean' | 'number' | 'list';

export interface FlagSpec {
  type: FlagType;
  alias?: string;
  description: string;
  /** Shown in help as the value name, e.g. <seconds>. */
  value?: string;
}

export interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  /** Minimum and maximum positional arguments (max Infinity for variadic). */
  positionals: [number, number];
  flags: Record<string, FlagSpec>;
  aliases?: string[];
}

export const GLOBAL_FLAGS: Record<string, FlagSpec> = {
  json: { type: 'boolean', description: 'Print raw JSON instead of text' },
  help: { type: 'boolean', alias: 'h', description: 'Show help' },
};

export const COMMANDS: CommandSpec[] = [
  {
    name: 'login',
    summary: 'Save your API key (from https://sentarys.com/settings/api)',
    usage: 'sentarys login [--key snt_live_...]',
    positionals: [0, 0],
    flags: { key: { type: 'string', description: 'API key; read from stdin when omitted', value: 'key' } },
  },
  {
    name: 'logout',
    summary: 'Remove the saved API key from this computer',
    usage: 'sentarys logout',
    positionals: [0, 0],
    flags: {},
  },
  {
    name: 'credits',
    summary: 'Show your plan and credit balance',
    usage: 'sentarys credits',
    positionals: [0, 0],
    flags: {},
    aliases: ['whoami', 'balance'],
  },
  {
    name: 'import',
    summary: 'Clip a YouTube, TikTok or Instagram link (charged when the analysis starts)',
    usage: 'sentarys import <url> [--template podcast] [--start 0 --end 600] [--wait]',
    positionals: [1, 1],
    flags: {
      template: { type: 'string', alias: 't', description: 'Clip template, e.g. podcast, viral, tiktok, gameplay, webinar', value: 'id' },
      title: { type: 'string', description: 'Project name', value: 'text' },
      start: { type: 'number', description: 'Import from this second of the source', value: 'seconds' },
      end: { type: 'number', description: 'Import up to this second of the source', value: 'seconds' },
      locale: { type: 'string', description: 'Interface language: en, pt-BR or es', value: 'locale' },
      wait: { type: 'boolean', alias: 'w', description: 'Wait until the clips are ready' },
    },
  },
  {
    name: 'upload',
    summary: 'Upload a video file (MP4, MOV, WEBM up to 512 MB) and clip it',
    usage: 'sentarys upload <file> [--template podcast] [--no-start] [--wait]',
    positionals: [1, 1],
    flags: {
      template: { type: 'string', alias: 't', description: 'Clip template', value: 'id' },
      title: { type: 'string', description: 'Project name (defaults to the file name)', value: 'text' },
      'no-start': { type: 'boolean', description: 'Upload only; start the paid analysis later' },
      wait: { type: 'boolean', alias: 'w', description: 'Wait until the clips are ready' },
    },
  },
  {
    name: 'projects',
    summary: 'List your projects',
    usage: 'sentarys projects [--limit 20]',
    positionals: [0, 0],
    flags: { limit: { type: 'number', alias: 'n', description: 'How many to show (default 20)', value: 'n' } },
    aliases: ['ls'],
  },
  {
    name: 'clips',
    summary: 'Show the status and clips of a project (latest project when no id is given)',
    usage: 'sentarys clips [projectId] [--wait]',
    positionals: [0, 1],
    flags: { wait: { type: 'boolean', alias: 'w', description: 'Poll until the project is ready or failed' } },
    aliases: ['status'],
  },
  {
    name: 'download',
    summary: 'Download 1080p clips, exporting them first when needed (free)',
    usage: 'sentarys download <projectId> [clipId...] [--all] [--out ./clips]',
    positionals: [1, Infinity],
    flags: {
      all: { type: 'boolean', alias: 'a', description: 'Every ready clip of the project' },
      out: { type: 'string', alias: 'o', description: 'Folder to save into (default: current folder)', value: 'dir' },
    },
  },
  {
    name: 'accounts',
    summary: 'List the social accounts connected in the app',
    usage: 'sentarys accounts',
    positionals: [0, 0],
    flags: {},
  },
  {
    name: 'post',
    summary: 'Publish or schedule a clip on connected social accounts',
    usage: 'sentarys post <projectId> <clipId> --to tiktok,youtube --caption "..." [--at 2026-11-01T15:00:00Z]',
    positionals: [2, 2],
    flags: {
      to: { type: 'list', description: 'Account ids or networks (tiktok, youtube, instagram, twitter, linkedin), comma separated', value: 'targets' },
      caption: { type: 'string', alias: 'c', description: 'Text that goes with the video', value: 'text' },
      title: { type: 'string', description: 'YouTube and LinkedIn title', value: 'text' },
      hashtags: { type: 'list', description: 'Comma separated hashtags', value: 'tags' },
      at: { type: 'string', description: 'Schedule for this ISO time (up to 60 days ahead); omit to post now', value: 'time' },
      'tiktok-privacy': { type: 'string', description: 'PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR or SELF_ONLY', value: 'value' },
      'youtube-privacy': { type: 'string', description: 'public, unlisted or private', value: 'value' },
      'request-id': { type: 'string', description: 'Reuse on a retry to avoid duplicate posts (8 to 64 letters, digits, _ or -)', value: 'id' },
      'allow-repeat': { type: 'boolean', description: 'Post again on an account that already has this clip' },
    },
  },
  {
    name: 'post-status',
    summary: 'Show the status and link of a post',
    usage: 'sentarys post-status <postId>',
    positionals: [1, 1],
    flags: {},
  },
  {
    name: 'cancel-post',
    summary: 'Cancel a scheduled post that has not started',
    usage: 'sentarys cancel-post <postId>',
    positionals: [1, 1],
    flags: {},
  },
];

export type FlagValue = string | number | boolean | string[];

export interface ParsedCommand {
  command: string;
  positionals: string[];
  flags: Record<string, FlagValue>;
}

export type ParseResult =
  | { kind: 'command'; value: ParsedCommand }
  | { kind: 'help'; command?: string }
  | { kind: 'version' }
  | { kind: 'error'; message: string; command?: string };

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

const SCHEDULE_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
const YOUTUBE_PRIVACY = ['public', 'unlisted', 'private'];

export function parseArgs(argv: string[]): ParseResult {
  if (argv.length === 0) return { kind: 'help' };
  const [first, ...rest] = argv;
  if (first === '--version' || first === '-v') return { kind: 'version' };
  if (first === '--help' || first === '-h' || first === 'help') return { kind: 'help', command: rest[0] };
  const spec = findCommand(first);
  if (!spec) return { kind: 'error', message: `Unknown command "${first}". Run "sentarys --help".` };

  const all: Record<string, FlagSpec> = { ...GLOBAL_FLAGS, ...spec.flags };
  const byAlias = new Map(Object.entries(all).filter(([, f]) => f.alias).map(([name, f]) => [f.alias as string, name]));
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '--') {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    let name: string | undefined;
    let inline: string | undefined;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      inline = eq === -1 ? undefined : token.slice(eq + 1);
    } else if (/^-[a-zA-Z]$/.test(token)) {
      name = byAlias.get(token.slice(1));
      if (!name) return { kind: 'error', message: `Unknown option ${token}.`, command: spec.name };
    } else {
      positionals.push(token);
      continue;
    }
    const flag = all[name];
    if (!flag) return { kind: 'error', message: `Unknown option --${name} for "${spec.name}".`, command: spec.name };
    if (flag.type === 'boolean') {
      if (inline !== undefined && !['true', 'false'].includes(inline)) return { kind: 'error', message: `--${name} takes no value.`, command: spec.name };
      flags[name] = inline !== 'false';
      continue;
    }
    const raw = inline ?? rest[++i];
    if (raw === undefined || (inline === undefined && raw.startsWith('--'))) return { kind: 'error', message: `--${name} needs a value.`, command: spec.name };
    if (flag.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { kind: 'error', message: `--${name} must be a non-negative number.`, command: spec.name };
      flags[name] = n;
    } else if (flag.type === 'list') {
      const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
      flags[name] = [...((flags[name] as string[] | undefined) ?? []), ...items];
    } else {
      flags[name] = raw;
    }
  }

  if (flags.help) return { kind: 'help', command: spec.name };
  const [min, max] = spec.positionals;
  if (positionals.length < min) return { kind: 'error', message: `Missing argument. Usage: ${spec.usage}`, command: spec.name };
  if (positionals.length > max) return { kind: 'error', message: `Too many arguments. Usage: ${spec.usage}`, command: spec.name };

  const problem = validate(spec.name, positionals, flags);
  if (problem) return { kind: 'error', message: problem, command: spec.name };
  return { kind: 'command', value: { command: spec.name, positionals, flags } };
}

function validate(command: string, positionals: string[], flags: Record<string, FlagValue>): string | undefined {
  switch (command) {
    case 'login':
      if (typeof flags.key === 'string' && !/^(snt|spx|pf)_[A-Za-z0-9_]{8,}$/.test(flags.key)) return 'That does not look like a Sentarys API key (snt_live_...).';
      return;
    case 'import': {
      let url: URL;
      try { url = new URL(positionals[0]); } catch { return 'Pass a full link, e.g. https://www.youtube.com/watch?v=...'; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Pass an http(s) link.';
      const start = flags.start as number | undefined;
      const end = flags.end as number | undefined;
      if ((start === undefined) !== (end === undefined)) return 'Pass --start and --end together.';
      if (start !== undefined && end !== undefined && end <= start) return '--end must be after --start.';
      return;
    }
    case 'download':
      if (flags.all && positionals.length > 1) return 'Pass clip ids or --all, not both.';
      return;
    case 'post': {
      const to = flags.to as string[] | undefined;
      if (!to?.length) return 'Choose where to post with --to (account ids or networks; see "sentarys accounts").';
      if (to.length > 6) return 'At most 6 accounts per post.';
      if (typeof flags.caption !== 'string') return 'Add a caption with --caption.';
      if (flags.caption.length > 5000) return 'The caption is longer than 5,000 characters.';
      if (flags.at !== undefined && !SCHEDULE_FORMAT.test(String(flags.at))) return '--at must be an ISO time with a timezone, e.g. 2026-11-01T15:00:00Z.';
      if (flags['tiktok-privacy'] !== undefined && !TIKTOK_PRIVACY.includes(String(flags['tiktok-privacy']))) return `--tiktok-privacy must be one of ${TIKTOK_PRIVACY.join(', ')}.`;
      if (flags['youtube-privacy'] !== undefined && !YOUTUBE_PRIVACY.includes(String(flags['youtube-privacy']))) return `--youtube-privacy must be one of ${YOUTUBE_PRIVACY.join(', ')}.`;
      if (flags['request-id'] !== undefined && !REQUEST_ID.test(String(flags['request-id']))) return '--request-id must be 8 to 64 letters, digits, _ or -.';
      return;
    }
  }
  return;
}

export function helpText(command?: string, version = ''): string {
  const spec = command ? findCommand(command) : undefined;
  if (spec) {
    const lines = [`${spec.summary}\n`, `Usage: ${spec.usage}`];
    const flags = Object.entries({ ...spec.flags, ...GLOBAL_FLAGS });
    if (flags.length) {
      lines.push('', 'Options:');
      for (const [name, f] of flags) {
        const left = `${f.alias ? `-${f.alias}, ` : '    '}--${name}${f.value ? ` <${f.value}>` : ''}`;
        lines.push(`  ${left.padEnd(30)} ${f.description}`);
      }
    }
    return lines.join('\n');
  }
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  return [
    `sentarys ${version}`.trim() + ': AI video editing from the terminal (https://sentarys.com)',
    '',
    'Usage: sentarys <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(width)} ${c.summary}`),
    '',
    'Run "sentarys <command> --help" for its options. Add --json for machine readable output.',
    'The API key comes from SENTARYS_API_KEY or "sentarys login" (~/.config/sentarys/config.json).',
  ].join('\n');
}
