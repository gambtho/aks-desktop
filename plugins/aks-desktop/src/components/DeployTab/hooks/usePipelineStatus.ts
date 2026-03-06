// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { ANNOTATION_PIPELINE_REPOS } from '../../GitHubPipeline/hooks/usePipelineAnnotationSync';
const PIPELINE_STATE_PREFIX = 'aks-desktop:pipeline-state:';

const CONFIGURED_STATES = new Set(['PipelineConfigured', 'Deployed', 'PipelineRunning']);

export interface PipelineStatusResult {
  isConfigured: boolean;
  repos: GitHubRepo[];
}

/**
 * Scans localStorage for configured pipeline state entries (fallback).
 * Only returns repos whose persisted state matches the given cluster and namespace.
 */
function scanLocalStorageForRepos(cluster: string, namespace: string): GitHubRepo[] {
  const repos: GitHubRepo[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PIPELINE_STATE_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw);
      if (
        parsed &&
        CONFIGURED_STATES.has(parsed.deploymentState) &&
        parsed.config?.repo &&
        parsed.config?.clusterName === cluster &&
        parsed.config?.namespace === namespace
      ) {
        const r = parsed.config.repo;
        if (!repos.some(existing => existing.owner === r.owner && existing.repo === r.repo)) {
          repos.push(r);
        }
      }
    } catch {
      continue;
    }
  }
  return repos;
}

/**
 * Checks K8s namespace annotations for configured pipeline repos.
 * Falls back to localStorage for backward compatibility.
 *
 * Uses Headlamp's reactive `useGet` hook, so the result updates automatically
 * when the namespace resource changes (no polling needed).
 */
export const usePipelineStatus = (cluster: string, namespace: string): PipelineStatusResult => {
  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster,
  });

  return useMemo(() => {
    // Primary: read from namespace annotation
    const annotation =
      namespaceInstance?.jsonData?.metadata?.annotations?.[ANNOTATION_PIPELINE_REPOS];
    if (annotation) {
      try {
        const repos: unknown = JSON.parse(annotation);
        if (
          Array.isArray(repos) &&
          repos.length > 0 &&
          repos.every(
            (r): r is GitHubRepo =>
              typeof r === 'object' &&
              r !== null &&
              'owner' in r &&
              typeof r.owner === 'string' &&
              'repo' in r &&
              typeof r.repo === 'string' &&
              'defaultBranch' in r &&
              typeof r.defaultBranch === 'string'
          )
        ) {
          return { isConfigured: true, repos };
        }
      } catch {
        // fall through to localStorage
      }
    }

    // Fallback: scan localStorage
    const localRepos = scanLocalStorageForRepos(cluster, namespace);
    if (localRepos.length > 0) {
      return { isConfigured: true, repos: localRepos };
    }

    return { isConfigured: false, repos: [] };
  }, [namespaceInstance, cluster, namespace]);
};
