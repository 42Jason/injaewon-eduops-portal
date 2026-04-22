interface EduOpsAdminApi {
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
      uploaderId?: number;
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
  trash: {
    list(filter?: {
      category?: string | null;
      tableName?: string | null;
      includePurged?: boolean;
      search?: string | null;
      limit?: number;
    }): Promise<
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
    >;
    stats(): Promise<{
      total: number;
      byCategory: Array<{
        category: string;
        categoryLabel: string;
        count: number;
        oldest: string | null;
      }>;
    }>;
    restore(payload: { id: number }): Promise<
      | { ok: true; restoredId: number | null; newId: boolean }
      | { ok: false; error: string }
    >;
    purge(payload: { ids: number[] }): Promise<
      { ok: true; purged: number } | { ok: false; error: string }
    >;
    purgeAll(payload?: { category?: string | null }): Promise<
      { ok: true; purged: number } | { ok: false; error: string }
    >;
  };
  notifications: {
    list(filter?: {
      userId?: number;
      status?: 'unread' | 'all';
      category?: string | null;
      limit?: number;
    }): Promise<
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
    >;
    stats(filter?: { userId?: number }): Promise<{
      total: number;
      byCategory: Array<{ category: string; count: number }>;
    }>;
    markRead(payload: {
      userId?: number;
      ids?: number[];
      all?: boolean;
      category?: string | null;
    }): Promise<
      { ok: true; updated: number } | { ok: false; error: string }
    >;
    dismiss(payload: { ids: number[] }): Promise<
      { ok: true; updated: number } | { ok: false; error: string }
    >;
    snooze(payload: { ids: number[]; until: string }): Promise<
      { ok: true; updated: number } | { ok: false; error: string }
    >;
  };
}
