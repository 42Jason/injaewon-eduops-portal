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

interface EduOpsApi extends EduOpsCoreApi, EduOpsAdminApi {}

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
