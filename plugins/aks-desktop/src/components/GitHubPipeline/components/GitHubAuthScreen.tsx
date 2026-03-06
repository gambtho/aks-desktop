// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { GitHubAuthState } from '../types';

interface GitHubAuthScreenProps {
  authState: GitHubAuthState;
  onStartOAuth: () => void;
  onCancel: () => void;
  onContinue: () => void;
}

const PERMISSIONS = [
  { name: 'Contents', level: 'write', purpose: 'Push agent config files' },
  { name: 'Workflows', level: 'write', purpose: 'Create setup workflow in .github/workflows/' },
  { name: 'Pull requests', level: 'write', purpose: 'Create setup PR' },
  { name: 'Issues', level: 'write', purpose: 'Trigger Copilot agent' },
  { name: 'Actions', level: 'write', purpose: 'Monitor and trigger workflow runs' },
];

export function GitHubAuthScreen({
  authState,
  onStartOAuth,
  onCancel,
  onContinue,
}: GitHubAuthScreenProps) {
  const { isAuthenticated, isAuthorizingBrowser, username, error } = authState;

  // Auto-advance after authentication
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useEffect(() => {
    if (!isAuthenticated) return;
    setAutoAdvancing(true);
    timerRef.current = setTimeout(() => {
      onContinueRef.current();
    }, 1500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAuthenticated]);

  if (isAuthenticated) {
    return (
      <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
        <CardContent>
          <Box
            component={Icon}
            icon="mdi:check-circle"
            sx={{ fontSize: 64, color: 'success.main', mb: 2, display: 'block', mx: 'auto' }}
          />
          <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
            Connected to GitHub
          </Typography>
          <Typography variant="body1" sx={{ mb: 1, color: 'text.secondary' }}>
            Signed in as <strong>{username}</strong>
          </Typography>
          {autoAdvancing && (
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              Continuing...
            </Typography>
          )}
          <Button
            variant="contained"
            color="primary"
            onClick={onContinue}
            sx={{ minWidth: 200, py: 1.5, px: 4, textTransform: 'none', fontSize: 16 }}
          >
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isAuthorizingBrowser) {
    return (
      <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
        <CardContent>
          <Box
            component={Icon}
            icon="mdi:github"
            sx={{ fontSize: 48, mb: 2, display: 'block', mx: 'auto' }}
          />
          <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
            Authorize on GitHub
          </Typography>
          <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
            Complete authorization in your browser to continue
          </Typography>

          <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={24} sx={{ mr: 1.5 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Waiting for browser authorization...
            </Typography>
          </Box>

          <Button
            variant="outlined"
            color="secondary"
            onClick={onCancel}
            sx={{ textTransform: 'none', fontSize: 14 }}
          >
            Cancel
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
      <CardContent>
        <Box
          component={Icon}
          icon="mdi:github"
          sx={{ fontSize: 64, mb: 2, display: 'block', mx: 'auto' }}
        />
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
          Connect to GitHub
        </Typography>
        <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
          Authorize AKS Desktop to create deployment pipelines in your repositories
        </Typography>

        <Box sx={{ mb: 3, textAlign: 'left' }}>
          <Typography variant="body2" sx={{ mb: 1.5, fontWeight: 600 }}>
            Required permissions:
          </Typography>
          {PERMISSIONS.map(perm => (
            <Box key={perm.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <Chip label={perm.level} size="small" variant="outlined" sx={{ minWidth: 48 }} />
              <Typography variant="body2">
                <strong>{perm.name}</strong> — {perm.purpose}
              </Typography>
            </Box>
          ))}
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
            {error}
          </Alert>
        )}

        <Button
          variant="contained"
          color="primary"
          onClick={onStartOAuth}
          startIcon={<Icon icon="mdi:github" />}
          sx={{ minWidth: 200, py: 1.5, px: 4, textTransform: 'none', fontSize: 16 }}
        >
          Connect to GitHub
        </Button>
      </CardContent>
    </Card>
  );
}
