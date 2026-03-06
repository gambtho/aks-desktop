// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useRef } from 'react';
import type { GitHubRepo } from '../../types/github';
import { openExternalUrl } from '../../utils/shared/openExternalUrl';
import type { ContainerConfig } from '../DeployWizard/hooks/useContainerConfiguration';
import { useContainerConfiguration } from '../DeployWizard/hooks/useContainerConfiguration';
import { AgentSetupReview } from './components/AgentSetupReview';
import { ConnectSourceStep } from './components/ConnectSourceStep';
import { DeploymentStatusScreen } from './components/DeploymentStatusScreen';
import { PipelineConfiguredScreen } from './components/PipelineConfiguredScreen';
import { PRStatusScreen } from './components/PRStatusScreen';
import { WizardShell } from './components/WizardShell';
import { useGitHubPipelineOrchestration } from './hooks/useGitHubPipelineOrchestration';
import { getWizardStep } from './utils/getWizardStep';

interface GitHubPipelineWizardProps {
  /** Cluster name — used for both K8s operations and PipelineConfig. */
  clusterName: string;
  namespace: string;
  /** Application name. Defaults to `''` (derived from repo name at runtime). */
  appName?: string;
  subscriptionId: string;
  resourceGroup: string;
  tenantId: string;
  onClose: () => void;
  /** Called when the user explicitly cancels/abandons the pipeline (clears progress). */
  onCancel?: () => void;
  /** Pre-selected repo for resuming an in-progress pipeline. */
  initialRepo?: GitHubRepo;
  /** Container configuration from the deploy wizard. */
  containerConfig?: ContainerConfig;
  /**
   * Pipeline mode:
   * - 'configure': Ends at PipelineConfigured after generated PR merges (no auto-deploy).
   * - 'deploy': Full flow through PipelineRunning → Deployed.
   * Defaults to 'deploy'.
   */
  mode?: 'configure' | 'deploy';
}

const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
    <CircularProgress sx={{ mb: 2 }} />
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      {message}
    </Typography>
  </Box>
);

function getRecoveryHint(error: string): string {
  const lower = error.toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('forbidden') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return 'This may be a permissions issue. Check your GitHub App permissions and try again.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The operation may still be running on GitHub. Check the link above for the latest status.';
  }
  return 'Try again, or check GitHub for details.';
}

/**
 * Error boundary that catches render errors in the wizard and shows a
 * recovery UI instead of a blank screen.
 */
