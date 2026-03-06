// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import {
  checkAppInstallation,
  checkRepoReadiness,
  dispatchWorkflow,
} from '../../../utils/github/github-api';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { PIPELINE_WORKFLOW_FILENAME } from '../constants';
import { useGitHubAuthContext } from '../GitHubAuthContext';
import { createSetupPR, triggerCopilotAgent } from '../utils/pipelineOrchestration';
import {
  ACTIVE_PIPELINE_KEY_PREFIX,
  getActivePipeline,
  RESUMABLE_STATES,
} from '../utils/pipelineStorage';
import { useAgentPRDiscovery } from './useAgentPRDiscovery';
import type { UseDeploymentHealthResult } from './useDeploymentHealth';
import { useDeploymentHealth } from './useDeploymentHealth';
import type { UseGitHubAuthResult } from './useGitHubAuth';
import type { UseGitHubPipelineStateResult } from './useGitHubPipelineState';
import { useGitHubPipelineState } from './useGitHubPipelineState';
import {
  ANNOTATION_WORKLOAD_IDENTITY,
  usePipelineAnnotationSync,
} from './usePipelineAnnotationSync';
import type { UsePRPollingResult } from './usePRPolling';
import { usePRPolling } from './usePRPolling';
import type { UseWorkflowPollingResult } from './useWorkflowPolling';
import { useWorkflowPolling } from './useWorkflowPolling';

interface UseGitHubPipelineOrchestrationProps {
  clusterName: string;
  namespace: string;
  /** Application name. Defaults to `''` (derived from repo name at runtime). */
  appName?: string;
  subscriptionId: string;
  resourceGroup: string;
  tenantId: string;
  /** Pre-selected repo for resuming an in-progress pipeline. */
  initialRepo?: GitHubRepo;
  /** Container configuration from the deploy wizard. */
  containerConfig?: ContainerConfig;
  /**
   * Pipeline mode:
   * - 'configure': Pipeline setup ends at PipelineConfigured after generated PR merges (no auto-deploy).
   * - 'deploy': Full flow — generated PR merge triggers PipelineRunning → Deployed.
   * Defaults to 'deploy' for backward compatibility.
   */
  mode?: 'configure' | 'deploy';
}

export interface UseGitHubPipelineOrchestrationResult {
  gitHubAuth: UseGitHubAuthResult;
  selectedRepo: GitHubRepo | null;
  setSelectedRepo: React.Dispatch<React.SetStateAction<GitHubRepo | null>>;
  appInstallUrl: string | null;
  isCheckingInstall: boolean;
  pipeline: UseGitHubPipelineStateResult;
  identityId: string;
  setIdentityId: React.Dispatch<React.SetStateAction<string>>;
  localAppName: string;
  setLocalAppName: React.Dispatch<React.SetStateAction<string>>;
  checkRepoAndApp: (options?: { silent?: boolean }) => Promise<void>;
  handleCreateSetupPR: () => Promise<void>;
  handleRedeploy: () => Promise<void>;
  setupPrPolling: UsePRPollingResult;
  generatedPrPolling: UsePRPollingResult;
  agentPrDiscoveryPollNow: () => void;
  workflowPolling: UseWorkflowPollingResult;
  deploymentHealth: UseDeploymentHealthResult;
}

/**
 * Orchestrates the full GitHub pipeline wizard lifecycle.
 *
 * Encapsulates all hooks, effects, state, and callbacks that drive the
 * pipeline wizard. The companion `GitHubPipelineWizard` component is a
 * pure render-only consumer of the values returned here.
 */
