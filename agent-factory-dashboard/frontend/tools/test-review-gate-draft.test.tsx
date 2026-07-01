import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewGatePanel } from '../src/components/agent-factory/ReviewGatePanel';
import * as storeModule from '../src/stores/agentFactory';

vi.mock('../src/stores/agentFactory', () => ({
  useAgentFactoryStore: vi.fn(),
}));

vi.mock('../src/components/agent-factory/EditableArtifactTabs', () => ({
  EditableArtifactTabs: () => null,
}));

vi.mock('../src/components/agent-factory/MarkdownArtifactEditor', () => ({
  MarkdownArtifactEditor: () => null,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function createDashboard(aduId = 'ADU-1351-003', status: 'pending' | 'answered' = 'pending', answer: string | null = null) {
  return {
    generated_at: new Date().toISOString(),
    adus: [
      {
        id: aduId,
        state: 'analysis_review',
        clarification_questions: [
          {
            id: 'Q1',
            question: 'Which compatibility mode should be used?',
            blocking: true,
            status,
            answer,
          },
        ],
      },
    ],
  };
}

describe('ReviewGatePanel clarification drafts', () => {
  it('preserves an unsubmitted answer when polling replaces the ADU snapshot', async () => {
    let storeState: any = {
      dashboard: createDashboard(),
      reviews: [],
      approveReview: vi.fn(),
      requestReviewRework: vi.fn(),
      controlEnabled: true,
      answerClarification: vi.fn(),
    };

    const useStore = storeModule.useAgentFactoryStore as any;
    useStore.mockImplementation((selector?: (state: any) => unknown) =>
      selector ? selector(storeState) : storeState
    );
    useStore.getState = () => storeState;

    const view = render(<ReviewGatePanel aduId="ADU-1351-003" />);
    const input = screen.getByPlaceholderText('请提供明确、具体的事实答案作为后续步骤的硬性约束...') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'Keep this operator draft' } });
    expect(input.value).toBe('Keep this operator draft');

    storeState = {
      ...storeState,
      dashboard: createDashboard(),
    };
    view.rerender(<ReviewGatePanel aduId="ADU-1351-003" />);

    await waitFor(() => {
      expect((screen.getByPlaceholderText('请提供明确、具体的事实答案作为后续步骤的硬性约束...') as HTMLTextAreaElement).value)
        .toBe('Keep this operator draft');
    });
  });

  it('adopts the persisted server answer after the question is submitted', async () => {
    let storeState: any = {
      dashboard: createDashboard(),
      reviews: [],
      approveReview: vi.fn(),
      requestReviewRework: vi.fn(),
      controlEnabled: true,
      answerClarification: vi.fn(),
    };

    const useStore = storeModule.useAgentFactoryStore as any;
    useStore.mockImplementation((selector?: (state: any) => unknown) =>
      selector ? selector(storeState) : storeState
    );
    useStore.getState = () => storeState;

    const view = render(<ReviewGatePanel aduId="ADU-1351-003" />);
    fireEvent.change(
      screen.getByPlaceholderText('请提供明确、具体的事实答案作为后续步骤的硬性约束...'),
      { target: { value: 'Local draft' } }
    );

    storeState = {
      ...storeState,
      dashboard: createDashboard('ADU-1351-003', 'answered', 'Persisted server answer'),
    };
    view.rerender(<ReviewGatePanel aduId="ADU-1351-003" />);

    await waitFor(() => {
      expect(screen.getByText('Persisted server answer')).toBeDefined();
    });
  });

  it('does not carry a clarification draft into another ADU', async () => {
    let storeState: any = {
      dashboard: createDashboard(),
      reviews: [],
      approveReview: vi.fn(),
      requestReviewRework: vi.fn(),
      controlEnabled: true,
      answerClarification: vi.fn(),
    };

    const useStore = storeModule.useAgentFactoryStore as any;
    useStore.mockImplementation((selector?: (state: any) => unknown) =>
      selector ? selector(storeState) : storeState
    );
    useStore.getState = () => storeState;

    const view = render(<ReviewGatePanel aduId="ADU-1351-003" />);
    fireEvent.change(
      screen.getByPlaceholderText('请提供明确、具体的事实答案作为后续步骤的硬性约束...'),
      { target: { value: 'Draft for the first ADU' } }
    );

    storeState = {
      ...storeState,
      dashboard: createDashboard('ADU-OTHER'),
    };
    view.rerender(<ReviewGatePanel aduId="ADU-OTHER" />);

    await waitFor(() => {
      expect((screen.getByPlaceholderText('请提供明确、具体的事实答案作为后续步骤的硬性约束...') as HTMLTextAreaElement).value)
        .toBe('');
    });
  });
});
