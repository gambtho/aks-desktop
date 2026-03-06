// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { WorkflowRunConclusion, WorkflowRunStatus } from '../../../types/github';
import { getWorkflowRun, listWorkflowRuns } from '../../../utils/github/github-api';
import { PIPELINE_WORKFLOW_FILENAME } from '../constants';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 360; // 360 * 5s = 30 minutes

export interface UseWorkflowPollingResult {
  runStatus: WorkflowRunStatus | null;
  runConclusion: WorkflowRunConclusion;
  runUrl: string | null;
  error: string | null;
  stopPolling: () => void;
}

/** Internal composite type returned by each poll cycle. */
interface WorkflowPollData {
  runStatus: WorkflowRunStatus | null;
  runConclusion: WorkflowRunConclusion;
  runUrl: string | null;
}

/**
 * Polls GitHub Actions for a workflow run triggered by a branch push (PR merge).
 * First discovers the run via listWorkflowRuns, then polls getWorkflowRun for status.
 * Stops automatically when the workflow completes or polling times out.
 *
 * @param octokit - Authenticated Octokit client. Pass null to disable.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param branchName - Branch to filter workflow runs (default branch after merge). Pass null to disable.
 * @param enabled - Master toggle; set false to pause polling.
 */
export const useWorkflowPolling = (
  octokit: Octokit | null,
  owner: string,
  repo: string,
  branchName: string | null,
  enabled: boolean
): UseWorkflowPollingResult => {
  const isEnabled = !!(octokit && branchName && enabled);
  const runIdRef = useRef<number | null>(null);

  // Reset runIdRef when polling is disabled (new session will re-discover)
  useEffect(() => {
    if (!isEnabled) {
      runIdRef.current = null;
    }
  }, [isEnabled]);

  const pollFn = useCallback(async (): Promise<WorkflowPollData | null> => {
    if (!octokit || !branchName) return null;

    if (runIdRef.current === null) {
      // Phase 1: Discover the workflow run
      const runs = await listWorkflowRuns(octokit, owner, repo, {
        branch: branchName,
        per_page: 5,
        workflowFileName: PIPELINE_WORKFLOW_FILENAME,
      });
      if (runs.length > 0) {
        const latestRun = runs[0];
        runIdRef.current = latestRun.id;
        return {
          runStatus: latestRun.status,
          runConclusion: latestRun.conclusion,
          runUrl: latestRun.url,
        };
      }
      return null; // Not found yet, keep polling
    }

    // Phase 2: Poll specific run for status updates
    const run = await getWorkflowRun(octokit, owner, repo, runIdRef.current);
    return {
      runStatus: run.status,
      runConclusion: run.conclusion,
      runUrl: run.url,
    };
  }, [octokit, owner, repo, branchName]);

  const shouldStop = useCallback(
    (result: WorkflowPollData): boolean => result.runStatus === 'completed',
    []
  );

  const {
    data,
    isTimedOut,
    error: pollingError,
    stopPolling,
  } = usePolling<WorkflowPollData>({
    enabled: isEnabled,
    intervalMs: POLL_INTERVAL_MS,
    maxPolls: MAX_POLLS,
    pollFn,
    shouldStop,
  });

  const runStatus = data?.runStatus ?? null;
  const runConclusion = data?.runConclusion ?? null;
  const runUrl = data?.runUrl ?? null;
  // Map polling timeout to an error message for consumers
  const error = pollingError ?? (isTimedOut ? 'Workflow polling timed out after 30 minutes' : null);

  return useMemo(
    () => ({ runStatus, runConclusion, runUrl, error, stopPolling }),
    [runStatus, runConclusion, runUrl, error, stopPolling]
  );
};
