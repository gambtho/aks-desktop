// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { GitHubRepo } from '../../../types/github';
import { SCHEMA_VERSION, STORAGE_KEY_PREFIX } from '../hooks/useGitHubPipelineState';
import type { PipelineDeploymentState } from '../types';

export const ACTIVE_PIPELINE_KEY_PREFIX = 'aks-desktop:active-pipeline:';

/**
 * States where the pipeline wizard should be resumable. Includes 'Failed'
 * so users can re-enter the wizard and retry from the failure point.
 */
export const RESUMABLE_STATES: ReadonlySet<PipelineDeploymentState> =
  new Set<PipelineDeploymentState>([
    'AppInstallationNeeded',
    'CheckingRepo',
    'WorkloadIdentitySetup',
    'ReadyForSetup',
    'SetupPRCreating',
    'SetupPRAwaitingMerge',
    'AgentTaskCreating',
    'AgentRunning',
    'GeneratedPRAwaitingMerge',
    'PipelineRunning',
    'Failed',
  ]);

function isValidGitHubRepo(value: unknown): value is GitHubRepo {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.owner === 'string' &&
    typeof obj.repo === 'string' &&
    typeof obj.defaultBranch === 'string'
  );
}

/**
 * Reads the active pipeline reference for a given cluster+namespace.
 * Used by DeployButton to detect in-progress pipelines.
 */
export function getActivePipeline(
  cluster: string,
  ns: string
): { repo: GitHubRepo; state: PipelineDeploymentState } | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_PIPELINE_KEY_PREFIX}${cluster}:${ns}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidGitHubRepo(parsed)) return null;
    const repo = parsed;
    const stateRaw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${repo.owner}/${repo.repo}`);
    if (!stateRaw) return null;
    const pipelineState = JSON.parse(stateRaw) as {
      __schemaVersion?: number;
      deploymentState?: string;
    };
    if (pipelineState?.__schemaVersion !== SCHEMA_VERSION) return null;
    const state = pipelineState?.deploymentState;
    if (!state || !RESUMABLE_STATES.has(state as PipelineDeploymentState)) return null;
    const deploymentState = state as PipelineDeploymentState;
    return { repo, state: deploymentState };
  } catch {
    return null;
  }
}

/**
 * Records the active pipeline for a given cluster+namespace.
 * Called when the user starts a new pipeline deployment.
 */
export function setActivePipeline(cluster: string, ns: string, repo: GitHubRepo): void {
  try {
    localStorage.setItem(`${ACTIVE_PIPELINE_KEY_PREFIX}${cluster}:${ns}`, JSON.stringify(repo));
  } catch {
    // localStorage may be full or unavailable
  }
}

/**
 * Clears the active pipeline reference and all persisted pipeline state for a
 * given cluster+namespace. Called when the user explicitly cancels / starts over.
 *
 * Scans all `pipeline-state:` entries to find any whose config matches the
 * cluster+namespace, because the `active-pipeline:` pointer may have already
 * been cleared by the orchestration hook.
 */
export function clearActivePipeline(cluster: string, ns: string): void {
  try {
    localStorage.removeItem(`${ACTIVE_PIPELINE_KEY_PREFIX}${cluster}:${ns}`);

    // Scan for pipeline state entries matching this cluster+namespace
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed?.config?.clusterName === cluster && parsed?.config?.namespace === ns) {
          keysToRemove.push(key);
        }
      } catch {
        // skip malformed entries
      }
    }
    console.log('[PipelineStorage] clearActivePipeline', { cluster, ns, keysToRemove });
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable
  }
}
