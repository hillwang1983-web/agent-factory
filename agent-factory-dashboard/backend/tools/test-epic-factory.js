#!/usr/bin/env node
/**
 * Integration tests for EpicFactory and Epic repository.
 * Uses isolated temp workspaces.
 */
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

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

// ── Mock infrastructure ──

class MockProjectRepository {
  constructor(projects = []) { this._projects = projects; }
  async getProject(id) { return this._projects.find(p => p.project_id === id) || null; }
}

function makeProject(overrides = {}) {
  return {
    project_id: 'test-project',
    name: 'Test Project',
    repo_path: '/tmp/test-repo',
    status: 'profiled',
    profile_path: '.agent-factory/project-profile.json',
    knowledge_dir: '.agent-factory/knowledge',
    ...overrides,
  };
}

class MockEpicRepository {
  constructor() { this._epics = []; }
  async readEpics() { return [...this._epics]; }
  async saveEpic(epic) {
    const idx = this._epics.findIndex(e => e.id === epic.id);
    if (idx >= 0) this._epics[idx] = epic;
    else this._epics.push(epic);
  }
  async getEpic(epicId) { return this._epics.find(e => e.id === epicId) || null; }
  async listEpicsByProject(projectId) { return this._epics.filter(e => e.project_id === projectId); }
  getEpics() { return [...this._epics]; }
}

async function main() {
  console.log('── Epic Factory Tests ──\n');

  let { EpicFactory } = require('../dist/application/epic-factory');
  if (!EpicFactory) {
    // Fallback: import from TypeScript via ts-node
    const tsNode = require;
    EpicFactory = require('../src/application/epic-factory').EpicFactory;
  }

  // Test 1: Create Epic for profiled project
  await assert('creates Epic for profiled project', async () => {
    const projectRepo = new MockProjectRepository([makeProject()]);
    const epicRepo = new MockEpicRepository();
    const factory = new EpicFactory(projectRepo, epicRepo);

    const epic = await factory.createForProject('test-project', {
      title: 'Test Epic',
      source_requirement: 'A test requirement',
    });

    eq(epic.project_id, 'test-project');
    eq(epic.title, 'Test Epic');
    eq(epic.state, 'created');
    eq(epic.language, 'zh');
    eq(epic.risk, 'medium');
    eq(epic.child_adus.length, 0);
    eq(typeof epic.id, 'string');
    if (!epic.id.startsWith('EPIC-')) throw new Error(`Expected Epic ID to start with EPIC-, got: ${epic.id}`);
    eq(epicRepo.getEpics().length, 1);
  });

  // Test 2: Reject non-profiled project
  await assertThrows('rejects non-profiled project', async () => {
    const projectRepo = new MockProjectRepository([makeProject({ status: 'registered' })]);
    const epicRepo = new MockEpicRepository();
    const factory = new EpicFactory(projectRepo, epicRepo);
    await factory.createForProject('test-project', { title: 'X', source_requirement: 'Y' });
  }, (e) => e.status === 409);

  // Test 3: Reject missing project
  await assertThrows('rejects missing project', async () => {
    const projectRepo = new MockProjectRepository([]);
    const epicRepo = new MockEpicRepository();
    const factory = new EpicFactory(projectRepo, epicRepo);
    await factory.createForProject('no-such-project', { title: 'X', source_requirement: 'Y' });
  }, (e) => e.status === 404);

  // Test 4: Reject disabled project
  await assertThrows('rejects disabled project', async () => {
    const projectRepo = new MockProjectRepository([makeProject({ status: 'disabled' })]);
    const epicRepo = new MockEpicRepository();
    const factory = new EpicFactory(projectRepo, epicRepo);
    await factory.createForProject('test-project', { title: 'X', source_requirement: 'Y' });
  }, (e) => e.status === 409);

  // Test 5: Reject empty title
  await assertThrows('rejects empty title', async () => {
    const projectRepo = new MockProjectRepository([makeProject()]);
    const epicRepo = new MockEpicRepository();
    const factory = new EpicFactory(projectRepo, epicRepo);
    await factory.createForProject('test-project', { title: '', source_requirement: 'Y' });
  }, (e) => e.status === 400);

  // Test 6: Reject empty source_requirement
  await assertThrows('rejects empty source_requirement', async () => {
    const projectRepo = new MockProjectRepository([makeProject()]);
    const epicRepo = new MockEpicRepository();
    const factory = new EpicFactory(projectRepo, epicRepo);
    await factory.createForProject('test-project', { title: 'X', source_requirement: '' });
  }, (e) => e.status === 400);

  // Test 7: Unique Epic IDs
  await assert('generates unique Epic IDs', async () => {
    const projectRepo = new MockProjectRepository([makeProject()]);
    const epicRepo = new MockEpicRepository();
    const factory = new EpicFactory(projectRepo, epicRepo);

    const e1 = await factory.createForProject('test-project', { title: 'T1', source_requirement: 'R1' });
    const e2 = await factory.createForProject('test-project', { title: 'T2', source_requirement: 'R2' });

    eq(e1.id === e2.id, false, 'Epic IDs should be different');
  });

  // Test 8: List Epics by project
  await assert('lists Epics by project', async () => {
    const projectRepo = new MockProjectRepository([
      makeProject({ project_id: 'proj-a' }),
      makeProject({ project_id: 'proj-b' }),
    ]);
    const epicRepo = new MockEpicRepository();
    const factory = new EpicFactory(projectRepo, epicRepo);

    await factory.createForProject('proj-a', { title: 'A1', source_requirement: 'R1' });
    await factory.createForProject('proj-a', { title: 'A2', source_requirement: 'R2' });
    await factory.createForProject('proj-b', { title: 'B1', source_requirement: 'R3' });

    const projAEpics = await epicRepo.listEpicsByProject('proj-a');
    eq(projAEpics.length, 2);
    const projBEpics = await epicRepo.listEpicsByProject('proj-b');
    eq(projBEpics.length, 1);
  });

  // ── Summary ──
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
