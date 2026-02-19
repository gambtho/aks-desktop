// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import type { GitHubRepo } from '../../types/github';
import { openExternalUrl } from '../../utils/shared/openExternalUrl';
import ConfigureContainer from '../DeployWizard/components/ConfigureContainer';
import type { ContainerConfig } from '../DeployWizard/hooks/useContainerConfiguration';
import { useContainerConfiguration } from '../DeployWizard/hooks/useContainerConfiguration';
import { AgentSetupReview } from './components/AgentSetupReview';
import { AppInstallScreen } from './components/AppInstallScreen';
import { DeploymentStatusScreen } from './components/DeploymentStatusScreen';
import { GitHubAuthScreen } from './components/GitHubAuthScreen';
import { PipelineConfiguredScreen } from './components/PipelineConfiguredScreen';
import { PRStatusScreen } from './components/PRStatusScreen';
import { RepoSelector } from './components/RepoSelector';
import { useGitHubPipelineOrchestration } from './hooks/useGitHubPipelineOrchestration';

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
  initialRepo,
  containerConfig,
  mode = 'deploy',
}: GitHubPipelineWizardProps) {
  const localContainerConfig = useContainerConfiguration(appName);
  const [showingContainerConfig, setShowingContainerConfig] = useState(false);

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

  const content = (() => {
    switch (pipeline.state.deploymentState) {
      case 'GitHubAuthorizationNeeded':
        return (
          <GitHubAuthScreen
            authState={gitHubAuth.authState}
            onStartDeviceFlow={() => gitHubAuth.startDeviceFlow()}
            onCancel={onClose}
            onContinue={() => {
              pipeline.setAuthCompleted();
            }}
          />
        );

      case 'AppInstallationNeeded':
        if (!selectedRepo) return <LoadingSpinner message="Loading..." />;
        return (
          <AppInstallScreen
            owner={selectedRepo.owner}
            repo={selectedRepo.repo}
            installUrl={appInstallUrl}
            isChecking={isCheckingInstall}
            onCheckAgain={checkRepoAndApp}
            onCancel={onClose}
          />
        );

      case 'Configured':
        if (!selectedRepo) {
          if (!gitHubAuth.octokit) return <LoadingSpinner message="Connecting..." />;
          return (
            <Box sx={{ width: '100%', maxWidth: 600 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Select a Repository
              </Typography>
              <RepoSelector octokit={gitHubAuth.octokit} onRepoSelect={setSelectedRepo} />
            </Box>
          );
        }
        // Will auto-proceed to CheckingRepo via useEffect
        return <LoadingSpinner message="Initializing..." />;

      case 'CheckingRepo':
        return <LoadingSpinner message="Checking repository readiness..." />;

      case 'ReadyForSetup': {
        if (!pipeline.state.config) return <LoadingSpinner message="Loading configuration..." />;

        // Sub-screen: container configuration
        if (showingContainerConfig) {
          return (
            <Box sx={{ maxWidth: 700, width: '100%' }}>
              <Button
                startIcon={<Icon icon="mdi:arrow-left" />}
                onClick={() => setShowingContainerConfig(false)}
                sx={{ mb: 2, textTransform: 'none' }}
              >
                Back to Setup Review
              </Button>
              <ConfigureContainer
                containerConfig={localContainerConfig}
                requireContainerImage={false}
              />
            </Box>
          );
        }

        const readiness = pipeline.state.repoReadiness;
        const filesAlreadyExist = !!(readiness?.hasSetupWorkflow && readiness?.hasAgentConfig);
        return (
          <AgentSetupReview
            config={pipeline.state.config}
            onSetupAgent={handleCreateSetupPR}
            identityId={identityId}
            onIdentityIdChange={setIdentityId}
            appName={localAppName}
            onAppNameChange={setLocalAppName}
            filesExist={filesAlreadyExist}
            onConfigureContainer={() => setShowingContainerConfig(true)}
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
            onBack={onClose}
            onCheckNow={setupPrPolling.pollNow}
            onClose={onClose}
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
            onBack={onClose}
            onCheckNow={agentPrDiscoveryPollNow}
            onClose={onClose}
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
            onBack={onClose}
            onCheckNow={generatedPrPolling.pollNow}
            onClose={onClose}
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
            onClose={onClose}
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
          <Card sx={{ maxWidth: 560, width: '100%', p: 4 }}>
            <CardContent>
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
              <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                <Button variant="contained" onClick={() => pipeline.retry()}>
                  Retry
                </Button>
                <Button variant="outlined" onClick={onClose}>
                  Back
                </Button>
              </Box>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  })();

  return (
    <PipelineErrorBoundary onClose={onClose}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          p: 3,
          minHeight: '100%',
        }}
      >
        {content}
      </Box>
    </PipelineErrorBoundary>
  );
}
