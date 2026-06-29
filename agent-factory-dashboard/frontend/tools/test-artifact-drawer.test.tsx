import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactDrawer } from '../src/components/agent-factory/ArtifactDrawer';
import * as storeModule from '../src/stores/agentFactory';

vi.mock('../src/stores/agentFactory', () => ({
  useAgentFactoryStore: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe('ArtifactDrawer', () => {
  it('shows an explicit empty-log message when availability is empty', () => {
    (storeModule.useAgentFactoryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedArtifactPath: '.ai-agent/runs/example/stderr.md',
      artifactContent: '',
      artifactTruncated: false,
      artifactAvailability: 'empty',
      openArtifact: vi.fn(),
      closeArtifact: vi.fn(),
    });

    render(<ArtifactDrawer />);

    expect(screen.getByText('本次运行未产生 stderr/stdout')).toBeDefined();
  });

  it('shows not recorded message when availability is not_recorded', () => {
    (storeModule.useAgentFactoryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedArtifactPath: '.ai-agent/runs/example/stderr.md',
      artifactContent: '',
      artifactTruncated: false,
      artifactAvailability: 'not_recorded',
      openArtifact: vi.fn(),
      closeArtifact: vi.fn(),
    });

    render(<ArtifactDrawer />);

    expect(screen.getByText('该历史运行未持久化日志')).toBeDefined();
  });

  it('shows error state with retry button when loading fails', () => {
    const openArtifactMock = vi.fn();
    (storeModule.useAgentFactoryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedArtifactPath: '.ai-agent/runs/example/stderr.md',
      artifactContent: null,
      artifactTruncated: false,
      artifactAvailability: 'error',
      openArtifact: openArtifactMock,
      closeArtifact: vi.fn(),
    });

    render(<ArtifactDrawer />);

    expect(screen.getByText('Error loading artifact content.')).toBeDefined();
    const retryBtn = screen.getByText('Retry');
    expect(retryBtn).toBeDefined();

    fireEvent.click(retryBtn);
    expect(openArtifactMock).toHaveBeenCalledWith('.ai-agent/runs/example/stderr.md');
  });
});
