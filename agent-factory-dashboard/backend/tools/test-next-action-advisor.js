#!/usr/bin/env node
const { NextActionAdvisor } = require('../dist/application/operator/next-action-advisor');

let passed = 0;
let failed = 0;

function assert(label, fn) {
  try {
    fn();
    console.log(`✅  ${label}`);
    passed++;
  } catch (e) {
    console.error(`❌  ${label}: ${e.message}`);
    failed++;
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

function runTests() {
  const advisor = new NextActionAdvisor();

  assert('ADU created state recommends start', () => {
    const adu = { id: 'ADU-1', state: 'created' };
    const nextAction = advisor.getNextActionForAdu(adu);
    // NextActionAdvisor methods might be async, let's wrap synchronously or use Promise if they return Promise.
    // Wait, let's check: next-action-advisor methods are declared async in typescript!
    // So they return promises. Let's make the test async.
  });
}

async function runAsyncTests() {
  const advisor = new NextActionAdvisor();

  await assertAsync('ADU created state recommends start', async () => {
    const adu = { id: 'ADU-1', state: 'created', project_id: 'proj1' };
    const res = await advisor.getNextActionForAdu(adu);
    eq(res.recommended_action, 'start');
    eq(res.priority, 'required');
    eq(res.safe_to_auto_continue, true);
  });

  await assertAsync('ADU analysis_review state with pending clarifications recommends answering them', async () => {
    const adu = {
      id: 'ADU-1',
      state: 'analysis_review',
      project_id: 'proj1',
      clarification_questions: [{ id: 'q1', status: 'pending', question: 'What limit?' }]
    };
    const res = await advisor.getNextActionForAdu(adu);
    eq(res.recommended_action, 'answer_clarifications');
    eq(res.priority, 'required');
  });

  await assertAsync('ADU design_review recommends approve_review', async () => {
    const adu = { id: 'ADU-1', state: 'design_review', project_id: 'proj1' };
    const res = await advisor.getNextActionForAdu(adu);
    eq(res.recommended_action, 'approve_review');
    eq(res.priority, 'required');
    eq(res.required_inputs.length, 1);
  });

  await assertAsync('ADU human_gate write_path_expansion recommends approve_write_path', async () => {
    const adu = { id: 'ADU-1', state: 'human_gate', gate_type: 'write_path_expansion', project_id: 'proj1' };
    const res = await advisor.getNextActionForAdu(adu);
    eq(res.recommended_action, 'approve_write_path');
    eq(res.priority, 'required');
    eq(res.required_inputs[0].key, 'request_id');
  });

  await assertAsync('Epic created state recommends start', async () => {
    const epic = { id: 'EPIC-1', state: 'created', project_id: 'proj1' };
    const res = await advisor.getNextActionForEpic(epic);
    eq(res.recommended_action, 'start');
    eq(res.priority, 'required');
    eq(res.safe_to_auto_continue, true);
  });

  await assertAsync('Epic split_required state recommends materialize_child_adus', async () => {
    const epic = { id: 'EPIC-1', state: 'split_required', project_id: 'proj1' };
    const res = await advisor.getNextActionForEpic(epic);
    eq(res.recommended_action, 'materialize_child_adus');
    eq(res.priority, 'required');
  });

  console.log(`\nNextActionAdvisor tests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

async function assertAsync(label, fn) {
  try {
    await fn();
    console.log(`✅  ${label}`);
    passed++;
  } catch (e) {
    console.error(`❌  ${label}: ${e.message}`);
    failed++;
  }
}

runAsyncTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
