// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';

interface KubeContainer {
  image?: string;
  ports?: Array<{ containerPort?: number }>;
  env?: Array<{ name?: string; value?: string }>;
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  securityContext?: {
    runAsNonRoot?: boolean;
    readOnlyRootFilesystem?: boolean;
    allowPrivilegeEscalation?: boolean;
  };
  livenessProbe?: KubeProbe;
  readinessProbe?: KubeProbe;
  startupProbe?: KubeProbe;
}

interface KubeProbe {
  httpGet?: { path?: string };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  failureThreshold?: number;
  successThreshold?: number;
}

interface KubeDeploymentInput {
  metadata?: { name?: string };
  spec?: {
    replicas?: number;
    template?: {
      spec?: {
        containers?: KubeContainer[];
        securityContext?: { runAsNonRoot?: boolean };
        affinity?: { podAntiAffinity?: unknown };
        topologySpreadConstraints?: unknown[];
      };
    };
  };
}

interface KubeServiceInput {
  spec?: {
    type?: string;
    ports?: Array<{ port?: number }>;
  };
}

/**
 * Extracts a partial ContainerConfig from a live K8s Deployment (and optional
 * Service) resource so the DeployWizard can be pre-populated for editing.
 *
 * Only HTTP GET probes are extracted — exec / TCP probes are ignored and the
 * corresponding enable flag is set to false.
 */
export function extractContainerConfigFromDeployment(
  deployment: KubeDeploymentInput | null | undefined,
  service?: KubeServiceInput
): Partial<ContainerConfig> {
  const meta = deployment?.metadata ?? {};
  const spec = deployment?.spec ?? {};
  const templateSpec = spec?.template?.spec ?? {};
  const container = templateSpec?.containers?.[0];

  if (!container) {
    return { appName: meta.name ?? '' };
  }

  const result: Record<string, unknown> = {
    appName: meta.name ?? '',
    containerImage: container.image ?? '',
    replicas: spec.replicas ?? 1,
    targetPort: container.ports?.[0]?.containerPort ?? 80,
  };

  // Environment variables
  if (Array.isArray(container.env) && container.env.length > 0) {
    result.envVars = container.env
      .filter(e => e.name)
      .map(e => ({ key: e.name, value: e.value ?? '' }));
  }

  // Resources
  const resources = container.resources;
  if (resources && (resources.requests || resources.limits)) {
    result.enableResources = true;
    result.cpuRequest = resources.requests?.cpu ?? '100m';
    result.cpuLimit = resources.limits?.cpu ?? '500m';
    result.memoryRequest = resources.requests?.memory ?? '128Mi';
    result.memoryLimit = resources.limits?.memory ?? '512Mi';
  } else {
    result.enableResources = false;
  }

  // Probes
  extractProbe(container.livenessProbe, 'liveness', result);
  extractProbe(container.readinessProbe, 'readiness', result);
  extractProbe(container.startupProbe, 'startup', result);

  // Security context (container-level)
  const secCtx = container.securityContext;
  if (secCtx) {
    result.runAsNonRoot = secCtx.runAsNonRoot ?? false;
    result.readOnlyRootFilesystem = secCtx.readOnlyRootFilesystem ?? false;
    result.allowPrivilegeEscalation = secCtx.allowPrivilegeEscalation ?? false;
  }

  // Pod-level security context (runAsNonRoot can also be set here)
  const podSecCtx = templateSpec.securityContext;
  if (podSecCtx?.runAsNonRoot && !secCtx?.runAsNonRoot) {
    result.runAsNonRoot = true;
  }

  // Affinity
  result.enablePodAntiAffinity = !!templateSpec.affinity?.podAntiAffinity;
  result.enableTopologySpreadConstraints =
    Array.isArray(templateSpec.topologySpreadConstraints) &&
    templateSpec.topologySpreadConstraints.length > 0;

  // Service
  if (service) {
    const svcSpec = service?.spec ?? {};
    result.serviceType = svcSpec.type === 'LoadBalancer' ? 'LoadBalancer' : 'ClusterIP';
    const svcPort = svcSpec.ports?.[0]?.port;
    if (svcPort !== undefined && svcPort !== null) {
      result.servicePort = svcPort;
      result.useCustomServicePort = svcPort !== result.targetPort;
    }
  }

  return result as Partial<ContainerConfig>;
}

function extractProbe(
  probe: KubeProbe | undefined,
  type: 'liveness' | 'readiness' | 'startup',
  result: Record<string, unknown>
): void {
  const cap = type.charAt(0).toUpperCase() + type.slice(1);
  if (!probe || !probe.httpGet) {
    result[`enable${cap}Probe`] = false;
    return;
  }
  result[`enable${cap}Probe`] = true;
  result[`${type}Path`] = probe.httpGet.path ?? '/';
  result[`${type}InitialDelay`] = probe.initialDelaySeconds ?? 0;
  result[`${type}Period`] = probe.periodSeconds ?? 10;
  result[`${type}Timeout`] = probe.timeoutSeconds ?? 1;
  result[`${type}Failure`] = probe.failureThreshold ?? 3;
  result[`${type}Success`] = probe.successThreshold ?? 1;
}
