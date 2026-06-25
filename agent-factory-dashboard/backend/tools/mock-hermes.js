#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv;
const promptArg = args[args.length - 1] || '';

function emitResult(result) {
  const completionMatch = promptArg.match(/"completion_file"\s*:\s*"([^"]+)"/);
  if (completionMatch) {
    const completionPath = path.resolve(process.cwd(), completionMatch[1]);
    fs.mkdirSync(path.dirname(completionPath), { recursive: true });
    const tempPath = `${completionPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({
      version: 1,
      status: result.result === 'human_gate' ? 'human_gate' : result.result === 'success' ? 'success' : 'failed',
      result,
    }, null, 2));
    fs.renameSync(tempPath, completionPath);
  }
  console.log('```json\n' + JSON.stringify(result, null, 2) + '\n```');
}

function touchDeclaredFiles(files) {
  const logFile = "/root/agent-factory/mock-hermes-debug.log";
  fs.appendFileSync(logFile, `DEBUG touchDeclaredFiles: process.cwd() = ${process.cwd()}\n`);
  for (const relativePath of files) {
    const absolutePath = path.resolve(process.cwd(), relativePath);
    const exists = fs.existsSync(absolutePath);
    fs.appendFileSync(logFile, `DEBUG absolutePath = ${absolutePath}, exists = ${exists}\n`);
    if (!exists) continue;
    const content = fs.readFileSync(absolutePath);
    fs.writeFileSync(absolutePath, content);
    const modifiedAt = new Date(Date.now() + 60000);
    fs.utimesSync(absolutePath, modifiedAt, modifiedAt);
  }
}

if (promptArg.includes('Code Reviewer Agent') || promptArg.includes('# Code Reviewer')) {
  const changedFiles = [
    ".ai-agent/reviews/REQ-MVP-004-code-review.json",
    ".ai-agent/reviews/REQ-MVP-004-code-review.md"
  ];
  touchDeclaredFiles(changedFiles);
  emitResult({
    "result": "success",
    "review_status": "fail",
    "next_state": "code_rework",
    "changed_files": changedFiles,
    "artifacts": changedFiles,
    "commands_run": [],
    "risks": [
      "Code review failed. Developer rework required."
    ],
    "next_agent": "developer"
  });
} else if (promptArg.includes('Acceptance Reviewer Agent') || promptArg.includes('# Acceptance Reviewer')) {
  const acceptanceStatus = process.env.MOCK_HERMES_ACCEPTANCE_STATUS || 'fail';
  const nextState = acceptanceStatus === 'pass' ? 'acceptance_reviewed' : 'acceptance_rework';
  const nextAgent = acceptanceStatus === 'pass' ? 'evidence' : 'developer';
  const changedFiles = [
    ".ai-agent/acceptance/REQ-MVP-004-acceptance-review.json",
    ".ai-agent/acceptance/REQ-MVP-004-acceptance-review.md"
  ];
  touchDeclaredFiles(changedFiles);
  emitResult({
    "result": "success",
    "acceptance_status": acceptanceStatus,
    "next_state": nextState,
    "changed_files": changedFiles,
    "artifacts": changedFiles,
    "commands_run": [],
    "risks": [
      acceptanceStatus === 'pass' ? "Acceptance review passed." : "Acceptance review failed. Developer rework required."
    ],
    "next_agent": nextAgent
  });
} else {
  emitResult({
    "result": "success",
    "next_state": null,
    "changed_files": [],
    "artifacts": [],
    "commands_run": [],
    "risks": [],
    "next_agent": null
  });
}
