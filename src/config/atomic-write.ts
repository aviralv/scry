import { promises as fs } from 'fs';

/**
 * Atomic write with backup. Sequence:
 *   1. If the target exists, copy it to <path>.bak (overwriting any prior .bak).
 *   2. Write content to <path>.tmp, fsync, close.
 *   3. Rename <path>.tmp → <path> (atomic on POSIX).
 * On any failure before the rename, the live file is untouched.
 */
export async function atomicWriteConfig(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  const bak = `${path}.bak`;

  // Verify target's parent is a directory we can write to (catches the
  // "target IS a directory" case before we touch any files).
  const stat = await fs.stat(path).catch(() => null);
  if (stat && stat.isDirectory()) {
    throw new Error(`Cannot write config: ${path} is a directory`);
  }

  if (stat) {
    await fs.copyFile(path, bak);
  }

  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }

  await fs.rename(tmp, path);
}
