// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from './openExternalUrl';

describe('openExternalUrl', () => {
  const originalRequire = window.require;
  const originalOpen = window.open;

  beforeEach(() => {
    window.open = vi.fn() as typeof window.open;
  });

  afterEach(() => {
    window.require = originalRequire;
    window.open = originalOpen;
  });

  it('does nothing for empty URLs', () => {
    openExternalUrl('');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does nothing for invalid URLs', () => {
    openExternalUrl('not a url');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does nothing for disallowed protocols', () => {
    // eslint-disable-next-line no-script-url
    openExternalUrl('javascript:alert(1)');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does nothing for ftp protocol', () => {
    openExternalUrl('ftp://example.com/file');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('falls back to window.open when Electron is not available', () => {
    window.require = undefined as typeof window.require;

    openExternalUrl('https://example.com');
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('calls shell.openExternal when running in Electron', () => {
    const mockOpenExternal = vi.fn().mockResolvedValue(undefined);
    window.require = vi.fn().mockReturnValue({
      shell: { openExternal: mockOpenExternal },
    }) as unknown as typeof window.require;

    openExternalUrl('https://example.com');
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('handles shell.openExternal rejection gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockOpenExternal = vi.fn().mockRejectedValue(new Error('denied'));
    window.require = vi.fn().mockReturnValue({
      shell: { openExternal: mockOpenExternal },
    }) as unknown as typeof window.require;

    openExternalUrl('https://example.com');

    // Flush microtasks so the .catch() handler runs
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to open external URL:',
        expect.any(Error)
      );
    });

    consoleErrorSpy.mockRestore();
  });

  it('allows http URLs', () => {
    window.require = undefined as typeof window.require;

    openExternalUrl('http://example.com');
    expect(window.open).toHaveBeenCalledWith(
      'http://example.com/',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
