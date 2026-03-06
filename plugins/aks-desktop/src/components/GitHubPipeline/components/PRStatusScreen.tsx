// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import type { PipelineState } from '../types';
import { getCheckColor, getCheckIcon } from '../utils/statusDisplay';

type PRPhase = 'setup' | 'agent-pending' | 'agent-created';

interface PRStatusScreenProps {
  pipelineState: PipelineState;
  prPhase: PRPhase;
  prStatus: {
    state: string;
    merged: boolean;
    mergeable: boolean | null;
  } | null;
  isTimedOut: boolean;
  statusChecks: Array<{ name: string; status: string; conclusion: string | null }> | null;
  onReviewInGitHub: () => void;
  onCheckNow?: () => void;
}

function PhaseIcon({ phase, merged }: { phase: PRPhase; merged: boolean }) {
  if (merged) {
    return (
      <Box
        component={Icon}
        icon="mdi:check-circle"
        sx={{ fontSize: 48, color: 'success.main', display: 'block', mx: 'auto', mb: 2 }}
      />
    );
  }
  if (phase === 'agent-pending') {
    return (
      <Box
        component={Icon}
        icon="mdi:robot-outline"
        sx={{ fontSize: 48, color: 'info.main', display: 'block', mx: 'auto', mb: 2 }}
      />
    );
  }
  return (
    <Box
      component={Icon}
      icon="mdi:source-pull"
      sx={{ fontSize: 48, color: 'primary.main', display: 'block', mx: 'auto', mb: 2 }}
    />
  );
}

const getTitle = (phase: PRPhase, merged: boolean): string => {
  if (phase === 'setup') {
    return merged ? 'Setup PR Merged' : 'Setup PR Created';
  }
  if (phase === 'agent-pending') {
    return 'Agent is Working';
  }
  return merged ? 'Deployment PR Merged' : 'Deployment PR Ready';
};

const getDescription = (phase: PRPhase, merged: boolean): string => {
  if (phase === 'setup' && !merged) {
    return 'Review and merge the setup PR to enable the Copilot agent. After merging, the agent will analyze your repo and create a deployment PR.';
  }
  if (phase === 'setup' && merged) {
    return 'The setup PR has been merged. The Copilot agent is now being triggered...';
  }
  if (phase === 'agent-pending') {
    return 'The Copilot Coding Agent is analyzing your repository and generating a deployment PR with Dockerfile, Kubernetes manifests, and a GitHub Actions workflow.';
  }
  if (phase === 'agent-created' && !merged) {
    return 'The agent has created a deployment PR. Review the generated files and merge to start the deployment pipeline.';
  }
  return 'The deployment PR has been merged. The deployment pipeline is starting...';
};

const getTracking = (
  pipelineState: PipelineState,
  phase: PRPhase
): { url: string | null; number: number | null } => {
  if (phase === 'setup')
    return { url: pipelineState.setupPr.url, number: pipelineState.setupPr.number };
  if (phase === 'agent-created')
    return { url: pipelineState.generatedPr.url, number: pipelineState.generatedPr.number };
  return { url: pipelineState.triggerIssue.url, number: pipelineState.triggerIssue.number };
};

function WaitingIndicator({
  message,
  size,
  onPollNow,
}: {
  message: string;
  size: number;
  onPollNow?: () => void;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <CircularProgress size={size} sx={{ mr: size >= 24 ? 1.5 : 1 }} />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {message}
        </Typography>
      </Box>
      {onPollNow && (
        <Button
          variant="text"
          size="small"
          onClick={onPollNow}
          startIcon={<Icon icon="mdi:refresh" />}
          sx={{ textTransform: 'none', mt: 1 }}
        >
          Check Now
        </Button>
      )}
    </Box>
  );
}

export function PRStatusScreen({
  pipelineState,
  prPhase,
  prStatus,
  isTimedOut,
  statusChecks,
  onReviewInGitHub,
  onCheckNow,
}: PRStatusScreenProps) {
  const merged = prStatus?.merged ?? false;
  const isClosed = prStatus?.state === 'closed' && !merged;
  const title = getTitle(prPhase, merged);
  const description = getDescription(prPhase, merged);
  const { url: prUrl, number: prNumber } = getTracking(pipelineState, prPhase);
  const isWaiting = prPhase === 'agent-pending';

  return (
    <Box sx={{ textAlign: 'center' }}>
      <PhaseIcon phase={prPhase} merged={merged} />

      <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
        {title}
      </Typography>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {description}
      </Typography>

      {prNumber !== null && (
        <Typography variant="body2" sx={{ mb: 1, fontFamily: 'monospace' }}>
          {prPhase === 'agent-pending' ? `Issue #${prNumber}` : `PR #${prNumber}`}
        </Typography>
      )}

      {isTimedOut && (
        <Alert
          severity="warning"
          sx={{ mb: 2, textAlign: 'left' }}
          action={
            onCheckNow ? (
              <Button color="inherit" size="small" onClick={onCheckNow}>
                Check Now
              </Button>
            ) : undefined
          }
        >
          This is taking longer than expected. The operation may still be in progress
          {' \u2014 '}
          check the {prPhase === 'agent-pending' ? 'GitHub issue' : 'PR on GitHub'} for the latest
          status.
        </Alert>
      )}

      {isClosed && (
        <Alert severity="warning" sx={{ mb: 2, textAlign: 'left' }}>
          This {prPhase === 'agent-pending' ? 'issue was closed' : 'PR was closed without merging'}.
          You may need to restart the process.
        </Alert>
      )}

      {isWaiting && !merged && !isTimedOut && (
        <WaitingIndicator
          message="Waiting for agent to create deployment PR..."
          size={24}
          onPollNow={onCheckNow}
        />
      )}

      {!isWaiting && !merged && !isClosed && !isTimedOut && (
        <WaitingIndicator message="Checking merge status..." size={20} onPollNow={onCheckNow} />
      )}

      {statusChecks && statusChecks.length > 0 && !merged && (
        <Box sx={{ mb: 3, textAlign: 'left' }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            Status Checks
          </Typography>
          {statusChecks.map(check => (
            <Box key={check.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Box
                component={Icon}
                icon={getCheckIcon(check.conclusion, check.status)}
                sx={{
                  fontSize: 18,
                  color: getCheckColor(check.conclusion, check.status),
                }}
              />
              <Typography variant="body2">{check.name}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {!merged && !isClosed && (
        <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', mb: 2 }}>
          You can close this panel — your progress is saved and will resume when you return.
        </Typography>
      )}

      {prUrl && (
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
          <Button
            variant="contained"
            color="primary"
            onClick={onReviewInGitHub}
            startIcon={<Icon icon="mdi:open-in-new" />}
            sx={{ textTransform: 'none', fontSize: 14 }}
          >
            {prPhase === 'agent-pending'
              ? 'View Issue on GitHub'
              : merged
              ? 'View on GitHub'
              : 'Review on GitHub'}
          </Button>
        </Box>
      )}
    </Box>
  );
}
