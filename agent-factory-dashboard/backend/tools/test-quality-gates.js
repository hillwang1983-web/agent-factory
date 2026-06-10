const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  console.log('--- STARTING QUALITY GATES integration tests ---');
  const workspaceRoot = process.env.WORKSPACE_ROOT || '/Users/hill/open5gs';
  const aduId = 'REQ-MVP-004';
  
  console.log(`Workspace Root: ${workspaceRoot}`);

  const registryAduPath = path.join(workspaceRoot, '.ai-agent', 'registry', 'adu.json');
  const registryAgentsPath = path.join(workspaceRoot, '.ai-agent', 'registry', 'agents.json');
  
  // Backups
  const aduBackup = fs.readFileSync(registryAduPath, 'utf-8');
  const agentsBackup = fs.readFileSync(registryAgentsPath, 'utf-8');

  // Build optional --project / --repo-root suffix for project-bound ADUs
  const aduBackupData = JSON.parse(aduBackup);
  const aduRecord = aduBackupData.adus.find(a => a.id === aduId);
  const orchProjectArgs = (aduRecord && aduRecord.project_id)
    ? `--project ${aduRecord.project_id} --repo-root ${aduRecord.repo_path || workspaceRoot}`
    : '';

  // Ensure reviews & acceptance directories exist
  const reviewsDir = path.join(workspaceRoot, '.ai-agent', 'reviews');
  const acceptanceDir = path.join(workspaceRoot, '.ai-agent', 'acceptance');
  fs.mkdirSync(reviewsDir, { recursive: true });
  fs.mkdirSync(acceptanceDir, { recursive: true });

  const codeReviewJsonPath = path.join(reviewsDir, `${aduId}-code-review.json`);
  const codeReviewMdPath = path.join(reviewsDir, `${aduId}-code-review.md`);
  const acceptanceJsonPath = path.join(acceptanceDir, `${aduId}-acceptance-review.json`);
  const acceptanceMdPath = path.join(acceptanceDir, `${aduId}-acceptance-review.md`);

  let codeReviewBackup = fs.existsSync(codeReviewJsonPath) ? fs.readFileSync(codeReviewJsonPath, 'utf-8') : null;
  let codeReviewMdBackup = fs.existsSync(codeReviewMdPath) ? fs.readFileSync(codeReviewMdPath, 'utf-8') : null;
  let acceptanceBackup = fs.existsSync(acceptanceJsonPath) ? fs.readFileSync(acceptanceJsonPath, 'utf-8') : null;
  let acceptanceMdBackup = fs.existsSync(acceptanceMdPath) ? fs.readFileSync(acceptanceMdPath, 'utf-8') : null;

  const contractJsonPath = path.join(workspaceRoot, '.ai-agent', 'contracts', `${aduId}.json`);
  const contractNotesPath = path.join(workspaceRoot, '.ai-agent', 'contracts', `${aduId}-notes.md`);
  let contractBackup = fs.existsSync(contractJsonPath) ? fs.readFileSync(contractJsonPath, 'utf-8') : null;
  let contractNotesBackup = fs.existsSync(contractNotesPath) ? fs.readFileSync(contractNotesPath, 'utf-8') : null;

  try {
    // 1. Temporarily replace hermes_bin with mock-hermes
    const mockHermesPath = path.join(workspaceRoot, 'agent-factory-dashboard', 'backend', 'tools', 'mock-hermes.js');
    runCommand(`chmod +x ${mockHermesPath}`, workspaceRoot);
    const agentsData = JSON.parse(agentsBackup);
    agentsData.hermes_bin = mockHermesPath;
    fs.writeFileSync(registryAgentsPath, JSON.stringify(agentsData, null, 2), 'utf-8');
    console.log('Redirected hermes_bin in agents.json to mock-hermes.js directly.');

    // ==========================================
    // TEST CASE 1: Code Review Fail Routing
    // ==========================================
    console.log('\n--- Test Case 1: Code Review Fail Routing ---');
    
    // Write simulated failed code review report
    const mockCodeReviewFail = {
      version: 1,
      adu_id: aduId,
      review_status: "fail",
      summary: "Simulated code review failure for E2E testing",
      checked_files: ["scripts/hermes_agent_orchestrator.py"],
      findings: [
        {
          id: "CR-1",
          severity: "P1",
          file: "scripts/hermes_agent_orchestrator.py",
          line: 12,
          title: "Simulation fail",
          detail: "Mock review failure",
          required_fix: "Check simulation settings"
        }
      ],
      next_state: "code_rework"
    };
    fs.writeFileSync(codeReviewJsonPath, JSON.stringify(mockCodeReviewFail, null, 2), 'utf-8');
    fs.writeFileSync(codeReviewMdPath, '# Mock Code Review Md\nFail', 'utf-8');

    // Run validator directly to verify it works
    const valCRResult = runCommand(`python3 scripts/validate_quality_report.py --adu ${aduId} --kind code-review`, workspaceRoot);
    console.log(`CR Validator stdout: ${valCRResult.stdout.trim()}`);
    if (valCRResult.status !== 0) {
      throw new Error(`Code review report validation failed unexpectedly: ${valCRResult.stderr}`);
    }
    console.log('  [PASS] Quality report validator successfully verified the fail code-review report.');

    // Update adu.json to state "implemented"
    const aduData = JSON.parse(aduBackup);
    const aduIdx = aduData.adus.findIndex(a => a.id === aduId);
    aduData.adus[aduIdx].state = 'implemented';
    // Reset rework counters for clean test
    if (!aduData.adus[aduIdx].review_counters) {
      aduData.adus[aduIdx].review_counters = {};
    }
    aduData.adus[aduIdx].review_counters.code_review_failures = 0;
    fs.writeFileSync(registryAduPath, JSON.stringify(aduData, null, 2), 'utf-8');

    // Run step using orchestrator
    console.log('Running orchestrator step for implemented ADU (should run code-reviewer and trigger code_rework)...');
    const orchCRResult = runCommand(`python3 scripts/hermes_agent_orchestrator.py --adu ${aduId} --mode step ${orchProjectArgs}`, workspaceRoot);
    console.log('Orchestrator CR stdout:', orchCRResult.stdout);
    if (orchCRResult.status !== 0) {
      console.log('Orchestrator CR stderr:', orchCRResult.stderr);
    }
    
    // Load registry and assert transition
    const updatedAduData = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const finalAdu = updatedAduData.adus.find(a => a.id === aduId);
    console.log(`New ADU state after code-reviewer step: ${finalAdu.state}`);
    console.log(`Rework count: ${finalAdu.review_counters.code_review_failures}`);

    if (finalAdu.state !== 'code_rework') {
      throw new Error(`Expected state to transition to 'code_rework', got '${finalAdu.state}'`);
    }
    if (finalAdu.review_counters.code_review_failures !== 1) {
      throw new Error(`Expected code_review_failures count to be 1, got ${finalAdu.review_counters.code_review_failures}`);
    }
    console.log('  [PASS] Correctly transitioned state to code_rework and incremented code_review_failures counter.');

    // ==========================================
    // TEST CASE 2: Acceptance Fail Routing
    // ==========================================
    console.log('\n--- Test Case 2: Acceptance Fail Routing ---');
    
    // Write simulated failed acceptance review report
    const mockAcceptanceFail = {
      version: 1,
      adu_id: aduId,
      acceptance_status: "fail",
      summary: "Simulated acceptance failure for E2E testing",
      assertion_results: [],
      negative_assertion_results: [],
      mismatch_findings: [
        {
          id: "AR-1",
          severity: "P1",
          title: "Simulation mismatch fail",
          detail: "Mock acceptance failure",
          required_fix: "Check simulation settings"
        }
      ],
      next_state: "acceptance_rework"
    };
    fs.writeFileSync(acceptanceJsonPath, JSON.stringify(mockAcceptanceFail, null, 2), 'utf-8');
    fs.writeFileSync(acceptanceMdPath, '# Mock Acceptance Review Md\nFail', 'utf-8');

    // Run validator directly to verify it works
    const valARResult = runCommand(`python3 scripts/validate_quality_report.py --adu ${aduId} --kind acceptance`, workspaceRoot);
    console.log(`AR Validator stdout: ${valARResult.stdout.trim()}`);
    if (valARResult.status !== 0) {
      throw new Error(`Acceptance report validation failed unexpectedly: ${valARResult.stderr}`);
    }
    console.log('  [PASS] Quality report validator successfully verified the fail acceptance report.');

    // Update adu.json to state "debugged"
    const aduData2 = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const aduIdx2 = aduData2.adus.findIndex(a => a.id === aduId);
    aduData2.adus[aduIdx2].state = 'debugged';
    if (!aduData2.adus[aduIdx2].review_counters) {
      aduData2.adus[aduIdx2].review_counters = {};
    }
    aduData2.adus[aduIdx2].review_counters.acceptance_review_failures = 0;
    fs.writeFileSync(registryAduPath, JSON.stringify(aduData2, null, 2), 'utf-8');

    // Run step using orchestrator
    console.log('Running orchestrator step for debugged ADU (should run acceptance-reviewer and trigger acceptance_rework)...');
    const orchARResult = runCommand(`python3 scripts/hermes_agent_orchestrator.py --adu ${aduId} --mode step ${orchProjectArgs}`, workspaceRoot);

    // Load registry and assert transition
    const updatedAduData2 = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const finalAdu2 = updatedAduData2.adus.find(a => a.id === aduId);
    console.log(`New ADU state after acceptance-reviewer step: ${finalAdu2.state}`);
    console.log(`Rework count: ${finalAdu2.review_counters.acceptance_review_failures}`);

    if (finalAdu2.state !== 'acceptance_rework') {
      throw new Error(`Expected state to transition to 'acceptance_rework', got '${finalAdu2.state}'`);
    }
    if (finalAdu2.review_counters.acceptance_review_failures !== 1) {
      throw new Error(`Expected acceptance_review_failures count to be 1, got ${finalAdu2.review_counters.acceptance_review_failures}`);
    }
    console.log('  [PASS] Correctly transitioned state to acceptance_rework and incremented acceptance_review_failures counter.');

    // ==========================================
    // TEST CASE 3: Evidence cannot run before acceptance
    // ==========================================
    console.log('\n--- Test Case 3: Evidence cannot run before acceptance ---');
    
    // Set state back to "debugged"
    const aduData3 = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const aduIdx3 = aduData3.adus.findIndex(a => a.id === aduId);
    aduData3.adus[aduIdx3].state = 'debugged';
    fs.writeFileSync(registryAduPath, JSON.stringify(aduData3, null, 2), 'utf-8');

    // Query hermes_agent_next.py run check
    const nextAgentResult = runCommand(`python3 scripts/hermes_agent_next.py`, workspaceRoot);
    console.log(`Next agent output line: ${nextAgentResult.stdout.split('\n')[0]}`);
    
    // Assert next agent is "acceptance-reviewer", not "evidence"
    if (!nextAgentResult.stdout.includes('--agent acceptance-reviewer')) {
      throw new Error(`Expected next agent command to target 'acceptance-reviewer', but got output: ${nextAgentResult.stdout}`);
    }
    console.log('  [PASS] Verified next agent from state debugged is acceptance-reviewer and not evidence.');

    // ==========================================
    // TEST CASE 4: Contract missing verification command directly
    // ==========================================
    console.log('\n--- Test Case 4: Contract missing verification command directly ---');
    const mockContractInvalid = {
      version: 2,
      adu_id: aduId,
      source_documents: {
        analysis: ".ai-agent/analysis/REQ-MVP-004.md",
        design: ".ai-agent/designs/REQ-MVP-004-detailed-design.md"
      },
      scope: {
        in_scope: ["test behavior"],
        out_of_scope: [],
        allowed_write_paths: [".ai-agent/context-packs/"]
      },
      acceptance_assertions: [
        {
          id: "A1",
          title: "Missing command assertion",
          requirement: "This assertion lacks verification command and manual steps.",
          verification_type: "automated_test",
          expected_evidence: ["Some evidence"],
          must_pass: true
        }
      ],
      negative_assertions: [
        {
          id: "N1",
          title: "Mock negative",
          forbidden_change: "None",
          must_pass: true
        }
      ],
      evidence_requirements: [
        {
          id: "E1",
          assertion_id: "A1",
          artifact: ".ai-agent/evidence/REQ-MVP-004.json",
          required_fields: ["assertions.A1.status"]
        }
      ],
      quality_gates: {
        minimum_assertions: 1,
        minimum_negative_assertions: 1
      }
    };
    fs.writeFileSync(contractJsonPath, JSON.stringify(mockContractInvalid, null, 2), 'utf-8');

    const valContractResult = runCommand(`python3 scripts/validate_agent_contract.py --adu ${aduId}`, workspaceRoot);
    console.log(`Contract Validator status code: ${valContractResult.status}`);
    console.log(`Contract Validator stdout/stderr: ${valContractResult.stderr || valContractResult.stdout}`);
    if (valContractResult.status === 0) {
      throw new Error('Expected contract validator to fail when verification_command and manual_verification_steps are missing.');
    }
    console.log('  [PASS] Successfully rejected contract with missing verification fields.');

    // ==========================================
    // TEST CASE 5: Contract validation failure state rollback
    // ==========================================
    console.log('\n--- Test Case 5: Contract validation failure state rollback ---');

    // Explicitly write the invalid contract (missing verification_command) so the validator will fail.
    // This makes the test self-contained and independent of TC4 side-effects.
    const mockContractRollback = {
      version: 2,
      adu_id: aduId,
      source_documents: {
        analysis: ".ai-agent/analysis/REQ-MVP-004.md",
        design: ".ai-agent/designs/REQ-MVP-004-detailed-design.md"
      },
      scope: {
        in_scope: ["test behavior"],
        out_of_scope: [],
        allowed_write_paths: [".ai-agent/context-packs/"]
      },
      acceptance_assertions: [
        {
          id: "A1",
          title: "Rollback test assertion — missing command",
          requirement: "This assertion intentionally omits verification_command and manual_verification_steps.",
          verification_type: "automated_test",
          expected_evidence: ["Some evidence"],
          must_pass: true
        }
      ],
      negative_assertions: [
        { id: "N1", title: "Mock negative", forbidden_change: "None", must_pass: true }
      ],
      evidence_requirements: [
        {
          id: "E1",
          assertion_id: "A1",
          artifact: ".ai-agent/evidence/REQ-MVP-004.json",
          required_fields: ["assertions.A1.status"]
        }
      ],
      quality_gates: { minimum_assertions: 1, minimum_negative_assertions: 1 }
    };
    fs.writeFileSync(contractJsonPath, JSON.stringify(mockContractRollback, null, 2), 'utf-8');

    // Set ADU state to "designed"
    const aduData4 = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const aduIdx4 = aduData4.adus.findIndex(a => a.id === aduId);
    aduData4.adus[aduIdx4].state = 'designed';
    fs.writeFileSync(registryAduPath, JSON.stringify(aduData4, null, 2), 'utf-8');

    // Run orchestrator step: mock-hermes reports success, but validate_agent_contract.py must then
    // reject the invalid contract and cause hermes_agent_run.py to flip result to "failed".
    console.log('Running orchestrator step for designed ADU (should run contract agent then fail validation)...');
    const orchContractResult = runCommand(
      `python3 scripts/hermes_agent_orchestrator.py --adu ${aduId} --mode step ${orchProjectArgs}`,
      workspaceRoot
    );
    console.log('Orchestrator Contract step stdout:', orchContractResult.stdout);

    // Guard: if the orchestrator failed due to missing --project args instead of contract validation,
    // that is a false positive — fail the test immediately.
    const orchContractOutput = (orchContractResult.stdout || '') + (orchContractResult.stderr || '');
    if (orchContractOutput.includes('--project and --repo-root are required')) {
      throw new Error(
        'TC5 false positive: orchestrator exited due to missing --project args, not contract validation failure. ' +
        'Ensure orchProjectArgs is set correctly.'
      );
    }

    // Load registry and verify ADU state is STILL "designed" (not "contracted")
    const updatedAduData4 = JSON.parse(fs.readFileSync(registryAduPath, 'utf-8'));
    const finalAdu4 = updatedAduData4.adus.find(a => a.id === aduId);
    console.log(`ADU state after failed contract validation step: ${finalAdu4.state}`);
    if (finalAdu4.state !== 'designed') {
      throw new Error(`Expected ADU state to remain 'designed', but got '${finalAdu4.state}'`);
    }
    console.log('  [PASS] Correctly rolled back/maintained designed state when contract validation failed.');

    // ==========================================
    // TEST CASE 6: Code review pass with P1/P2 findings rejected
    // ==========================================
    console.log('\n--- Test Case 6: Code review pass with P1/P2 findings rejected ---');
    const mockCodeReviewPassInvalid = {
      version: 1,
      adu_id: aduId,
      review_status: "pass",
      summary: "Invalid pass review with P1 findings",
      checked_files: ["src/index.ts"],
      contract_assertion_results: [],
      findings: [
        {
          id: "CR-1",
          severity: "P1",
          file: "src/index.ts",
          line: 12,
          title: "Critical flaw",
          detail: "Validation bypass",
          required_fix: "Fix it"
        }
      ],
      next_state: "code_reviewed"
    };
    fs.writeFileSync(codeReviewJsonPath, JSON.stringify(mockCodeReviewPassInvalid, null, 2), 'utf-8');
    
    const valCRPassInvalidResult = runCommand(`python3 scripts/validate_quality_report.py --adu ${aduId} --kind code-review`, workspaceRoot);
    console.log(`CR Pass Validator status code: ${valCRPassInvalidResult.status}`);
    console.log(`CR Pass Validator stdout/stderr: ${valCRPassInvalidResult.stderr || valCRPassInvalidResult.stdout}`);
    if (valCRPassInvalidResult.status === 0) {
      throw new Error('Expected quality report validator to reject a pass code-review report containing P1 findings.');
    }
    console.log('  [PASS] Successfully rejected pass code-review report containing P1 findings.');

    // ==========================================
    // TEST CASE 7: Empty acceptance pass rejected
    // ==========================================
    console.log('\n--- Test Case 7: Empty acceptance pass rejected ---');
    
    // Write valid contract first to define must_pass assertions
    const mockContractValid = {
      version: 2,
      adu_id: aduId,
      source_documents: {
        analysis: ".ai-agent/analysis/REQ-MVP-004.md",
        design: ".ai-agent/designs/REQ-MVP-004-detailed-design.md"
      },
      scope: {
        in_scope: ["test behavior"],
        out_of_scope: [],
        allowed_write_paths: [".ai-agent/context-packs/"]
      },
      acceptance_assertions: [
        {
          id: "A1",
          title: "Must pass assertion",
          requirement: "Check must pass requirement",
          verification_type: "automated_test",
          verification_command: "npm run test",
          expected_evidence: ["Test output"],
          must_pass: true
        }
      ],
      negative_assertions: [
        {
          id: "N1",
          title: "Must pass negative",
          forbidden_change: "Forbidden path",
          must_pass: true
        }
      ],
      evidence_requirements: [
        {
          id: "E1",
          assertion_id: "A1",
          artifact: ".ai-agent/evidence/REQ-MVP-004.json",
          required_fields: ["assertions.A1.status"]
        }
      ],
      quality_gates: {
        minimum_assertions: 1,
        minimum_negative_assertions: 1
      }
    };
    fs.writeFileSync(contractJsonPath, JSON.stringify(mockContractValid, null, 2), 'utf-8');

    // Write empty acceptance pass (missing assertions coverage)
    const mockAcceptanceEmpty = {
      version: 1,
      adu_id: aduId,
      acceptance_status: "pass",
      summary: "Empty acceptance pass",
      assertion_results: [], // missing A1
      negative_assertion_results: [], // missing N1
      mismatch_findings: [],
      missing_evidence: [],
      next_state: "acceptance_reviewed"
    };
    fs.writeFileSync(acceptanceJsonPath, JSON.stringify(mockAcceptanceEmpty, null, 2), 'utf-8');

    const valAcceptanceEmptyResult = runCommand(`python3 scripts/validate_quality_report.py --adu ${aduId} --kind acceptance`, workspaceRoot);
    console.log(`Acceptance Validator status: ${valAcceptanceEmptyResult.status}`);
    console.log(`Acceptance Validator stdout/stderr: ${valAcceptanceEmptyResult.stderr || valAcceptanceEmptyResult.stdout}`);
    if (valAcceptanceEmptyResult.status === 0) {
      throw new Error('Expected quality report validator to reject an acceptance pass report missing contract must_pass assertions.');
    }
    console.log('  [PASS] Successfully rejected empty acceptance pass report.');

  } finally {
    // Restore backups
    console.log('\nCleaning up and restoring original files...');
    fs.writeFileSync(registryAduPath, aduBackup, 'utf-8');
    fs.writeFileSync(registryAgentsPath, agentsBackup, 'utf-8');
    console.log('Restored adu.json and agents.json backups.');

    if (codeReviewBackup) {
      fs.writeFileSync(codeReviewJsonPath, codeReviewBackup, 'utf-8');
    } else if (fs.existsSync(codeReviewJsonPath)) {
      fs.unlinkSync(codeReviewJsonPath);
    }
    
    if (codeReviewMdBackup) {
      fs.writeFileSync(codeReviewMdPath, codeReviewMdBackup, 'utf-8');
    } else if (fs.existsSync(codeReviewMdPath)) {
      fs.unlinkSync(codeReviewMdPath);
    }

    if (acceptanceBackup) {
      fs.writeFileSync(acceptanceJsonPath, acceptanceBackup, 'utf-8');
    } else if (fs.existsSync(acceptanceJsonPath)) {
      fs.unlinkSync(acceptanceJsonPath);
    }

    if (acceptanceMdBackup) {
      fs.writeFileSync(acceptanceMdPath, acceptanceMdBackup, 'utf-8');
    } else if (fs.existsSync(acceptanceMdPath)) {
      fs.unlinkSync(acceptanceMdPath);
    }

    if (contractBackup) {
      fs.writeFileSync(contractJsonPath, contractBackup, 'utf-8');
    } else if (fs.existsSync(contractJsonPath)) {
      fs.unlinkSync(contractJsonPath);
    }

    if (contractNotesBackup) {
      fs.writeFileSync(contractNotesPath, contractNotesBackup, 'utf-8');
    } else if (fs.existsSync(contractNotesPath)) {
      fs.unlinkSync(contractNotesPath);
    }
    console.log('Restored reviews, acceptance, and contract mock files.');
  }

  console.log('\n--- ALL QUALITY GATES INTEGRATION TESTS PASSED SUCCESSFULY! ---');
}

runTests().catch(error => {
  console.error('Test FAILED:', error);
  process.exit(1);
});
