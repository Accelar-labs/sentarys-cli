export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

export interface Clip {
  id: string;
  title: string | null;
  status: string;
  startSeconds: number | null;
  endSeconds: number | null;
  aspectRatio?: string | null;
  locked?: boolean;
  watermarked?: boolean;
  previewUrl: string | null;
  exportUrl: string | null;
}

export interface Project {
  id: string;
  title: string;
  kind: string;
  status: string;
  stage?: string | null;
  progress?: number | null;
  error?: string | null;
  durationSeconds?: number | null;
  updatedAt?: string;
  clips?: Clip[];
}

export interface BillingStatus {
  plan?: string;
  status?: string;
  creditsLimit?: number;
  creditsUsed?: number;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
}

export interface UploadSession {
  id: string;
  partSizeBytes: number;
  partCount: number;
}

export interface SocialAccount {
  id: string;
  provider: string;
  status: string;
  handle: string | null;
  warning?: string | null;
}

export interface SocialPost {
  id: string;
  provider: string;
  accountHandle?: string | null;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  permalink: string | null;
  errorMessage: string | null;
}

const VERSION_HEADER = 'sentarys-cli';

export class SentarysApi {
  constructor(private readonly apiKey: string, private readonly baseUrl: string, private readonly version: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        accept: 'application/json',
        'user-agent': `${VERSION_HEADER}/${this.version}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
    if (!res.ok) throw new ApiError(errorMessage(res.status, parsed), res.status, parsed);
    return parsed as T;
  }

  billingStatus() { return this.request<BillingStatus>('GET', '/billing/status'); }
  listProjects() { return this.request<Project[]>('GET', '/video-projects'); }
  getProject(id: string) { return this.request<Project>('GET', `/video-projects/${enc(id)}`); }

  createLinkProject(input: { url: string; title: string; templateId?: string; locale?: string; startSec?: number; endSec?: number }) {
    return this.request<Project>('POST', '/video-projects', {
      title: input.title,
      kind: 'clips',
      youtubeReferenceUrl: input.url,
      importSource: true,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.startSec !== undefined ? { startSec: input.startSec, endSec: input.endSec } : {}),
    });
  }

  createUploadProject(input: { title: string; templateId?: string }) {
    return this.request<Project>('POST', '/video-projects', { title: input.title, kind: 'clips', ...(input.templateId ? { templateId: input.templateId } : {}) });
  }

  startUpload(projectId: string, fileName: string, expectedSize: number) {
    return this.request<UploadSession>('POST', `/video-projects/${enc(projectId)}/uploads`, { fileName, expectedSize });
  }

  signPart(projectId: string, uploadId: string, partNumber: number) {
    return this.request<{ uploadUrl: string; contentLength: number }>('POST', `/video-projects/${enc(projectId)}/uploads/${enc(uploadId)}/parts/${partNumber}/sign`);
  }

  completeUpload(projectId: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>) {
    return this.request<unknown>('POST', `/video-projects/${enc(projectId)}/uploads/${enc(uploadId)}/complete`, { parts });
  }

  analyze(projectId: string) { return this.request<unknown>('POST', `/video-projects/${enc(projectId)}/analyze`, {}); }

  renderExport(projectId: string, clipId: string) {
    return this.request<unknown>('POST', `/video-projects/${enc(projectId)}/clips/${enc(clipId)}/render`, { renderMode: 'export' });
  }

  /** Resolves the export to a signed URL (or, for locally stored media, a URL that needs the key). */
  async exportLocation(projectId: string, clipId: string): Promise<{ url: string; needsAuth: boolean }> {
    const url = `${this.baseUrl}/video-projects/${enc(projectId)}/clips/${enc(clipId)}/media?variant=export`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.apiKey}`, 'user-agent': `${VERSION_HEADER}/${this.version}` }, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (!location) throw new ApiError('The server did not return a download link.', res.status);
      return { url: new URL(location, url).toString(), needsAuth: false };
    }
    if (res.ok) {
      await res.body?.cancel();
      return { url, needsAuth: true };
    }
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch {}
    throw new ApiError(errorMessage(res.status, parsed), res.status, parsed);
  }

  authHeader() { return `Bearer ${this.apiKey}`; }

  socialAccounts() { return this.request<{ providers: Array<{ slug: string; displayName: string }>; accounts: SocialAccount[] }>('GET', '/social/accounts'); }

  createPosts(projectId: string, clipId: string, body: unknown) {
    return this.request<{ posts: SocialPost[] }>('POST', `/video-projects/${enc(projectId)}/clips/${enc(clipId)}/social-posts`, body);
  }

  getPost(postId: string) { return this.request<SocialPost>('GET', `/social/posts/${enc(postId)}`); }
  cancelPost(postId: string) { return this.request<unknown>('DELETE', `/social/posts/${enc(postId)}`); }
}

const enc = encodeURIComponent;

export function errorMessage(status: number, body: unknown): string {
  const raw = body && typeof body === 'object' ? (body as { message?: unknown; error?: unknown }).message ?? (body as { error?: unknown }).error : body;
  const detail = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw : '';
  switch (status) {
    case 401: return `${detail || 'Invalid or revoked API key'}. Create a key at https://sentarys.com/settings/api and run "sentarys login".`;
    case 402: return `${detail || 'Not enough credits'}. Nothing was charged. Add credits at https://sentarys.com/settings/billing.`;
    case 404: return detail || 'Not found in this account.';
    case 429: return `${detail || 'Too many requests'}. Wait a minute and try again.`;
    default: return detail ? `${detail} (HTTP ${status})` : `Request failed (HTTP ${status}).`;
  }
}
