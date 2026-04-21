/**
 * Notion REST 클라이언트 (런타임용 · 노션 MCP와는 별개).
 *
 * 본 Electron 앱은 사용자가 발급한 Notion Internal Integration Token을
 * 사용해 공식 REST API를 호출합니다. 토큰은 `admin_settings` 테이블에
 * 저장되며, 각 호출마다 `Authorization: Bearer <token>` 헤더로 전달됩니다.
 *
 * 공식 문서: https://developers.notion.com/reference
 *
 * 주의:
 *   - 사용자 워크스페이스에서 해당 Integration이 "명시적으로 공유"된
 *     페이지/DB 만 접근 가능합니다 (Internal Integration의 기본 정책).
 *   - 사내 Private 워크스페이스면 Notion Admin이 Integration Access 를
 *     "Read" 이상으로 부여해야 `users.list` 가 동작합니다.
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionPageProperties {
  [key: string]: unknown;
}

export interface NotionPage {
  object: 'page';
  id: string;
  created_time: string;
  last_edited_time: string;
  archived?: boolean;
  url?: string;
  properties: NotionPageProperties;
}

export interface NotionQueryResult {
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface NotionUser {
  object: 'user';
  id: string;
  type?: 'person' | 'bot';
  name?: string | null;
  avatar_url?: string | null;
  person?: { email?: string };
  bot?: unknown;
}

export interface NotionUsersResult {
  results: NotionUser[];
  next_cursor: string | null;
  has_more: boolean;
}

export class NotionApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'NotionApiError';
  }
}

function stripDashes(id: string): string {
  return id.replace(/-/g, '').trim();
}

export class NotionClient {
  constructor(private readonly token: string) {
    if (!token || !token.trim()) {
      throw new Error('Notion token 이 비어 있습니다.');
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    pathname: string,
    body?: unknown,
  ): Promise<T> {
    // Node 20 / Electron 32+ 는 global fetch 를 제공.
    const res = await fetch(`${NOTION_API}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON response (rare) */
      }
    }

    if (!res.ok) {
      const message =
        (json && typeof json.message === 'string' && json.message) ||
        `Notion API ${method} ${pathname} 실패 (status ${res.status})`;
      const code = json && typeof json.code === 'string' ? json.code : undefined;
      throw new NotionApiError(res.status, message, code);
    }
    return json as T;
  }

  /** 토큰 유효성 검증 — /users/me 1회 호출. */
  async probe(): Promise<NotionUser> {
    return this.request<NotionUser>('GET', '/users/me');
  }

  /** 특정 데이터베이스의 모든 페이지를 커서 페이지네이션으로 수집. */
  async queryDatabase(
    databaseId: string,
    options: { page_size?: number; start_cursor?: string | null } = {},
  ): Promise<NotionQueryResult> {
    const id = stripDashes(databaseId);
    const payload: Record<string, unknown> = {
      page_size: Math.min(Math.max(options.page_size ?? 100, 1), 100),
    };
    if (options.start_cursor) payload.start_cursor = options.start_cursor;
    return this.request<NotionQueryResult>(
      'POST',
      `/databases/${id}/query`,
      payload,
    );
  }

  /** 데이터베이스 페이지를 커서 끝까지 반복해 수집 (최대 `limit` 건). */
  async queryAllPages(
    databaseId: string,
    limit: number = 500,
  ): Promise<NotionPage[]> {
    const out: NotionPage[] = [];
    let cursor: string | null = null;
    while (out.length < limit) {
      const page = await this.queryDatabase(databaseId, {
        page_size: Math.min(100, limit - out.length),
        start_cursor: cursor ?? undefined,
      });
      out.push(...page.results);
      if (!page.has_more || !page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return out;
  }

  /** 워크스페이스 사용자 목록 (bot 포함). */
  async listUsersPage(
    options: { page_size?: number; start_cursor?: string | null } = {},
  ): Promise<NotionUsersResult> {
    const qs = new URLSearchParams();
    qs.set(
      'page_size',
      String(Math.min(Math.max(options.page_size ?? 100, 1), 100)),
    );
    if (options.start_cursor) qs.set('start_cursor', options.start_cursor);
    return this.request<NotionUsersResult>('GET', `/users?${qs.toString()}`);
  }

  /** 사용자 목록을 끝까지 반복 수집. */
  async listAllUsers(limit: number = 500): Promise<NotionUser[]> {
    const out: NotionUser[] = [];
    let cursor: string | null = null;
    while (out.length < limit) {
      const page = await this.listUsersPage({
        page_size: Math.min(100, limit - out.length),
        start_cursor: cursor ?? undefined,
      });
      out.push(...page.results);
      if (!page.has_more || !page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// 프로퍼티 값 추출 헬퍼 — 각 Notion property 타입에서 "가장 자연스러운
// 문자열/숫자" 하나를 뽑아내 upsert에 사용합니다. 매핑되지 않은 원본은
// notion_extra 에 JSON 으로 통째 저장되므로, 여기서는 best-effort 로 충분.
// ---------------------------------------------------------------------------

export function readTitle(prop: any): string {
  if (!prop || prop.type !== 'title' || !Array.isArray(prop.title)) return '';
  return prop.title.map((n: any) => n?.plain_text ?? '').join('').trim();
}

export function readText(prop: any): string {
  if (!prop) return '';
  if (prop.type === 'title' && Array.isArray(prop.title)) {
    return prop.title.map((n: any) => n?.plain_text ?? '').join('').trim();
  }
  if (prop.type === 'rich_text' && Array.isArray(prop.rich_text)) {
    return prop.rich_text.map((n: any) => n?.plain_text ?? '').join('').trim();
  }
  if (prop.type === 'select' && prop.select) return String(prop.select.name ?? '');
  if (prop.type === 'status' && prop.status) return String(prop.status.name ?? '');
  if (prop.type === 'phone_number') return String(prop.phone_number ?? '');
  if (prop.type === 'email') return String(prop.email ?? '');
  if (prop.type === 'url') return String(prop.url ?? '');
  if (prop.type === 'number' && prop.number !== null && prop.number !== undefined) {
    return String(prop.number);
  }
  if (prop.type === 'checkbox') return prop.checkbox ? 'Y' : 'N';
  if (prop.type === 'date' && prop.date?.start) return String(prop.date.start);
  if (prop.type === 'multi_select' && Array.isArray(prop.multi_select)) {
    return prop.multi_select.map((o: any) => o?.name ?? '').filter(Boolean).join(', ');
  }
  if (prop.type === 'people' && Array.isArray(prop.people)) {
    return prop.people.map((p: any) => p?.name ?? p?.id ?? '').filter(Boolean).join(', ');
  }
  return '';
}

export function readNumber(prop: any): number | null {
  if (!prop) return null;
  if (prop.type === 'number' && typeof prop.number === 'number') return prop.number;
  return null;
}

/**
 * Page 의 properties 를 "이름 → 평탄 문자열" 맵으로 바꿔 notion_extra 에
 * 저장하기 위한 덤프. null/빈 값은 생략.
 */
export function flattenProperties(properties: NotionPageProperties): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(properties ?? {})) {
    const val = readText(raw);
    if (val) out[key] = val;
  }
  return out;
}