class PipelineErrorBoundary extends React.Component<
  { onClose: () => void; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            Something went wrong: {this.state.error.message}
          </Alert>
          <Button variant="outlined" onClick={this.props.onClose}>
            Go Back
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

export default function GitHubPipelineWizard({
  clusterName,
  namespace,
  appName = '',
  subscriptionId,
  resourceGroup,
  tenantId,
  onClose,
  onCancel,
  initialRepo,
  containerConfig,
  mode = 'deploy',
}: GitHubPipelineWizardProps) {
  const localContainerConfig = useContainerConfiguration(appName);

  useEffect(() => {
    if (containerConfig) {
      localContainerConfig.setConfig(containerConfig);
    }
    // One-time sync on mount — containerConfig is a stable prop from the parent
    // and localContainerConfig.setConfig is a ref-stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
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
    agentPrDiscoveryPollNow,
    workflowPolling,
    deploymentHealth,
  } = useGitHubPipelineOrchestration({
    clusterName,
    namespace,
    appName,
    subscriptionId,
    resourceGroup,
    tenantId,
    initialRepo,
    containerConfig: localContainerConfig.config,
    mode,
  });

  useEffect(() => {
    if (localContainerConfig.config.appName !== localAppName) {
      localContainerConfig.setConfig(c => ({ ...c, appName: localAppName }));
    }
  }, [localAppName, localContainerConfig.config.appName, localContainerConfig.setConfig]);

  const deploymentState = pipeline.state.deploymentState;

  // Determine active wizard step, using lastSuccessfulState for Failed
  const activeStep =
    deploymentState === 'Failed'
      ? pipeline.state.lastSuccessfulState
        ? getWizardStep(pipeline.state.lastSuccessfulState)
        : 0
      : getWizardStep(deploymentState);

  // Auto-advance after auth completes. The cross-tree auth sync can
  // briefly flicker isAuthenticated true → false, so we use a ref to
  // latch the first successful auth and advance immediately.
  const authAdvancedRef = useRef(false);
  const setAuthCompletedRef = useRef(pipeline.setAuthCompleted);
  setAuthCompletedRef.current = pipeline.setAuthCompleted;

  useEffect(() => {
    if (
      !authAdvancedRef.current &&
      deploymentState === 'GitHubAuthorizationNeeded' &&
      gitHubAuth.authState.isAuthenticated
    ) {
      authAdvancedRef.current = true;
      setAuthCompletedRef.current();
    }
  }, [deploymentState, gitHubAuth.authState.isAuthenticated]);

  const isAppInstallNeeded = deploymentState === 'AppInstallationNeeded';

  const content = (() => {
    switch (deploymentState) {
      case 'GitHubAuthorizationNeeded':
      case 'AppInstallationNeeded':
      case 'Configured': {
        if (selectedRepo && !isAppInstallNeeded) {
          // Repo selected, will auto-proceed to CheckingRepo via useEffect
          return <LoadingSpinner message="Initializing..." />;
        }
        return (
          <ConnectSourceStep
            authState={gitHubAuth.authState}
            onStartOAuth={() => gitHubAuth.startOAuth()}
            octokit={gitHubAuth.octokit}
            selectedRepo={selectedRepo}
            onRepoSelect={setSelectedRepo}
            appInstallNeeded={isAppInstallNeeded}
            appInstallUrl={appInstallUrl}
            isCheckingInstall={isCheckingInstall}
            authCompleted={deploymentState !== 'GitHubAuthorizationNeeded'}
          />
        );
      }

      case 'CheckingRepo':
        return <LoadingSpinner message="Checking repository readiness..." />;

      case 'ReadyForSetup': {
        if (!pipeline.state.config) return <LoadingSpinner message="Loading configuration..." />;

        const readiness = pipeline.state.repoReadiness;
        const filesAlreadyExist = !!(readiness?.hasSetupWorkflow && readiness?.hasAgentConfig);
        return (
          <AgentSetupReview
            config={pipeline.state.config}
            identityId={identityId}
            onIdentityIdChange={setIdentityId}
            appName={localAppName}
            onAppNameChange={setLocalAppName}
            filesExist={filesAlreadyExist}
            containerConfig={localContainerConfig}
          />
        );
      }

      case 'SetupPRCreating':
        return <LoadingSpinner message="Creating setup PR..." />;

      case 'SetupPRAwaitingMerge':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="setup"
            prStatus={setupPrPolling.prStatus}
            isTimedOut={setupPrPolling.isTimedOut}
            statusChecks={setupPrPolling.statusChecks}
            onReviewInGitHub={() => openExternalUrl(pipeline.state.setupPr.url ?? '')}
            onCheckNow={setupPrPolling.pollNow}
          />
        );

      case 'AgentTaskCreating':
        return <LoadingSpinner message="Creating agent task..." />;

      case 'AgentRunning':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="agent-pending"
            prStatus={null}
            isTimedOut={false}
            statusChecks={null}
            onReviewInGitHub={() => openExternalUrl(pipeline.state.triggerIssue.url ?? '')}
            onCheckNow={agentPrDiscoveryPollNow}
          />
        );

      case 'GeneratedPRAwaitingMerge':
        return (
          <PRStatusScreen
            pipelineState={pipeline.state}
            prPhase="agent-created"
            prStatus={generatedPrPolling.prStatus}
            isTimedOut={generatedPrPolling.isTimedOut}
            statusChecks={generatedPrPolling.statusChecks}
            onReviewInGitHub={() => openExternalUrl(pipeline.state.generatedPr.url ?? '')}
            onCheckNow={generatedPrPolling.pollNow}
          />
        );

      case 'PipelineConfigured':
        return (
          <PipelineConfiguredScreen
            repoFullName={
              pipeline.state.config
                ? `${pipeline.state.config.repo.owner}/${pipeline.state.config.repo.repo}`
                : ''
            }
          />
        );

      case 'PipelineRunning':
      case 'Deployed':
        return (
          <DeploymentStatusScreen
            pipelineState={pipeline.state}
            workflowStatus={{
              status: workflowPolling.runStatus,
              conclusion: workflowPolling.runConclusion,
              url: workflowPolling.runUrl,
            }}
            deploymentHealth={{
              ready: deploymentHealth.deploymentReady,
              podStatuses: deploymentHealth.podStatuses,
              serviceEndpoint: deploymentHealth.serviceEndpoint,
            }}
            onRedeploy={handleRedeploy}
            onOpenGitHubRun={() => openExternalUrl(workflowPolling.runUrl ?? '')}
          />
        );

      case 'Failed':
        return (
          <Box>
            <Alert severity="error" sx={{ mb: 2 }}>
              {pipeline.state.error ?? 'Unknown error'}
            </Alert>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {getRecoveryHint(pipeline.state.error ?? '')}
            </Typography>
            {(pipeline.state.setupPr.url ||
              pipeline.state.triggerIssue.url ||
              pipeline.state.generatedPr.url) && (
              <Button
                variant="text"
                onClick={() =>
                  openExternalUrl(
                    pipeline.state.generatedPr.url ??
                      pipeline.state.triggerIssue.url ??
                      pipeline.state.setupPr.url ??
                      ''
                  )
                }
              >
                View on GitHub
              </Button>
            )}
          </Box>
        );

      default:
        return null;
    }
  })();

  // Footer actions based on current state
  const footerActions = (() => {
    switch (deploymentState) {
      case 'GitHubAuthorizationNeeded':
      case 'AppInstallationNeeded':
      case 'Configured': {
        // "Next" enabled only when repo is selected and app is installed
        const canProceed = !!selectedRepo && !isAppInstallNeeded;
        if (!gitHubAuth.authState.isAuthenticated) return null;
        return (
          <Button
            variant="contained"
            disabled={!canProceed}
            onClick={() => canProceed && checkRepoAndApp()}
            sx={{ textTransform: 'none' }}
          >
            Next
          </Button>
        );
      }
      case 'ReadyForSetup': {
        const needsIdentity = !pipeline.state.config?.identityId.trim() && !identityId.trim();
        const needsApp = !pipeline.state.config?.appName.trim() && !localAppName.trim();
        const readiness = pipeline.state.repoReadiness;
        const filesExist = !!(readiness?.hasSetupWorkflow && readiness?.hasAgentConfig);
        return (
          <Button
            variant="contained"
            disabled={needsIdentity || needsApp}
            onClick={handleCreateSetupPR}
            startIcon={<Icon icon={filesExist ? 'mdi:robot-outline' : 'mdi:source-pull'} />}
            sx={{ textTransform: 'none' }}
          >
            {filesExist ? 'Trigger Copilot Agent' : 'Create Setup PR'}
          </Button>
        );
      }
      case 'PipelineConfigured':
      case 'Deployed':
        return (
          <Button variant="contained" onClick={onClose} sx={{ textTransform: 'none' }}>
            Done
          </Button>
        );
      case 'Failed':
        return (
          <>
            <Button variant="outlined" onClick={onClose} sx={{ textTransform: 'none' }}>
              Back
            </Button>
            <Button
              variant="contained"
              onClick={() => pipeline.retry()}
              sx={{ textTransform: 'none' }}
            >
              Retry
            </Button>
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <PipelineErrorBoundary onClose={onClose}>
      <WizardShell
        activeStep={activeStep}
        onClose={onClose}
        onCancel={onCancel}
        footerActions={footerActions}
      >
        {content}
      </WizardShell>
    </PipelineErrorBoundary>
  );
}
