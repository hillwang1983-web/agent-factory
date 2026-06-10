import type { AgentFactoryDashboard, AgentFactoryRun, QualityReports, AgentFactoryProject, CreateProjectAduInput } from '../types/agent-factory';

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

  async fetchAgentFactoryDashboard(): Promise<AgentFactoryDashboard> {
    const res = await fetch(`${API_URL}/api/agent-factory/dashboard`);
    if (!res.ok) {
      throw new Error('Failed to fetch Agent Factory dashboard');
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

  async runNextStep(aduId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/agent-factory/adus/${aduId}/run-next-step`, {
      method: 'POST',
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to run next step: ${txt}`);
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
  async registerIntakeDraft(draftId: string): Promise<any> {
    const res = await fetch(`${API_URL}/api/agent-factory/intake-drafts/${draftId}/register-adu`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};
