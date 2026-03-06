// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback } from 'react';
import { findLinkedPullRequest, getIssue } from '../../../utils/github/github-api';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 120; // 120 * 5s = 10 minutes

interface UseAgentPRDiscoveryResult {
  prUrl: string | null;
  prNumber: number | null;
  prMerged: boolean;
  issueClosed: boolean;
  isTimedOut: boolean;
  error: string | null;
  stopPolling: () => void;
  pollNow: () => void;
}

/** Internal type returned by each poll cycle. */
interface AgentPRPollData {
  prUrl: string | null;
  prNumber: number | null;
  merged: boolean;
  issueClosed: boolean;
}

/**
 * Polls for a PR created by the Copilot Coding Agent.
 *
 * Detection strategy:
 * 1. **Issue timeline** (primary): Queries the trigger issue's timeline for
 *    cross-referenced PRs. This is deterministic — the agent's PR references
 *    the trigger issue, creating a timeline event.
 * 2. **Issue status** (termination signal): If no linked PR is found and the
 *    issue is closed, the agent completed without creating a PR.
 *
 * @param octokit - Authenticated Octokit client. Pass null to disable.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param enabled - Master toggle; set false to pause polling.
 * @param issueNumber - The trigger issue number used to find the linked PR.
 */
export const useAgentPRDiscovery = (
  octokit: Octokit | null,
  owner: string,
  repo: string,
  enabled: boolean,
  issueNumber?: number | null
): UseAgentPRDiscoveryResult => {
  const isEnabled = !!(octokit && owner && repo && issueNumber && enabled);

  const pollFn = useCallback(async (): Promise<AgentPRPollData | null> => {
    if (!octokit || !issueNumber) return null;

    // Primary: find a PR linked to the trigger issue via the timeline API
    try {
      const linked = await findLinkedPullRequest(octokit, owner, repo, issueNumber);
      if (linked) {
        return {
          prUrl: linked.url,
          prNumber: linked.number,
          merged: linked.merged,
          issueClosed: false,
        };
      }
    } catch (err) {
      console.warn('Failed to query issue timeline:', err);
    }

    // Secondary: check if agent is done (issue closed) — termination signal only
    try {
      const issue = await getIssue(octokit, owner, repo, issueNumber);
      if (issue.state === 'closed') {
        return { prUrl: null, prNumber: null, merged: false, issueClosed: true };
      }
    } catch (err) {
      console.warn('Failed to check issue status:', err);
    }

    return null; // Keep polling
  }, [octokit, owner, repo, issueNumber]);

  // Stop when we find a PR or when the issue is closed (agent is done)
  const shouldStop = useCallback(
    (result: AgentPRPollData): boolean => !!(result.prNumber || result.issueClosed),
    []
  );

  const { data, isTimedOut, error, stopPolling, pollNow } = usePolling<AgentPRPollData>({
    enabled: isEnabled,
    intervalMs: POLL_INTERVAL_MS,
    maxPolls: MAX_POLLS,
    pollFn,
    shouldStop,
  });

  return {
    prUrl: data?.prUrl ?? null,
    prNumber: data?.prNumber ?? null,
    prMerged: data?.merged ?? false,
    issueClosed: data?.issueClosed ?? false,
    isTimedOut,
    error,
    stopPolling,
    pollNow,
  };
};
