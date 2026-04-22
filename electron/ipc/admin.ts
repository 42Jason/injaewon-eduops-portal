import { getDb } from '../db';
import { registerTuitionIpc } from './admin/tuition';
import { registerPayrollIpc } from './admin/payroll';
import { registerSubscriptionsIpc } from './admin/subscriptions';
import { registerCorporateCardsIpc } from './admin/corporate-cards';

export type AdminIpcDeps = {
  logActivity: (
    db: ReturnType<typeof getDb>,
    actorId: number | null,
    action: string,
    target: string,
    meta: Record<string, unknown>,
  ) => void;
  recordDeletion: (
    db: ReturnType<typeof getDb>,
    table: string,
    id: number,
    actorId: number | null,
    opts?: { reason?: string | null; label?: string | null; category?: string | null },
  ) => boolean;
  dismissEntityNotifications: (
    db: ReturnType<typeof getDb>,
    entityType: string,
    entityId: number,
  ) => void;
};

// Administrative IPC entrypoint: finance sections live in focused modules.
export function registerAdminIpc(deps: AdminIpcDeps) {
  registerTuitionIpc(deps);
  registerPayrollIpc(deps);
  registerSubscriptionsIpc(deps);
  registerCorporateCardsIpc(deps);
}
