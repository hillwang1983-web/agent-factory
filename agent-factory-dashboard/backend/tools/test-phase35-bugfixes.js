const http = require('http');
const fs = require('fs');
const path = require('path');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = {
      'x-ha-test': 'true',
      'Content-Type': 'application/json',
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
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING PHASE 3.5 BUGFIX INTEGRATION TESTS ---');
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3011';
  const workspaceRoot = process.env.WORKSPACE_ROOT || '/Users/hill/open5gs';

  console.log(`Target Base URL: ${baseUrl}`);
  console.log(`Workspace Root: ${workspaceRoot}`);

  const registryDir = path.join(workspaceRoot, '.ai-agent', 'registry');
  const aduJsonPath = path.join(registryDir, 'adu.json');
  const projectsJsonPath = path.join(registryDir, 'projects.json');
  const gatesJsonPath = path.join(registryDir, 'human-gates.json');
  const waiversJsonPath = path.join(registryDir, 'evidence-waivers.json');
  const operationsJsonPath = path.join(registryDir, 'operations.json');

  // Backup files
  const backups = {};
  const backupFile = (filePath, key) => {
    if (fs.existsSync(filePath)) {
      backups[key] = { path: filePath, content: fs.readFileSync(filePath, 'utf-8'), exists: true };
    } else {
      backups[key] = { path: filePath, exists: false };
    }
  };

  backupFile(aduJsonPath, 'adu');
  backupFile(projectsJsonPath, 'projects');
  backupFile(gatesJsonPath, 'gates');
  backupFile(waiversJsonPath, 'waivers');
  backupFile(operationsJsonPath, 'operations');

  // Project-level contract and evidence paths
  const subprojectDir = path.join(workspaceRoot, 'open5gs');
  const subprojectContractsDir = path.join(subprojectDir, '.ai-agent', 'contracts');
  const subprojectEvidenceDir = path.join(subprojectDir, '.ai-agent', 'evidence');
  const subprojectAcceptanceDir = path.join(subprojectDir, '.ai-agent', 'acceptance');

  fs.mkdirSync(subprojectContractsDir, { recursive: true });
  fs.mkdirSync(subprojectEvidenceDir, { recursive: true });
  fs.mkdirSync(subprojectAcceptanceDir, { recursive: true });

  const testAduId = 'REQ-TEST-BUGFIX';
  const subprojectContractFile = path.join(subprojectContractsDir, `${testAduId}.json`);
  const subprojectEvidenceFile = path.join(subprojectEvidenceDir, `${testAduId}.json`);
  const subprojectAcceptanceFile = path.join(subprojectAcceptanceDir, `${testAduId}-acceptance-review.json`);

  let subprojectContractBackup = fs.existsSync(subprojectContractFile) ? fs.readFileSync(subprojectContractFile, 'utf-8') : null;
  let subprojectEvidenceBackup = fs.existsSync(subprojectEvidenceFile) ? fs.readFileSync(subprojectEvidenceFile, 'utf-8') : null;
  let subprojectAcceptanceBackup = fs.existsSync(subprojectAcceptanceFile) ? fs.readFileSync(subprojectAcceptanceFile, 'utf-8') : null;

  try {
    // Write mock contract to subproject
    const mockContract = {
      version: 1,
      adu_id: testAduId,
      acceptance_assertions: [
        { id: 'A-1', title: 'Static assertion 1', verification_type: 'static', must_pass: true, expected_evidence: ['Doc verified'] },
        { id: 'A-2', title: 'Runtime assertion 2', verification_type: 'runtime', must_pass: true, expected_evidence: ['Log verified'] }
      ]
    };
    fs.writeFileSync(subprojectContractFile, JSON.stringify(mockContract, null, 2), 'utf-8');

    // Write mock evidence to subproject
    const mockEvidence = {
      status: 'success',
      evidence: {
        'A-1': { path: 'dummy-path-1', status: 'verified' }
      }
    };
    fs.writeFileSync(subprojectEvidenceFile, JSON.stringify(mockEvidence, null, 2), 'utf-8');

    // Write mock projects.json
    const mockProjectsData = {
      version: 1,
      projects: [
        { project_id: 'mock-open5gs', repo_path: subprojectDir }
      ]
    };
    fs.writeFileSync(projectsJsonPath, JSON.stringify(mockProjectsData, null, 2), 'utf-8');

    // Write mock adu.json
    const mockAduData = {
      version: 1,
      adus: [
        {
          id: testAduId,
          title: 'Bugfix verification ADU',
          state: 'debugged',
          project_id: 'mock-open5gs',
          repo_path: subprojectDir
        }
      ]
    };
    fs.writeFileSync(aduJsonPath, JSON.stringify(mockAduData, null, 2), 'utf-8');

    // Write mock human gate
    const testGateId = `gate-${testAduId}-env-verification`;
    const mockGatesData = {
      version: 1,
      gates: [
        {
          gate_id: testGateId,
          scope: 'adu',
          target_id: testAduId,
          project_id: 'mock-open5gs',
          gate_type: 'environment_verification_required',
          status: 'pending',
          title: 'Runtime Evidence Required',
          reason: 'Missing runtime evidence',
          source_agent: 'evidence',
          pre_gate_state: 'debugged',
          affected_assertions: ['A-2'],
          available_actions: ['submit_runtime_result', 'approve_waiver', 'request_rework'],
          created_at: new Date().toISOString()
        }
      ]
    };
    fs.writeFileSync(gatesJsonPath, JSON.stringify(mockGatesData, null, 2), 'utf-8');

    // Write mock operations
    const testOpId = `op-${testAduId}-run`;
    const mockOperationsData = {
      version: 1,
      operations: [
        {
          operation_id: testOpId,
          scope: 'adu',
          target_id: testAduId,
          project_id: 'mock-open5gs',
          action: 'start',
          mode: 'auto',
          status: 'waiting_human',
          created_at: new Date().toISOString()
        }
      ]
    };
    fs.writeFileSync(operationsJsonPath, JSON.stringify(mockOperationsData, null, 2), 'utf-8');

    // Clear waivers
    fs.writeFileSync(waiversJsonPath, JSON.stringify({ version: 1, waivers: [] }, null, 2), 'utf-8');

    // Force server to reload files by restarting or let it read them dynamically
    // The backend reads adu.json, projects.json, operations.json, etc. on each request/service call,
    // so writing to files directly is sufficient!

    // ==========================================================
    // TEST 1: Project-aware ADU evidence matrix
    // ==========================================================
    console.log('\n--- Test Case 1: Project-aware ADU evidence matrix ---');
    const resMatrix = await request(`${baseUrl}/api/agent-factory/adus/${testAduId}/evidence-matrix`);
    console.log(`Matrix status: ${resMatrix.statusCode}`);
    const matrix = JSON.parse(resMatrix.data);
    console.log(`Matrix overall status: ${matrix.overall_status}`);
    console.log(`Matrix assertions:`, JSON.stringify(matrix.assertion_evidence, null, 2));

    if (matrix.overall_status !== 'pending_environment_verification') {
      throw new Error(`Expected matrix status to be 'pending_environment_verification', got: ${matrix.overall_status}`);
    }
    const a1 = matrix.assertion_evidence.find(a => a.assertion_id === 'A-1');
    if (!a1 || a1.status !== 'pass') {
      throw new Error(`Expected A-1 to be 'pass' from project-level evidence.json, got: ${a1 ? a1.status : 'not found'}`);
    }
    console.log('  [PASS] Successfully read contract and evidence from project repo root.');

    // ==========================================================
    // TEST 1.5: Project-aware acceptance report verification (Now as a negative/blocker test)
    // ==========================================================
    console.log('\n--- Test Case 1.5: Project-aware acceptance report verification (Negative) ---');
    const mockAcceptanceReport = {
      adu_id: testAduId,
      acceptance_status: "pass",
      next_state: "acceptance_reviewed",
      assertion_results: [
        { assertion_id: "A-1", status: "pass" },
        { assertion_id: "A-2", status: "pass" }
      ]
    };
    fs.writeFileSync(subprojectAcceptanceFile, JSON.stringify(mockAcceptanceReport, null, 2), 'utf-8');

    const resMatrix2 = await request(`${baseUrl}/api/agent-factory/adus/${testAduId}/evidence-matrix`);
    const matrix2 = JSON.parse(resMatrix2.data);
    console.log(`Matrix with acceptance status: ${matrix2.overall_status}`);
    const a2 = matrix2.assertion_evidence.find(a => a.assertion_id === 'A-2');

    // Runtime assertion must NOT be pass even if acceptance says pass
    if (!a2 || a2.status === 'pass') {
      throw new Error(`Expected A-2 to remain pending/not_verified without concrete runtime evidence, got: ${a2 ? a2.status : 'not found'}`);
    }
    if (matrix2.overall_status !== 'pending_environment_verification') {
      throw new Error(`Expected matrix overall_status to remain 'pending_environment_verification', got: ${matrix2.overall_status}`);
    }
    console.log('  [PASS] Successfully blocked runtime assertion pass when only acceptance report says pass.');

    // Verify python script exits with 20
    const { execSync } = require('child_process');
    try {
      execSync(`python3 scripts/validate_evidence_package.py --adu ${testAduId} --repo-root ${subprojectDir} --registry-dir ${registryDir}`, { cwd: workspaceRoot });
      throw new Error('Expected validate_evidence_package.py to exit with non-zero exit code.');
    } catch (err) {
      if (err.status !== 20) {
        throw new Error(`Expected validate_evidence_package.py to exit with status 20, got: ${err.status}`);
      }
      console.log('  [PASS] validate_evidence_package.py successfully exited with status 20.');
    }

    // ==========================================================
    // TEST 1.6: Runtime record validation (Positive)
    // ==========================================================
    console.log('\n--- Test Case 1.6: Runtime record validation (Positive) ---');
    // Add execution record to adu.json
    const updatedAduData = {
      version: 1,
      adus: [
        {
          id: testAduId,
          title: 'Bugfix verification ADU',
          state: 'debugged',
          project_id: 'mock-open5gs',
          repo_path: subprojectDir,
          runtime_evidence_records: [
            {
              command: 'curl -X GET http://localhost/A-2',
              exitCode: 0,
              output: 'Success verification for A-2',
              submitted_at: new Date().toISOString()
            }
          ]
        }
      ]
    };
    fs.writeFileSync(aduJsonPath, JSON.stringify(updatedAduData, null, 2), 'utf-8');

    const resMatrix3 = await request(`${baseUrl}/api/agent-factory/adus/${testAduId}/evidence-matrix`);
    const matrix3 = JSON.parse(resMatrix3.data);
    console.log(`Matrix with runtime record status: ${matrix3.overall_status}`);
    const a2_pos = matrix3.assertion_evidence.find(a => a.assertion_id === 'A-2');
    if (!a2_pos || a2_pos.status !== 'pass') {
      throw new Error(`Expected A-2 to be 'pass' with runtime evidence, got: ${a2_pos ? a2_pos.status : 'not found'}`);
    }
    if (matrix3.overall_status !== 'pass') {
      throw new Error(`Expected matrix overall_status to be 'pass', got: ${matrix3.overall_status}`);
    }
    console.log('  [PASS] Successfully marked runtime assertion as pass with valid runtime record.');

    // Verify python script exits with 0
    try {
      execSync(`python3 scripts/validate_evidence_package.py --adu ${testAduId} --repo-root ${subprojectDir} --registry-dir ${registryDir}`, { cwd: workspaceRoot });
      console.log('  [PASS] validate_evidence_package.py successfully exited with status 0.');
    } catch (err) {
      throw new Error(`Expected validate_evidence_package.py to exit with status 0, got error: ${err.message}`);
    }

    // Remove acceptance report
    fs.unlinkSync(subprojectAcceptanceFile);

    // ==========================================================
    // TEST 2: Waiver validations
    // ==========================================================
    console.log('\n--- Test Case 2: Waiver validations ---');

    // Case 2a: Empty assertion_ids
    const resWaiverEmpty = await request(`${baseUrl}/api/agent-factory/human-gates/${testGateId}/waive`, {
      method: 'POST',
      body: {
        assertion_ids: [],
        waiver_type: 'environment',
        reason: 'Missing simulator',
        risk: 'low',
        follow_up: 'None',
        operator: 'QA-tester'
      }
    });
    console.log(`Empty waiver response: ${resWaiverEmpty.statusCode} - ${resWaiverEmpty.data}`);
    if (resWaiverEmpty.statusCode !== 400 || !resWaiverEmpty.data.includes('assertion_ids must be a non-empty array')) {
      throw new Error('Expected 400 for empty assertion_ids');
    }
    console.log('  [PASS] Blocked empty assertion_ids.');

    // Case 2b: Assertion not in contract
    const resWaiverInvalidAss = await request(`${baseUrl}/api/agent-factory/human-gates/${testGateId}/waive`, {
      method: 'POST',
      body: {
        assertion_ids: ['A-UNKNOWN'],
        waiver_type: 'environment',
        reason: 'Missing simulator',
        risk: 'low',
        follow_up: 'None',
        operator: 'QA-tester'
      }
    });
    console.log(`Invalid assertion waiver response: ${resWaiverInvalidAss.statusCode} - ${resWaiverInvalidAss.data}`);
    if (resWaiverInvalidAss.statusCode !== 400 || !resWaiverInvalidAss.data.includes('does not exist in the contract')) {
      throw new Error('Expected 400 for assertion ID not in contract');
    }
    console.log('  [PASS] Blocked assertion ID not in contract.');

    // Case 2c: Valid assertion waiver
    const resWaiverValid = await request(`${baseUrl}/api/agent-factory/human-gates/${testGateId}/waive`, {
      method: 'POST',
      body: {
        assertion_ids: ['A-2'],
        waiver_type: 'environment',
        reason: 'Missing simulator',
        risk: 'low',
        follow_up: 'None',
        operator: 'QA-tester'
      }
    });
    console.log(`Valid waiver response: ${resWaiverValid.statusCode} - ${resWaiverValid.data}`);
    if (resWaiverValid.statusCode !== 200) {
      throw new Error(`Expected 200 for valid waiver request, got: ${resWaiverValid.statusCode}`);
    }
    console.log('  [PASS] Approved valid waiver.');

    // ==========================================================
    // TEST 3: Auto-close operation after gate resolved
    // ==========================================================
    console.log('\n--- Test Case 3: Auto-close operation after gate resolved ---');
    const ops = JSON.parse(fs.readFileSync(operationsJsonPath, 'utf-8')).operations;
    const op = ops.find(o => o.operation_id === testOpId);
    console.log(`Operation status after waiver: ${op ? op.status : 'not found'}`);
    if (!op || op.status !== 'completed' || op.result !== 'success') {
      throw new Error(`Expected operation to be completed and success, got: ${JSON.stringify(op)}`);
    }
    console.log('  [PASS] Operation auto-closed and set to completed/success.');

    // ==========================================================
    // TEST 4: Whitelist regex checks
    // ==========================================================
    console.log('\n--- Test Case 4: Whitelist regex checks ---');
    const resRegexAdu = await request(`${baseUrl}/api/agent-factory/adus/BAD;DROP/evidence-matrix`);
    console.log(`Invalid ADU regex status: ${resRegexAdu.statusCode} - ${resRegexAdu.data}`);
    if (resRegexAdu.statusCode !== 400 || !resRegexAdu.data.includes('Invalid aduId format')) {
      throw new Error('Expected 400 for invalid ADU ID characters');
    }

    const resRegexGate = await request(`${baseUrl}/api/agent-factory/human-gates/gate*id/waive`, {
      method: 'POST',
      body: {
        assertion_ids: ['A-2'],
        waiver_type: 'environment',
        reason: 'Test',
        risk: 'low',
        follow_up: 'None',
        operator: 'tester'
      }
    });
    console.log(`Invalid gate regex status: ${resRegexGate.statusCode} - ${resRegexGate.data}`);
    if (resRegexGate.statusCode !== 400 || !resRegexGate.data.includes('Invalid gateId format')) {
      throw new Error('Expected 400 for invalid gate ID characters');
    }
    console.log('  [PASS] Whitelist regex successfully blocked malicious characters.');

    console.log('\nALL TESTS PASSED SUCCESSFULLY! 🎉');

  } finally {
    console.log('\nCleaning up subproject files...');
    if (fs.existsSync(subprojectContractFile)) fs.unlinkSync(subprojectContractFile);
    if (fs.existsSync(subprojectEvidenceFile)) fs.unlinkSync(subprojectEvidenceFile);
    if (fs.existsSync(subprojectAcceptanceFile)) {
      try { fs.unlinkSync(subprojectAcceptanceFile); } catch(_) {}
    }

    // Restore original subproject backups if they existed
    if (subprojectContractBackup) fs.writeFileSync(subprojectContractFile, subprojectContractBackup);
    if (subprojectEvidenceBackup) fs.writeFileSync(subprojectEvidenceFile, subprojectEvidenceBackup);
    if (subprojectAcceptanceBackup) fs.writeFileSync(subprojectAcceptanceFile, subprojectAcceptanceBackup);

    // Restore registry backups
    console.log('Restoring registry backup files...');
    const restoreBackup = (key) => {
      const b = backups[key];
      if (b) {
        if (b.exists) {
          fs.writeFileSync(b.path, b.content, 'utf-8');
        } else if (fs.existsSync(b.path)) {
          fs.unlinkSync(b.path);
        }
      }
    };

    restoreBackup('adu');
    restoreBackup('projects');
    restoreBackup('gates');
    restoreBackup('waivers');
    restoreBackup('operations');
    console.log('Cleanup completed.');
  }
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
