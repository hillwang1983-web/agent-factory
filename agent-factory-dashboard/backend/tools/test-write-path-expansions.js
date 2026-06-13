const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

function runCommand(cmd, cwd) {
  console.log(`Running command: ${cmd}`);
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf-8' });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status || 1, stderr: error.stderr || error.message, stdout: error.stdout };
  }
}

async function runTests() {
  console.log('--- STARTING WRITE PATH EXPANSIONS INTEGRATION TESTS ---');
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3011';
  const aduId = 'REQ-MVP-004';
  const workspaceRoot = process.env.WORKSPACE_ROOT || '/Users/hill/open5gs';

  console.log(`Target Base URL: ${baseUrl}`);
  console.log(`Workspace Root: ${workspaceRoot}`);

  const registryAduPath = path.join(workspaceRoot, '.ai-agent', 'registry', 'adu.json');
  const requestsJsonPath = path.join(workspaceRoot, '.ai-agent', 'registry', 'write-path-expansion-requests.json');
  const contractJsonPath = path.join(workspaceRoot, '.ai-agent', 'contracts', `${aduId}.json`);

  // Backups
  const aduBackup = fs.readFileSync(registryAduPath, 'utf-8');
  let requestsBackup = fs.existsSync(requestsJsonPath) ? fs.readFileSync(requestsJsonPath, 'utf-8') : null;
  let contractBackup = fs.existsSync(contractJsonPath) ? fs.readFileSync(contractJsonPath, 'utf-8') : null;

  try {
    // 1. Setup ADU record in registry
    const aduData = JSON.parse(aduBackup);
    const aduIndex = aduData.adus.findIndex(a => a.id === aduId);
    if (aduIndex === -1) {
      throw new Error(`ADU ${aduId} not found in registry`);
    }

    // Helper to reset ADU
    const resetAduRecord = () => {
      const freshAduData = JSON.parse(aduBackup);
      freshAduData.adus[aduIndex].allowed_write_paths = ['tests/', 'lib/app/main.c'];
      freshAduData.adus[aduIndex].allowed_read_paths = ['tests/', 'docs/', 'lib/app/main.c'];
      freshAduData.adus[aduIndex].state = 'contracted';
      delete freshAduData.adus[aduIndex].gate_type;
      fs.writeFileSync(registryAduPath, JSON.stringify(freshAduData, null, 2), 'utf-8');
    };

    const writeContract = (allowed_write_paths) => {
      const contractData = {
        version: 2,
        adu_id: aduId,
        source_documents: {
          analysis: `.ai-agent/analysis/${aduId}.md`,
          design: `.ai-agent/designs/${aduId}-detailed-design.md`
        },
        scope: {
          in_scope: ["smoke-test"],
          out_of_scope: [],
          allowed_write_paths: allowed_write_paths
        },
        acceptance_assertions: [
          { id: "A1", title: "A1", requirement: "R1", verification_type: "manual_review", manual_verification_steps: ["Check"], expected_evidence: ["Evidence"], must_pass: true },
          { id: "A2", title: "A2", requirement: "R2", verification_type: "manual_review", manual_verification_steps: ["Check"], expected_evidence: ["Evidence"], must_pass: true },
          { id: "A3", title: "A3", requirement: "R3", verification_type: "manual_review", manual_verification_steps: ["Check"], expected_evidence: ["Evidence"], must_pass: true }
        ],
        negative_assertions: [
          { id: "N1", title: "N1", forbidden_change: "No forbidden change", manual_verification_steps: ["Check"], must_pass: true }
        ],
        evidence_requirements: [
          { id: "E1", assertion_id: "A1", artifact: `.ai-agent/evidence/${aduId}.json`, required_fields: ["status"] }
        ],
        quality_gates: {}
      };
      fs.mkdirSync(path.dirname(contractJsonPath), { recursive: true });
      fs.writeFileSync(contractJsonPath, JSON.stringify(contractData, null, 2), 'utf-8');
    };

    // ==========================================
    // SCENARIO 1: Purely Auto-Approvable Path
    // ==========================================
    console.log('\n--- Scenario 1: Purely Auto-Approvable Path ---');
    resetAduRecord();
    fs.writeFileSync(requestsJsonPath, JSON.stringify({ version: 1, requests: [] }, null, 2), 'utf-8');
    writeContract(["tests/smoke.js", "lib/app/meson.build"]); // meson.build is auto-approvable because lib/app/main.c is allowed

    const valResult1 = runCommand(`python3 scripts/validate_agent_contract.py --adu ${aduId}`, workspaceRoot);
    console.log(`Validator Exit Code: ${valResult1.status}`);
    if (valResult1.status !== 0) {
      throw new Error(`Expected exit code 0 for auto-approved path, got ${valResult1.status}. Output: ${valResult1.stderr || valResult1.stdout}`);
    }

    const aduData1 = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const adu1 = aduData1.adus[aduIndex];
    if (!adu1.allowed_write_paths.includes("lib/app/meson.build")) {
      throw new Error('Auto-approved path "lib/app/meson.build" was not added to allowed_write_paths');
    }
    if (!adu1.allowed_read_paths.includes("lib/app/meson.build")) {
      throw new Error('Auto-approved path "lib/app/meson.build" was not added to allowed_read_paths');
    }
    console.log('  [PASS] Auto-approved paths successfully updated in adu.json directly.');

    // ==========================================
    // SCENARIO 2: Request with Pending Path
    // ==========================================
    console.log('\n--- Scenario 2: Request with Pending Path ---');
    resetAduRecord();
    fs.writeFileSync(requestsJsonPath, JSON.stringify({ version: 1, requests: [] }, null, 2), 'utf-8');
    writeContract(["tests/smoke.js", "lib/app/meson.build", "lib/other/custom.c"]); // custom.c is pending

    const valResult2 = runCommand(`python3 scripts/validate_agent_contract.py --adu ${aduId}`, workspaceRoot);
    console.log(`Validator Exit Code: ${valResult2.status}`);
    if (valResult2.status !== 20) {
      throw new Error(`Expected exit code 20, got ${valResult2.status}`);
    }
    console.log('  [PASS] Validator exited with 20 for pending path.');

    // Verify requests.json registration
    const requestsData = JSON.parse(fs.readFileSync(requestsJsonPath, 'utf-8'));
    const pendingReq = requestsData.requests.find(r => r.adu_id === aduId && r.decision === 'pending_human_approval');
    if (!pendingReq) {
      throw new Error('Pending human approval request was not registered in write-path-expansion-requests.json');
    }
    console.log(`  [PASS] Registered pending request ID: ${pendingReq.request_id}`);

    // GET expansions API
    const getRes = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/write-path-expansions`);
    console.log(`GET status: ${getRes.statusCode}`);
    const getPayload = JSON.parse(getRes.data);
    if (getRes.statusCode !== 200 || getPayload.requests.length === 0) {
      throw new Error('Failed to fetch expansions or list is empty');
    }
    console.log(`  [PASS] GET expansions returned 200 with ${getPayload.requests.length} requests.`);

    // Approve API
    // Set ADU to human_gate state to simulate orchestrator pause
    const aduData2 = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    aduData2.adus[aduIndex].state = 'human_gate';
    aduData2.adus[aduIndex].gate_type = 'write_path_expansion';
    aduData2.adus[aduIndex].pre_gate_state = 'contracted';
    fs.writeFileSync(registryAduPath, JSON.stringify(aduData2, null, 2), 'utf-8');

    const approveRes = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/write-path-expansions/${pendingReq.request_id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Approved via integration test' })
    });
    console.log(`Approve status: ${approveRes.statusCode}`);
    const approvePayload = JSON.parse(approveRes.data);
    if (approveRes.statusCode !== 200 || !approvePayload.success) {
      throw new Error(`Approval failed: ${approveRes.data}`);
    }

    // Verify adu.json after approval
    const finalAduData = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const finalAdu = finalAduData.adus[aduIndex];
    if (!finalAdu.allowed_write_paths.includes("lib/other/custom.c")) {
      throw new Error('Approved path "lib/other/custom.c" was not added to allowed_write_paths');
    }
    if (!finalAdu.allowed_write_paths.includes("lib/app/meson.build")) {
      throw new Error('Approved path "lib/app/meson.build" was not added to allowed_write_paths');
    }
    if (finalAdu.state !== 'contracted') {
      throw new Error(`Expected state to reset to pre-gate state "contracted", got "${finalAdu.state}"`);
    }
    console.log('  [PASS] Successfully approved and synced all paths, state reset to pre-gate.');

    // Reject API
    console.log('\n--- Scenario 3: Reject API ---');
    const freshReqId = 'req-testreject';
    const freshReq = {
      request_id: freshReqId,
      adu_id: aduId,
      decision: 'pending_human_approval',
      requested_paths: ['lib/rejected/file.c'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const freshReqsData = JSON.parse(fs.readFileSync(requestsJsonPath, 'utf-8'));
    freshReqsData.requests.push(freshReq);
    fs.writeFileSync(requestsJsonPath, JSON.stringify(freshReqsData, null, 2), 'utf-8');

    const rejectRes = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/write-path-expansions/${freshReqId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Rejected via integration test' })
    });
    console.log(`Reject status: ${rejectRes.statusCode}`);
    const rejectPayload = JSON.parse(rejectRes.data);
    if (rejectRes.statusCode !== 200 || !rejectPayload.success) {
      throw new Error(`Rejection failed: ${rejectRes.data}`);
    }

    const postRejectReqs = JSON.parse(fs.readFileSync(requestsJsonPath, 'utf-8'));
    const rejectedReq = postRejectReqs.requests.find(r => r.request_id === freshReqId);
    if (rejectedReq.decision !== 'rejected') {
      throw new Error(`Expected decision to be "rejected", got "${rejectedReq.decision}"`);
    }
    console.log('  [PASS] Rejection successfully updated request status to rejected.');

    // 8. Test double approval blocker (should return 400)
    console.log('\n--- Scenario 4: Double approval blocker ---');
    const doubleApproveRes = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/write-path-expansions/${pendingReq.request_id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Double approval attempt' })
    });
    console.log(`Double approve status: ${doubleApproveRes.statusCode}`);
    if (doubleApproveRes.statusCode !== 400) {
      throw new Error(`Expected status 400 for double approval, got ${doubleApproveRes.statusCode}`);
    }
    console.log('  [PASS] Double approval request successfully blocked.');

    // 9. Test approve request containing blocked paths (should return 400 and update decision to blocked)
    console.log('\n--- Scenario 5: Blocked paths approval check ---');
    const blockedReqId = 'req-testblocked';
    const blockedReq = {
      request_id: blockedReqId,
      adu_id: aduId,
      decision: 'pending_human_approval',
      requested_paths: ['.env'], // sensitive blocked file!
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const currentReqsData = JSON.parse(fs.readFileSync(requestsJsonPath, 'utf-8'));
    currentReqsData.requests.push(blockedReq);
    fs.writeFileSync(requestsJsonPath, JSON.stringify(currentReqsData, null, 2), 'utf-8');

    const blockedApproveRes = await request(`${baseUrl}/api/agent-factory/adus/${aduId}/write-path-expansions/${blockedReqId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Approving blocked path' })
    });
    console.log(`Blocked path approve status: ${blockedApproveRes.statusCode}`);
    if (blockedApproveRes.statusCode !== 400) {
      throw new Error(`Expected status 400 for approving blocked path, got ${blockedApproveRes.statusCode}`);
    }
    const postBlockedReqs = JSON.parse(fs.readFileSync(requestsJsonPath, 'utf-8'));
    const finalBlockedReq = postBlockedReqs.requests.find(r => r.request_id === blockedReqId);
    if (finalBlockedReq.decision !== 'blocked') {
      throw new Error(`Expected decision to be updated to "blocked", got "${finalBlockedReq.decision}"`);
    }
    console.log('  [PASS] Blocked path approval successfully rejected with 400 and marked as blocked.');

    // 10. Verify that no view fields were polluted in adu.json
    console.log('\n--- Scenario 6: Verify registry adu.json clean format (No View pollution) ---');
    const aduJsonText = fs.readFileSync(registryAduPath, 'utf-8');
    const parsedAduRegistry = JSON.parse(aduJsonText);
    const registryAduRecord = parsedAduRegistry.adus.find(a => a.id === aduId);

    const pollutedFields = ['workflow', 'health', 'runs', 'latest_run', 'artifact_status'];
    for (const field of pollutedFields) {
      if (registryAduRecord.hasOwnProperty(field)) {
        throw new Error(`Registry ADU is polluted with View field: ${field}`);
      }
    }
    console.log('  [PASS] Verified registry adu.json contains no View pollution fields.');

  } finally {
    // Restore backups
    console.log('\nRestoring backup registry and contracts...');
    fs.writeFileSync(registryAduPath, aduBackup, 'utf-8');
    if (requestsBackup) {
      fs.writeFileSync(requestsJsonPath, requestsBackup, 'utf-8');
    } else if (fs.existsSync(requestsJsonPath)) {
      fs.unlinkSync(requestsJsonPath);
    }
    if (contractBackup) {
      fs.writeFileSync(contractJsonPath, contractBackup, 'utf-8');
    } else if (fs.existsSync(contractJsonPath)) {
      fs.unlinkSync(contractJsonPath);
    }
  }

  console.log('\n--- WRITE PATH EXPANSIONS INTEGRATION TESTS COMPLETED SUCCESSFULLY ---');
}

runTests().catch(err => {
  console.error('❌ Integration tests failed:', err);
  process.exit(1);
});
