/**
 * Renderer-side type shims.
 *
 * The preload script installs `window.api` via `contextBridge`. We mirror the
 * shape here so the renderer can stay decoupled from the Electron process
 * (electron/ is outside the renderer tsconfig's include path).
 */

interface ApiUser {
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
}

interface EduOpsApi {
  app: {
    info(): Promise<{
      version: string;
      platform: string;
      dbPath: string;
      isDev: boolean;
    }>;
  };
  auth: {
    login(
      email: string,
      password: string,
    ): Promise<{ ok: boolean; user?: ApiUser; error?: string }>;
    logout(): Promise<{ ok: boolean }>;
    /** Validate the stored session against main — returns `{ ok: false }` if main has no matching actor. */
    me(): Promise<
      | {
          ok: true;
          actor: {
            userId: number;
            email: string;
            name: string;
            role: string;
            departmentId: number | null;
          };
        }
      | { ok: false }
    >;
  };
  assignments: {
    list(filter?: {
      state?: string;
      assignee?: number;
      search?: string;
      includeDeleted?: boolean;
      onlyDeleted?: boolean;
    }): Promise<Array<Record<string, unknown>>>;
    get(
      payload: number | { id: number; includeDeleted?: boolean },
    ): Promise<Record<string, unknown> | null>;
    setState(payload: {
      id: number;
      state: string;
      actorId: number;
      note?: string;
    }): Promise<{ ok: boolean; error?: string }>;
    parsingResult(assignmentId: number): Promise<Record<string, unknown> | null>;
    qaReviews(assignmentId: number): Promise<Array<Record<string, unknown>>>;
    create(payload: {
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
    }): Promise<{
      ok: boolean;
      error?: string;
      id?: number;
      code?: string;
      message?: string;
    }>;
    update(payload: {
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
    }): Promise<{ ok: boolean; error?: string; message?: string }>;
    softDelete(payload: {
      id: number;
      actorId: number | null;
    }): Promise<{ ok: boolean; error?: string }>;
    restore(payload: {
      id: number;
      actorId: number | null;
    }): Promise<{ ok: boolean; error?: string }>;
    bulkSetState(payload: {
      ids: number[];
      state: string;
      actorId: number | null;
    }): Promise<{ ok: boolean; error?: string; changed?: number }>;
    bulkAssign(payload: {
      ids: number[];
      parserId?: number | null;
      qa1Id?: number | null;
      qaFinalId?: number | null;
      actorId: number | null;
    }): Promise<{ ok: boolean; error?: string; changed?: number }>;
    bulkDelete(payload: {
      ids: number[];
      actorId: number | null;
    }): Promise<{ ok: boolean; error?: string; changed?: number }>;
  };
  notices: {
    list(): Promise<Array<Record<string, unknown>>>;
  };
  home: {
    stats(userId: number): Promise<{
      todayMine: number;
      dueToday: number;
      atRisk: number;
      rejected: number;
      awaitingApp: number;
      unreadNotice: number;
    }>;
  };
  parsing: {
    preview(payload: { buffer: ArrayBuffer | Uint8Array; filename: string }): Promise<{
      ok: boolean;
      error?: string;
      sheetName?: string;
      filename?: string;
      headerRow?: number;
      warnings?: string[];
      availableSheets?: string[];
      headerMap?: Record<string, number | null>;
      rows?: Array<ParsingPreviewRow>;
    }>;
    commit(payload: {
      rows: Array<Record<string, unknown>>;
      uploaderId: number;
      filename: string;
    }): Promise<{
      ok: boolean;
      error?: string;
      created?: Array<{ code: string; rowNumber: number }>;
      skipped?: Array<{ rowNumber: number; reason: string }>;
    }>;
    recent(): Promise<Array<Record<string, unknown>>>;
  };
  attendance: {
    today(userId: number): Promise<Record<string, unknown> | null>;
    checkIn(payload: { userId: number; note?: string }): Promise<{
      ok: boolean;
      error?: string;
      id?: number;
      checkInAt?: string;
      already?: boolean;
    }>;
    checkOut(payload: { userId: number; breakMin?: number; note?: string }): Promise<{
      ok: boolean;
      error?: string;
      id?: number;
      checkOutAt?: string;
    }>;
    month(payload: { userId: number; yyyymm: string }): Promise<Array<Record<string, unknown>>>;
    stats(payload: { userId: number; yyyymm: string }): Promise<{
      workedDays: number;
      totalMin: number;
      late: number;
      early: number;
      avgMin: number;
    }>;
  };
  leave: {
    list(filter?: { userId?: number; status?: string }): Promise<Array<Record<string, unknown>>>;
    balance(userId: number): Promise<number>;
    create(payload: {
      userId: number;
      kind: 'annual' | 'half_am' | 'half_pm' | 'sick' | 'special' | 'unpaid';
      startDate: string;
      endDate: string;
      reason?: string;
    }): Promise<{ ok: boolean; error?: string; id?: number; days?: number }>;
    decide(payload: {
      id: number;
      approverId: number;
      decision: 'approved' | 'rejected';
      comment?: string;
    }): Promise<{ ok: boolean; error?: string; deducted?: number }>;
    cancel(payload: { id: number; userId: number }): Promise<{ ok: boolean }>;
  };
  cs: {
    list(filter?: {
      status?: string;
      assigneeId?: number;
      priority?: string;
    }): Promise<Array<Record<string, unknown>>>;
    get(id: number): Promise<Record<string, unknown> | null>;
    create(payload: {
      channel: 'phone' | 'email' | 'kakao' | 'other';
      studentCode?: string;
      inquirer?: string;
      subject: string;
      body?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      assigneeId?: number;
      relatedAssignmentId?: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string; id?: number; code?: string }>;
    update(payload: {
      id: number;
      status?: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      assigneeId?: number | null;
      body?: string;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    stats(): Promise<Record<string, number>>;
  };
  approvals: {
    list(filter?: {
      drafterId?: number;
      approverId?: number;
      status?: string;
    }): Promise<Array<Record<string, unknown>>>;
    get(id: number): Promise<Record<string, unknown> | null>;
    create(payload: {
      drafterId: number;
      title: string;
      kind: string;
      payload?: Record<string, unknown>;
      approverIds: number[];
    }): Promise<{ ok: boolean; error?: string; id?: number; code?: string }>;
    decide(payload: {
      approvalId: number;
      approverId: number;
      decision: 'approved' | 'rejected';
      comment?: string;
    }): Promise<{
      ok: boolean;
      error?: string;
      finalStatus?: 'approved' | 'rejected' | 'pending';
    }>;
    withdraw(payload: { approvalId: number; drafterId: number }): Promise<{ ok: boolean }>;
  };
  board: {
    summary(): Promise<{
      byState: Array<{ state: string; n: number }>;
      overdue: number;
      risk: Record<string, number>;
    }>;
  };
  qa: {
    templates(stage: 'QA1' | 'QA_FINAL'): Promise<Array<Record<string, unknown>>>;
    submit(payload: {
      assignmentId: number;
      stage: 'QA1' | 'QA_FINAL';
      reviewerId: number;
      result: 'approved' | 'rejected' | 'revision_requested';
      checklist: Record<string, { checked: boolean; note?: string }>;
      comment?: string;
    }): Promise<{ ok: boolean; error?: string; nextState?: string }>;
  };
  manuals: {
    list(): Promise<Array<Record<string, unknown>>>;
    get(slug: string): Promise<Record<string, unknown> | null>;
    save(payload: {
      id?: number;
      slug: string;
      title: string;
      bodyMd: string;
      category?: string;
      authorId: number;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    delete(payload: { id: number; actorId: number }): Promise<{ ok: boolean }>;
  };
  reports: {
    kpi(): Promise<{
      assignmentsOpen: number;
      completedThisMonth: number;
      qaRejectRate: number;
      csOpen: number;
      csAvgMins: number;
      attendanceLate: number;
      pendingApprovals: number;
      daily: Array<{ d: string; n: number }>;
    }>;
  };
  logs: {
    list(filter?: { action?: string; limit?: number }): Promise<Array<Record<string, unknown>>>;
  };
  settings: {
    list(): Promise<Array<{ key: string; value_json: string; updated_at: string }>>;
    set(payload: {
      key: string;
      valueJson: string;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
  };
  users: {
    list(): Promise<Array<Record<string, unknown>>>;
    update(payload: {
      id: number;
      role?: string;
      departmentId?: number | null;
      title?: string | null;
      phone?: string | null;
      active?: boolean;
      leaveBalance?: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
  };
  departments: {
    list(): Promise<Array<{ id: number; name: string; parent_id: number | null }>>;
  };
  noticesAdmin: {
    create(payload: {
      authorId: number;
      title: string;
      bodyMd: string;
      audience?: string;
      pinned?: boolean;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    archive(payload: { id: number; actorId: number }): Promise<{ ok: boolean }>;
  };
  documents: {
    list(folder?: string): Promise<Array<Record<string, unknown>>>;
    create(payload: {
      name: string;
      folder?: string;
      tags?: string;
      mimeType?: string;
      sizeBytes?: number;
      uploaderId: number;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
  };
  workLogs: {
    list(filter?: {
      userId?: number;
      from?: string;
      to?: string;
      limit?: number;
    }): Promise<Array<Record<string, unknown>>>;
    create(payload: {
      userId: number;
      logDate: string;
      summary: string;
      details?: string;
      tags?: string;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    update(payload: {
      id: number;
      userId: number;
      summary?: string;
      details?: string;
      tags?: string;
    }): Promise<{ ok: boolean; error?: string }>;
    delete(payload: {
      id: number;
      userId: number;
    }): Promise<{ ok: boolean; error?: string }>;
  };
  tuition: {
    listStudents(filter?: {
      active?: boolean;
      search?: string;
    }): Promise<Array<Record<string, unknown>>>;
    updateStudentBilling(payload: {
      studentId: number;
      monthlyFee?: number;
      billingDay?: number;
      billingActive?: boolean;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    listInvoices(filter?: {
      period?: string;
      status?: string;
      studentId?: number;
    }): Promise<Array<Record<string, unknown>>>;
    generateMonthly(payload: {
      period: string;
      dueDate?: string;
      actorId: number;
      overwrite?: boolean;
    }): Promise<{
      ok: boolean;
      error?: string;
      created?: number;
      skipped?: number;
    }>;
    updateInvoice(payload: {
      id: number;
      baseAmount?: number;
      discount?: number;
      adjustment?: number;
      dueDate?: string | null;
      memo?: string | null;
      status?: 'unpaid' | 'partial' | 'paid' | 'waived' | 'cancelled';
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    recordPayment(payload: {
      invoiceId: number;
      amount: number;
      method: 'cash' | 'card' | 'transfer' | 'other';
      paidAt?: string;
      receiptNo?: string;
      note?: string;
      actorId: number;
    }): Promise<{
      ok: boolean;
      error?: string;
      paidAmount?: number;
      status?: string;
    }>;
    listPayments(invoiceId: number): Promise<Array<Record<string, unknown>>>;
    periodSummary(period: string): Promise<Record<string, number> | null>;
  };
  payroll: {
    listProfiles(): Promise<Array<Record<string, unknown>>>;
    getProfile(userId: number): Promise<Record<string, unknown> | null>;
    upsertProfile(payload: {
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
    }): Promise<{ ok: boolean; error?: string }>;
    listPeriods(): Promise<Array<Record<string, unknown>>>;
    ensurePeriod(payload: {
      period: string;
      payDate?: string | null;
      actorId: number;
    }): Promise<{
      ok: boolean;
      error?: string;
      id?: number;
      created?: boolean;
    }>;
    generatePayslips(payload: {
      periodId: number;
      overwriteDraft?: boolean;
      actorId: number;
    }): Promise<{
      ok: boolean;
      error?: string;
      created?: number;
      updated?: number;
      skipped?: number;
    }>;
    listPayslips(periodId: number): Promise<Array<Record<string, unknown>>>;
    getMyPayslips(userId: number): Promise<Array<Record<string, unknown>>>;
    updatePayslip(payload: {
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
    }): Promise<{ ok: boolean; error?: string }>;
    closePeriod(payload: {
      periodId: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    markPaid(payload: {
      periodId: number;
      paidAt?: string;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
  };
  subscriptions: {
    list(filter?: {
      status?: string;
      cardId?: number;
    }): Promise<Array<Record<string, unknown>>>;
    upsert(payload: {
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
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    setStatus(payload: {
      id: number;
      status: 'active' | 'paused' | 'cancelled';
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    monthlyForecast(): Promise<{ activeCount: number; monthlyTotal: number }>;
    delete(payload: {
      id: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
  };
  corpCards: {
    list(filter?: { status?: string }): Promise<Array<Record<string, unknown>>>;
    upsert(payload: {
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
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    setStatus(payload: {
      id: number;
      status: 'active' | 'frozen' | 'retired';
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    listTransactions(filter?: {
      cardId?: number;
      period?: string;
      reconciled?: boolean;
      limit?: number;
    }): Promise<Array<Record<string, unknown>>>;
    addTransaction(payload: {
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
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    setReconciled(payload: {
      id: number;
      reconciled: boolean;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    deleteTransaction(payload: {
      id: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    monthlySummary(period: string): Promise<Array<Record<string, unknown>>>;
  };
  students: {
    list(filter?: {
      q?: string;
      limit?: number;
      includeDeleted?: boolean;
    }): Promise<Array<Record<string, unknown>>>;
    get(studentId: number): Promise<Record<string, unknown> | null>;
    create(payload: {
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
    }): Promise<{
      ok: boolean;
      error?: string;
      id?: number;
      studentCode?: string;
      message?: string;
    }>;
    update(payload: {
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
    }): Promise<{ ok: boolean; error?: string }>;
    softDelete(payload: {
      id: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    restore(payload: {
      id: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    listGrades(studentId: number): Promise<Array<Record<string, unknown>>>;
    upsertGrade(payload: {
      id?: number;
      studentId: number;
      gradeLevel: string;
      semester: string;
      subject: string;
      score?: string | null;
      rawScore?: number | null;
      memo?: string | null;
      actorId: number;
    }): Promise<{
      ok: boolean;
      error?: string;
      id?: number;
      merged?: boolean;
    }>;
    deleteGrade(payload: {
      id: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    listCounseling(studentId: number): Promise<Array<Record<string, unknown>>>;
    upsertCounseling(payload: {
      id?: number;
      studentId: number;
      logDate: string;
      title: string;
      body?: string | null;
      category?: string | null;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    deleteCounseling(payload: {
      id: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    history(studentId: number): Promise<{
      assignments: Array<Record<string, unknown>>;
      parsings: Array<Record<string, unknown>>;
    }>;
    getParsingDetail(parsingId: number): Promise<Record<string, unknown> | null>;
    listReportTopics(studentId: number): Promise<Array<Record<string, unknown>>>;
    upsertReportTopic(payload: {
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
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    deleteReportTopic(payload: {
      id: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
    listArchiveFiles(filter: {
      studentId: number;
      topicId?: number | null;
    }): Promise<Array<Record<string, unknown>>>;
    addArchiveFile(payload: {
      studentId: number;
      topicId?: number | null;
      category?: 'report' | 'draft' | 'reference' | 'feedback' | 'other';
      originalName: string;
      storedPath?: string;
      mimeType?: string;
      sizeBytes?: number;
      description?: string | null;
      uploaderId: number;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    deleteArchiveFile(payload: {
      id: number;
      actorId: number;
    }): Promise<{ ok: boolean; error?: string }>;
  };
  notion: {
    getSettings(): Promise<{
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
    }>;
    saveSettings(payload: {
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
    }): Promise<{
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
    }>;
    probe(payload?: { actorId?: number | null }): Promise<
      | { ok: true; me: { id: string; name?: string | null } }
      | { ok: false; message: string }
    >;
    syncStudents(payload?: { actorId?: number | null }): Promise<{
      runId: number;
      kind: 'students';
      ok: boolean;
      inserted: number;
      updated: number;
      skipped: number;
      errors: number;
      message?: string;
    }>;
    syncStaff(payload?: { actorId?: number | null }): Promise<{
      runId: number;
      kind: 'staff';
      ok: boolean;
      inserted: number;
      updated: number;
      skipped: number;
      errors: number;
      message?: string;
    }>;
    syncAssignments(payload?: { actorId?: number | null }): Promise<{
      runId: number;
      kind: 'assignments';
      ok: boolean;
      inserted: number;
      updated: number;
      skipped: number;
      errors: number;
      message?: string;
    }>;
    listRuns(filter?: {
      limit?: number;
      kind?: 'students' | 'staff' | 'probe' | 'assignments';
    }): Promise<
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
    >;
  };
  updater: {
    status(): Promise<UpdaterStatus>;
    check(): Promise<{ ok: boolean; error?: string }>;
    download(): Promise<{ ok: boolean; error?: string }>;
    install(): Promise<{ ok: boolean; error?: string }>;
    onStatus(cb: (s: UpdaterStatus) => void): () => void;
  };
  release: {
    getConfig(): Promise<{
      ok: true;
      hasPat: boolean;
      repoOwner: string;
      repoName: string;
      workflowFile: string;
      currentVersion: string;
      encryptionAvailable: boolean;
    }>;
    setConfig(payload: {
      pat?: string | null;
      repoOwner?: string;
      repoName?: string;
      workflowFile?: string;
    }): Promise<{ ok: true } | { ok: false; error: string }>;
    clearConfig(): Promise<{ ok: true }>;
    trigger(payload: {
      bumpType: 'patch' | 'minor' | 'major';
      customVersion?: string | null;
      notes?: string | null;
    }): Promise<{ ok: true } | { ok: false; error: string; detail?: string }>;
    listRuns(payload?: { limit?: number }): Promise<
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
    >;
  };
}

interface Window {
  /** Available only inside Electron — undefined if running in a plain browser preview. */
  api?: EduOpsApi;
}

/** Re-declared globally so modules can reference `ParsingPreviewRow` without importing. */
interface ParsingPreviewRow {
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
}

type UpdaterStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string; releaseDate?: string }
  | { state: 'not-available'; version: string }
  | {
      state: 'downloading';
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

