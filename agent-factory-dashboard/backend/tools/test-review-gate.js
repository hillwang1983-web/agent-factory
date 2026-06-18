const http = require('http');
const fs = require('fs');
const path = require('path');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = {
      'x-ha-test': 'true',
      ...(options.headers || {})
    };
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: headers,
    };
    
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data,
        });
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING REVIEW GATE QA INTEGRATION TESTS ---');
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3011';
  const aduId = 'REQ-MVP-004';
  const workspaceRoot = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../..');
  
  console.log(`Target Base URL: ${baseUrl}`);
  console.log(`Workspace Root: ${workspaceRoot}`);

  // 1. Prepare registry file to review state
  const registryAduPath = path.join(workspaceRoot, '.ai-agent', 'registry', 'adu.json');
  console.log(`Loading registry at: ${registryAduPath}`);
  const aduData = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
  const aduIndex = aduData.adus.findIndex(a => a.id === aduId);
  if (aduIndex === -1) {
    throw new Error(`Adu ${aduId} not found in registry`);
  }
  const originalState = aduData.adus[aduIndex].state;
  console.log(`Original state of ${aduId}: ${originalState}`);

  // Set state to analysis_review to test approval blocker
  aduData.adus[aduIndex].state = 'analysis_review';
  fs.writeFileSync(registryAduPath, JSON.stringify(aduData, null, 2), 'utf-8');
  console.log(`Forced state of ${aduId} to: analysis_review`);

  const analysisDocPath = path.join(workspaceRoot, '.ai-agent', 'analysis', `${aduId}.md`);
  let backupContent = '';
  if (fs.existsSync(analysisDocPath)) {
    backupContent = fs.readFileSync(analysisDocPath, 'utf-8');
  }

  try {
    // Test Blocker A: Document does not exist
    console.log('\n--- Test Case 1: Document does not exist (Expected: 400) ---');
    if (fs.existsSync(analysisDocPath)) {
      fs.unlinkSync(analysisDocPath);
    }
    
    const resA = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/reviews/analysis/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Approve without document test' })
    });
    console.log(`Status code: ${resA.statusCode}`);
    console.log(`Response: ${resA.data}`);
    if (resA.statusCode !== 400 || !resA.data.includes('无法读取审核文档')) {
      throw new Error('Expected 400 when document does not exist.');
    }
    console.log('  [PASS] Successfully blocked non-existent document.');

    // Test Blocker B: Document is empty
    console.log('\n--- Test Case 2: Document is empty (Expected: 400) ---');
    fs.mkdirSync(path.dirname(analysisDocPath), { recursive: true });
    fs.writeFileSync(analysisDocPath, '   \n   \n', 'utf-8');
    
    const resB = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/reviews/analysis/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Approve with empty document test' })
    });
    console.log(`Status code: ${resB.statusCode}`);
    console.log(`Response: ${resB.data}`);
    if (resB.statusCode !== 400 || !resB.data.includes('内容为空')) {
      throw new Error('Expected 400 when document content is empty.');
    }
    console.log('  [PASS] Successfully blocked empty document.');

    // Test Blocker C: Concurrent process lock check
    console.log('\n--- Test Case 3: Concurrent process lock (Expected: 409) ---');
    const lockDir = path.join(workspaceRoot, '.ai-agent', 'locks');
    fs.mkdirSync(lockDir, { recursive: true });
    const projectId = aduData.adus[aduIndex].project_id || 'default-open5gs';
    const lockPath = path.join(lockDir, `${projectId}__${aduId}.lock`);
    
    const lockData = {
      adu_id: aduId,
      mode: 'continue',
      pid: 99999,
      created_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString()
    };
    fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), 'utf-8');
    console.log(`Wrote simulated lock file to: ${lockPath}`);

    const resLock = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/continue`, {
      method: 'POST'
    });
    console.log(`Status code: ${resLock.statusCode}`);
    console.log(`Response: ${resLock.data}`);
    if (resLock.statusCode !== 409 || !resLock.data.includes('already being processed')) {
      throw new Error('Expected 409 when concurrent process lock exists.');
    }
    console.log('  [PASS] Successfully blocked concurrent orchestrator start.');

    // Remove simulated lock
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
    console.log('Cleaned up simulated lock.');

    // Test case 4: Pending Review linkage updates
    console.log('\n--- Test Case 4: Pending review log update ---');
    // Prepare a simulated reviews.json containing a pending review
    const reviewsPath = path.join(workspaceRoot, '.ai-agent', 'registry', 'reviews.json');
    let reviewsWrapper = { version: 1, reviews: [] };
    if (fs.existsSync(reviewsPath)) {
      reviewsWrapper = JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
    }
    // Delete any existing pending review for this adu to keep it clean
    reviewsWrapper.reviews = (reviewsWrapper.reviews || []).filter(r => !(r.adu_id === aduId && r.gate === 'analysis' && r.status === 'pending'));
    
    // Add a simulated pending review
    const testReviewId = `review-${aduId}-analysis-${Date.now()}`;
    reviewsWrapper.reviews.push({
      review_id: testReviewId,
      adu_id: aduId,
      gate: 'analysis',
      state: 'analysis_review',
      status: 'pending',
      artifact_paths: [`.ai-agent/analysis/${aduId}.md`],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
      comment: null,
      approved_hashes: {}
    });
    fs.writeFileSync(reviewsPath, JSON.stringify(reviewsWrapper, null, 2), 'utf-8');
    console.log(`Prepared simulated reviews.json with pending review: ${testReviewId}`);

    // Restore valid document to allow successful approval
    fs.writeFileSync(analysisDocPath, '# Valid Document\nSome analysis notes.', 'utf-8');
    
    console.log('Approving the review now...');
    const resApprove = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/reviews/analysis/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Approved by integration test script' })
    });
    console.log(`Status code: ${resApprove.statusCode}`);
    console.log(`Response: ${resApprove.data}`);
    
    if (resApprove.statusCode !== 200) {
      throw new Error(`Failed to approve: ${resApprove.data}`);
    }

    // Verify reviews.json updated the pending review instead of creating a new one
    const updatedReviewsWrapper = JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
    const matchedReview = (updatedReviewsWrapper.reviews || []).find(r => r.review_id === testReviewId);
    if (!matchedReview) {
      throw new Error('Pending review record was lost or a new one was pushed instead of updating the existing one.');
    }
    console.log(`Matched review: ${JSON.stringify(matchedReview, null, 2)}`);
    if (matchedReview.status !== 'approved' || matchedReview.comment !== 'Approved by integration test script') {
      throw new Error(`Review record status/comment not updated correctly: ${matchedReview.status}`);
    }
    console.log('  [PASS] Successfully updated pending review record.');

  } finally {
    // Restore original state and document content
    console.log('\nRestoring state and clean up...');
    const currentAduData = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const currIdx = currentAduData.adus.findIndex(a => a.id === aduId);
    if (currIdx !== -1) {
      currentAduData.adus[currIdx].state = originalState;
      fs.writeFileSync(registryAduPath, JSON.stringify(currentAduData, null, 2), 'utf-8');
      console.log(`Restored adu ${aduId} state to: ${originalState}`);
    }

    if (backupContent) {
      fs.writeFileSync(analysisDocPath, backupContent, 'utf-8');
      console.log('Restored original analysis document content.');
    } else if (fs.existsSync(analysisDocPath)) {
      fs.unlinkSync(analysisDocPath);
    }
  }

  console.log('\n--- ALL QA FIXES INTEGRATION TESTS PASSED SUCCESSFULY! ---');
}

runTests().catch(e => {
  console.error('Test FAILED:', e);
  process.exit(1);
});
