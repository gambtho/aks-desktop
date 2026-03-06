// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import type { Octokit } from '@octokit/rest';
import React, { useEffect, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { openExternalUrl } from '../../../utils/shared/openExternalUrl';
import type { GitHubAuthState } from '../types';
import { RepoSelector } from './RepoSelector';

const PERMISSIONS = [
  { name: 'Contents', purpose: 'Push agent config files' },
  { name: 'Workflows', purpose: 'Create setup workflow in .github/workflows/' },
  { name: 'Pull requests', purpose: '' },
  { name: 'Issues', purpose: '' },
  { name: 'Actions', purpose: '' },
];

interface ConnectSourceStepProps {
  authState: GitHubAuthState;
  onStartOAuth: () => void;
  octokit: Octokit | null;
  selectedRepo: GitHubRepo | null;
  onRepoSelect: (repo: GitHubRepo) => void;
  appInstallNeeded?: boolean;
  appInstallUrl?: string | null;
  isCheckingInstall?: boolean;
  /** Override from the wizard: auth was completed (state machine advanced past auth). */
  authCompleted?: boolean;
}

export function ConnectSourceStep({
  authState,
  onStartOAuth,
  octokit,
  selectedRepo,
  onRepoSelect,
  appInstallNeeded,
  appInstallUrl,
  isCheckingInstall,
  authCompleted,
}: ConnectSourceStepProps) {
  const { isAuthorizingBrowser, username, error } = authState;
  // Use authCompleted from the state machine if available — it's stable
  // and not subject to the cross-tree auth sync flicker.
  const isAuthenticated = authCompleted || authState.isAuthenticated;

  return (
    <Box sx={{ maxWidth: 600 }}>
      {/* GitHub Auth Section */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Icon icon="mdi:github" width={22} height={22} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Connect to GitHub
        </Typography>
      </Box>

      {isAuthenticated ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Box
            component={Icon}
            icon="mdi:check-circle"
            sx={{ color: 'success.main', fontSize: 18 }}
          />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Connected to &apos;{username}&apos;.
          </Typography>
        </Box>
      ) : (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Authorize AKS Desktop to create deployment pipelines in your repository.
          </Typography>

          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            Required Permissions
          </Typography>
          <Box sx={{ mb: 2 }}>
            {PERMISSIONS.map(perm => (
              <Box key={perm.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Box
                  component={Icon}
                  icon="mdi:check-circle-outline"
                  sx={{ fontSize: 16, color: 'text.secondary' }}
                />
                <Typography variant="body2">
                  <strong>{perm.name}</strong>
                  {perm.purpose && ` - ${perm.purpose}`}
                </Typography>
              </Box>
            ))}
          </Box>

          {isAuthorizingBrowser ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Box
                component={Icon}
                icon="mdi:open-in-new"
                sx={{ fontSize: 16, color: 'primary.main' }}
              />
              <Typography variant="body2" sx={{ color: 'primary.main' }}>
                Complete authorization on your browser screen
              </Typography>
            </Box>
          ) : (
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon icon="mdi:open-in-new" />}
              onClick={onStartOAuth}
              sx={{ textTransform: 'none', mb: 2 }}
            >
              Connect
            </Button>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
        </>
      )}

      {/* Repo Selector - shown after auth */}
      {isAuthenticated && octokit && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
            Select repository
          </Typography>
          <RepoSelector octokit={octokit} selectedRepo={selectedRepo} onRepoSelect={onRepoSelect} />

          {/* App install warning - shown inline below repo selector */}
          {appInstallNeeded && selectedRepo && (
            <AppInstallAlert
              selectedRepo={selectedRepo}
              appInstallUrl={appInstallUrl}
              isCheckingInstall={isCheckingInstall}
            />
          )}
        </>
      )}
    </Box>
  );
}

function AppInstallAlert({
  selectedRepo,
  appInstallUrl,
  isCheckingInstall,
}: {
  selectedRepo: GitHubRepo;
  appInstallUrl?: string | null;
  isCheckingInstall?: boolean;
}) {
  const [installClicked, setInstallClicked] = useState(false);
  // Brief flash when each poll check runs so the user sees activity
  const [showCheckingDot, setShowCheckingDot] = useState(false);

  useEffect(() => {
    if (!isCheckingInstall) return;
    setShowCheckingDot(true);
    const timer = setTimeout(() => setShowCheckingDot(false), 800);
    return () => clearTimeout(timer);
  }, [isCheckingInstall]);

  const handleInstallClick = () => {
    if (appInstallUrl) {
      openExternalUrl(appInstallUrl);
      setInstallClicked(true);
    }
  };

  const repoName = `${selectedRepo.owner}/${selectedRepo.repo}`;

  return (
    <Alert severity={installClicked ? 'info' : 'warning'} sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {installClicked
          ? `Complete the installation in your browser. This will update automatically once the app is installed on ${repoName}.`
          : `The AKS Desktop GitHub App must be installed on ${repoName} to continue.`}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {appInstallUrl && (
          <Button
            size="small"
            variant={installClicked ? 'text' : 'outlined'}
            onClick={handleInstallClick}
            sx={{ textTransform: 'none' }}
          >
            {installClicked ? 'Reopen install page' : 'Install GitHub App'}
          </Button>
        )}
        {installClicked && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
            <CircularProgress size={12} />
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                transition: 'opacity 0.3s',
                opacity: showCheckingDot ? 1 : 0.5,
              }}
            >
              Checking{showCheckingDot ? '...' : ''}
            </Typography>
          </Box>
        )}
      </Box>
    </Alert>
  );
}
