import type { Database as Db } from 'better-sqlite3';

interface NotionArchiveFileRef {
  name: string;
  url: string;
  expires?: string;
  kind: 'draft' | 'final' | 'attachment';
}

interface SyncNotionArchiveFilesInput {
  assignmentId: number;
  studentId: number | null;
  files: NotionArchiveFileRef[];
  actorId: number | null;
  reportTitle?: string | null;
  subject?: string | null;
  sourceLabel?: string | null;
}

function archiveCategoryForNotionFile(kind: NotionArchiveFileRef['kind']) {
  if (kind === 'final') return 'report';
  if (kind === 'draft') return 'draft';
  return 'reference';
}

function buildDescription(input: {
  file: NotionArchiveFileRef;
  reportTitle?: string | null;
  subject?: string | null;
  sourceLabel?: string | null;
}) {
  const lines = [
    `source: Notion${input.sourceLabel ? ` (${input.sourceLabel})` : ''}`,
    `kind: ${input.file.kind}`,
  ];
  if (input.reportTitle) lines.push(`report: ${input.reportTitle}`);
  if (input.subject) lines.push(`subject: ${input.subject}`);
  if (input.file.expires) lines.push(`expires: ${input.file.expires}`);
  return lines.join('\n');
}

export function syncNotionAssignmentArchiveFiles(
  db: Db,
  input: SyncNotionArchiveFilesInput,
) {
  if (!input.studentId || input.files.length === 0) {
    db.prepare(
      `DELETE FROM student_archive_files
        WHERE source_assignment_id = ?
          AND auto_generated = 1
          AND stored_path LIKE 'http%'`,
    ).run(input.assignmentId);
    return 0;
  }

  const files = input.files.filter((file) => file.name?.trim() && file.url?.trim());
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM student_archive_files
        WHERE source_assignment_id = ?
          AND auto_generated = 1
          AND stored_path LIKE 'http%'`,
    ).run(input.assignmentId);

    const insert = db.prepare(
      `INSERT INTO student_archive_files (
          student_id, topic_id, category, original_name, stored_path,
          mime_type, size_bytes, description,
          source_assignment_id, auto_generated,
          uploaded_by
       ) VALUES (?, NULL, ?, ?, ?, NULL, NULL, ?, ?, 1, ?)`,
    );

    for (const file of files) {
      insert.run(
        input.studentId,
        archiveCategoryForNotionFile(file.kind),
        file.name.trim(),
        file.url.trim(),
        buildDescription({
          file,
          reportTitle: input.reportTitle,
          subject: input.subject,
          sourceLabel: input.sourceLabel,
        }),
        input.assignmentId,
        input.actorId,
      );
    }
  });

  tx();
  return files.length;
}
