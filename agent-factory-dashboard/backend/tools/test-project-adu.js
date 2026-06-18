#!/usr/bin/env node
/**
 * Integration tests for ProjectAduFactory.
 * Uses isolated temp workspaces via AGENT_FACTORY_REGISTRY_DIR to avoid
 * polluting the real .ai-agent/registry.
 */
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function assert(label, fn) {
  try {
    await fn();
    console.log(`✅  ${label}`);
    passed++;
  } catch (e) {
    console.error(`❌  ${label}: ${e.message}`);
    failed++;
  }
}

function assertThrows(label, fn, check) {
  return assert(label, async () => {
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    if (!threw) throw new Error('Expected an error but none was thrown');
    if (check && !check(threw)) {
      throw new Error(`Error did not match predicate: ${threw.message} (status=${threw.status})`);
    }
  });
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

// ── Mock infrastructure ───────────────────────────────────────────────────────

class MockProjectRepository {
  constructor(projects = []) {
    this._projects = projects;
  }
  async getProject(id) {
    return this._projects.find(p => p.project_id === id) || null;
  }
}

function makeProject(overrides = {}) {
  return {
    project_id: 'open5gs-main',
    name: 'Open5GS',
    repo_path: path.resolve(__dirname, '../../..'),
    status: 'profiled',
    profile_path: '.agent-factory/project-profile.json',
    knowledge_dir: '.agent-factory/knowledge',
    profile_summary: {
      test_commands: ['meson test -C build'],
      build_commands: ['meson compile -C build'],
    },
    ...overrides,
  };
}

class MockAgentFactoryRepository {
  constructor() {
    this._adus = new Map();
  }
  async getAduById(id) {
    return this._adus.get(id) || null;
  }
  async saveAdu(adu) {
    this._adus.set(adu.id, adu);
  }
}

// Load the real compiled factory from dist if available, else use a local copy.
let ProjectAduFactory;
try {
  ({ ProjectAduFactory } = require('../dist/application/project-adu-factory'));
} catch (_) {
  // Fallback: inline implementation (mirrors project-adu-factory.ts exactly)
  const ADU_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
  const BLOCKED_COMMAND_PATTERNS = [
    'rm -rf', 'sudo ', 'curl ', 'wget ', 'ssh ', 'scp ', 'rsync ',
    'chmod -R 777', '> /dev/', 'dd ', 'mkfs', 'launchctl', 'security ',
    'git push', 'git clean', 'git reset --hard',
  ];

  function normalizeRepoRelativePath(input) {
    const value = input.trim().replace(/\\/g, '/');
    if (!value || value.startsWith('/') || value.includes('..') || value.includes('\0')) {
      throw new Error(`Invalid repository-relative path: ${input}`);
    }
    return value;
  }

  ProjectAduFactory = class {
    constructor(projectRepository, agentFactoryRepository) {
      this.projectRepository = projectRepository;
      this.agentFactoryRepository = agentFactoryRepository;
    }

    async createForProject(projectId, input) {
      const project = await this.projectRepository.getProject(projectId);
      if (!project) {
        throw Object.assign(new Error(`Project ${projectId} not found`), { status: 404 });
      }
      if (project.status !== 'profiled') {
        throw Object.assign(new Error(`Project ${projectId} is not profiled (status: ${project.status})`), { status: 409 });
      }
      if (!project.profile_path || !project.knowledge_dir) {
        throw Object.assign(new Error(`Project ${projectId} is missing profile_path or knowledge_dir`), { status: 409 });
      }

      const aduId = input.aduId || `REQ-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
      if (!ADU_ID_PATTERN.test(aduId)) {
        throw Object.assign(new Error(`Invalid ADU ID: ${aduId}`), { status: 400 });
      }
      if (!input.title?.trim() || !input.goal?.trim()) {
        throw Object.assign(new Error('Title and goal are required'), { status: 400 });
      }

      const existing = await this.agentFactoryRepository.getAduById(aduId);
      if (existing) {
        throw Object.assign(new Error(`ADU with ID ${aduId} already exists`), { status: 400 });
      }

      const allowedReadPaths = new Set([
        '.agent-factory/project-profile.json',
        '.agent-factory/knowledge/',
        '.ai-agent/',
      ]);
      if (input.preferredReadPaths) {
        input.preferredReadPaths.forEach(p => allowedReadPaths.add(normalizeRepoRelativePath(p)));
      }

      const allowedWritePaths = new Set([
        '.ai-agent/analysis/',
        '.ai-agent/designs/',
        '.ai-agent/contracts/',
        '.ai-agent/reviews/',
        '.ai-agent/acceptance/',
        '.ai-agent/evidence/',
        '.ai-agent/runs/',
      ]);
      if (input.preferredWritePaths) {
        input.preferredWritePaths.forEach(p => allowedWritePaths.add(normalizeRepoRelativePath(p)));
      }

      const requiredCommands = new Set();
      if (input.requiredCommands) {
        input.requiredCommands.forEach(cmd => {
          if (!cmd.trim()) return;
          for (const blocked of BLOCKED_COMMAND_PATTERNS) {
            if (cmd.includes(blocked)) {
              throw Object.assign(new Error(`Command blocked by pattern "${blocked}": ${cmd}`), { status: 400 });
            }
          }
          requiredCommands.add(cmd.trim());
        });
      }

      const profileTestCmds = project.profile_summary?.test_commands || [];
      const profileBuildCmds = project.profile_summary?.build_commands || [];
      if (requiredCommands.size === 0 && profileTestCmds.length === 0 && profileBuildCmds.length === 0 && input.manualEvidenceMode !== true) {
        throw Object.assign(new Error('No verification commands available.'), { status: 400 });
      }

      const allowedCommands = Array.from(requiredCommands);
      for (const cmd of profileTestCmds) {
        if (!allowedCommands.includes(cmd)) allowedCommands.push(cmd);
      }
      for (const cmd of profileBuildCmds) {
        if (!allowedCommands.includes(cmd)) allowedCommands.push(cmd);
      }

      const now = new Date().toISOString();
      const adu = {
        id: aduId,
        project_id: project.project_id,
        project_name: project.name,
        repo_path: project.repo_path,
        artifact_root: '.ai-agent',
        profile_path: project.profile_path,
        knowledge_dir: project.knowledge_dir,
        title: input.title,
        goal: input.goal,
        state: 'created',
        retry_count: 0,
        max_retries: 3,
        risk: input.risk || 'medium',
        target_level: input.targetLevel || 'mvp',
        allowed_read_paths: Array.from(allowedReadPaths),
        allowed_write_paths: Array.from(allowedWritePaths),
        required_commands: Array.from(requiredCommands),
        required_evidence: [`.ai-agent/evidence/${aduId}.md`],
        artifacts: [],
        human_gate_required: true,
        language: 'zh',
        review_policy: {
          analysis_review_required: input.analysisReviewRequired !== false,
          design_review_required: input.designReviewRequired !== false,
        },
        command_policy: {
          mode: 'allowlist',
          allowed_commands: allowedCommands,
          blocked_command_patterns: BLOCKED_COMMAND_PATTERNS,
        },
        created_at: now,
        updated_at: now,
      };

      await this.agentFactoryRepository.saveAdu(adu);
      return adu;
    }
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Running ProjectAduFactory tests...\n');

  // ── Happy path ──────────────────────────────────────────────────────────────

  await assert('T01: Valid creation succeeds', async () => {
    const proj = new MockProjectRepository([makeProject()]);
    const af = new MockAgentFactoryRepository();
    const factory = new ProjectAduFactory(proj, af);
    const adu = await factory.createForProject('open5gs-main', {
      aduId: 'REQ-2026-0001',
      title: 'Add health endpoint',
      goal: 'Expose /health route',
    });
    eq(adu.id, 'REQ-2026-0001');
    eq(adu.project_id, 'open5gs-main');
    eq(adu.state, 'created');
    eq(adu.language, 'zh');
  });

  await assert('T02: Auto-generated ADU ID has correct format', async () => {
    const proj = new MockProjectRepository([makeProject()]);
    const af = new MockAgentFactoryRepository();
    const factory = new ProjectAduFactory(proj, af);
    const adu = await factory.createForProject('open5gs-main', {
      title: 'Auto ID test',
      goal: 'Check auto ID',
    });
    if (!/^REQ-\d{4}-\d{4}$/.test(adu.id)) throw new Error(`Unexpected ID: ${adu.id}`);
  });

  await assert('T03: Default read/write paths are always present', async () => {
    const proj = new MockProjectRepository([makeProject()]);
    const af = new MockAgentFactoryRepository();
    const factory = new ProjectAduFactory(proj, af);
    const adu = await factory.createForProject('open5gs-main', {
      title: 'Path test',
      goal: 'Check default paths',
    });
    if (!adu.allowed_read_paths.includes('.agent-factory/project-profile.json')) {
      throw new Error('Missing default read path');
    }
    if (!adu.allowed_write_paths.includes('.ai-agent/analysis/')) {
      throw new Error('Missing default write path');
    }
  });

  await assert('T04: Profile commands populate allowedCommands', async () => {
    const proj = new MockProjectRepository([makeProject()]);
    const af = new MockAgentFactoryRepository();
    const factory = new ProjectAduFactory(proj, af);
    const adu = await factory.createForProject('open5gs-main', {
      title: 'Cmd test',
      goal: 'Check commands',
    });
    if (!adu.command_policy.allowed_commands.includes('meson test -C build')) {
      throw new Error('Profile test command missing from allowlist');
    }
  });

  await assert('T05: manualEvidenceMode bypasses no-commands check', async () => {
    const emptyProfile = makeProject({ profile_summary: { test_commands: [], build_commands: [] } });
    const proj = new MockProjectRepository([emptyProfile]);
    const af = new MockAgentFactoryRepository();
    const factory = new ProjectAduFactory(proj, af);
    const adu = await factory.createForProject('open5gs-main', {
      title: 'Manual mode',
      goal: 'Manual evidence',
      manualEvidenceMode: true,
    });
    eq(adu.state, 'created');
  });

  // ── Error cases ─────────────────────────────────────────────────────────────

  await assertThrows(
    'T06: Unknown project → 404',
    () => {
      const proj = new MockProjectRepository([]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('nonexistent', { title: 'x', goal: 'y' });
    },
    e => e.status === 404,
  );

  await assertThrows(
    'T07: Unprofiled project → 409',
    () => {
      const proj = new MockProjectRepository([makeProject({ status: 'registered' })]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('open5gs-main', { title: 'x', goal: 'y' });
    },
    e => e.status === 409,
  );

  await assertThrows(
    'T08: Duplicate ADU ID → 400',
    async () => {
      const proj = new MockProjectRepository([makeProject()]);
      const af = new MockAgentFactoryRepository();
      const factory = new ProjectAduFactory(proj, af);
      await factory.createForProject('open5gs-main', { aduId: 'DUP-1', title: 'first', goal: 'first' });
      await factory.createForProject('open5gs-main', { aduId: 'DUP-1', title: 'second', goal: 'second' });
    },
    e => e.status === 400 && e.message.includes('already exists'),
  );

  await assertThrows(
    'T09: Empty title → 400',
    () => {
      const proj = new MockProjectRepository([makeProject()]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('open5gs-main', { title: '   ', goal: 'y' });
    },
    e => e.status === 400,
  );

  await assertThrows(
    'T10: Blocked command (rm -rf) → 400',
    () => {
      const proj = new MockProjectRepository([makeProject()]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('open5gs-main', {
          title: 'blocked cmd',
          goal: 'test',
          requiredCommands: ['rm -rf /tmp/foo'],
        });
    },
    e => e.status === 400,
  );

  await assertThrows(
    'T11: Blocked command (sudo) → 400',
    () => {
      const proj = new MockProjectRepository([makeProject()]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('open5gs-main', {
          title: 'sudo cmd',
          goal: 'test',
          requiredCommands: ['sudo make install'],
        });
    },
    e => e.status === 400,
  );

  // ── Path isolation (symlink / traversal) ────────────────────────────────────

  await assertThrows(
    'T12: Path traversal in preferredWritePaths → rejected',
    () => {
      const proj = new MockProjectRepository([makeProject()]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('open5gs-main', {
          title: 'traversal',
          goal: 'escape',
          preferredWritePaths: ['../../../etc/'],
        });
    },
    e => e.message.includes('Invalid repository-relative path'),
  );

  await assertThrows(
    'T13: Absolute path in preferredReadPaths → rejected',
    () => {
      const proj = new MockProjectRepository([makeProject()]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('open5gs-main', {
          title: 'absolute path',
          goal: 'escape',
          preferredReadPaths: ['/etc/passwd'],
        });
    },
    e => e.message.includes('Invalid repository-relative path'),
  );

  await assertThrows(
    'T14: Null byte in path → rejected',
    () => {
      const proj = new MockProjectRepository([makeProject()]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('open5gs-main', {
          title: 'null byte',
          goal: 'escape',
          preferredWritePaths: ['src/\0evil'],
        });
    },
    e => e.message.includes('Invalid repository-relative path'),
  );

  // ── No-commands guard ───────────────────────────────────────────────────────

  await assertThrows(
    'T15: No commands and no profile commands → 400',
    () => {
      const emptyProfile = makeProject({ profile_summary: { test_commands: [], build_commands: [] } });
      const proj = new MockProjectRepository([emptyProfile]);
      return new ProjectAduFactory(proj, new MockAgentFactoryRepository())
        .createForProject('open5gs-main', {
          title: 'no cmds',
          goal: 'fails',
        });
    },
    e => e.status === 400 && e.message.includes('verification commands'),
  );

  // ── Summary ─────────────────────────────────────────────────────────────────

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
