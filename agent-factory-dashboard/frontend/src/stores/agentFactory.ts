import { create } from 'zustand';
import type { AgentFactoryDashboard, QualityReports, AgentFactoryProject } from '../types/agent-factory';
import { agentFactoryApi } from '../api/agentFactory';

interface AgentFactoryState {
  dashboard: AgentFactoryDashboard | null;
  projects: AgentFactoryProject[];
  selectedProjectId: string | null; // null means 'ALL'
  isProfiling: Record<string, boolean>;
  profilingLogs: Record<string, string[]>;
  selectedAduId: string | null;
  selectedArtifactPath: string | null;
  artifactContent: string | null;
  artifactTruncated: boolean;
  loading: boolean;
  error: string | null;
  controlEnabled: boolean;
  healthLoaded: boolean;
  reviews: any[];
  editableArtifacts: any[];
  qualityReports: QualityReports | null;
  activeArtifactPath: string | null;
  activeArtifactContent: string | null;
  activeArtifactSha256: string | null;
  activeArtifactLoading: boolean;
  
  refresh: () => Promise<void>;
  setDashboard: (dashboard: AgentFactoryDashboard) => void;
  fetchProjects: () => Promise<void>;
  selectProject: (projectId: string | null) => void;
  registerProject: (params: { projectId?: string; name: string; repoPath: string; description?: string }) => Promise<void>;
  runProjectProfiling: (projectId: string) => Promise<void>;
  disableProject: (projectId: string) => Promise<void>;
  addProfilingLog: (projectId: string, log: string) => void;
  setProjectProfilingState: (projectId: string, state: boolean) => void;
  selectAdu: (aduId: string) => void;
  openArtifact: (path: string) => Promise<void>;
  closeArtifact: () => void;
  loadReviews: (aduId: string) => Promise<void>;
  loadEditableArtifacts: (aduId: string) => Promise<void>;
  loadArtifactContent: (path: string) => Promise<void>;
  loadQualityReports: (aduId: string) => Promise<void>;
  saveArtifactContent: (params: { aduId: string; gate: 'analysis' | 'design'; path: string; content: string; baseSha256: string; changeReason?: string }) => Promise<void>;
  approveReview: (aduId: string, gate: 'analysis' | 'design', comment?: string) => Promise<void>;
  requestReviewRework: (aduId: string, gate: 'analysis' | 'design', comment: string) => Promise<void>;
  runNextStep: (aduId: string) => Promise<void>;
}

