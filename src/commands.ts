import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError, type Clip, type Project, SentarysApi, type SocialAccount } from './api.js';
import type { FlagValue } from './args.js';
import { clearConfig, configPath, maskKey, readConfig, resolveCredentials, writeConfig } from './config.js';
import { readSecret } from './prompt.js';

export interface Context {
  version: string;
  json: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
}

type Flags = Record<string, FlagValue>;

const POLL_MS = 20_000;
const BUSY = new Set(['draft', 'importing', 'uploaded', 'queued', 'analyzing', 'rendering']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm']);
const MAX_UPLOAD_BYTES = 536_870_912;

function client(ctx: Context): SentarysApi {
  const { apiKey, apiUrl } = resolveCredentials();
  if (!apiKey) throw new ApiError('No API key. Run "sentarys login" or set SENTARYS_API_KEY (create a key at https://sentarys.com/settings/api).', 401);
  return new SentarysApi(apiKey, apiUrl, ctx.version);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtNum = (n: number) => n.toLocaleString('en-US');
const fmtSec = (s: number | null | undefined) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

function printJson(ctx: Context, value: unknown) {
  ctx.out(JSON.stringify(value, null, 2));
}

export async function login(ctx: Context, flags: Flags) {
  const key = typeof flags.key === 'string' ? flags.key : await readSecret('Paste your Sentarys API key (snt_live_...): ');
  if (!/^(snt|spx|pf)_[A-Za-z0-9_]{8,}$/.test(key)) throw new ApiError('That does not look like a Sentarys API key (snt_live_...).', 400);
  const { apiUrl } = resolveCredentials({ ...process.env, SENTARYS_API_KEY: '' });
  const status = await new SentarysApi(key, apiUrl, ctx.version).billingStatus();
  const path = writeConfig({ ...readConfig(), apiKey: key });
  if (ctx.json) return printJson(ctx, { ok: true, key: maskKey(key), configPath: path, plan: status.plan });
  ctx.out(`Logged in with ${maskKey(key)}. Saved to ${path} (readable only by you).`);
  ctx.out(creditsLine(status));
}

export async function logout(ctx: Context) {
  const removed = clearConfig();
  if (ctx.json) return printJson(ctx, { ok: true, removed });
  ctx.out(removed ? `Removed ${configPath()}. Revoke the key at https://sentarys.com/settings/api if you no longer need it.` : 'No saved key.');
  if (process.env.SENTARYS_API_KEY) ctx.out('SENTARYS_API_KEY is still set in this shell.');
}

function creditsLine(status: { plan?: string; creditsLimit?: number; creditsUsed?: number }) {
  const limit = status.creditsLimit ?? 0;
  const remaining = Math.max(0, limit - (status.creditsUsed ?? 0));
  const plan = !status.plan || status.plan === 'expired' || status.plan === 'none' ? 'free' : status.plan;
  return `Plan: ${plan}. Credits: ${fmtNum(remaining)} left of ${fmtNum(limit)}.`;
}

export async function credits(ctx: Context) {
  const status = await client(ctx).billingStatus();
  const remaining = Math.max(0, (status.creditsLimit ?? 0) - (status.creditsUsed ?? 0));
  if (ctx.json) return printJson(ctx, { ...status, creditsRemaining: remaining });
  ctx.out(creditsLine(status));
  ctx.out('Clips cost 200 credits per source minute (minimum 1,000). Edits, exports and downloads are free.');
}

function platformOf(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return /youtu/.test(host) ? 'YouTube' : /tiktok/.test(host) ? 'TikTok' : /instagram/.test(host) ? 'Instagram' : 'a link';
}

export async function importLink(ctx: Context, [url]: string[], flags: Flags) {
  const api = client(ctx);
  const project = await api.createLinkProject({
    url,
    title: typeof flags.title === 'string' ? flags.title : `Clips from ${platformOf(url)}`,
    templateId: flags.template as string | undefined,
    locale: flags.locale as string | undefined,
    startSec: flags.start as number | undefined,
    endSec: flags.end as number | undefined,
  });
  if (!flags.wait) {
    if (ctx.json) return printJson(ctx, project);
    ctx.out(`Project ${project.id} created (${project.status}). The link imports and the analysis starts on its own.`);
    ctx.out('Charged when the analysis starts: 200 credits per source minute, minimum 1,000.');
    ctx.out(`Follow it with: sentarys clips ${project.id} --wait`);
    return;
  }
  ctx.err(`Project ${project.id} created. Waiting for clips...`);
  await waitAndShow(ctx, api, project.id);
}

export async function upload(ctx: Context, [file]: string[], flags: Flags) {
  const path = resolve(file);
  if (!existsSync(path)) throw new ApiError(`File not found: ${file}`, 400);
  const size = statSync(path).size;
  if (!VIDEO_EXT.has(extname(path).toLowerCase())) throw new ApiError('Upload an MP4, MOV or WEBM file.', 400);
  if (size < 1 || size > MAX_UPLOAD_BYTES) throw new ApiError('Files must be between 1 byte and 512 MB.', 400);
  const api = client(ctx);
  const name = basename(path);
  const project = await api.createUploadProject({
    title: (typeof flags.title === 'string' ? flags.title : name.replace(/\.[^.]+$/, '')).slice(0, 120) || 'Untitled video',
    templateId: flags.template as string | undefined,
  });
  const session = await api.startUpload(project.id, name, size);
  const parts: Array<{ partNumber: number; etag: string }> = [];
  const fd = openSync(path, 'r');
  try {
    for (let n = 1; n <= session.partCount; n++) {
      const offset = (n - 1) * session.partSizeBytes;
      const length = Math.min(session.partSizeBytes, size - offset);
      const buffer = new Uint8Array(new ArrayBuffer(length));
      readSync(fd, buffer, 0, length, offset);
      parts.push({ partNumber: n, etag: await putPart(api, project.id, session.id, n, buffer) });
      if (!ctx.json) ctx.err(`Uploaded part ${n}/${session.partCount}`);
    }
  } finally {
    closeSync(fd);
  }
  await api.completeUpload(project.id, session.id, parts);
  if (flags['no-start']) {
    if (ctx.json) return printJson(ctx, { projectId: project.id, status: 'uploaded' });
    ctx.out(`Uploaded to project ${project.id}. Start the analysis in the app or with the MCP tool start_processing.`);
    return;
  }
  await api.analyze(project.id);
  if (!flags.wait) {
    if (ctx.json) return printJson(ctx, { projectId: project.id, status: 'queued' });
    ctx.out(`Uploaded. Analysis started for project ${project.id} (200 credits per source minute, minimum 1,000).`);
    ctx.out(`Follow it with: sentarys clips ${project.id} --wait`);
    return;
  }
  await waitAndShow(ctx, api, project.id);
}

async function putPart(api: SentarysApi, projectId: string, uploadId: string, n: number, buffer: Uint8Array<ArrayBuffer>): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { uploadUrl } = await api.signPart(projectId, uploadId, n);
      const res = await fetch(uploadUrl, { method: 'PUT', body: buffer, headers: { 'content-length': String(buffer.length) } });
      if (!res.ok) throw new ApiError(`Part ${n} upload failed (HTTP ${res.status}).`, res.status);
      const etag = res.headers.get('etag');
      if (!etag) throw new ApiError(`Part ${n}: the storage did not return an ETag.`, 502);
      return etag.startsWith('"') ? etag : `"${etag}"`;
    } catch (error) {
      lastError = error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function projects(ctx: Context, flags: Flags) {
  const list = await client(ctx).listProjects();
  const limit = typeof flags.limit === 'number' ? flags.limit : 20;
  const shown = list.slice(0, limit);
  if (ctx.json) return printJson(ctx, shown);
  if (!shown.length) return ctx.out('No projects yet. Start one with: sentarys import <link>');
  for (const p of shown) {
    const clips = p.clips?.length ?? 0;
    ctx.out(`${p.id}  ${p.status.padEnd(10)} ${p.kind.padEnd(10)} ${String(clips).padStart(3)} clips  ${p.title}`);
  }
}

async function latestProjectId(api: SentarysApi): Promise<string> {
  const list = await api.listProjects();
  if (!list.length) throw new ApiError('No projects yet. Start one with: sentarys import <link>', 404);
  return list[0].id;
}

export async function clips(ctx: Context, positionals: string[], flags: Flags) {
  const api = client(ctx);
  const id = positionals[0] ?? (await latestProjectId(api));
  if (flags.wait) return waitAndShow(ctx, api, id);
  showProject(ctx, await api.getProject(id));
}

async function waitAndShow(ctx: Context, api: SentarysApi, id: string) {
  let project = await api.getProject(id);
  let last = '';
  while (BUSY.has(project.status) && project.stage !== 'import_needs_range') {
    const line = `${project.status}${project.stage ? ` (${project.stage})` : ''}${project.progress != null ? ` ${Math.round(project.progress)}%` : ''}`;
    if (line !== last && !ctx.json) ctx.err(line);
    last = line;
    await sleep(POLL_MS);
    project = await api.getProject(id);
  }
  showProject(ctx, project);
}

function showProject(ctx: Context, project: Project) {
  if (ctx.json) return printJson(ctx, project);
  ctx.out(`${project.title}  [${project.id}]`);
  ctx.out(`Status: ${project.status}${project.stage ? ` (${project.stage})` : ''}${project.progress != null && BUSY.has(project.status) ? ` ${Math.round(project.progress)}%` : ''}`);
  if (project.error) ctx.out(`Error: ${project.error}`);
  if (project.stage === 'import_needs_range') ctx.out('The link is longer than the import limit. Choose a section in the app, or re-import with --start and --end.');
  const list = project.clips ?? [];
  if (!list.length) {
    if (BUSY.has(project.status)) ctx.out(`No clips yet. Check again with: sentarys clips ${project.id} --wait`);
    return;
  }
  for (const c of list) {
    const length = c.startSeconds != null && c.endSeconds != null ? fmtSec(c.endSeconds - c.startSeconds) : '';
    const tags = [c.exportUrl ? '1080p ready' : c.previewUrl ? 'preview ready' : '', c.locked ? 'locked (upgrade to unlock)' : '', c.watermarked ? 'watermark' : ''].filter(Boolean).join(', ');
    ctx.out(`  ${c.id}  ${c.status.padEnd(9)} ${length.padStart(5)}  ${c.title ?? '(untitled)'}${tags ? `  [${tags}]` : ''}`);
  }
  ctx.out(`Download: sentarys download ${project.id} --all`);
}

export async function download(ctx: Context, positionals: string[], flags: Flags) {
  const api = client(ctx);
  const [projectId, ...ids] = positionals;
  const project = await api.getProject(projectId);
  const all = project.clips ?? [];
  let targets: Clip[];
  if (ids.length) {
    targets = ids.map((id) => {
      const clip = all.find((c) => c.id === id);
      if (!clip) throw new ApiError(`Clip ${id} is not in project ${projectId}.`, 404);
      return clip;
    });
  } else if (flags.all || all.length === 1) {
    targets = all.filter((c) => c.status === 'ready' && !c.locked);
  } else {
    throw new ApiError(`Pass clip ids or --all. Clips: ${all.map((c) => c.id).join(', ') || 'none yet'}`, 400);
  }
  if (!targets.length) throw new ApiError('No ready clips to download yet.', 409);
  const dir = resolve(typeof flags.out === 'string' ? flags.out : '.');
  mkdirSync(dir, { recursive: true });

  for (const clip of targets.filter((c) => !c.exportUrl)) {
    if (clip.locked) throw new ApiError(`Clip ${clip.id} is locked on the trial. Upgrade to Pro to export it.`, 402);
    await api.renderExport(projectId, clip.id);
    if (!ctx.json) ctx.err(`Exporting ${clip.id} in 1080p (free)...`);
  }
  const saved: Array<{ clipId: string; path: string }> = [];
  for (const clip of targets) {
    const ready = clip.exportUrl ? clip : await waitForExport(api, projectId, clip.id);
    const location = await api.exportLocation(projectId, ready.id);
    const res = await fetch(location.url, location.needsAuth ? { headers: { authorization: api.authHeader() } } : {});
    if (!res.ok || !res.body) throw new ApiError(`Download of ${clip.id} failed (HTTP ${res.status}).`, res.status);
    const path = join(dir, `${slug(ready.title) || 'clip'}-${ready.id}.mp4`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
    saved.push({ clipId: ready.id, path });
    if (!ctx.json) ctx.out(`Saved ${path}`);
  }
  if (ctx.json) printJson(ctx, saved);
}

async function waitForExport(api: SentarysApi, projectId: string, clipId: string): Promise<Clip> {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const clip = (await api.getProject(projectId)).clips?.find((c) => c.id === clipId);
    if (!clip) throw new ApiError(`Clip ${clipId} disappeared from the project.`, 404);
    if (clip.exportUrl) return clip;
    if (clip.status === 'failed') throw new ApiError(`The export of ${clipId} failed. Try again in a minute.`, 500);
  }
  throw new ApiError(`The export of ${clipId} is taking longer than usual. Run the download again later.`, 504);
}

function slug(text: string | null) {
  return (text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export async function accounts(ctx: Context) {
  const result = await client(ctx).socialAccounts();
  if (ctx.json) return printJson(ctx, result);
  if (!result.accounts.length) {
    ctx.out('No accounts connected. Connect TikTok, YouTube, Instagram, X or LinkedIn at https://sentarys.com/settings/social');
    return;
  }
  for (const a of result.accounts) ctx.out(`${a.id}  ${a.provider.padEnd(10)} ${a.handle ?? ''}  ${a.status}${a.warning ? `  (${a.warning})` : ''}`);
}

/** Maps --to values (account ids or network names) to connected account ids. */
export function resolveTargets(to: string[], connected: SocialAccount[]): { ids: string[]; error?: string } {
  const ids: string[] = [];
  for (const raw of to) {
    const value = raw.toLowerCase() === 'x' ? 'twitter' : raw.toLowerCase();
    const byId = connected.find((a) => a.id === raw);
    if (byId) { ids.push(byId.id); continue; }
    const byProvider = connected.filter((a) => a.provider === value && a.status === 'ACTIVE');
    if (byProvider.length === 1) { ids.push(byProvider[0].id); continue; }
    if (byProvider.length > 1) return { ids, error: `More than one ${value} account is connected; pass the account id (see "sentarys accounts").` };
    return { ids, error: `No connected account matches "${raw}". See "sentarys accounts" or connect one at https://sentarys.com/settings/social` };
  }
  return { ids: [...new Set(ids)] };
}

export async function post(ctx: Context, [projectId, clipId]: string[], flags: Flags) {
  const api = client(ctx);
  const { accounts: connected } = await api.socialAccounts();
  const { ids, error } = resolveTargets(flags.to as string[], connected);
  if (error) throw new ApiError(error, 400);
  const tiktokPrivacy = flags['tiktok-privacy'] as string | undefined;
  const youtubePrivacy = flags['youtube-privacy'] as string | undefined;
  const providers = new Map(connected.map((a) => [a.id, a.provider]));
  if (ids.some((id) => providers.get(id) === 'tiktok') && !tiktokPrivacy) throw new ApiError('TikTok needs --tiktok-privacy (who can see the post). Choose it yourself; Sentarys never picks it for you.', 400);
  const requestId = (flags['request-id'] as string | undefined) ?? randomBytes(12).toString('hex');
  const body = {
    targets: ids.map((connectionId) => ({
      connectionId,
      options: {
        ...(providers.get(connectionId) === 'tiktok' && tiktokPrivacy ? { privacy: tiktokPrivacy } : {}),
        ...(providers.get(connectionId) === 'youtube' && youtubePrivacy ? { youtubePrivacy } : {}),
      },
    })),
    caption: flags.caption as string,
    ...(typeof flags.title === 'string' ? { title: flags.title } : {}),
    ...(flags.hashtags ? { hashtags: flags.hashtags } : {}),
    ...(typeof flags.at === 'string' ? { scheduledAt: flags.at } : {}),
    ...(flags['allow-repeat'] ? { allowRepeat: true } : {}),
    requestId,
  };
  const result = await api.createPosts(projectId, clipId, body);
  if (ctx.json) return printJson(ctx, { requestId, ...result });
  for (const p of result.posts) ctx.out(`${p.id}  ${p.provider.padEnd(10)} ${p.status}${p.scheduledAt ? ` at ${p.scheduledAt}` : ''}`);
  ctx.out(`Retry safely with --request-id ${requestId}. Check a post with: sentarys post-status <postId>`);
}

export async function postStatus(ctx: Context, [postId]: string[]) {
  const p = await client(ctx).getPost(postId);
  if (ctx.json) return printJson(ctx, p);
  ctx.out(`${p.id}  ${p.provider}  ${p.status}${p.permalink ? `  ${p.permalink}` : ''}`);
  if (p.status === 'unconfirmed') ctx.out('The network received the video but did not confirm it. Check the profile before posting again.');
  if (p.errorMessage) ctx.out(`Error: ${p.errorMessage}`);
}

export async function cancelPost(ctx: Context, [postId]: string[]) {
  const result = await client(ctx).cancelPost(postId);
  if (ctx.json) return printJson(ctx, result);
  ctx.out(`Canceled ${postId}.`);
}
