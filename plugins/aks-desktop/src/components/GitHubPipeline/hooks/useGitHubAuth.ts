// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createOctokitClient, getCurrentUser } from '../../../utils/github/github-api';
import {
  clearTokens,
  initiateDeviceFlow,
  isTokenExpired,
  loadTokens,
  refreshAccessToken,
  requestAccessToken,
  saveTokens,
  TokenResponse,
} from '../../../utils/github/github-auth';
import { openExternalUrl } from '../../../utils/shared/openExternalUrl';
import { GitHubAuthState } from '../types';

const INITIAL_AUTH_STATE: GitHubAuthState = {
  isAuthenticated: false,
  isRestoring: true,
  isAuthorizingDevice: false,
  token: null,
  refreshToken: null,
  expiresAt: null,
  userCode: null,
  verificationUri: null,
  username: null,
  error: null,
};

export interface UseGitHubAuthResult {
  authState: GitHubAuthState;
  octokit: Octokit | null;
  startDeviceFlow: () => void;
  reset: () => Promise<void>;
}

/**
 * Manages GitHub OAuth device flow authorization, token storage/refresh,
 * and Octokit client derivation.
 */
export const useGitHubAuth = (): UseGitHubAuthResult => {
  const [authState, setAuthState] = useState<GitHubAuthState>(INITIAL_AUTH_STATE);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAuthorizingRef = useRef(false);

  // Ref tracking the current token for cross-tree sync comparison.
  const authTokenRef = useRef<string | null>(null);
  useEffect(() => {
    authTokenRef.current = authState.token;
  }, [authState.token]);

  // Mutex for token refresh: ensures only one refresh request is in-flight at a time.
  // Concurrent callers share the same promise to avoid consuming single-use refresh tokens twice.
  const refreshInFlightRef = useRef<Promise<TokenResponse> | null>(null);

  const deduplicatedRefresh = useCallback((refreshToken: string): Promise<TokenResponse> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    const promise = refreshAccessToken(refreshToken).finally(() => {
      refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = promise;
    return promise;
  }, []);

  // Derive Octokit from token — not stored in useState (Octokit is not React state)
  const octokit = useMemo(
    () => (authState.token ? createOctokitClient(authState.token) : null),
    [authState.token]
  );

  useEffect(() => {
    const restoreSession = async () => {
      const stored = await loadTokens();
      if (!stored) {
        setAuthState(prev => ({ ...prev, isRestoring: false }));
        return;
      }

      let { accessToken, refreshToken: storedRefreshToken, expiresAt } = stored;

      if (isTokenExpired(expiresAt)) {
        try {
          const refreshed = await deduplicatedRefresh(storedRefreshToken);
          accessToken = refreshed.accessToken;
          storedRefreshToken = refreshed.refreshToken;
          expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
          await saveTokens({
            accessToken,
            refreshToken: storedRefreshToken,
            expiresAt,
          });
        } catch (error) {
          console.error('Failed to refresh GitHub token:', error);
          await clearTokens();
          setAuthState(prev => ({ ...prev, isRestoring: false }));
          return;
        }
      }

      try {
        const client = createOctokitClient(accessToken);
        const user = await getCurrentUser(client);
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: true,
          isRestoring: false,
          token: accessToken,
          refreshToken: storedRefreshToken,
          expiresAt,
          username: user.login,
        }));
      } catch (error) {
        console.error('Failed to restore GitHub session:', error);
        await clearTokens();
        setAuthState(prev => ({ ...prev, isRestoring: false }));
      }
    };

    restoreSession();
    return () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
      }
    };
  }, [deduplicatedRefresh]);

  // Proactive token refresh: check every 5 minutes whether the token needs refreshing.
  // Uses refs to avoid recreating the interval on every state change.
  const refreshTokenRef = useRef(authState.refreshToken);
  const expiresAtRef = useRef(authState.expiresAt);
  useEffect(() => {
    refreshTokenRef.current = authState.refreshToken;
    expiresAtRef.current = authState.expiresAt;
  }, [authState.refreshToken, authState.expiresAt]);

  useEffect(() => {
    if (!authState.isAuthenticated) return;

    const REFRESH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
    const intervalId = setInterval(async () => {
      const currentExpiresAt = expiresAtRef.current;
      const currentRefreshToken = refreshTokenRef.current;
      if (!currentExpiresAt || !currentRefreshToken) return;
      if (!isTokenExpired(currentExpiresAt)) return;

      try {
        const refreshed = await deduplicatedRefresh(currentRefreshToken);
        const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
        await saveTokens({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: newExpiresAt,
        });
        setAuthState(prev => ({
          ...prev,
          token: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: newExpiresAt,
        }));
        window.dispatchEvent(new Event('github-auth-update'));
      } catch (error) {
        console.error('Proactive token refresh failed:', error);
        await clearTokens();
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: false,
          token: null,
          refreshToken: null,
          expiresAt: null,
          error: 'Session expired. Please re-authenticate.',
        }));
        window.dispatchEvent(new Event('github-auth-update'));
      }
    }, REFRESH_CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [authState.isAuthenticated, deduplicatedRefresh]);

  // Cross-tree auth sync: each GitHubAuthProvider lives in an independent React tree
  // (Headlamp mounts each registered component separately). When one tree completes
  // auth or signs out, it dispatches 'github-auth-update'. Other trees pick up
  // the change from secure storage here.
  useEffect(() => {
    const handleAuthUpdate = async () => {
      if (isAuthorizingRef.current) return;

      const stored = await loadTokens();
      if (!stored) {
        // Tokens cleared by another tree — sign out
        setAuthState(prev =>
          prev.isAuthenticated ? { ...INITIAL_AUTH_STATE, isRestoring: false } : prev
        );
        return;
      }

      // Already have this token
      if (stored.accessToken === authTokenRef.current) return;
      if (isTokenExpired(stored.expiresAt)) return;

      try {
        const client = createOctokitClient(stored.accessToken);
        const user = await getCurrentUser(client);
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: true,
          isRestoring: false,
          isAuthorizingDevice: false,
          token: stored.accessToken,
          refreshToken: stored.refreshToken,
          expiresAt: stored.expiresAt,
          username: user.login,
          userCode: null,
          verificationUri: null,
          error: null,
        }));
      } catch {
        // Token invalid — ignore
      }
    };

    window.addEventListener('github-auth-update', handleAuthUpdate);
    return () => window.removeEventListener('github-auth-update', handleAuthUpdate);
  }, []);

  const startDeviceFlow = useCallback(async () => {
    if (isAuthorizingRef.current) return;
    isAuthorizingRef.current = true;
    try {
      const flow = await initiateDeviceFlow();

      setAuthState(prev => ({
        ...prev,
        isAuthorizingDevice: true,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        error: null,
      }));

      openExternalUrl(flow.verificationUri);

      let pollCount = 0;
      const maxPolls = Math.ceil(flow.expiresIn / flow.interval);
      let currentInterval = flow.interval;

      const poll = () => {
        pollRef.current = setTimeout(async () => {
          if (!isAuthorizingRef.current) return;
          pollCount++;
          try {
            const tokens = await requestAccessToken(flow.deviceCode);
            pollRef.current = null;
            isAuthorizingRef.current = false;

            const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
            await saveTokens({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt,
            });

            let user;
            try {
              const client = createOctokitClient(tokens.accessToken);
              user = await getCurrentUser(client);
            } catch (userErr) {
              await clearTokens();
              pollRef.current = null;
              isAuthorizingRef.current = false;
              console.error('Device flow: failed to fetch current user:', userErr);
              setAuthState(prev => ({
                ...prev,
                isAuthorizingDevice: false,
                error: userErr instanceof Error ? userErr.message : 'Failed to verify GitHub user',
                userCode: null,
                verificationUri: null,
              }));
              return;
            }

            setAuthState(prev => ({
              ...prev,
              isAuthenticated: true,
              isAuthorizingDevice: false,
              token: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt,
              username: user.login,
              userCode: null,
              verificationUri: null,
            }));
            window.dispatchEvent(new Event('github-auth-update'));
          } catch (error) {
            if (error instanceof Error && error.message === 'slow_down') {
              currentInterval += 5;
              poll();
              return;
            }
            if (error instanceof Error && error.message === 'authorization_pending') {
              if (pollCount >= maxPolls) {
                pollRef.current = null;
                isAuthorizingRef.current = false;
                setAuthState(prev => ({
                  ...prev,
                  isAuthorizingDevice: false,
                  error: 'Authorization timed out. Please try again.',
                  userCode: null,
                  verificationUri: null,
                }));
                return;
              }
              poll();
              return;
            }
            // Fatal error (expired_token, access_denied, or network error)
            pollRef.current = null;
            isAuthorizingRef.current = false;
            console.error('Device flow authorization failed:', error);
            setAuthState(prev => ({
              ...prev,
              isAuthorizingDevice: false,
              error: error instanceof Error ? error.message : 'Authorization failed',
              userCode: null,
              verificationUri: null,
            }));
          }
        }, currentInterval * 1000);
      };

      poll();
    } catch (error) {
      isAuthorizingRef.current = false;
      console.error('Failed to initiate device flow:', error);
      setAuthState(prev => ({
        ...prev,
        isAuthorizingDevice: false,
        error: error instanceof Error ? error.message : 'Failed to start authorization',
      }));
    }
  }, []);

  const reset = useCallback(async () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    isAuthorizingRef.current = false;
    await clearTokens();
    setAuthState({ ...INITIAL_AUTH_STATE, isRestoring: false });
    window.dispatchEvent(new Event('github-auth-update'));
  }, []);

  return { authState, octokit, startDeviceFlow, reset };
};
