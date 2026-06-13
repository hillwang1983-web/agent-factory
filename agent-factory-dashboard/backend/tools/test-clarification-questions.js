#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data,
        });
      });
    });

    req.on('error', (err) => { reject(err); });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING CLARIFICATION QUESTIONS LIFECYCLE INTEGRATION TESTS ---');
  const baseUrl = 'http://localhost:3011';
  const aduId = 'REQ-MVP-004';
  const workspaceRoot = '/Users/hill/open5gs';

  // 1. Load and backup registry
  const registryAduPath = path.join(workspaceRoot, '.ai-agent', 'registry', 'adu.json');
  console.log(`Loading registry from: ${registryAduPath}`);
  const aduData = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
  const aduIndex = aduData.adus.findIndex(a => a.id === aduId);
  if (aduIndex === -1) {
    throw new Error(`ADU ${aduId} not found in registry`);
  }
  const originalState = aduData.adus[aduIndex].state;
  const originalQuestions = aduData.adus[aduIndex].clarification_questions || null;
  const originalClarifications = aduData.adus[aduIndex].clarifications || null;

  console.log(`Original state of ${aduId}: ${originalState}`);

  try {
    // 2. Inject pending blocking question and set state to analysis_review
    aduData.adus[aduIndex].state = 'analysis_review';
    aduData.adus[aduIndex].clarification_questions = [
      {
        id: 'test-q1',
        question: 'Is this a mock blocking question for testing?',
        blocking: true,
        status: 'pending',
        answer: null,
        answered_at: null
      }
    ];
    fs.writeFileSync(registryAduPath, JSON.stringify(aduData, null, 2), 'utf-8');
    console.log(`Injected pending blocking question and forced state to: analysis_review`);

    // Prepare simulated analysis review document to allow eventual approve
    const analysisDocPath = path.join(workspaceRoot, '.ai-agent', 'analysis', `${aduId}.md`);
    fs.mkdirSync(path.dirname(analysisDocPath), { recursive: true });
    const originalDocExists = fs.existsSync(analysisDocPath);
    let originalDocContent = '';
    if (originalDocExists) {
      originalDocContent = fs.readFileSync(analysisDocPath, 'utf-8');
    }
    fs.writeFileSync(analysisDocPath, '# Analysis Review Document\nValid document for integration testing.', 'utf-8');

    // 3. Test blocker: Approve analysis review should fail with 400 due to unresolved question
    console.log('\n--- Test Case 1: Approve blocked by pending question (Expected: 400) ---');
    const resApproveBlocked = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/reviews/analysis/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Approved blocked check' })
    });
    console.log(`Status code: ${resApproveBlocked.statusCode}`);
    console.log(`Response: ${resApproveBlocked.data}`);
    if (resApproveBlocked.statusCode !== 400 || !resApproveBlocked.data.includes('存在未解答的阻塞性澄清问题')) {
      throw new Error('Expected 400 and blocking warning message when pending questions exist.');
    }
    console.log('  [PASS] Successfully blocked approval.');

    // 3.1 Test Invalid Status Validation: Submit status "foo"
    console.log('\n--- Test Case 1.1: Submit invalid status "foo" (Expected: 400) ---');
    const resInvalidStatus = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/clarifications/test-q1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'foo' })
    });
    console.log(`Status code: ${resInvalidStatus.statusCode}`);
    console.log(`Response: ${resInvalidStatus.data}`);
    if (resInvalidStatus.statusCode !== 400 || !resInvalidStatus.data.includes('Invalid status value')) {
      throw new Error('Expected 400 when submitting invalid status value.');
    }
    console.log('  [PASS] Successfully validated status value runtime constraints.');

    // 3.2 Test Approve Blocked after Invalid Status Submission
    console.log('\n--- Test Case 1.2: Approve still blocked after invalid status test (Expected: 400) ---');
    const resApproveBlocked2 = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/reviews/analysis/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Approved blocked check 2' })
    });
    console.log(`Status code: ${resApproveBlocked2.statusCode}`);
    console.log(`Response: ${resApproveBlocked2.data}`);
    if (resApproveBlocked2.statusCode !== 400 || !resApproveBlocked2.data.includes('存在未解答的阻塞性澄清问题')) {
      throw new Error('Expected 400 approval block to remain intact.');
    }
    console.log('  [PASS] Successfully blocked approval after invalid status attempt.');

    // 3.3 Test Answer Required for Answered Status: Submit answered status with blank answer
    console.log('\n--- Test Case 1.3: Submit answered status with blank answer (Expected: 400) ---');
    const resBlankAnswer = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/clarifications/test-q1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'answered', answer: '   ' })
    });
    console.log(`Status code: ${resBlankAnswer.statusCode}`);
    console.log(`Response: ${resBlankAnswer.data}`);
    if (resBlankAnswer.statusCode !== 400 || !resBlankAnswer.data.includes('Answer is required')) {
      throw new Error('Expected 400 when submitting blank answer for status answered.');
    }
    console.log('  [PASS] Successfully validated blank answer constraint.');

    // 4. Test API: Submit answer for the question

    console.log('\n--- Test Case 2: Answer clarification question (Expected: 200) ---');
    const resAnswer = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/clarifications/test-q1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'Yes, it is a mock question.', status: 'answered' })
    });
    console.log(`Status code: ${resAnswer.statusCode}`);
    console.log(`Response: ${resAnswer.data}`);
    if (resAnswer.statusCode !== 200) {
      throw new Error(`Failed to submit answer: ${resAnswer.data}`);
    }

    // Verify changes persisted to registry
    const registryAfterAnswer = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const aduAfterAnswer = registryAfterAnswer.adus.find(a => a.id === aduId);
    const q1 = aduAfterAnswer.clarification_questions.find(q => q.id === 'test-q1');
    if (q1.status !== 'answered' || q1.answer !== 'Yes, it is a mock question.') {
      throw new Error(`Question q1 was not updated correctly in registry: ${JSON.stringify(q1)}`);
    }
    const legacyClar = aduAfterAnswer.clarifications.find(c => c.question === q1.question);
    if (!legacyClar || legacyClar.answer !== 'Yes, it is a mock question.' || legacyClar.status !== 'answered') {
      throw new Error(`Legacy clarifications array was not synced correctly: ${JSON.stringify(legacyClar)}`);
    }
    console.log('  [PASS] Successfully updated question state and synced legacy clarifications.');

    // 5. Test approve: Approve should now succeed with 200
    console.log('\n--- Test Case 3: Approve review after resolving question (Expected: 200) ---');
    const resApproveSuccess = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/reviews/analysis/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Approved after resolution' })
    });
    console.log(`Status code: ${resApproveSuccess.statusCode}`);
    console.log(`Response: ${resApproveSuccess.data}`);
    if (resApproveSuccess.statusCode !== 200) {
      throw new Error(`Expected successful approval but got code ${resApproveSuccess.statusCode}`);
    }
    console.log('  [PASS] Successfully approved review after resolving question.');

  } finally {
    // 6. Clean up and restore registry and files
    console.log('\nRestoring state and clean up...');
    const aduDataRestore = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const restoreIndex = aduDataRestore.adus.findIndex(a => a.id === aduId);
    if (restoreIndex !== -1) {
      aduDataRestore.adus[restoreIndex].state = originalState;
      if (originalQuestions === null) {
        delete aduDataRestore.adus[restoreIndex].clarification_questions;
      } else {
        aduDataRestore.adus[restoreIndex].clarification_questions = originalQuestions;
      }
      if (originalClarifications === null) {
        delete aduDataRestore.adus[restoreIndex].clarifications;
      } else {
        aduDataRestore.adus[restoreIndex].clarifications = originalClarifications;
      }
      fs.writeFileSync(registryAduPath, JSON.stringify(aduDataRestore, null, 2), 'utf-8');
      console.log(`Restored adu ${aduId} registry details to original.`);
    }

    const analysisDocPath = path.join(workspaceRoot, '.ai-agent', 'analysis', `${aduId}.md`);
    if (fs.existsSync(analysisDocPath)) {
      fs.unlinkSync(analysisDocPath);
    }
  }

  console.log('\n--- CLARIFICATION INTEGRATION TESTS COMPLETED SUCCESSFULLY ---');
}

runTests().catch(e => {
  console.error('Test FAILED:', e);
  process.exit(1);
});
