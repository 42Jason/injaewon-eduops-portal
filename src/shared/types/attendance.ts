export interface AttendanceRecord {
  id: number;
  userId: number;
  workDate: string;        // YYYY-MM-DD
  checkIn: string | null;  // ISO or HH:mm
  checkOut: string | null;
  breakMin: number;
  note?: string | null;
}

export type LeaveKind = 'annual' | 'half_am' | 'half_pm' | 'sick' | 'special' | 'unpaid';

export const LEAVE_KIND_LABELS: Record<LeaveKind, string> = {
  annual: '연차',
  half_am: '반차(오전)',
  half_pm: '반차(오후)',
  sick: '병가',
  special: '경조사',
  unpaid: '무급',
};

export interface LeaveRequest {
  id: number;
  userId: number;
  kind: LeaveKind;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approverId?: number | null;
  decidedAt?: string | null;
  createdAt: string;
}
