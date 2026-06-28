import type { AgentFactoryDashboard, AgentFactoryRun, QualityReports, AgentFactoryProject, CreateProjectAduInput, CreateEpicInput, AgentFactoryEpicView } from '../types/agent-factory';

const API_URL = import.meta.env.VITE_API_URL || '';

export const agentFactoryApi = {
  async fetchQualityReports(aduId: string): Promise<QualityReports> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/quality-reports`);
    if (!res.ok) {
      throw new Error('Failed to fetch quality reports');
    }
    return res.json();
  },

  async fetchHealth(): Promise<{ status: string; controlEnabled: boolean }> {
    const res = await fetch(`${API_URL}/api/health`);
    if (!res.ok) {
      throw new Error('Failed to fetch health status');
    }
    return res.json();
  },

  async fetchRuntimeInfo(): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/runtime-info`);
    if (!res.ok) {
      throw new Error('Failed to fetch runtime info');
    }
    return res.json();
  },

  async fetchAgentFactoryDashboard(): Promise<AgentFactoryDashboard> {
    const res = await fetch(`${API_URL}/api/agent-factory/dashboard`);
    if (!res.ok) {
      throw new Error('Failed to fetch Agent Factory dashboard');
    }
    return res.json();
  },

  async fetchAgentRuntimeStatus(params: {
    scope?: 'global' | 'adu';
    aduId?: string;
    status?: string[];
    search?: string;
  }): Promise<{ generated_at: string; scope: string; summary: any; agents: any[] }> {
    const query = new URLSearchParams();
    if (params.scope) query.append('scope', params.scope);
    if (params.aduId) query.append('aduId', params.aduId);
    if (params.status && params.status.length > 0) query.append('status', params.status.join(','));
    if (params.search) query.append('search', params.search);

    const res = await fetch(`${API_URL}/api/agent-factory/agents/runtime-status?${query.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch agent runtime status');
    }
    return res.json();
  },

  async fetchAgentFactoryRuns(params: {
    aduId?: string;
    agent?: string;
    limit?: number;
  }): Promise<AgentFactoryRun[]> {
    const query = new URLSearchParams();
    if (params.aduId) query.append('aduId', params.aduId);
    if (params.agent) query.append('agent', params.agent);
    if (params.limit) query.append('limit', String(params.limit));

    const res = await fetch(`${API_URL}/api/agent-factory/runs?${query.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch Agent Factory runs');
    }
    return res.json();
  },

  async fetchAgentFactoryArtifact(path: string, maxBytes?: number, aduId?: string): Promise<{
    path: string;
    content: string;
    truncated: boolean;
  }> {
    const query = new URLSearchParams();
    query.append('path', path);
    if (maxBytes !== undefined) query.append('maxBytes', String(maxBytes));
    if (aduId !== undefined) query.append('aduId', aduId);
    const res = await fetch(`${API_URL}/api/agent-factory/artifacts?${query.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch Agent Factory artifact');
    }
    return res.json();
  },

  // Orchestrator control APIs (These will return 403 unless AGENT_FACTORY_ENABLE_CONTROL is true)
  async startOrchestrator(aduId: string, language?: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ language }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to start orchestrator');
    }
  },

  async pauseAdu(aduId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/pause`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to pause ADU');
    }
  },

  async continueAdu(aduId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/continue`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to continue ADU');
    }
  },

  async cancelAdu(aduId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/cancel`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to cancel ADU');
    }
  },

  async waiveHumanGate(aduId: string, params: { reasonType: 'environment'; comment: string }): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/human-gate/waive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to waive human gate');
    }
  },

  async disposeHumanGate(aduId: string, params: {
    disposition: 'environment_waiver' | 'accept_risk' | 'request_rework' | 'provide_missing_evidence' | 'external_dependency_block' | 'cancel_adu';
    comment: string;
    affectedAssertions?: string[];
  }): Promise<{ success: boolean; state: string; disposition: any }> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/human-gate/disposition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to dispose human gate');
    }
    return res.json();
  },

  async fetchTokenBudget(aduId?: string): Promise<any> {
    const url = aduId
      ? `${API_URL}/api/agent-factory/token-budget?aduId=${aduId}`
      : `${API_URL}/api/agent-factory/token-budget`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error('Failed to fetch token budget');
    }
    return res.json();
  },

  async runNextStep(aduId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/run-next-step`, {
      method: 'POST',
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to run next step: ${txt}`);
    }
    return res.json();
  },

  async appendAduPaths(aduId: string, addWritePaths: string[], addReadPaths: string[]): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/paths`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add_write_paths: addWritePaths, add_read_paths: addReadPaths }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Failed to update paths`);
    }
  },

  async fetchReviews(aduId: string): Promise<{ aduId: string; reviews: any[] }> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/reviews`);
    if (!res.ok) {
      throw new Error('Failed to fetch reviews');
    }
    return res.json();
  },

  async approveReview(aduId: string, gate: 'analysis' | 'design', comment?: string): Promise<{ success: boolean; toState: string }> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/reviews/${gate}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to approve review: ${txt}`);
    }
    return res.json();
  },

  async requestRework(aduId: string, gate: 'analysis' | 'design', comment: string): Promise<{ success: boolean; toState: string }> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/reviews/${gate}/request-rework`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to request rework: ${txt}`);
    }
    return res.json();
  },

  async fetchEditableArtifacts(aduId: string): Promise<{ aduId: string; artifacts: any[] }> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/editable-artifacts`);
    if (!res.ok) {
      throw new Error('Failed to fetch editable artifacts');
    }
    return res.json();
  },

  async fetchEditableArtifactContent(path: string, aduId?: string): Promise<{ path: string; content: string; sha256: string; bytes: number }> {
    const query = new URLSearchParams({ path });
    if (aduId) query.append('aduId', aduId);
    const res = await fetch(`${API_URL}/api/agent-factory/editable-artifacts/content?${query.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch editable artifact content');
    }
    return res.json();
  },

  async saveEditableArtifactContent(params: {
    aduId: string;
    gate: 'analysis' | 'design';
    path: string;
    content: string;
    baseSha256: string;
    changeReason?: string;
  }): Promise<{ ok: boolean; path: string; sha256: string; bytes: number }> {
    const res = await fetch(`${API_URL}/api/agent-factory/editable-artifacts/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      if (res.status === 409) {
        throw new Error('conflict');
      }
      const txt = await res.text();
      throw new Error(txt || 'Failed to save artifact content');
    }
    return res.json();
  },

  async fetchProjects(): Promise<AgentFactoryProject[]> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects`);
    if (!res.ok) {
      throw new Error('Failed to fetch projects');
    }
    return res.json();
  },

  async registerProject(params: {
    projectId?: string;
    name: string;
    repoPath: string;
    description?: string;
  }): Promise<{ success: boolean; project: AgentFactoryProject }> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to register project');
    }
    return res.json();
  },

  async fetchProject(projectId: string): Promise<AgentFactoryProject> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}`);
    if (!res.ok) {
      throw new Error('Failed to fetch project details');
    }
    return res.json();
  },

  async runProjectProfiling(projectId: string): Promise<{ success: boolean; status: string }> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}/profile`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to run project profiling');
    }
    return res.json();
  },

  async fetchProjectProfile(projectId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}/profile`);
    if (!res.ok) {
      throw new Error('Failed to fetch project profile');
    }
    return res.json();
  },

  async fetchProjectKnowledgeList(projectId: string): Promise<string[]> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}/knowledge`);
    if (!res.ok) {
      throw new Error('Failed to fetch project knowledge list');
    }
    return res.json();
  },

  async fetchProjectKnowledgeDoc(projectId: string, docName: string): Promise<string> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}/knowledge/${docName}`);
    if (!res.ok) {
      throw new Error('Failed to fetch project knowledge document');
    }
    return res.text();
  },

  async getAduProjectContext(aduId: string): Promise<{
    aduId: string;
    project: { project_id: string; name: string; repo_path: string; status: string };
    profile: { exists: boolean; path?: string; summary?: Record<string, unknown> };
    knowledge: Array<{ name: string; path: string; exists: boolean }>;
    policies: { allowed_read_paths: string[]; allowed_write_paths: string[]; required_commands: string[] };
  }> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/project-context`);
    if (!res.ok) {
      throw new Error('Failed to fetch ADU project context');
    }
    return res.json();
  },

  async createProjectAdu(projectId: string, input: CreateProjectAduInput): Promise<{ adu: { id: string; project_id?: string; title: string; state: string } }> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}/adus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to create project ADU');
    }
    return res.json();
  },

  async disableProject(projectId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}/disable`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to disable project');
    }
  },

  async createIntakeDraft(projectId: string, formData: FormData): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}/intake-drafts`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async generateIntakeDraft(draftId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/intake-drafts/${draftId}/generate`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async getIntakeDraft(draftId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/intake-drafts/${draftId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async updateIntakeDraft(draftId: string, updates: any): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/intake-drafts/${draftId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async registerIntakeDraft(draftId: string, targetType: 'adu' | 'epic', confirmed = false): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/intake-drafts/${draftId}/register-adu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed, target_type: targetType }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // ── Phase 3: Epic ──

  async fetchEpics(): Promise<{ epics: AgentFactoryEpicView[] }> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics`);
    if (!res.ok) throw new Error('Failed to fetch Epics');
    return res.json();
  },

  async createEpic(projectId: string, input: CreateEpicInput): Promise<{ epic: AgentFactoryEpicView }> {
    const res = await fetch(`${API_URL}/api/agent-factory/projects/${projectId}/epics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to create Epic');
    }
    return res.json();
  },

  async getEpic(epicId: string): Promise<AgentFactoryEpicView> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}`);
    if (!res.ok) throw new Error('Failed to fetch Epic');
    return res.json();
  },

  async getEpicDag(epicId: string): Promise<{ epic: AgentFactoryEpicView; children: any[]; dependencies: any[] }> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}/dag`);
    if (!res.ok) throw new Error('Failed to fetch Epic DAG');
    return res.json();
  },

  async startEpic(epicId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}/start`, { method: 'POST' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Failed to start Epic'); }
    return res.json();
  },

  async continueEpic(epicId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}/continue`, { method: 'POST' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Failed to continue Epic'); }
    return res.json();
  },

  async stepEpic(epicId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}/step`, { method: 'POST' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Failed to step Epic'); }
    return res.json();
  },

  async cancelEpic(epicId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}/cancel`, { method: 'POST' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Failed to cancel Epic'); }
    return res.json();
  },

  async pauseEpic(epicId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}/pause`, { method: 'POST' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Failed to pause Epic'); }
    return res.json();
  },

  async materializeChildAdus(epicId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}/materialize-child-adus`, { method: 'POST' });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Failed to materialize child ADUs'); }
    return res.json();
  },

  async fetchWritePathExpansions(aduId: string): Promise<{ aduId: string; requests: any[] }> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/write-path-expansions`);
    if (!res.ok) throw new Error('Failed to fetch write path expansions');
    return res.json();
  },

  async approveWritePathExpansion(aduId: string, requestId: string, comment?: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/write-path-expansions/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to approve write path expansion');
    }
    return res.json();
  },

  async rejectWritePathExpansion(aduId: string, requestId: string, comment?: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/write-path-expansions/${requestId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to reject write path expansion');
    }
    return res.json();
  },

  async getOperation(operationId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/operations/${operationId}`);
    if (!res.ok) throw new Error(`Failed to fetch operation ${operationId}`);
    return res.json();
  },

  async getLatestOperation(targetType: 'adu' | 'epic', targetId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/${targetType}s/${targetId}/operations/latest`);
    if (!res.ok) throw new Error(`Failed to fetch latest operation for ${targetType} ${targetId}`);
    return res.json();
  },

  async fetchOperations(params?: { targetId?: string; scope?: string }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.targetId) query.append('targetId', params.targetId);
    if (params?.scope) query.append('scope', params.scope);
    const res = await fetch(`${API_URL}/api/agent-factory/operations?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch operations');
    return res.json();
  },

  async fetchOperationEvents(operationId: string): Promise<any[]> {
    const res = await fetch(`${API_URL}/api/agent-factory/operations/${operationId}/events`);
    if (!res.ok) throw new Error('Failed to fetch operation events');
    return res.json();
  },

  async fetchEvents(params?: { targetId?: string; operationId?: string; limit?: number }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.targetId) query.append('targetId', params.targetId);
    if (params?.operationId) query.append('operationId', params.operationId);
    if (params?.limit) query.append('limit', String(params.limit));
    const res = await fetch(`${API_URL}/api/agent-factory/events?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch events');
    return res.json();
  },

  async fetchHumanGates(status?: string): Promise<any[]> {
    const query = new URLSearchParams();
    if (status) query.append('status', status);
    const res = await fetch(`${API_URL}/api/agent-factory/human-gates?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch human gates');
    return res.json();
  },

  async fetchHumanGate(gateId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/human-gates/${gateId}`);
    if (!res.ok) throw new Error('Failed to fetch human gate');
    return res.json();
  },

  async submitRuntimeResult(gateId: string, params: { command: string; exitCode: number; output: string }): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/human-gates/${gateId}/runtime-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Failed to submit runtime result');
  },

  async approveWaiver(gateId: string, params: { assertion_ids: string[]; waiver_type: string; reason: string; risk: string; follow_up: string; operator: string }): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/human-gates/${gateId}/waive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Failed to approve waiver');
  },

  async requestHumanGateRework(gateId: string, params: { targetAgent: 'developer' | 'rework-planner'; instruction: string }): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/human-gates/${gateId}/request-rework`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Failed to request rework');
  },

  async cancelGate(gateId: string, reason: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/human-gates/${gateId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error('Failed to cancel gate');
  },

  async approveGate(gateId: string, comment?: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/human-gates/${gateId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    if (!res.ok) throw new Error('Failed to approve gate');
  },

  async fetchEvidenceMatrix(aduId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/evidence-matrix`);
    if (!res.ok) throw new Error('Failed to fetch evidence matrix');
    return res.json();
  },

  async validateEvidence(aduId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/validate-evidence`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to validate evidence');
    return res.json();
  },

  async fetchTokenGovernance(): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/token-governance`);
    if (!res.ok) throw new Error('Failed to fetch token governance config');
    return res.json();
  },

  async updateTokenGovernance(configData: any): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/token-governance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configData),
    });
    if (!res.ok) throw new Error('Failed to update token governance');
  },

  async estimateNextRun(aduId: string, agent: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/token-governance/estimate-next-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aduId, agent }),
    });
    if (!res.ok) throw new Error('Failed to estimate next run');
    return res.json();
  },

  async reconcileEpic(epicId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/epics/${epicId}/reconcile`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to reconcile epic');
    return res.json();
  },

  async answerClarification(aduId: string, questionId: string, params: { answer?: string; status?: 'pending' | 'answered' | 'deferred' }): Promise<any> {

    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/clarifications/${questionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to submit clarification');
    }
    return res.json();
  },

  async fetchNextAction(targetType: 'adu' | 'epic', targetId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/operator/${targetType}/${targetId}/next-action`);
    if (!res.ok) throw new Error('Failed to fetch next action');
    return res.json();
  },

  async executeOperatorAction(targetType: 'adu' | 'epic', targetId: string, actionData: {
    action: string;
    idempotency_key: string;
    requested_by?: string;
    payload?: any;
  }): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/operator/${targetType}/${targetId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actionData),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to execute operator action');
    }
    return res.json();
  },

  async fetchHandoff(targetType: 'adu' | 'epic', targetId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/operator/${targetType}/${targetId}/handoff`);
    if (!res.ok) throw new Error('Failed to fetch handoff summary');
    return res.json();
  },

  async submitOperatorIntake(intakeData: {
    project_id: string;
    raw_requirement: string;
    preferred_granularity?: string;
    language?: string;
  }): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/operator/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intakeData),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to submit intake');
    }
    return res.json();
  },

  // ── Operator Override ──
  async applyRunOverride(aduId: string, runTimestamp: string, input: any): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/runs/${runTimestamp}/override`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Failed to apply override'); }
    return res.json();
  },
  async getRunOverrides(aduId: string): Promise<{ aduId: string; overrides: any[] }> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/overrides`);
    if (!res.ok) throw new Error('Failed to fetch overrides');
    return res.json();
  },
};


// Named exports for direct use in components
export const createIntakeDraft = (projectId: string, formData: FormData) =>
  agentFactoryApi.createIntakeDraft(projectId, formData);
export const generateIntakeDraft = (draftId: string) =>
  agentFactoryApi.generateIntakeDraft(draftId);
export const getIntakeDraft = (draftId: string) =>
  agentFactoryApi.getIntakeDraft(draftId);
export const updateIntakeDraft = (draftId: string, updates: any) =>
  agentFactoryApi.updateIntakeDraft(draftId, updates);
export const registerIntakeDraft = (draftId: string, targetType: 'adu' | 'epic', confirmed = false) =>
  agentFactoryApi.registerIntakeDraft(draftId, targetType, confirmed);
export const getOperation = (operationId: string) =>
  agentFactoryApi.getOperation(operationId);
export const getLatestOperation = (targetType: 'adu' | 'epic', targetId: string) =>
  agentFactoryApi.getLatestOperation(targetType, targetId);
export const fetchNextAction = (targetType: 'adu' | 'epic', targetId: string) =>
  agentFactoryApi.fetchNextAction(targetType, targetId);
export const executeOperatorAction = (targetType: 'adu' | 'epic', targetId: string, actionData: any) =>
  agentFactoryApi.executeOperatorAction(targetType, targetId, actionData);
export const fetchHandoff = (targetType: 'adu' | 'epic', targetId: string) =>
  agentFactoryApi.fetchHandoff(targetType, targetId);
export const submitOperatorIntake = (intakeData: any) =>
  agentFactoryApi.submitOperatorIntake(intakeData);
export const fetchRuntimeInfo = () =>
  agentFactoryApi.fetchRuntimeInfo();
