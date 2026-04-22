import { app } from 'electron';
import path from 'node:path';

export function resolveUserDataPath(storedPath: string): string {
  const base = path.resolve(app.getPath('userData'));
  const absolutePath = path.resolve(base, storedPath);
  const relativePath = path.relative(base, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('forbidden_path');
  }
  return absolutePath;
}
