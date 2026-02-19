// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Badge, Box, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useGitHubAuthContext } from '../GitHubAuthContext';

/**
 * Small icon button showing GitHub auth status. Placed in the project header
 * so users can sign in / see sign-in status from anywhere in the project.
 */
export function GitHubAuthStatusButton() {
  const { authState, startDeviceFlow } = useGitHubAuthContext();

  if (authState.isRestoring) {
    return (
      <Tooltip title="Connecting to GitHub...">
        <IconButton size="small">
          <CircularProgress size={18} />
        </IconButton>
      </Tooltip>
    );
  }

  if (authState.isAuthenticated) {
    return (
      <Tooltip title={`GitHub: ${authState.username}`}>
        <IconButton size="small">
          <Badge
            variant="dot"
            color="success"
            overlap="circular"
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          >
            <Icon icon="mdi:github" style={{ fontSize: 22 }} />
          </Badge>
        </IconButton>
      </Tooltip>
    );
  }

  if (authState.isAuthorizingDevice && authState.userCode) {
    return (
      <Tooltip
        title={
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2">Enter code on GitHub:</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, mt: 0.5 }}>
              {authState.userCode}
            </Typography>
          </Box>
        }
      >
        <IconButton size="small">
          <CircularProgress size={18} />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Tooltip title="Sign in to GitHub">
      <IconButton size="small" onClick={startDeviceFlow}>
        <Icon icon="mdi:github" style={{ fontSize: 22, opacity: 0.5 }} />
      </IconButton>
    </Tooltip>
  );
}
