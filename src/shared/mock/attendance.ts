import type { AttendanceRecord, LeaveRequest } from '../types/attendance';
import { MOCK_USERS } from './users';

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Build ~1 month of attendance for each user (weekdays only).
export function buildMockAttendance(): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let idCounter = 1;

  for (const u of MOCK_USERS) {
    for (let offset = 30; offset >= 0; offset--) {
      const d = new Date(today);
      d.setDate(d.getDate() - offset);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;

      // Skip a random-ish day to simulate leave (deterministic by uid+offset)
      if ((u.id + offset) % 17 === 0) continue;

      // Slight jitter on check-in / check-out
      const jitter = ((u.id * 7) + offset) % 15;
      const checkIn = `08:${String(45 + (jitter % 15)).padStart(2, '0')}`;
      const checkOut = offset === 0 ? null : `18:${String(jitter % 45).padStart(2, '0')}`;

      records.push({
        id: idCounter++,
        userId: u.id,
        workDate: ymd(d),
        checkIn,
        checkOut,
        breakMin: 60,
        note: null,
      });
    }
  }
  return records;
}

export const MOCK_ATTENDANCE: AttendanceRecord[] = buildMockAttendance();

export const MOCK_LEAVE_REQUESTS: LeaveRequest[] = [
  { id: 1,  userId: 5,  kind: 'annual',  startDate: '2026-04-22', endDate: '2026-04-22', days: 1,   reason: '개인 사유',           status: 'approved',  approverId: 3, decidedAt: '2026-04-10', createdAt: '2026-04-08' },
  { id: 2,  userId: 1,  kind: 'annual',  startDate: '2026-04-22', endDate: '2026-04-22', days: 1,   reason: '외부 일정',           status: 'approved',  approverId: 2, decidedAt: '2026-04-15', createdAt: '2026-04-12' },
  { id: 3,  userId: 7,  kind: 'half_pm', startDate: '2026-04-24', endDate: '2026-04-24', days: 0.5, reason: '병원 방문',           status: 'approved',  approverId: 3, decidedAt: '2026-04-18', createdAt: '2026-04-17' },
  { id: 4,  userId: 4,  kind: 'annual',  startDate: '2026-04-28', endDate: '2026-04-28', days: 1,   reason: '가족 행사',           status: 'pending',   approverId: null, decidedAt: null, createdAt: '2026-04-18' },
  { id: 5,  userId: 10, kind: 'annual',  startDate: '2026-04-28', endDate: '2026-04-29', days: 2,   reason: '개인 사유',           status: 'pending',   approverId: null, decidedAt: null, createdAt: '2026-04-18' },
  { id: 6,  userId: 6,  kind: 'sick',    startDate: '2026-04-14', endDate: '2026-04-14', days: 1,   reason: '감기',                 status: 'approved',  approverId: 3, decidedAt: '2026-04-14', createdAt: '2026-04-14' },
  { id: 7,  userId: 9,  kind: 'half_am', startDate: '2026-05-02', endDate: '2026-05-02', days: 0.5, reason: '자녀 학교 행사',       status: 'pending',   approverId: null, decidedAt: null, createdAt: '2026-04-17' },
  { id: 8,  userId: 8,  kind: 'annual',  startDate: '2026-05-06', endDate: '2026-05-08', days: 3,   reason: '여행',                 status: 'pending',   approverId: null, decidedAt: null, createdAt: '2026-04-19' },
  { id: 9,  userId: 3,  kind: 'special', startDate: '2026-04-30', endDate: '2026-04-30', days: 1,   reason: '결혼기념일',           status: 'approved',  approverId: 1, decidedAt: '2026-04-16', createdAt: '2026-04-15' },
  { id: 10, userId: 5,  kind: 'annual',  startDate: '2026-05-15', endDate: '2026-05-15', days: 1,   reason: '—',                    status: 'rejected',  approverId: 3, decidedAt: '2026-04-16', createdAt: '2026-04-14' },
];
