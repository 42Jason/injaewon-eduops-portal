import { useEffect } from 'react';
import type { ArchiveCategory, TopicRow, TopicStatus } from './model';

// -----------------------------------------------------------------------------
// Tiny hook helpers — kept in-file to avoid over-abstraction.
// -----------------------------------------------------------------------------

export function useMemoDebounce(value: string, set: (s: string) => void, delay: number) {
  useEffect(() => {
    const id = setTimeout(() => set(value), delay);
    return () => clearTimeout(id);
  }, [value, delay, set]);
}

export function useMemoAutoSelect(
  rows: Array<{ id: number }>,
  selected: number | null,
  setSelected: (id: number | null) => void,
) {
  useEffect(() => {
    if (selected !== null) {
      if (!rows.some((r) => r.id === selected)) {
        setSelected(rows[0]?.id ?? null);
      }
      return;
    }
    if (rows.length > 0) setSelected(rows[0].id);
  }, [rows, selected, setSelected]);
}

export function useMemoResetModal(
  open: boolean,
  editing: TopicRow | null,
  setters: {
    setTitle: (s: string) => void;
    setSubject: (s: string) => void;
    setTopic: (s: string) => void;
    setStatus: (s: TopicStatus) => void;
    setAssignmentId: (s: number | null) => void;
    setDueAt: (s: string) => void;
    setSubmittedAt: (s: string) => void;
    setScore: (s: string) => void;
    setMemo: (s: string) => void;
    setTouched: (v: boolean) => void;
  },
) {
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setters.setTitle(editing.title ?? '');
      setters.setSubject(editing.subject ?? '');
      setters.setTopic(editing.topic ?? '');
      setters.setStatus(editing.status);
      setters.setAssignmentId(editing.assignment_id ?? null);
      setters.setDueAt(editing.due_at ? editing.due_at.slice(0, 10) : '');
      setters.setSubmittedAt(editing.submitted_at ? editing.submitted_at.slice(0, 10) : '');
      setters.setScore(editing.score ?? '');
      setters.setMemo(editing.memo ?? '');
    } else {
      setters.setTitle('');
      setters.setSubject('');
      setters.setTopic('');
      setters.setStatus('planned');
      setters.setAssignmentId(null);
      setters.setDueAt('');
      setters.setSubmittedAt('');
      setters.setScore('');
      setters.setMemo('');
    }
    setters.setTouched(false);
  }, [open, editing, setters]);
}

export function useMemoResetFileModal(
  open: boolean,
  defaultTopicId: number | null,
  setters: {
    setFile: (f: File | null) => void;
    setOriginalName: (s: string) => void;
    setCategory: (c: ArchiveCategory) => void;
    setTopicId: (id: number | null) => void;
    setDescription: (s: string) => void;
    setTouched: (v: boolean) => void;
  },
) {
  useEffect(() => {
    if (!open) return;
    setters.setFile(null);
    setters.setOriginalName('');
    setters.setCategory('report');
    setters.setTopicId(defaultTopicId);
    setters.setDescription('');
    setters.setTouched(false);
  }, [open, defaultTopicId, setters]);
}