export const useAgentFactoryStore = create<AgentFactoryState>((set, get) => ({
  dashboard: null,
  projects: [],
  selectedProjectId: null,
  isProfiling: {},
  profilingLogs: {},
  selectedAduId: null,
  selectedArtifactPath: null,
  artifactContent: null,
  artifactTruncated: false,
  loading: false,
  error: null,
  controlEnabled: false,
  healthLoaded: false,
  reviews: [],
  editableArtifacts: [],
  qualityReports: null,
  activeArtifactPath: null,
  activeArtifactContent: null,
  activeArtifactSha256: null,
  activeArtifactLoading: false,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      let controlEnabled = get().controlEnabled;
      let healthLoaded = get().healthLoaded;
      if (!healthLoaded) {
        try {
          const health = await agentFactoryApi.fetchHealth();
          controlEnabled = health.controlEnabled;
          healthLoaded = true;
        } catch (e) {
          console.error('Failed to fetch health control status', e);
        }
      }

      // Simultaneously load projects list and dashboard
      const [dashboard, projects] = await Promise.all([
        agentFactoryApi.fetchAgentFactoryDashboard(),
        agentFactoryApi.fetchProjects()
      ]);
      
      // Keep track of selected ADU. If none selected, or if selected disappears, select first active or first available
      let selectedAduId = get().selectedAduId;
      if (dashboard.adus.length > 0) {
        const aduExists = dashboard.adus.some((a) => a.id === selectedAduId);
        if (!aduExists) {
          // Try to select first active or default to the first one
          const activeAdu = dashboard.adus.find((a) => a.health.status === 'active');
          selectedAduId = activeAdu ? activeAdu.id : dashboard.adus[0].id;
        }
      } else {
        selectedAduId = null;
      }

      set({
        dashboard,
        projects,
        selectedAduId,
        controlEnabled,
        healthLoaded,
        loading: false,
      });

      if (selectedAduId) {
        void get().loadReviews(selectedAduId);
        void get().loadEditableArtifacts(selectedAduId);
        void get().loadQualityReports(selectedAduId);
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  setDashboard: (dashboard: AgentFactoryDashboard) => {
    let selectedAduId = get().selectedAduId;
    if (dashboard.adus.length > 0) {
      const aduExists = dashboard.adus.some((a) => a.id === selectedAduId);
      if (!aduExists) {
        const activeAdu = dashboard.adus.find((a) => a.health.status === 'active');
        selectedAduId = activeAdu ? activeAdu.id : dashboard.adus[0].id;
      }
    } else {
      selectedAduId = null;
    }

    set({ dashboard, selectedAduId });

    if (selectedAduId) {
      void get().loadReviews(selectedAduId);
      void get().loadEditableArtifacts(selectedAduId);
      void get().loadQualityReports(selectedAduId);
    }
  },

  fetchProjects: async () => {
    try {
      const projects = await agentFactoryApi.fetchProjects();
      set({ projects });
    } catch (e) {
      console.error('Failed to fetch projects list', e);
    }
  },

  selectProject: (selectedProjectId: string | null) => {
    set({ selectedProjectId });
    
    // Automatically select the first ADU belonging to this project if currently selected ADU doesn't match
    const dashboard = get().dashboard;
    if (dashboard && selectedProjectId) {
      const adusForProject = dashboard.adus.filter(a => a.project_id === selectedProjectId);
      if (adusForProject.length > 0) {
        const aduExistsInProject = adusForProject.some(a => a.id === get().selectedAduId);
        if (!aduExistsInProject) {
          get().selectAdu(adusForProject[0].id);
        }
      } else {
        set({ selectedAduId: null, reviews: [], editableArtifacts: [], qualityReports: null, activeArtifactPath: null, activeArtifactContent: null });
      }
    } else if (dashboard && !selectedProjectId) {
      // selectedProjectId is null (ALL). Default to first adu if none selected
      if (!get().selectedAduId && dashboard.adus.length > 0) {
        get().selectAdu(dashboard.adus[0].id);
      }
    }
  },

  registerProject: async (params) => {
    set({ loading: true, error: null });
    try {
      await agentFactoryApi.registerProject(params);
      await get().refresh();
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  runProjectProfiling: async (projectId) => {
    get().setProjectProfilingState(projectId, true);
    set({ profilingLogs: { ...get().profilingLogs, [projectId]: ['[System] Spawning project profiling agent...\n'] } });
    try {
      await agentFactoryApi.runProjectProfiling(projectId);
    } catch (e) {
      get().setProjectProfilingState(projectId, false);
      get().addProfilingLog(projectId, `[System Error] Failed to run profiling: ${String(e)}\n`);
      throw e;
    }
  },

  disableProject: async (projectId) => {
    set({ loading: true, error: null });
    try {
      await agentFactoryApi.disableProject(projectId);
      if (get().selectedProjectId === projectId) {
        set({ selectedProjectId: null });
      }
      await get().refresh();
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  addProfilingLog: (projectId, log) => {
    const logs = get().profilingLogs[projectId] || [];
    set({
      profilingLogs: {
        ...get().profilingLogs,
        [projectId]: [...logs, log]
      }
    });
  },

  setProjectProfilingState: (projectId, state) => {
    set({
      isProfiling: {
        ...get().isProfiling,
        [projectId]: state
      }
    });
  },

  selectAdu: (selectedAduId: string) => {
    set({ selectedAduId, activeArtifactPath: null, activeArtifactContent: null, activeArtifactSha256: null });
    void get().loadReviews(selectedAduId);
    void get().loadEditableArtifacts(selectedAduId);
    void get().loadQualityReports(selectedAduId);
  },

  openArtifact: async (path: string) => {
    set({ selectedArtifactPath: path, artifactContent: 'Loading...', artifactTruncated: false });
    try {
      const selectedAduId = get().selectedAduId;
      const result = await agentFactoryApi.fetchAgentFactoryArtifact(path, undefined, selectedAduId || undefined);
      set({
        artifactContent: result.content,
        artifactTruncated: result.truncated,
      });
    } catch (error) {
      set({
        artifactContent: `Error loading artifact content:\n${String(error)}`,
        artifactTruncated: false,
      });
    }
  },

  closeArtifact: () => {
    set({ selectedArtifactPath: null, artifactContent: null, artifactTruncated: false });
  },

  loadReviews: async (aduId: string) => {
    try {
      const { reviews } = await agentFactoryApi.fetchReviews(aduId);
      set({ reviews });
    } catch (e) {
      console.error('Failed to load reviews', e);
    }
  },

  loadEditableArtifacts: async (aduId: string) => {
    try {
      const { artifacts } = await agentFactoryApi.fetchEditableArtifacts(aduId);
      set({ editableArtifacts: artifacts });
      
      const activePath = get().activeArtifactPath;
      if (activePath) {
        const stillExists = artifacts.some(a => a.path === activePath && a.exists);
        if (!stillExists) {
          set({ activeArtifactPath: null, activeArtifactContent: null, activeArtifactSha256: null });
        }
      }
    } catch (e) {
      console.error('Failed to load editable artifacts', e);
    }
  },

  loadArtifactContent: async (path: string) => {
    set({ activeArtifactPath: path, activeArtifactLoading: true });
    try {
      const selectedAduId = get().selectedAduId;
      const result = await agentFactoryApi.fetchEditableArtifactContent(path, selectedAduId || undefined);
      set({
        activeArtifactContent: result.content,
        activeArtifactSha256: result.sha256,
        activeArtifactLoading: false
      });
    } catch (e) {
      console.error('Failed to load artifact content', e);
      set({
        activeArtifactContent: `Error loading content:\n${String(e)}`,
        activeArtifactSha256: null,
        activeArtifactLoading: false
      });
    }
  },

  saveArtifactContent: async (params) => {
    try {
      const result = await agentFactoryApi.saveEditableArtifactContent(params);
      set({
        activeArtifactContent: params.content,
        activeArtifactSha256: result.sha256
      });
      void get().loadEditableArtifacts(params.aduId);
    } catch (e) {
      if ((e as Error).message === 'conflict') {
        throw new Error('conflict');
      }
      throw e;
    }
  },

  approveReview: async (aduId, gate, comment) => {
    await agentFactoryApi.approveReview(aduId, gate, comment);
    void get().refresh();
  },

  requestReviewRework: async (aduId, gate, comment) => {
    await agentFactoryApi.requestRework(aduId, gate, comment);
    void get().refresh();
  },

  runNextStep: async (aduId) => {
    await agentFactoryApi.runNextStep(aduId);
    // Await the refresh so callers see health.status='running' before returning,
    // preventing the single-step button from briefly re-enabling during the window
    // between the API response and the next scheduled store refresh.
    await get().refresh();
  },

  loadQualityReports: async (aduId) => {
    try {
      const reports = await agentFactoryApi.fetchQualityReports(aduId);
      set({ qualityReports: reports });
    } catch (e) {
      console.error('Failed to load quality reports', e);
      set({ qualityReports: null });
    }
  }
}));
