import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { writeAtomicFile } from './atomic-file.ts';

export const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;

/** Limit the decoded stream even if Content-Length is absent or describes compressed bytes. */
export async function readArtifactText(
  response: Response,
  allowedMediaTypes: readonly string[],
  maxBytes = MAX_ARTIFACT_BYTES,
): Promise<string> {
  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!mediaType || !allowedMediaTypes.includes(mediaType)) {
    await response.body?.cancel();
    throw new Error('Unexpected HTTP content type');
  }

  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) {
    await response.body?.cancel();
    throw new Error(`HTTP artifact exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(`HTTP artifact exceeds ${maxBytes} bytes`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

/** Require a direct child of the expected directory and reject symlinked directory components. */
export function writeArtifact(directory: string, destination: string, content: string): void {
  const expected = resolve(directory);
  const output = resolve(destination);
  if (dirname(output) !== expected || realpathSync(expected) !== expected) {
    throw new Error('HTTP artifact destination must be inside its expected directory');
  }
  writeAtomicFile(output, content);
}
