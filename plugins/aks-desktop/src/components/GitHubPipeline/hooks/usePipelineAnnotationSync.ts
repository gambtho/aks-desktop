// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { useEffect, useRef } from 'react';
import type { GitHubRepo } from '../../../types/github';
import type { PipelineDeploymentState } from '../types';

export const ANNOTATION_PIPELINE_REPOS = 'aks-project/pipeline-repos';
export const ANNOTATION_WORKLOAD_IDENTITY = 'aks-project/workload-identity-id';
export const ANNOTATION_WORKLOAD_TENANT = 'aks-project/workload-identity-tenant';

const MERGE_PATCH_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/merge-patch+json',
};

interface UsePipelineAnnotationSyncProps {
  deploymentState: PipelineDeploymentState;
  selectedRepo: GitHubRepo | null;
  repoKey: string | null;
  identityId: string;
  tenantId: string;
  configIdentityId: string | undefined;
  namespace: string;
  clusterName: string;
  namespaceInstance: { jsonData?: { metadata?: { annotations?: Record<string, string> } } } | null;
}

/**
 * Persists pipeline repo and workload-identity annotations on the namespace
 * resource when the pipeline reaches a terminal configured state.
 *
 * Extracted from {@link useGitHubPipelineOrchestration} for readability.
 */
export const usePipelineAnnotationSync = ({
  deploymentState,
  selectedRepo,
  repoKey,
  identityId,
  tenantId,
  configIdentityId,
  namespace,
  clusterName,
  namespaceInstance,
}: UsePipelineAnnotationSyncProps): void => {
  // Tracks the repoKey for which we've successfully written annotations.
  // Reset naturally when repoKey changes — no render-phase ref mutation needed.
  const lastWrittenRepoKeyRef = useRef<string | null>(null);
  const errorCountRef = useRef(0);
  const backoffUntilRef = useRef(0);

  useEffect(() => {
    if (deploymentState !== 'PipelineConfigured' && deploymentState !== 'Deployed') return;
    if (!selectedRepo || !repoKey) return;
    if (lastWrittenRepoKeyRef.current === repoKey) return; // Already written for this repo

    let cancelled = false;

    (async () => {
      if (Date.now() < backoffUntilRef.current) return;

      try {
        const existing =
          namespaceInstance?.jsonData?.metadata?.annotations?.[ANNOTATION_PIPELINE_REPOS];
        let repos: GitHubRepo[] = [];
        if (existing) {
          try {
            repos = JSON.parse(existing);
          } catch {
            repos = [];
          }
        }

        const alreadyPresent = repos.some(
          r => r.owner === selectedRepo.owner && r.repo === selectedRepo.repo
        );
        if (!alreadyPresent) {
          repos.push({
            owner: selectedRepo.owner,
            repo: selectedRepo.repo,
            defaultBranch: selectedRepo.defaultBranch,
          });
        }

        const annotations: Record<string, string> = {
          [ANNOTATION_PIPELINE_REPOS]: JSON.stringify(repos),
        };

        const resolvedIdentityId = identityId || configIdentityId;
        const existingIdentity =
          namespaceInstance?.jsonData?.metadata?.annotations?.[ANNOTATION_WORKLOAD_IDENTITY];
        if (resolvedIdentityId && !existingIdentity) {
          annotations[ANNOTATION_WORKLOAD_IDENTITY] = resolvedIdentityId;
        }

        const existingTenant =
          namespaceInstance?.jsonData?.metadata?.annotations?.[ANNOTATION_WORKLOAD_TENANT];
        if (tenantId && !existingTenant) {
          annotations[ANNOTATION_WORKLOAD_TENANT] = tenantId;
        }

        await clusterRequest(`/api/v1/namespaces/${namespace}`, {
          method: 'PATCH',
          body: JSON.stringify({ metadata: { annotations } }),
          headers: MERGE_PATCH_HEADERS,
          cluster: clusterName,
        });
        if (cancelled) return;
        lastWrittenRepoKeyRef.current = repoKey; // Only after success
        errorCountRef.current = 0;
      } catch (err) {
        if (cancelled) return;
        errorCountRef.current++;
        backoffUntilRef.current = Date.now() + Math.min(1000 * 2 ** errorCountRef.current, 60_000);
        console.error('Failed to annotate namespace with pipeline repo:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    deploymentState,
    configIdentityId,
    selectedRepo,
    repoKey,
    namespaceInstance,
    namespace,
    clusterName,
    identityId,
    tenantId,
  ]);
};
