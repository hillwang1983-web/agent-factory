#!/usr/bin/env node
/**
 * Integration tests for AduIntake use case.
 * Tests file validation, path/command safety, registration guards.
 * Uses isolated temp registries (never writes to real .ai-agent/registry).
 */
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let passed = 0, failed = 0;

async function assert(label, fn) {
  try { await fn(); console.log(`✅  ${label}`); passed++; }
  catch (e) { console.error(`❌  ${label}: ${e.message}`); failed++; }
}
function assertThrows(label, fn, check) {
  return assert(label, async () => {
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    if (!threw) throw new Error('Expected an error but none was thrown');
    if (check && !check(threw)) throw new Error(`Error mismatch: ${threw.message}`);
  });
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'Expected truthy'); }

// ── Build AduIntake under test ─────────────────────────────────────────────
const { AduIntake } = require('../dist/application/adu-intake');
const { ProjectAduFactory } = require('../dist/application/project-adu-factory');

// ── Mock infrastructure ────────────────────────────────────────────────────
class MockProjectRepository {
  constructor(projects = []) { this._p = projects; }
  async getProject(id) { return this._p.find(p => p.project_id === id) || null; }
}

class MockAduRepository {
  constructor() { this._adus = []; }
  async getAduById(id) { return this._adus.find(a => a.id === id) || null; }
  async saveAdu(adu) { this._adus.push(adu); return adu; }
}

function makeProject(overrides = {}) {
  return {
    project_id: 'test-proj',
    name: 'Test Project',
    status: 'profiled',
    profile_path: '.agent-factory/project-profile.json',
    knowledge_dir: '.agent-factory/knowledge',
    profile_summary: { build_commands: [], test_commands: ['python3 tests/run.py'] },
    ...overrides,
  };
}

async function makeIntake(tmpDir, projectOverrides = {}) {
  const repoPath = path.join(tmpDir, 'repo');
  await fs.mkdir(path.join(repoPath, '.ai-agent', 'registry'), { recursive: true });
  const project = makeProject({ repo_path: repoPath, ...projectOverrides });
  const projRepo = new MockProjectRepository([project]);
  const aduRepo = new MockAduRepository();
  const factory = new ProjectAduFactory(projRepo, aduRepo);
  const intake = new AduIntake(projRepo, factory, tmpDir);
  return { intake, project, repoPath, aduRepo };
}

async function makeTempFile(tmpDir, name, content) {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, content);
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { path: p, originalname: name, size: buf.length };
}

