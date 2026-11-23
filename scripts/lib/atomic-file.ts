import { linkSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Publish a complete file from the same filesystem. Exclusive publication preserves an existing path. */
export function writeAtomicFile(
  destination: string,
  content: string,
  { mode = 0o666, exclusive = false } = {},
): void {
  const temporaryDirectory = mkdtempSync(join(dirname(destination), '.write-'));
  const temporary = join(temporaryDirectory, 'content');
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode, flag: 'wx' });
    if (exclusive) {
      linkSync(temporary, destination);
    } else {
      renameSync(temporary, destination);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
