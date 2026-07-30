import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { SourceFileHandle } from "../types";

// Milestone 1's source-file provider: a developer-supplied local path. The
// Drive-connector-based provider (driveFileId populated, discovery against
// the shared folder) is a separate, later implementation of the same
// interface shape — see docs/RIVER-RUN-INGESTION-ARCHITECTURE.md Section 2c.
// Nothing in the Sync Run orchestrator depends on which one supplied the file.
export async function loadLocalFile(path: string): Promise<SourceFileHandle> {
  const [bytesBuffer, stats] = await Promise.all([readFile(path), stat(path)]);
  const bytes = bytesBuffer.buffer.slice(
    bytesBuffer.byteOffset, bytesBuffer.byteOffset + bytesBuffer.byteLength,
  ) as ArrayBuffer;
  return {
    fileName: basename(path),
    lastModifiedAt: stats.mtime.toISOString(),
    driveFileId: null,
    bytes,
  };
}
