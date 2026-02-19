// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Chip, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import React from 'react';
import type { WorkflowRunConclusion, WorkflowRunStatus } from '../../types/github';
import type { ProjectDefinition } from '../../types/project';
import { openExternalUrl } from '../../utils/shared/openExternalUrl';
import { usePipelineStatus } from '../DeployTab/hooks/usePipelineStatus';
import { useGitHubAuthContext } from '../GitHubPipeline/GitHubAuthContext';
import { usePipelineRuns } from './hooks/usePipelineRuns';

interface PipelineCardProps {
  project: ProjectDefinition;
}

function getStatusIcon(status: WorkflowRunStatus | null, conclusion: WorkflowRunConclusion) {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return { icon: 'mdi:check-circle', color: 'success.main' };
      case 'failure':
        return { icon: 'mdi:close-circle', color: 'error.main' };
      case 'cancelled':
        return { icon: 'mdi:cancel', color: 'text.secondary' };
      default:
        return { icon: 'mdi:help-circle', color: 'text.secondary' };
    }
  }
  if (status === 'in_progress') {
    return { icon: 'mdi:progress-clock', color: 'info.main' };
  }
  if (status === 'queued' || status === 'waiting') {
    return { icon: 'mdi:clock-outline', color: 'warning.main' };
  }
  return { icon: 'mdi:help-circle', color: 'text.secondary' };
}

function getStatusLabel(status: WorkflowRunStatus | null, conclusion: WorkflowRunConclusion) {
  if (status === 'completed') return conclusion ?? 'completed';
  return status ?? 'unknown';
}

function PipelineCard({ project }: PipelineCardProps) {
  const cluster = project.clusters?.[0] ?? '';
  const namespace = project.namespaces?.[0] ?? '';
  const { octokit, authState, startDeviceFlow } = useGitHubAuthContext();
  const pipelineStatus = usePipelineStatus(cluster, namespace);
  const { runs, loading, error } = usePipelineRuns(octokit, pipelineStatus.repos);

  return (
    <Box
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 0, '&:last-child': { pb: 0 } }}
    >
      <Typography variant="h6" sx={{ mb: 2 }}>
        Pipeline
      </Typography>

      {!pipelineStatus.isConfigured && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component={Icon}
            icon="mdi:information-outline"
            sx={{ fontSize: 18, color: 'text.secondary' }}
          />
          <Typography variant="body2" color="text.secondary">
            No pipeline configured. Use "Configure Pipeline" to set up CI/CD.
          </Typography>
        </Box>
      )}

      {pipelineStatus.isConfigured && !authState.isAuthenticated && !authState.isRestoring && (
        <Box>
          {authState.isAuthorizingDevice && authState.userCode ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} />
              <Typography variant="body2" color="text.secondary">
                Enter code <strong style={{ fontFamily: 'monospace' }}>{authState.userCode}</strong>{' '}
                on GitHub
              </Typography>
            </Box>
          ) : (
            <Typography
              variant="body2"
              color="primary"
              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
              onClick={startDeviceFlow}
            >
              Sign in to GitHub to view pipeline runs.
            </Typography>
          )}
        </Box>
      )}

      {pipelineStatus.isConfigured && authState.isRestoring && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary">
            Connecting...
          </Typography>
        </Box>
      )}

      {pipelineStatus.isConfigured && authState.isAuthenticated && (
        <>
          {pipelineStatus.repos.map(r => (
            <Typography
              key={`${r.owner}/${r.repo}`}
              variant="caption"
              color="text.secondary"
              sx={{ mb: 0.5 }}
            >
              {r.owner}/{r.repo}
            </Typography>
          ))}

          {loading && runs.length === 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          )}

          {error && (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          )}

          {!loading && !error && runs.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No pipeline runs yet.
            </Typography>
          )}

          {runs.map(run => {
            const { icon, color } = getStatusIcon(run.status, run.conclusion);
            return (
              <Box
                key={run.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  py: 0.75,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                  <Box component={Icon} icon={icon} sx={{ color, fontSize: 18, flexShrink: 0 }} />
                  <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {run.name || `Run #${run.id}`}
                  </Typography>
                  <Chip
                    label={getStatusLabel(run.status, run.conclusion)}
                    size="small"
                    variant="outlined"
                    sx={{ textTransform: 'capitalize' }}
                  />
                </Box>
                <Tooltip title="View on GitHub">
                  <IconButton
                    size="small"
                    aria-label="View run on GitHub"
                    onClick={() => openExternalUrl(run.url)}
                  >
                    <Icon icon="mdi:open-in-new" style={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}

export default PipelineCard;
