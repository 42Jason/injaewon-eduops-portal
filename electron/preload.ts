import { contextBridge, ipcRenderer } from 'electron';

const api = {
  app: {
    info: () =>
      ipcRenderer.invoke('app:info') as Promise<{
        version: string;
        platform: string;
        dbPath: string;
        isDev: boolean;
      }>,
  },
  auth: {
    login: (email: string, password: string) =>
      ipcRenderer.invoke('auth:login', { email, password }) as Promise<{
        ok: boolean;
        user?: {
          id: number;
          email: string;
          name: string;
          role: string;
          departmentId: number | null;
          departmentName?: string;
          title?: string | null;
          phone?: string | null;
          avatarUrl?: string | null;
          active: boolean;
          createdAt: string;
        };
        error?: string;
      }>,
    logout: () => ipcRenderer.invoke('auth:logout') as Promise<{ ok: boolean }>,
  },
  assignments: {
    list: (filter?: { state?: string; assignee?: number }) =>
      ipcRenderer.invoke('assignments:list', filter) as Promise<Array<Record<string, unknown>>>,
    get: (id: number) =>
      ipcRenderer.invoke('assignments:get', id) as Promise<Record<string, unknown> | null>,
    setState: (payload: { id: number; state: string; actorId: number; note?: string }) =>
      ipcRenderer.invoke('assignments:setState', payload) as Promise<{ ok: boolean }>,
    parsingResult: (assignmentId: number) =>
      ipcRenderer.invoke('assignments:parsingResult', assignmentId) as Promise<Record<string, unknown> | null>,
    qaReviews: (assignmentId: number) =>
      ipcRenderer.invoke('assignments:qaReviews', assignmentId) as Promise<Array<Record<string, unknown>>>,
  },
  notices: {
    list: () =>
      ipcRenderer.invoke('notices:list') as Promise<Array<Record<string, unknown>>>,
  },
  home: {
    stats: (userId: number) =>
      ipcRenderer.invoke('home:stats', userId) as Promise<{
        todayMine: number;
        dueToday: number;
        atRisk: number;
        rejected: number;
        awaitingApp: number;
        unreadNotice: number;
      }>,
  },
  parsing: {
    preview: (payload: { buffer: ArrayBuffer | Uint8Array; filename: string }) =>
      ipcRenderer.invoke('parsing:preview', payload) as Promise<{
        ok: boolean;
        error?: string;
        sheetName?: string;
        filename?: string;
        headerRow?: number;
        warnings?: string[];
        availableSheets?: string[];
        headerMap?: Record<string, number | null>;
        rows?: Array<{
          rowNumber: number;
          subject: string;
          publisher: string;
          studentCode: string;
          assignmentTitle: string;
          assignmentScope: string;
          lengthRequirement: string;
          outline: string;
          rubric: string;
          teacherRequirements: string;
          studentRequests: string;
          valid: boolean;
          errors: string[];
        }>;
      }>,
    commit: (payload: {
      rows: Array<Record<string, unknown>>;
      uploaderId: number;
      filename: string;
    }) =>
      ipcRenderer.invoke('parsing:commit', payload) as Promise<{
        ok: boolean;
        error?: string;
        created?: Array<{ code: string; rowNumber: number }>;
        skipped?: Array<{ rowNumber: number; reason: string }>;
      }>,
    recent: () =>
      ipcRenderer.invoke('parsing:recent') as Promise<Array<Record<string, unknown>>>,
  },
  attendance: {
    today: (userId: number) =>
      ipcRenderer.invoke('attendance:today', userId) as Promise<Record<string, unknown> | null>,
    checkIn: (payload: { userId: number; note?: string }) =>
      ipcRenderer.invoke('attendance:checkIn', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        checkInAt?: string;
        already?: boolean;
      }>,
    checkOut: (payload: { userId: number; breakMin?: number; note?: string }) =>
      ipcRenderer.invoke('attendance:checkOut', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        checkOutAt?: string;
      }>,
    month: (payload: { userId: number; yyyymm: string }) =>
      ipcRenderer.invoke('attendance:month', payload) as Promise<Array<Record<string, unknown>>>,
    stats: (payload: { userId: number; yyyymm: string }) =>
      ipcRenderer.invoke('attendance:stats', payload) as Promise<{
        workedDays: number;
        totalMin: number;
        late: number;
        early: number;
        avgMin: number;
      }>,
  },
  leave: {
    list: (filter?: { userId?: number; status?: string }) =>
      ipcRenderer.invoke('leave:list', filter) as Promise<Array<Record<string, unknown>>>,
    balance: (userId: number) =>
      ipcRenderer.invoke('leave:balance', userId) as Promise<number>,
    create: (payload: {
      userId: number;
      kind: 'annual' | 'half_am' | 'half_pm' | 'sick' | 'special' | 'unpaid';
      startDate: string;
      endDate: string;
      reason?: string;
    }) =>
      ipcRenderer.invoke('leave:create', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        days?: number;
      }>,
    decide: (payload: {
      id: number;
      approverId: number;
      decision: 'approved' | 'rejected';
      comment?: string;
    }) =>
      ipcRenderer.invoke('leave:decide', payload) as Promise<{
        ok: boolean;
        error?: string;
        deducted?: number;
      }>,
    cancel: (payload: { id: number; userId: number }) =>
      ipcRenderer.invoke('leave:cancel', payload) as Promise<{ ok: boolean }>,
  },
  cs: {
    list: (filter?: { status?: string; assigneeId?: number; priority?: string }) =>
      ipcRenderer.invoke('cs:list', filter) as Promise<Array<Record<string, unknown>>>,
    get: (id: number) =>
      ipcRenderer.invoke('cs:get', id) as Promise<Record<string, unknown> | null>,
    create: (payload: {
      channel: 'phone' | 'email' | 'kakao' | 'other';
      studentCode?: string;
      inquirer?: string;
      subject: string;
      body?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      assigneeId?: number;
      relatedAssignmentId?: number;
      actorId: number;
    }) =>
      ipcRenderer.invoke('cs:create', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        code?: string;
      }>,
    update: (payload: {
      id: number;
      status?: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      assigneeId?: number | null;
      body?: string;
      actorId: number;
    }) =>
      ipcRenderer.invoke('cs:update', payload) as Promise<{ ok: boolean; error?: string }>,
    stats: () => ipcRenderer.invoke('cs:stats') as Promise<Record<string, number>>,
  },
  approvals: {
    list: (filter?: { drafterId?: number; approverId?: number; status?: string }) =>
      ipcRenderer.invoke('approvals:list', filter) as Promise<Array<Record<string, unknown>>>,
    get: (id: number) =>
      ipcRenderer.invoke('approvals:get', id) as Promise<Record<string, unknown> | null>,
    create: (payload: {
      drafterId: number;
      title: string;
      kind: string;
      payload?: Record<string, unknown>;
      approverIds: number[];
    }) =>
      ipcRenderer.invoke('approvals:create', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        code?: string;
      }>,
    decide: (payload: {
      approvalId: number;
      approverId: number;
      decision: 'approved' | 'rejected';
      comment?: string;
    }) =>
      ipcRenderer.invoke('approvals:decide', payload) as Promise<{
        ok: boolean;
        error?: string;
        finalStatus?: 'approved' | 'rejected' | 'pending';
      }>,
    withdraw: (payload: { approvalId: number; drafterId: number }) =>
      ipcRenderer.invoke('approvals:withdraw', payload) as Promise<{ ok: boolean }>,
  },
  board: {
    summary: () =>
      ipcRenderer.invoke('board:summary') as Promise<{
        byState: Array<{ state: string; n: number }>;
        overdue: number;
        risk: Record<string, number>;
      }>,
  },
  qa: {
    templates: (stage: 'QA1' | 'QA_FINAL') =>
      ipcRenderer.invoke('qa:templates', stage) as Promise<Array<Record<string, unknown>>>,
    submit: (payload: {
      assignmentId: number;
      stage: 'QA1' | 'QA_FINAL';
      reviewerId: number;
      result: 'approved' | 'rejected' | 'revision_requested';
      checklist: Record<string, { checked: boolean; note?: string }>;
      comment?: string;
    }) =>
      ipcRenderer.invoke('qa:submit', payload) as Promise<{
        ok: boolean;
        error?: string;
        nextState?: string;
      }>,
  },
  manuals: {
    list: () =>
      ipcRenderer.invoke('manuals:list') as Promise<Array<Record<string, unknown>>>,
    get: (slug: string) =>
      ipcRenderer.invoke('manuals:get', slug) as Promise<Record<string, unknown> | null>,
    save: (payload: {
      id?: number;
      slug: string;
      title: string;
      bodyMd: string;
      category?: string;
      authorId: number;
    }) =>
      ipcRenderer.invoke('manuals:save', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    delete: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('manuals:delete', payload) as Promise<{ ok: boolean }>,
  },
  reports: {
    kpi: () =>
      ipcRenderer.invoke('reports:kpi') as Promise<{
        assignmentsOpen: number;
        completedThisMonth: number;
        qaRejectRate: number;
        csOpen: number;
        csAvgMins: number;
        attendanceLate: number;
        pendingApprovals: number;
        daily: Array<{ d: string; n: number }>;
      }>,
  },
  logs: {
    list: (filter?: { action?: string; limit?: number }) =>
      ipcRenderer.invoke('logs:list', filter) as Promise<Array<Record<string, unknown>>>,
  },
  settings: {
    list: () =>
      ipcRenderer.invoke('settings:list') as Promise<
        Array<{ key: string; value_json: string; updated_at: string }>
      >,
    set: (payload: { key: string; valueJson: string; actorId: number }) =>
      ipcRenderer.invoke('settings:set', payload) as Promise<{ ok: boolean; error?: string }>,
  },
  users: {
    list: () =>
      ipcRenderer.invoke('users:list') as Promise<Array<Record<string, unknown>>>,
    update: (payload: {
      id: number;
      role?: string;
      departmentId?: number | null;
      title?: string | null;
      phone?: string | null;
      active?: boolean;
      leaveBalance?: number;
      actorId: number;
    }) =>
      ipcRenderer.invoke('users:update', payload) as Promise<{ ok: boolean; error?: string }>,
  },
  departments: {
    list: () =>
      ipcRenderer.invoke('departments:list') as Promise<
        Array<{ id: number; name: string; parent_id: number | null }>
      >,
  },
  noticesAdmin: {
    create: (payload: {
      authorId: number;
      title: string;
      bodyMd: string;
      audience?: string;
      pinned?: boolean;
    }) =>
      ipcRenderer.invoke('notices:create', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    archive: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('notices:archive', payload) as Promise<{ ok: boolean }>,
  },
  documents: {
    list: (folder?: string) =>
      ipcRenderer.invoke('documents:list', folder) as Promise<Array<Record<string, unknown>>>,
    create: (payload: {
      name: string;
      folder?: string;
      tags?: string;
      mimeType?: string;
      sizeBytes?: number;
      uploaderId: number;
    }) =>
      ipcRenderer.invoke('documents:create', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
  },
  updater: {
    status: () =>
      ipcRenderer.invoke('updater:status') as Promise<UpdaterStatusPayload>,
    check: () =>
      ipcRenderer.invoke('updater:check') as Promise<{ ok: boolean; error?: string }>,
    download: () =>
      ipcRenderer.invoke('updater:download') as Promise<{ ok: boolean; error?: string }>,
    install: () =>
      ipcRenderer.invoke('updater:install') as Promise<{ ok: boolean; error?: string }>,
    onStatus: (cb: (s: UpdaterStatusPayload) => void) => {
      const handler = (_e: unknown, payload: UpdaterStatusPayload) => cb(payload);
      ipcRenderer.on('updater:status', handler);
      return () => {
        ipcRenderer.removeListener('updater:status', handler);
      };
    },
  },
};

export type UpdaterStatusPayload =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string; releaseDate?: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

contextBridge.exposeInMainWorld('api', api);

export type EduOpsApi = typeof api;
