// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Opens a URL in the user's default browser via Electron shell if available,
 * falling back to window.open().
 *
 * Only `http://` and `https://` protocols are allowed for security.
 * Returns silently if the URL is empty or uses a disallowed protocol.
 */
export function openExternalUrl(url: string): void {
  if (!url) return;
  let normalizedUrl: string;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    normalizedUrl = parsed.href;
  } catch {
    return; // Invalid URL
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = window.require?.('electron');
    if (electron?.shell?.openExternal) {
      void electron.shell.openExternal(normalizedUrl).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.error('Failed to open external URL:', error);
      });
      return;
    }
  } catch {
    // Not running in Electron — fall through to window.open
  }
  window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
}
