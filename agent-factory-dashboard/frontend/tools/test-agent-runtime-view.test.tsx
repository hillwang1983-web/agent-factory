import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AgentRuntimeTable } from '../src/components/agent-factory/AgentRuntimeTable';
import { AgentRuntimeRow } from '../src/components/agent-factory/AgentRuntimeRow';
import { AgentRuntimeFilters } from '../src/components/agent-factory/AgentRuntimeFilters';
import React from 'react';
import * as storeModule from '../src/stores/agentFactory';
import * as apiModule from '../src/api/agentFactory';

// Mock zustand store
vi.mock('../src/stores/agentFactory', () => ({
  useAgentFactoryStore: vi.fn(),
}));

// Mock api
vi.mock('../src/api/agentFactory', () => ({
  agentFactoryApi: {
    fetchAgentRuntimeStatus: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
});

describe('AgentRuntimeFilters', () => {
  it('Has 4 runtime status labels and failed is not a runtime status', () => {
    const onStatusFilterChange = vi.fn();
    render(
      <AgentRuntimeFilters
        scope="global"
        onScopeChange={() => {}}
        statusFilter={[]}
        onStatusFilterChange={onStatusFilterChange}
        search=""
        onSearchChange={() => {}}
        hasSelectedAdu={true}
      />
    );

    // Check for the 4 status labels
    expect(screen.getByText('Running')).toBeDefined();
    expect(screen.getByText('Ready')).toBeDefined();
    expect(screen.getByText('Needs Attention')).toBeDefined();
    expect(screen.getByText('Idle')).toBeDefined();

    // Failed should not exist
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('Scope toggle exists and ADU filter disabled when no ADU selected', () => {
    const { rerender } = render(
      <AgentRuntimeFilters
        scope="global"
        onScopeChange={() => {}}
        statusFilter={[]}
        onStatusFilterChange={() => {}}
        search=""
        onSearchChange={() => {}}
        hasSelectedAdu={false}
      />
    );

    const globalBtn = screen.getByText('Global');
    const aduBtn = screen.getByText('Current ADU');

    expect(globalBtn).toBeDefined();
    expect(aduBtn).toBeDefined();

    // Check if Current ADU button is disabled/styled differently when no ADU selected
    expect(aduBtn.className).toContain('opacity-50 cursor-not-allowed');

    // Re-render with ADU selected
    rerender(
      <AgentRuntimeFilters
        scope="global"
        onScopeChange={() => {}}
        statusFilter={[]}
        onStatusFilterChange={() => {}}
        search=""
        onSearchChange={() => {}}
        hasSelectedAdu={true}
      />
    );

    expect(aduBtn.className).not.toContain('opacity-50 cursor-not-allowed');
  });
});

describe('AgentRuntimeRow', () => {
  it('Agent ID has break-words for mobile and row layout handles responsive classes', () => {
    const mockAgent = {
      id: 'very-long-agent-id-that-should-not-be-truncated-because-break-words',
      description: 'Test agent',
      runtime_status: 'running',
      success_rate: 100,
      stale_warning: { stale: false },
      current_operations: [],
      queued_targets: [],
      attention_items: [],
      last_result: null,
      last_run_at: null
    };

    const { container } = render(<AgentRuntimeRow agent={mockAgent as any} />);

    // The agent ID should be visible and have break-words
    const agentIdEl = screen.getAllByText(mockAgent.id)[0];
    expect(agentIdEl.className).toContain('break-words');
    expect(agentIdEl.className).not.toContain('truncate');

    // Desktop view wrapper
    const desktopView = container.querySelector('.hidden.md\\:grid');
    expect(desktopView).not.toBeNull();

    // Mobile view wrapper
    const mobileView = container.querySelector('.md\\:hidden');
    expect(mobileView).not.toBeNull();
  });
});

describe('AgentRuntimeTable', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('Search and status filters combine to API call', async () => {
    (storeModule.useAgentFactoryStore as any).mockReturnValue({
      selectedAduId: null,
      dashboard: { generated_at: '2023-01-01' }
    });

    const mockFetch = apiModule.agentFactoryApi.fetchAgentRuntimeStatus as any;
    mockFetch.mockResolvedValue({
      summary: {},
      agents: []
    });

    render(<AgentRuntimeTable />);

    // Initial fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith({
        scope: 'global',
        aduId: undefined,
        status: [],
        search: ''
      });
    });

    // Simulate search typing
    const searchInput = screen.getByPlaceholderText('Search agents...');
    fireEvent.change(searchInput, { target: { value: 'tester' } });

    // Simulate status filter click
    const runningBtn = screen.getByText('Running');
    fireEvent.click(runningBtn);

    // API should be called with both
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith({
        scope: 'global',
        aduId: undefined,
        status: ['running'],
        search: 'tester'
      });
    });
  });
});
