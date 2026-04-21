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
    /**
     * Ask the main process whether this webContents still has a live session.
     * Renderer calls this on startup to validate any stored user before trusting
     * localStorage — a forged entry there has no matching session in main and
     * will get an `{ ok: false }` response.
     */
    me: () =>
      ipcRenderer.invoke('auth:me') as Promise<
        | { ok: true; actor: { userId: number; email: string; name: string; role: string; departmentId: number | null } }
        | { ok: false }
      >,
  },
  assignments: {
    list: (filter?: {
      state?: string;
      assignee?: number;
      search?: string;
      includeDeleted?: boolean;
      onlyDeleted?: boolean;
    }) =>
      ipcRenderer.invoke('assignments:list', filter) as Promise<Array<Record<string, unknown>>>,
    get: (payload: number | { id: number; includeDeleted?: boolean }) =>
      ipcRenderer.invoke('assignments:get', payload) as Promise<Record<string, unknown> | null>,
    setState: (payload: { id: number; state: string; actorId: number; note?: string }) =>
      ipcRenderer.invoke('assignments:setState', payload) as Promise<{ ok: boolean }>,
    parsingResult: (assignmentId: number) =>
      ipcRenderer.invoke('assignments:parsingResult', assignmentId) as Promise<Record<string, unknown> | null>,
    qaReviews: (assignmentId: number) =>
      ipcRenderer.invoke('assignments:qaReviews', assignmentId) as Promise<Array<Record<string, unknown>>>,
    create: (payload: {
      actorId: number | null;
      subject: string;
      title: string;
      studentId?: number | null;
      studentCode?: string | null;
      publisher?: string | null;
      scope?: string | null;
      lengthReq?: string | null;
      outline?: string | null;
      rubric?: string | null;
      teacherReq?: string | null;
      studentReq?: string | null;
      state?: string;
      risk?: 'low' | 'medium' | 'high';
      parserId?: number | null;
      qa1Id?: number | null;
      qaFinalId?: number | null;
      dueAt?: string | null;
    }) =>
      ipcRenderer.invoke('assignments:create', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        code?: string;
        message?: string;
      }>,
    update: (payload: {
      id: number;
      actorId: number | null;
      subject?: string;
      title?: string;
      publisher?: string | null;
      studentId?: number | null;
      studentCode?: string | null;
      scope?: string | null;
      lengthReq?: string | null;
      outline?: string | null;
      rubric?: string | null;
      teacherReq?: string | null;
      studentReq?: string | null;
      state?: string;
      risk?: 'low' | 'medium' | 'high';
      parserId?: number | null;
      qa1Id?: number | null;
      qaFinalId?: number | null;
      dueAt?: string | null;
    }) =>
      ipcRenderer.invoke('assignments:update', payload) as Promise<{
        ok: boolean;
        error?: string;
        message?: string;
      }>,
    softDelete: (payload: { id: number; actorId: number | null }) =>
      ipcRenderer.invoke('assignments:softDelete', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    restore: (payload: { id: number; actorId: number | null }) =>
      ipcRenderer.invoke('assignments:restore', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    bulkSetState: (payload: {
      ids: number[];
      state: string;
      actorId: number | null;
    }) =>
      ipcRenderer.invoke('assignments:bulkSetState', payload) as Promise<{
        ok: boolean;
        error?: string;
        changed?: number;
      }>,
    bulkAssign: (payload: {
      ids: number[];
      parserId?: number | null;
      qa1Id?: number | null;
      qaFinalId?: number | null;
      actorId: number | null;
    }) =>
      ipcRenderer.invoke('assignments:bulkAssign', payload) as Promise<{
        ok: boolean;
        error?: string;
        changed?: number;
      }>,
    bulkDelete: (payload: { ids: number[]; actorId: number | null }) =>
      ipcRenderer.invoke('assignments:bulkDelete', payload) as Promise<{
        ok: boolean;
        error?: string;
        changed?: number;
      }>,
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

    // ---- TA 업로드 워크큐 ------------------------------------------------
    uploadExcel: (payload: {
      filename: string;
      buffer: ArrayBuffer | Uint8Array;
      mimeType?: string | null;
      note?: string | null;
      studentCode?: string | null;
      subject?: string | null;
      title?: string | null;
    }) =>
      ipcRenderer.invoke('parsing:uploadExcel', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        storedPath?: string;
      }>,
    listUploads: (filter?: {
      status?: 'pending' | 'consumed' | 'archived' | 'all';
      mineOnly?: boolean;
    }) =>
      ipcRenderer.invoke('parsing:listUploads', filter) as Promise<
        Array<{
          id: number;
          uploader_user_id: number | null;
          original_name: string;
          stored_path: string;
          mime_type: string | null;
          size_bytes: number | null;
          note: string | null;
          student_code: string | null;
          subject: string | null;
          title: string | null;
          status: 'pending' | 'consumed' | 'archived';
          consumed_by_user_id: number | null;
          consumed_at: string | null;
          consumed_note: string | null;
          uploaded_at: string;
          uploader_name: string | null;
          consumer_name: string | null;
        }>
      >,
    downloadUpload: (payload: { id: number }) =>
      ipcRenderer.invoke('parsing:downloadUpload', payload) as Promise<{
        ok: boolean;
        error?: string;
        filename?: string;
        mimeType?: string;
        size?: number;
        buffer?: ArrayBuffer;
      }>,
    openUpload: (payload: { id: number }) =>
      ipcRenderer.invoke('parsing:openUpload', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    markConsumed: (payload: { id: number; note?: string | null }) =>
      ipcRenderer.invoke('parsing:markConsumed', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    reopenUpload: (payload: { id: number }) =>
      ipcRenderer.invoke('parsing:reopenUpload', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    deleteUpload: (payload: { id: number }) =>
      ipcRenderer.invoke('parsing:deleteUpload', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    uploadsStats: () =>
      ipcRenderer.invoke('parsing:uploadsStats') as Promise<{
        pending: number;
        consumed: number;
        archived: number;
        total: number;
      }>,
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
  workLogs: {
    list: (filter?: { userId?: number; from?: string; to?: string; limit?: number }) =>
      ipcRenderer.invoke('workLogs:list', filter) as Promise<Array<Record<string, unknown>>>,
    create: (payload: {
      userId: number;
      logDate: string;
      summary: string;
      details?: string;
      tags?: string;
    }) =>
      ipcRenderer.invoke('workLogs:create', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    update: (payload: {
      id: number;
      userId: number;
      summary?: string;
      details?: string;
      tags?: string;
    }) =>
      ipcRenderer.invoke('workLogs:update', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    delete: (payload: { id: number; userId: number }) =>
      ipcRenderer.invoke('workLogs:delete', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
  },
  tuition: {
    listStudents: (filter?: { active?: boolean; search?: string }) =>
      ipcRenderer.invoke('tuition:listStudents', filter) as Promise<Array<Record<string, unknown>>>,
    updateStudentBilling: (payload: {
      studentId: number;
      monthlyFee?: number;
      billingDay?: number;
      billingActive?: boolean;
      actorId: number;
    }) =>
      ipcRenderer.invoke('tuition:updateStudentBilling', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    listInvoices: (filter?: { period?: string; status?: string; studentId?: number }) =>
      ipcRenderer.invoke('tuition:listInvoices', filter) as Promise<Array<Record<string, unknown>>>,
    generateMonthly: (payload: {
      period: string;
      dueDate?: string;
      actorId: number;
      overwrite?: boolean;
    }) =>
      ipcRenderer.invoke('tuition:generateMonthly', payload) as Promise<{
        ok: boolean;
        error?: string;
        created?: number;
        skipped?: number;
      }>,
    updateInvoice: (payload: {
      id: number;
      baseAmount?: number;
      discount?: number;
      adjustment?: number;
      dueDate?: string | null;
      memo?: string | null;
      status?: 'unpaid' | 'partial' | 'paid' | 'waived' | 'cancelled';
      actorId: number;
    }) =>
      ipcRenderer.invoke('tuition:updateInvoice', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    recordPayment: (payload: {
      invoiceId: number;
      amount: number;
      method: 'cash' | 'card' | 'transfer' | 'other';
      paidAt?: string;
      receiptNo?: string;
      note?: string;
      actorId: number;
    }) =>
      ipcRenderer.invoke('tuition:recordPayment', payload) as Promise<{
        ok: boolean;
        error?: string;
        paidAmount?: number;
        status?: string;
      }>,
    listPayments: (invoiceId: number) =>
      ipcRenderer.invoke('tuition:listPayments', invoiceId) as Promise<Array<Record<string, unknown>>>,
    periodSummary: (period: string) =>
      ipcRenderer.invoke('tuition:periodSummary', period) as Promise<Record<string, number> | null>,
  },
  payroll: {
    listProfiles: () =>
      ipcRenderer.invoke('payroll:listProfiles') as Promise<Array<Record<string, unknown>>>,
    getProfile: (userId: number) =>
      ipcRenderer.invoke('payroll:getProfile', userId) as Promise<Record<string, unknown> | null>,
    upsertProfile: (payload: {
      userId: number;
      employmentType: 'regular' | 'freelancer' | 'parttime';
      baseSalary: number;
      positionAllowance: number;
      mealAllowance: number;
      transportAllowance: number;
      otherAllowance: number;
      dependentsCount: number;
      kidsUnder20: number;
      bankName?: string | null;
      bankAccount?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('payroll:upsertProfile', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    listPeriods: () =>
      ipcRenderer.invoke('payroll:listPeriods') as Promise<Array<Record<string, unknown>>>,
    ensurePeriod: (payload: { period: string; payDate?: string | null; actorId: number }) =>
      ipcRenderer.invoke('payroll:ensurePeriod', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        created?: boolean;
      }>,
    generatePayslips: (payload: {
      periodId: number;
      overwriteDraft?: boolean;
      actorId: number;
    }) =>
      ipcRenderer.invoke('payroll:generatePayslips', payload) as Promise<{
        ok: boolean;
        error?: string;
        created?: number;
        updated?: number;
        skipped?: number;
      }>,
    listPayslips: (periodId: number) =>
      ipcRenderer.invoke('payroll:listPayslips', periodId) as Promise<Array<Record<string, unknown>>>,
    getMyPayslips: (userId: number) =>
      ipcRenderer.invoke('payroll:getMyPayslips', userId) as Promise<Array<Record<string, unknown>>>,
    updatePayslip: (payload: {
      id: number;
      patch: Partial<{
        overtimePay: number;
        bonus: number;
        otherTaxable: number;
        otherNontaxable: number;
        otherDeduction: number;
        memo: string | null;
      }>;
      actorId: number;
    }) =>
      ipcRenderer.invoke('payroll:updatePayslip', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    closePeriod: (payload: { periodId: number; actorId: number }) =>
      ipcRenderer.invoke('payroll:closePeriod', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    markPaid: (payload: { periodId: number; paidAt?: string; actorId: number }) =>
      ipcRenderer.invoke('payroll:markPaid', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
  },
  subscriptions: {
    list: (filter?: { status?: string; cardId?: number }) =>
      ipcRenderer.invoke('subscriptions:list', filter) as Promise<Array<Record<string, unknown>>>,
    upsert: (payload: {
      id?: number;
      vendor: string;
      plan?: string | null;
      category?: string | null;
      amount: number;
      currency?: string;
      cadence: 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'custom';
      cadenceDays?: number | null;
      nextChargeAt?: string | null;
      cardId?: number | null;
      ownerUserId?: number | null;
      status?: 'active' | 'paused' | 'cancelled';
      startedAt?: string | null;
      memo?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('subscriptions:upsert', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    setStatus: (payload: {
      id: number;
      status: 'active' | 'paused' | 'cancelled';
      actorId: number;
    }) =>
      ipcRenderer.invoke('subscriptions:setStatus', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    monthlyForecast: () =>
      ipcRenderer.invoke('subscriptions:monthlyForecast') as Promise<{
        activeCount: number;
        monthlyTotal: number;
      }>,
    delete: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('subscriptions:delete', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
  },
  corpCards: {
    list: (filter?: { status?: string }) =>
      ipcRenderer.invoke('corpCards:list', filter) as Promise<Array<Record<string, unknown>>>,
    upsert: (payload: {
      id?: number;
      alias: string;
      brand?: string | null;
      issuer?: string | null;
      last4: string;
      holderUserId?: number | null;
      ownerUserId?: number | null;
      monthlyLimit: number;
      statementDay: number;
      status?: 'active' | 'frozen' | 'retired';
      memo?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('corpCards:upsert', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    setStatus: (payload: {
      id: number;
      status: 'active' | 'frozen' | 'retired';
      actorId: number;
    }) =>
      ipcRenderer.invoke('corpCards:setStatus', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    listTransactions: (filter?: {
      cardId?: number;
      period?: string;
      reconciled?: boolean;
      limit?: number;
    }) =>
      ipcRenderer.invoke('corpCards:listTransactions', filter) as Promise<Array<Record<string, unknown>>>,
    addTransaction: (payload: {
      cardId: number;
      spentAt: string;
      merchant: string;
      category?: string | null;
      amount: number;
      currency?: string;
      note?: string | null;
      subscriptionId?: number | null;
      receiptPath?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('corpCards:addTransaction', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    setReconciled: (payload: { id: number; reconciled: boolean; actorId: number }) =>
      ipcRenderer.invoke('corpCards:setReconciled', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    deleteTransaction: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('corpCards:deleteTransaction', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    monthlySummary: (period: string) =>
      ipcRenderer.invoke('corpCards:monthlySummary', period) as Promise<Array<Record<string, unknown>>>,
  },
  students: {
    list: (filter?: { q?: string; limit?: number; includeDeleted?: boolean }) =>
      ipcRenderer.invoke('students:list', filter) as Promise<Array<Record<string, unknown>>>,
    get: (studentId: number) =>
      ipcRenderer.invoke('students:get', studentId) as Promise<Record<string, unknown> | null>,
    create: (payload: {
      studentCode?: string | null;
      name: string;
      grade?: string | null;
      school?: string | null;
      schoolNo?: string | null;
      phone?: string | null;
      guardian?: string | null;
      guardianPhone?: string | null;
      gradeMemo?: string | null;
      memo?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('students:create', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        studentCode?: string;
        message?: string;
      }>,
    update: (payload: {
      id: number;
      name?: string;
      grade?: string | null;
      school?: string | null;
      schoolNo?: string | null;
      phone?: string | null;
      guardian?: string | null;
      guardianPhone?: string | null;
      gradeMemo?: string | null;
      memo?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('students:update', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    softDelete: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('students:softDelete', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    restore: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('students:restore', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    listGrades: (studentId: number) =>
      ipcRenderer.invoke('students:listGrades', studentId) as Promise<
        Array<Record<string, unknown>>
      >,
    upsertGrade: (payload: {
      id?: number;
      studentId: number;
      gradeLevel: string;
      semester: string;
      subject: string;
      score?: string | null;
      rawScore?: number | null;
      memo?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('students:upsertGrade', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
        merged?: boolean;
      }>,
    deleteGrade: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('students:deleteGrade', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    listCounseling: (studentId: number) =>
      ipcRenderer.invoke('students:listCounseling', studentId) as Promise<
        Array<Record<string, unknown>>
      >,
    upsertCounseling: (payload: {
      id?: number;
      studentId: number;
      logDate: string;
      title: string;
      body?: string | null;
      category?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('students:upsertCounseling', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    deleteCounseling: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('students:deleteCounseling', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    history: (studentId: number) =>
      ipcRenderer.invoke('students:history', studentId) as Promise<{
        assignments: Array<Record<string, unknown>>;
        parsings: Array<Record<string, unknown>>;
      }>,
    getParsingDetail: (parsingId: number) =>
      ipcRenderer.invoke('students:getParsingDetail', parsingId) as Promise<
        Record<string, unknown> | null
      >,
    listReportTopics: (studentId: number) =>
      ipcRenderer.invoke('students:listReportTopics', studentId) as Promise<
        Array<Record<string, unknown>>
      >,
    upsertReportTopic: (payload: {
      id?: number;
      studentId: number;
      title: string;
      subject?: string | null;
      topic?: string | null;
      status?: 'planned' | 'in_progress' | 'submitted' | 'graded' | 'archived' | 'cancelled';
      assignmentId?: number | null;
      dueAt?: string | null;
      submittedAt?: string | null;
      score?: string | null;
      memo?: string | null;
      actorId: number;
    }) =>
      ipcRenderer.invoke('students:upsertReportTopic', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    deleteReportTopic: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('students:deleteReportTopic', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    listArchiveFiles: (filter: { studentId: number; topicId?: number | null }) =>
      ipcRenderer.invoke('students:listArchiveFiles', filter) as Promise<
        Array<Record<string, unknown>>
      >,
    addArchiveFile: (payload: {
      studentId: number;
      topicId?: number | null;
      category?: 'report' | 'draft' | 'reference' | 'feedback' | 'other';
      originalName: string;
      storedPath?: string;
      mimeType?: string;
      sizeBytes?: number;
      description?: string | null;
      uploaderId: number;
    }) =>
      ipcRenderer.invoke('students:addArchiveFile', payload) as Promise<{
        ok: boolean;
        error?: string;
        id?: number;
      }>,
    deleteArchiveFile: (payload: { id: number; actorId: number }) =>
      ipcRenderer.invoke('students:deleteArchiveFile', payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
  },
  notion: {
    getSettings: () =>
      ipcRenderer.invoke('notion:getSettings') as Promise<{
        isConfigured: boolean;
        tokenMasked: string;
        studentDatabases: Array<{
          id: string;
          label?: string;
          contactField?: string;
          guardianField?: string;
        }>;
        assignmentDatabases: Array<{
          id: string;
          label?: string;
          subjectField?: string;
          titleField?: string;
          statusField?: string;
          parserField?: string;
          qa1Field?: string;
          qaFinalField?: string;
          dueField?: string;
        }>;
      }>,
    saveSettings: (payload: {
      token?: string;
      studentDatabases?: Array<{
        id: string;
        label?: string;
        contactField?: string;
        guardianField?: string;
      }>;
      assignmentDatabases?: Array<{
        id: string;
        label?: string;
        subjectField?: string;
        titleField?: string;
        statusField?: string;
        parserField?: string;
        qa1Field?: string;
        qaFinalField?: string;
        dueField?: string;
      }>;
      actorId?: number | null;
    }) =>
      ipcRenderer.invoke('notion:saveSettings', payload) as Promise<{
        ok: boolean;
        error?: string;
        studentDatabases?: Array<{
          id: string;
          label?: string;
          contactField?: string;
          guardianField?: string;
        }>;
        assignmentDatabases?: Array<{
          id: string;
          label?: string;
          subjectField?: string;
          titleField?: string;
          statusField?: string;
          parserField?: string;
          qa1Field?: string;
          qaFinalField?: string;
          dueField?: string;
        }>;
      }>,
    probe: (payload?: { actorId?: number | null }) =>
      ipcRenderer.invoke('notion:probe', payload) as Promise<
        | { ok: true; me: { id: string; name?: string | null } }
        | { ok: false; message: string }
      >,
    syncStudents: (payload?: { actorId?: number | null }) =>
      ipcRenderer.invoke('notion:syncStudents', payload) as Promise<{
        runId: number;
        kind: 'students';
        ok: boolean;
        inserted: number;
        updated: number;
        skipped: number;
        errors: number;
        message?: string;
      }>,
    syncStaff: (payload?: { actorId?: number | null }) =>
      ipcRenderer.invoke('notion:syncStaff', payload) as Promise<{
        runId: number;
        kind: 'staff';
        ok: boolean;
        inserted: number;
        updated: number;
        skipped: number;
        errors: number;
        message?: string;
      }>,
    syncAssignments: (payload?: { actorId?: number | null }) =>
      ipcRenderer.invoke('notion:syncAssignments', payload) as Promise<{
        runId: number;
        kind: 'assignments';
        ok: boolean;
        inserted: number;
        updated: number;
        skipped: number;
        errors: number;
        message?: string;
      }>,
    listRuns: (filter?: {
      limit?: number;
      kind?: 'students' | 'staff' | 'probe' | 'assignments';
    }) =>
      ipcRenderer.invoke('notion:listRuns', filter) as Promise<
        Array<{
          id: number;
          kind: 'students' | 'staff' | 'probe' | 'assignments';
          started_at: string;
          finished_at: string | null;
          ok: number;
          inserted: number;
          updated: number;
          skipped: number;
          errors: number;
          message: string | null;
          triggered_by: number | null;
        }>
      >,
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
  release: {
    getConfig: () =>
      ipcRenderer.invoke('release:getConfig') as Promise<{
        ok: true;
        hasPat: boolean;
        repoOwner: string;
        repoName: string;
        workflowFile: string;
        currentVersion: string;
        encryptionAvailable: boolean;
      }>,
    setConfig: (payload: {
      pat?: string | null;
      repoOwner?: string;
      repoName?: string;
      workflowFile?: string;
    }) =>
      ipcRenderer.invoke('release:setConfig', payload) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    clearConfig: () =>
      ipcRenderer.invoke('release:clearConfig') as Promise<{ ok: true }>,
    trigger: (payload: {
      bumpType: 'patch' | 'minor' | 'major';
      customVersion?: string | null;
      notes?: string | null;
    }) =>
      ipcRenderer.invoke('release:trigger', payload) as Promise<
        { ok: true } | { ok: false; error: string; detail?: string }
      >,
    listRuns: (payload?: { limit?: number }) =>
      ipcRenderer.invoke('release:listRuns', payload ?? {}) as Promise<
        | {
            ok: true;
            runs: Array<{
              id: number;
              name: string;
              title: string;
              branch: string;
              sha: string;
              status: string;
              conclusion: string;
              event: string;
              url: string;
              createdAt: string;
              updatedAt: string;
              path: string;
            }>;
          }
        | { ok: false; error: string; detail?: string }
      >,
  },
  trash: {
    list: (filter?: {
      category?: string | null;
      tableName?: string | null;
      includePurged?: boolean;
      search?: string | null;
      limit?: number;
    }) =>
      ipcRenderer.invoke('trash:list', filter ?? {}) as Promise<
        Array<{
          id: number;
          tableName: string;
          rowId: number | null;
          category: string;
          categoryLabel: string;
          label: string | null;
          reason: string | null;
          deletedBy: number | null;
          deletedByName: string | null;
          deletedAt: string;
          purgedAt: string | null;
          payloadPreview: Record<string, string>;
        }>
      >,
    stats: () =>
      ipcRenderer.invoke('trash:stats') as Promise<{
        total: number;
        byCategory: Array<{
          category: string;
          categoryLabel: string;
          count: number;
          oldest: string | null;
        }>;
      }>,
    restore: (payload: { id: number }) =>
      ipcRenderer.invoke('trash:restore', payload) as Promise<
        | { ok: true; restoredId: number | null; newId: boolean }
        | { ok: false; error: string }
      >,
    purge: (payload: { ids: number[] }) =>
      ipcRenderer.invoke('trash:purge', payload) as Promise<
        { ok: true; purged: number } | { ok: false; error: string }
      >,
    purgeAll: (payload?: { category?: string | null }) =>
      ipcRenderer.invoke('trash:purgeAll', payload ?? {}) as Promise<
        { ok: true; purged: number } | { ok: false; error: string }
      >,
  },
  notifications: {
    list: (filter?: {
      userId?: number;
      status?: 'unread' | 'all';
      category?: string | null;
      limit?: number;
    }) =>
      ipcRenderer.invoke('notifications:list', filter ?? {}) as Promise<
        Array<{
          id: number;
          userId: number;
          category: string;
          kind: string;
          title: string;
          body: string | null;
          link: string | null;
          entityTable: string | null;
          entityId: number | null;
          dedupeKey: string | null;
          priority: number;
          payload: Record<string, unknown> | null;
          createdAt: string;
          readAt: string | null;
          snoozeUntil: string | null;
          dismissedAt: string | null;
        }>
      >,
    stats: (filter?: { userId?: number }) =>
      ipcRenderer.invoke('notifications:stats', filter ?? {}) as Promise<{
        total: number;
        byCategory: Array<{ category: string; count: number }>;
      }>,
    markRead: (payload: {
      userId?: number;
      ids?: number[];
      all?: boolean;
      category?: string | null;
    }) =>
      ipcRenderer.invoke('notifications:markRead', payload) as Promise<
        { ok: true; updated: number } | { ok: false; error: string }
      >,
    dismiss: (payload: { ids: number[] }) =>
      ipcRenderer.invoke('notifications:dismiss', payload) as Promise<
        { ok: true; updated: number } | { ok: false; error: string }
      >,
    snooze: (payload: { ids: number[]; until: string }) =>
      ipcRenderer.invoke('notifications:snooze', payload) as Promise<
        { ok: true; updated: number } | { ok: false; error: string }
      >,
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
