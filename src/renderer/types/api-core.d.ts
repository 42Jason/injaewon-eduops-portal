interface EduOpsCoreApi {
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
    reviewFiles(assignmentId: number): Promise<Array<Record<string, unknown>>>;
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
      uploaderId?: number;
      filename: string;
    }): Promise<{
      ok: boolean;
      error?: string;
      created?: Array<{ code: string; rowNumber: number }>;
      skipped?: Array<{ rowNumber: number; reason: string }>;
    }>;
    recent(): Promise<Array<Record<string, unknown>>>;

    // ---- TA 업로드 워크큐 ------------------------------------------------
    uploadExcel(payload: {
      filename: string;
      buffer: ArrayBuffer | Uint8Array;
      mimeType?: string | null;
      note?: string | null;
      studentCode?: string | null;
      subject?: string | null;
      title?: string | null;
    }): Promise<{
      ok: boolean;
      error?: string;
      id?: number;
      storedPath?: string;
    }>;
    listUploads(filter?: {
      status?: 'pending' | 'consumed' | 'archived' | 'all';
      mineOnly?: boolean;
    }): Promise<
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
    >;
    downloadUpload(payload: { id: number }): Promise<{
      ok: boolean;
      error?: string;
      filename?: string;
      mimeType?: string;
      size?: number;
      buffer?: ArrayBuffer;
    }>;
    openUpload(payload: { id: number }): Promise<{ ok: boolean; error?: string }>;
    markConsumed(payload: { id: number; note?: string | null }): Promise<{
      ok: boolean;
      error?: string;
    }>;
    reopenUpload(payload: { id: number }): Promise<{ ok: boolean; error?: string }>;
    deleteUpload(payload: { id: number }): Promise<{ ok: boolean; error?: string }>;
    uploadsStats(): Promise<{
      pending: number;
      consumed: number;
      archived: number;
      total: number;
    }>;
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
      drafterId?: number;
      title: string;
      kind: string;
      payload?: Record<string, unknown>;
      approverIds: number[];
    }): Promise<{ ok: boolean; error?: string; id?: number; code?: string }>;
    decide(payload: {
      approvalId: number;
      approverId?: number;
      decision: 'approved' | 'rejected';
      comment?: string;
    }): Promise<{
      ok: boolean;
      error?: string;
      finalStatus?: 'approved' | 'rejected' | 'pending';
    }>;
    withdraw(payload: { approvalId: number; drafterId?: number }): Promise<{ ok: boolean }>;
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
      reviewerId?: number;
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
      authorId?: number;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    delete(payload: { id: number; actorId?: number }): Promise<{ ok: boolean }>;
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
      authorId?: number;
      title: string;
      bodyMd: string;
      audience?: string;
      pinned?: boolean;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    archive(payload: { id: number; actorId?: number }): Promise<{ ok: boolean }>;
  };
  documents: {
    list(folder?: string): Promise<Array<Record<string, unknown>>>;
    create(payload: {
      name: string;
      folder?: string;
      tags?: string;
      mimeType?: string;
      sizeBytes?: number;
      uploaderId?: number;
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
      userId?: number;
      logDate: string;
      summary: string;
      details?: string;
      tags?: string;
    }): Promise<{ ok: boolean; error?: string; id?: number }>;
    update(payload: {
      id: number;
      userId?: number;
      summary?: string;
      details?: string;
      tags?: string;
    }): Promise<{ ok: boolean; error?: string }>;
    delete(payload: {
      id: number;
      userId?: number;
    }): Promise<{ ok: boolean; error?: string }>;
  };

}