// ── Tests ─────────────────────────────────────────────────────────────────
async function run() {
  console.log('Running AduIntake tests...\n');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-test-'));

  // T01: Create draft from text only
  await assert('T01: create draft from text only', async () => {
    const { intake } = await makeIntake(tmp);
    const r = await intake.createDraft('test-proj', 'Add smoke test', '', 'feature', []);
    ok(r.draft_id.startsWith('DRAFT-'), 'draft_id prefix');
    eq(r.status, 'created');
  });

  // T02: Create draft from .md upload
  await assert('T02: create draft from .md upload', async () => {
    const { intake } = await makeIntake(tmp);
    const f = await makeTempFile(tmp, 'req.md', '# Requirement\nAdd feature X');
    const r = await intake.createDraft('test-proj', '', '', 'feature', [f]);
    ok(r.draft_id);
  });

  // T03: Create draft from text + upload combined
  await assert('T03: create draft from text + upload combined', async () => {
    const { intake } = await makeIntake(tmp);
    const f = await makeTempFile(tmp, 'spec.txt', 'Spec content here');
    const r = await intake.createDraft('test-proj', 'Also add this', '', 'feature', [f]);
    ok(r.draft_id);
  });

  // T04: Reject unsupported extension
  await assertThrows('T04: reject unsupported extension (.pdf)', async () => {
    const { intake } = await makeIntake(tmp);
    const f = await makeTempFile(tmp, 'file.pdf', 'PDF content');
    await intake.createDraft('test-proj', '', '', 'feature', [f]);
  }, e => e.message.includes('Unsupported'));

  // T05: Reject file with NUL bytes
  await assertThrows('T05: reject binary file (NUL bytes)', async () => {
    const { intake } = await makeIntake(tmp);
    const f = await makeTempFile(tmp, 'binary.md', Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));
    await intake.createDraft('test-proj', '', '', 'feature', [f]);
  }, e => e.message.includes('NUL'));

  // T06: Reject oversized file (> 200KB)
  await assertThrows('T06: reject oversized file (>200KB)', async () => {
    const { intake } = await makeIntake(tmp);
    const bigContent = 'x'.repeat(201 * 1024);
    const f = await makeTempFile(tmp, 'big.md', bigContent);
    f.size = bigContent.length;
    await intake.createDraft('test-proj', '', '', 'feature', [f]);
  }, e => e.message.includes('200KB'));

  // T07: Reject total size > 1MB
  await assertThrows('T07: reject total upload > 1MB', async () => {
    const { intake } = await makeIntake(tmp);
    // Create 6 files of 200KB each = 1.2MB total
    const files = [];
    for (let i = 0; i < 6; i++) {
      const f = await makeTempFile(tmp, `chunk${i}.txt`, 'y'.repeat(200 * 1024));
      f.size = 200 * 1024;
      files.push(f);
    }
    await intake.createDraft('test-proj', '', '', 'feature', files);
  }, e => e.message.includes('1 MB'));

  // T08: Reject draft creation for non-profiled project
  await assertThrows('T08: reject non-profiled project', async () => {
    const { intake } = await makeIntake(tmp, { status: 'registered' });
    await intake.createDraft('test-proj', 'text', '', 'feature', []);
  }, e => e.message.includes('profiled'));

  // T09: updateDraft rejects path traversal
  await assertThrows('T09: updateDraft rejects path traversal in writePaths', async () => {
    const { intake } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    // Manually write a draft.json so updateDraft can read it
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({ title: 't', goal: 'g', risk: 'low', targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: [], analysisReviewRequired: true, designReviewRequired: true, manualEvidenceMode: false }), 'utf-8');
    await intake.updateDraft(draft_id, { preferredWritePaths: ['../../.ssh'] });
  }, e => e.message.includes('..'));

  // T10: updateDraft rejects blocked command
  await assertThrows('T10: updateDraft rejects blocked command (rm -rf)', async () => {
    const { intake } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({ title: 't', goal: 'g', risk: 'low', targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: [], analysisReviewRequired: true, designReviewRequired: true, manualEvidenceMode: false }), 'utf-8');
    await intake.updateDraft(draft_id, { requiredCommands: ['rm -rf /'] });
  }, e => e.message.includes('blocked'));

  // T11: registerDraft rejects empty requiredCommands + manualEvidenceMode=false
  await assertThrows('T11: registerDraft blocks empty commands + manualEvidenceMode=false', async () => {
    const { intake } = await makeIntake(tmp, {
      profile_summary: { build_commands: [], test_commands: [] },
    });
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'some goal here that is long enough', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: [],
      analysisReviewRequired: true, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'high', questions: [], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));
    await intake.registerDraft(draft_id);
  }, e => e.message.includes('manualEvidenceMode') || e.message.includes('commands'));

  // T12: registerDraft blocks low-confidence without confirmed
  await assertThrows('T12: registerDraft blocks confidence=low without confirmed', async () => {
    const { intake } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'goal long enough here', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: ['python3 tests/run.py'],
      analysisReviewRequired: true, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'low', questions: [], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));
    await intake.registerDraft(draft_id, { confirmed: false });
  }, e => e.message.includes('confidence'));

  // T13: registerDraft blocks non-empty questions without confirmed
  await assertThrows('T13: registerDraft blocks non-empty questions without confirmed', async () => {
    const { intake } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'goal long enough here', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: ['python3 tests/run.py'],
      analysisReviewRequired: true, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'high', questions: ['Is scope correct?'], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));
    await intake.registerDraft(draft_id, { confirmed: false });
  }, e => e.message.includes('question'));

  // T15: registerDraft succeeds with answered questions
  await assert('T15: registerDraft succeeds with answered questions', async () => {
    const { intake, aduRepo } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'Original Goal Text', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: ['python3 tests/run.py'],
      analysisReviewRequired: false, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'high', questions: ['Question 1?'], question_answers: [{
        question: 'Question 1?',
        answer: 'My Answer 1',
        status: 'answered',
        impact: 'design'
      }], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));

    const { adu_id } = await intake.registerDraft(draft_id);
    const createdAdu = await aduRepo.getAduById(adu_id);
    ok(createdAdu, 'ADU created');
    eq(createdAdu.clarifications[0].answer, 'My Answer 1', 'clarification answer matches');
    ok(createdAdu.goal.includes('用户澄清问题'), 'goal contains header');
    ok(createdAdu.goal.includes('Question 1?'), 'goal contains question');
    ok(createdAdu.goal.includes('My Answer 1'), 'goal contains answer');
  });

  // T16: registerDraft with deferred questions forces analysisReviewRequired=true
  await assert('T16: registerDraft with deferred questions forces analysisReviewRequired=true', async () => {
    const { intake, aduRepo } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'Original Goal Text', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: ['python3 tests/run.py'],
      analysisReviewRequired: false, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'high', questions: ['Question 1?'], question_answers: [{
        question: 'Question 1?',
        answer: 'My Answer 1',
        status: 'defer_to_requirement_analyst',
        impact: 'design'
      }], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));

    const { adu_id } = await intake.registerDraft(draft_id);
    const createdAdu = await aduRepo.getAduById(adu_id);
    ok(createdAdu, 'ADU created');
    eq(createdAdu.review_policy.analysis_review_required, true, 'analysis review forced');
  });

  // T17: registerDraft with out_of_scope questions succeeds
  await assert('T17: registerDraft with out_of_scope questions succeeds', async () => {
    const { intake, aduRepo } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'Original Goal Text', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: ['python3 tests/run.py'],
      analysisReviewRequired: false, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'high', questions: ['Question 1?'], question_answers: [{
        question: 'Question 1?',
        answer: '',
        status: 'out_of_scope',
        impact: 'design'
      }], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));

    const { adu_id } = await intake.registerDraft(draft_id);
    const createdAdu = await aduRepo.getAduById(adu_id);
    ok(createdAdu, 'ADU created');
    eq(createdAdu.clarifications[0].status, 'out_of_scope', 'status is out_of_scope');
  });

  // T18: registerDraft fails with empty question
  await assertThrows('T18: registerDraft fails with empty question', async () => {
    const { intake } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'Original Goal Text', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: ['python3 tests/run.py'],
      analysisReviewRequired: false, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'high', questions: ['   '], question_answers: [{
        question: '   ',
        answer: 'My Answer',
        status: 'answered',
        impact: 'design'
      }], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));
    await intake.registerDraft(draft_id);
  }, e => e.message.includes('question must not be empty'));

  // T19: registerDraft fails with oversized single answer
  await assertThrows('T19: registerDraft fails with oversized single answer', async () => {
    const { intake } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'Original Goal Text', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: ['python3 tests/run.py'],
      analysisReviewRequired: false, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'high', questions: ['Q?'], question_answers: [{
        question: 'Q?',
        answer: 'a'.repeat(4001),
        status: 'answered',
        impact: 'design'
      }], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));
    await intake.registerDraft(draft_id);
  }, e => e.message.includes('single answer must not exceed 4000'));

  // T20: registerDraft fails with oversized total answers
  await assertThrows('T20: registerDraft fails with oversized total answers', async () => {
    const { intake } = await makeIntake(tmp);
    const { draft_id } = await intake.createDraft('test-proj', 'text', '', 'feature', []);
    const meta_reg = JSON.parse(await fs.readFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), 'utf-8'));
    const meta = meta_reg.drafts.find(d => d.draft_id === draft_id);
    const draftPath = path.join(meta.repo_path, meta.draft_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, JSON.stringify({
      draft_id, project_id: 'test-proj', title: 'T', goal: 'Original Goal Text', risk: 'low',
      targetLevel: 'mvp', preferredReadPaths: [], preferredWritePaths: [], requiredCommands: ['python3 tests/run.py'],
      analysisReviewRequired: false, designReviewRequired: true, manualEvidenceMode: false,
      confidence: 'high', questions: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'], question_answers: [
        { question: 'Q1?', answer: 'a'.repeat(3500), status: 'answered', impact: 'design' },
        { question: 'Q2?', answer: 'b'.repeat(3500), status: 'answered', impact: 'design' },
        { question: 'Q3?', answer: 'c'.repeat(3500), status: 'answered', impact: 'design' },
        { question: 'Q4?', answer: 'd'.repeat(3500), status: 'answered', impact: 'design' },
        { question: 'Q5?', answer: 'e'.repeat(3500), status: 'answered', impact: 'design' },
        { question: 'Q6?', answer: 'f'.repeat(3500), status: 'answered', impact: 'design' }
      ], status: 'draft_ready'
    }), 'utf-8');
    meta_reg.drafts.find(d => d.draft_id === draft_id).status = 'draft_ready';
    await fs.writeFile(path.join(tmp, '.ai-agent', 'registry', 'intake-drafts.json'), JSON.stringify(meta_reg, null, 2));
    await intake.registerDraft(draft_id);
  }, e => e.message.includes('total answers length must not exceed 20000'));

  // T14: Tests use isolated registry (never pollute real registry)
  await assert('T14: isolated registry — no production files touched', async () => {
    const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../..');
    const realRegistry = path.join(workspaceRoot, '.ai-agent', 'registry', 'intake-drafts.json');
    let realExists = false;
    try { await fs.access(realRegistry); realExists = true; } catch (_) {}
    // If real registry exists, make sure our temp drafts aren't in it
    if (realExists) {
      const real = JSON.parse(await fs.readFile(realRegistry, 'utf-8'));
      const leaked = real.drafts?.some(d => d.draft_id?.startsWith('DRAFT-') && d.project_id === 'test-proj');
      ok(!leaked, 'Found test-proj drafts in real registry — isolation broken');
    }
    // Verify our test registry is under tmp
    ok(tmp.includes(os.tmpdir()), 'Test workspace should be under os.tmpdir()');
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
