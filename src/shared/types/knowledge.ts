export interface Notice {
  id: number;
  title: string;
  body: string;         // markdown
  authorId: number | null;
  authorName?: string;
  audience: string;     // 'ALL' | role | department id
  pinned: boolean;
  publishedAt: string;
  archivedAt?: string | null;
}

export interface ManualPage {
  id: number;
  slug: string;
  title: string;
  body: string;
  category: string | null;
  parentId: number | null;
  authorId: number | null;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface DocumentFile {
  id: number;
  name: string;
  storedPath: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  folder?: string | null;
  tags?: string | null;
  uploadedBy?: number | null;
  uploadedAt: string;
}

export interface CsTicket {
  id: number;
  code: string;
  channel: 'phone' | 'email' | 'kakao' | 'other';
  studentCode?: string | null;
  inquirer?: string | null;
  subject: string;
  body?: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  assigneeId?: number | null;
  relatedAssignmentId?: number | null;
  openedAt: string;
  resolvedAt?: string | null;
}