export const useGitHubPipelineOrchestration = ({
  clusterName,
  namespace,
  appName = '',
  subscriptionId,
  resourceGroup,
  tenantId,
  initialRepo,
  containerConfig,
  mode = 'deploy',
}: UseGitHubPipelineOrchestrationProps): UseGitHubPipelineOrchestrationResult => {
  const agentTriggerInFlightRef = useRef(false);
  const checkRepoInFlightRef = useRef(false);
  const installPollFailuresRef = useRef(0);

  // Resolve the repo to resume from: explicit initialRepo prop, or
  // an in-progress pipeline stored in localStorage.
  const resolvedInitialRepo =
    initialRepo ?? getActivePipeline(clusterName, namespace)?.repo ?? null;
  // True when resuming from an existing pipeline (not a fresh start).
  // Used to decide whether to shortcut to PipelineConfigured when the
  // deploy workflow already exists on the repo.
  const isResumingRef = useRef(!!resolvedInitialRepo);

  const gitHubAuth = useGitHubAuthContext();
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(resolvedInitialRepo);
  const [appInstallUrl, setAppInstallUrl] = useState<string | null>(null);
  const [isCheckingInstall, setIsCheckingInstall] = useState(false);
  const repoKey = selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : null;
  const pipeline = useGitHubPipelineState(repoKey);

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster: clusterName,
  });

  const containerConfigRef = useRef(containerConfig);
  containerConfigRef.current = containerConfig;

  const [identityId, setIdentityId] = useState('');
  const [localAppName, setLocalAppName] = useState(appName || '');

  useEffect(() => {
    if (identityId) return;
    const stored =
      namespaceInstance?.jsonData?.metadata?.annotations?.[ANNOTATION_WORKLOAD_IDENTITY];
    if (stored) {
      setIdentityId(stored);
    }
  }, [identityId, namespaceInstance]);

  useEffect(() => {
    if (!localAppName && selectedRepo) {
      setLocalAppName(selectedRepo.repo);
    }
  }, [localAppName, selectedRepo]);

  // Track whether auth has succeeded at least once during this wizard session.
  // The cross-tree auth sync can briefly flicker isAuthenticated true → false
  // after a successful OAuth. Once we've seen a successful auth, we stop
  // pushing the pipeline back to GitHubAuthorizationNeeded.
  const authSeenRef = useRef(false);
  if (gitHubAuth.authState.isAuthenticated) {
    authSeenRef.current = true;
  }

  useEffect(() => {
    if (gitHubAuth.authState.isRestoring) return;
    if (!gitHubAuth.authState.isAuthenticated && !authSeenRef.current) {
      pipeline.setAuthNeeded();
    }
  }, [
    gitHubAuth.authState.isAuthenticated,
    gitHubAuth.authState.isRestoring,
    pipeline.setAuthNeeded,
  ]);

  useEffect(() => {
    if (!selectedRepo) return;

    if (!pipeline.state.config) {
      pipeline.setConfig({
        tenantId,
        identityId: identityId || '',
        subscriptionId,
        clusterName,
        resourceGroup,
        namespace,
        appName,
        serviceType: containerConfig?.serviceType ?? 'ClusterIP',
        containerConfig,
        repo: selectedRepo,
      });
    } else if (!pipeline.state.config.repo.owner) {
      // Config was created during auth with placeholder repo — update it now
      pipeline.updateConfig({ repo: selectedRepo });
    }
  }, [
    selectedRepo,
    pipeline.state.config,
    pipeline.setConfig,
    tenantId,
    identityId,
    subscriptionId,
    clusterName,
    resourceGroup,
    namespace,
    appName,
    containerConfig,
  ]);

  const checkRepoAndApp = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!gitHubAuth.octokit || !selectedRepo) return;
      if (checkRepoInFlightRef.current) return;
      checkRepoInFlightRef.current = true;
      setIsCheckingInstall(true);
      if (!options?.silent) {
        pipeline.setCheckingRepo();
      }
      try {
        const { installed, installUrl } = await checkAppInstallation(
          gitHubAuth.octokit,
          selectedRepo.owner,
          selectedRepo.repo
        );
        if (!installed) {
          pipeline.setAppInstallNeeded();
          setAppInstallUrl(installUrl);
          return;
        }
        const readiness = await checkRepoReadiness(
          gitHubAuth.octokit,
          selectedRepo.owner,
          selectedRepo.repo,
          selectedRepo.defaultBranch
        );
        // Only shortcut to PipelineConfigured when resuming via initialRepo.
        // When the user manually selected a repo (or used "Start over"),
        // always show the setup review so they can re-run the pipeline.
        console.log('[Orchestration] checkRepoAndApp readiness', {
          readiness,
          isResuming: isResumingRef.current,
          initialRepo: !!initialRepo,
        });
        const effective = isResumingRef.current
          ? readiness
          : { ...readiness, hasDeployWorkflow: false };
        pipeline.setRepoReadiness(effective);
      } catch (err) {
        pipeline.setFailed(err instanceof Error ? err.message : 'Failed to check repo');
      } finally {
        checkRepoInFlightRef.current = false;
        setIsCheckingInstall(false);
      }
    },
    [
      gitHubAuth.octokit,
      selectedRepo,
      pipeline.setCheckingRepo,
      pipeline.setAppInstallNeeded,
      pipeline.setRepoReadiness,
      pipeline.setFailed,
    ]
  );

  // Auto-advance when a repo is already selected (e.g. resuming after
  // drawer close/reopen or initialRepo). Without this the wizard shows
  // "Initializing…" forever because nothing triggers checkRepoAndApp.
  useEffect(() => {
    if (selectedRepo && gitHubAuth.octokit && pipeline.state.deploymentState === 'Configured') {
      checkRepoAndApp();
    }
  }, [selectedRepo, gitHubAuth.octokit, pipeline.state.deploymentState, checkRepoAndApp]);

  const setupPrPolling = usePRPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.setupPr.number,
    pipeline.state.deploymentState === 'SetupPRAwaitingMerge'
  );

  const agentPrDiscovery = useAgentPRDiscovery(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.deploymentState === 'AgentRunning',
    pipeline.state.triggerIssue.number
  );

  const generatedPrPolling = usePRPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.generatedPr.number,
    pipeline.state.deploymentState === 'GeneratedPRAwaitingMerge'
  );

  const workflowPolling = useWorkflowPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    selectedRepo?.defaultBranch ?? null,
    pipeline.state.deploymentState === 'PipelineRunning'
  );

  const deploymentHealth = useDeploymentHealth(
    localAppName,
    namespace,
    clusterName,
    pipeline.state.deploymentState === 'PipelineRunning' ||
      pipeline.state.deploymentState === 'Deployed'
  );

  useEffect(() => {
    switch (pipeline.state.deploymentState) {
      case 'Configured':
        if (gitHubAuth.authState.isAuthenticated && selectedRepo) {
          checkRepoAndApp();
        }
        break;

      case 'SetupPRAwaitingMerge':
        if (setupPrPolling.isMerged) {
          pipeline.setSetupPRMerged();
        }
        break;

      case 'AgentTaskCreating':
        if (gitHubAuth.octokit && pipeline.state.config && !agentTriggerInFlightRef.current) {
          agentTriggerInFlightRef.current = true;
          triggerCopilotAgent(gitHubAuth.octokit, pipeline.state.config)
            .then(issue => pipeline.setAgentTriggered(issue))
            .catch(err => {
              console.error('Failed to trigger Copilot agent:', err);
              pipeline.setFailed(
                err instanceof Error ? err.message : 'Failed to trigger Copilot agent'
              );
            })
            .finally(() => {
              agentTriggerInFlightRef.current = false;
            });
        }
        break;

      case 'AgentRunning':
        if (agentPrDiscovery.prUrl && agentPrDiscovery.prNumber) {
          pipeline.setGeneratedPRCreated(agentPrDiscovery.prUrl, agentPrDiscovery.prNumber);
        } else if (agentPrDiscovery.issueClosed) {
          pipeline.setFailed(
            'Copilot agent completed but no deployment PR was found. Check the GitHub issue for details.'
          );
        } else if (agentPrDiscovery.isTimedOut) {
          pipeline.setFailed('Timed out waiting for Copilot agent to create PR');
        }
        break;

      case 'GeneratedPRAwaitingMerge':
        if (generatedPrPolling.isMerged) {
          if (mode === 'configure') {
            pipeline.setPipelineConfigured();
          } else {
            pipeline.setGeneratedPRMerged();
          }
        }
        break;

      case 'PipelineRunning':
        if (workflowPolling.runConclusion === 'success') {
          pipeline.setDeployed(deploymentHealth.serviceEndpoint ?? undefined);
        } else if (workflowPolling.runConclusion === 'failure') {
          pipeline.setFailed('GitHub Actions workflow failed');
        }
        break;
    }
  }, [
    pipeline.state.deploymentState,
    pipeline.state.config,
    gitHubAuth.authState.isAuthenticated,
    gitHubAuth.octokit,
    selectedRepo,
    checkRepoAndApp,
    setupPrPolling.isMerged,
    agentPrDiscovery.prUrl,
    agentPrDiscovery.prNumber,
    agentPrDiscovery.issueClosed,
    agentPrDiscovery.isTimedOut,
    generatedPrPolling.isMerged,
    workflowPolling.runConclusion,
    deploymentHealth.serviceEndpoint,
    pipeline.setSetupPRMerged,
    pipeline.setAgentTriggered,
    pipeline.setGeneratedPRCreated,
    pipeline.setGeneratedPRMerged,
    pipeline.setPipelineConfigured,
    mode,
    pipeline.setDeployed,
    pipeline.setFailed,
  ]);

  // Polls silently without transitioning to CheckingRepo, so the install
  // screen stays visible. Only advances state when installation is detected.
  useEffect(() => {
    if (pipeline.state.deploymentState !== 'AppInstallationNeeded') return;
    if (!gitHubAuth.octokit || !selectedRepo) return;
    const intervalId = setInterval(async () => {
      if (checkRepoInFlightRef.current) return;
      const currentOctokit = gitHubAuth.octokit;
      const currentRepo = selectedRepo;
      if (!currentOctokit || !currentRepo) return;
      try {
        setIsCheckingInstall(true);
        const { installed } = await checkAppInstallation(
          currentOctokit,
          currentRepo.owner,
          currentRepo.repo
        );
        if (installed) {
          checkRepoAndApp({ silent: true });
        }
        installPollFailuresRef.current = 0;
      } catch (err) {
        installPollFailuresRef.current++;
        console.warn('App installation check failed:', err);
      } finally {
        setIsCheckingInstall(false);
      }
    }, 3_000);
    return () => clearInterval(intervalId);
  }, [pipeline.state.deploymentState, gitHubAuth.octokit, selectedRepo, checkRepoAndApp]);

  // Saves the selected repo when the pipeline is in progress, so DeployButton
  // can show a "Resume" button. Clears when the pipeline completes or is reset.
  useEffect(() => {
    if (!selectedRepo) return;
    const key = `${ACTIVE_PIPELINE_KEY_PREFIX}${clusterName}:${namespace}`;
    const state = pipeline.state.deploymentState;
    try {
      if (RESUMABLE_STATES.has(state)) {
        localStorage.setItem(key, JSON.stringify(selectedRepo));
      } else if (state === 'Deployed' || state === 'PipelineConfigured' || state === 'Configured') {
        localStorage.removeItem(key);
      }
    } catch {
      // localStorage may be unavailable or full — non-critical for pipeline operation
    }
  }, [pipeline.state.deploymentState, selectedRepo, clusterName, namespace]);

  usePipelineAnnotationSync({
    deploymentState: pipeline.state.deploymentState,
    selectedRepo,
    repoKey,
    identityId,
    configIdentityId: pipeline.state.config?.identityId,
    namespace,
    clusterName,
    namespaceInstance,
  });

  const handleCreateSetupPR = useCallback(async () => {
    if (!pipeline.state.config || !gitHubAuth.octokit) return;

    // Persist latest identityId and appName to localStorage for crash recovery.
    // Note: React state won't reflect this until next render, so we build a
    // fresh config object below for the API call.
    const resolvedIdentityId = identityId || pipeline.state.config.identityId;
    const resolvedAppName = localAppName || pipeline.state.config.appName;
    pipeline.updateConfig({
      identityId: resolvedIdentityId,
      appName: resolvedAppName,
      containerConfig: containerConfigRef.current,
    });

    // If both config files already exist on the repo (e.g. setup PR was merged in a previous
    // session), skip PR creation and go straight to the agent trigger.
    const readiness = pipeline.state.repoReadiness;
    if (readiness?.hasSetupWorkflow && readiness?.hasAgentConfig) {
      pipeline.setSetupPRMerged();
      return;
    }

    pipeline.setCreatingSetupPR();
    try {
      const config = {
        ...pipeline.state.config,
        identityId: resolvedIdentityId,
        appName: resolvedAppName,
        containerConfig: containerConfigRef.current,
      };
      const pr = await createSetupPR(gitHubAuth.octokit, config);
      pipeline.setSetupPRCreated(pr);
    } catch (error) {
      console.error('Failed to create setup PR:', error);
      pipeline.setFailed(error instanceof Error ? error.message : 'Failed to create setup PR');
    }
  }, [
    gitHubAuth.octokit,
    pipeline.state.config,
    pipeline.state.repoReadiness,
    pipeline.updateConfig,
    pipeline.setSetupPRMerged,
    pipeline.setCreatingSetupPR,
    pipeline.setSetupPRCreated,
    pipeline.setFailed,
    identityId,
    localAppName,
  ]);

  const handleRedeploy = useCallback(async () => {
    if (!gitHubAuth.octokit || !selectedRepo) return;
    try {
      await dispatchWorkflow(
        gitHubAuth.octokit,
        selectedRepo.owner,
        selectedRepo.repo,
        PIPELINE_WORKFLOW_FILENAME,
        selectedRepo.defaultBranch
      );
    } catch (error) {
      pipeline.setFailed(error instanceof Error ? error.message : 'Failed to redeploy');
    }
  }, [gitHubAuth.octokit, selectedRepo, pipeline.setFailed]);

  return {
    gitHubAuth,
    selectedRepo,
    setSelectedRepo,
    appInstallUrl,
    isCheckingInstall,
    pipeline,
    identityId,
    setIdentityId,
    localAppName,
    setLocalAppName,
    checkRepoAndApp,
    handleCreateSetupPR,
    handleRedeploy,
    setupPrPolling,
    generatedPrPolling,
    agentPrDiscoveryPollNow: agentPrDiscovery.pollNow,
    workflowPolling,
    deploymentHealth,
  };
};
