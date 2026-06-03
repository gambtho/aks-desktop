/*
 * Copyright (c) Microsoft Corporation.
 * Licensed under the Apache 2.0.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const FILE_NAME = 'installId.json';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InstallIdFile {
  installId: string;
  createdAt: string;
}

/**
 * Read the install UUID from `<userDataDir>/installId.json` or create a
 * fresh one if the file is missing, unreadable, or contains a value that
 * doesn't look like a v4 UUID.
 *
 * Called from the Electron main process. The renderer never touches the
 * file directly — it goes through the `'get-install-id'` IPC.
 */
export function getOrCreateInstallId(userDataDir: string): string {
  const filePath = path.join(userDataDir, FILE_NAME);

  const existing = tryReadValid(filePath);
  if (existing) return existing;

  const installId = randomUUID();
  const payload: InstallIdFile = { installId, createdAt: new Date().toISOString() };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return installId;
}

function tryReadValid(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<InstallIdFile>;
    if (typeof parsed.installId === 'string' && UUID_RE.test(parsed.installId)) {
      return parsed.installId;
    }
  } catch {
    // file missing, unreadable, or not JSON — fall through to regenerate
  }
  return undefined;
}
