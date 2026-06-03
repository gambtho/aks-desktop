// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getOrCreateInstallId } from '../install-id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'installid-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getOrCreateInstallId', () => {
  it('creates installId.json with a v4 UUID on first call', () => {
    const id = getOrCreateInstallId(tmpDir);
    expect(id).toMatch(UUID_RE);
    const file = JSON.parse(fs.readFileSync(path.join(tmpDir, 'installId.json'), 'utf8'));
    expect(file.installId).toBe(id);
    expect(typeof file.createdAt).toBe('string');
  });

  it('returns the same UUID across calls', () => {
    const first = getOrCreateInstallId(tmpDir);
    const second = getOrCreateInstallId(tmpDir);
    expect(second).toBe(first);
  });

  it('regenerates when the file is missing', () => {
    const first = getOrCreateInstallId(tmpDir);
    fs.unlinkSync(path.join(tmpDir, 'installId.json'));
    const second = getOrCreateInstallId(tmpDir);
    expect(second).not.toBe(first);
    expect(second).toMatch(UUID_RE);
  });

  it('regenerates when the file is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, 'installId.json'), 'not-json');
    const id = getOrCreateInstallId(tmpDir);
    expect(id).toMatch(UUID_RE);
  });

  it('regenerates when the stored value is not a valid UUID', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'installId.json'),
      JSON.stringify({ installId: 'garbage', createdAt: '2026-01-01' }),
    );
    const id = getOrCreateInstallId(tmpDir);
    expect(id).toMatch(UUID_RE);
    expect(id).not.toBe('garbage');
  });

  it('writes the file with restrictive permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    getOrCreateInstallId(tmpDir);
    const stat = fs.statSync(path.join(tmpDir, 'installId.json'));
    // Mask to permission bits; expect 0600.
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
