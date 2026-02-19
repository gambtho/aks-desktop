// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import React from 'react';

interface PipelineConfiguredScreenProps {
  repoFullName: string;
  onClose: () => void;
}

export function PipelineConfiguredScreen({ repoFullName, onClose }: PipelineConfiguredScreenProps) {
  return (
    <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
      <CardContent>
        <Box
          component={Icon}
          icon="mdi:check-circle"
          sx={{ fontSize: 64, color: 'success.main', mb: 2 }}
        />
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
          Pipeline Configured
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mb: 4 }}>
          CI/CD pipeline for <strong>{repoFullName}</strong> is ready. Trigger deployments from the
          Deploy tab.
        </Typography>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </CardContent>
    </Card>
  );
}
