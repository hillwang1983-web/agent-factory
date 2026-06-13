#!/usr/bin/env node
const fs = require('fs');

const args = process.argv;
const promptArg = args[args.length - 1] || '';

if (promptArg.includes('Code Reviewer Agent') || promptArg.includes('# Code Reviewer')) {
  console.log('```json\n' + JSON.stringify({
    "result": "success",
    "review_status": "fail",
    "next_state": "code_rework",
    "changed_files": [
      ".ai-agent/reviews/REQ-MVP-004-code-review.json",
      ".ai-agent/reviews/REQ-MVP-004-code-review.md"
    ],
    "artifacts": [
      ".ai-agent/reviews/REQ-MVP-004-code-review.json",
      ".ai-agent/reviews/REQ-MVP-004-code-review.md"
    ],
    "risks": [
      "Code review failed. Developer rework required."
    ],
    "next_agent": "developer"
  }, null, 2) + '\n```');
} else if (promptArg.includes('Acceptance Reviewer Agent') || promptArg.includes('# Acceptance Reviewer')) {
  const acceptanceStatus = process.env.MOCK_HERMES_ACCEPTANCE_STATUS || 'fail';
  const nextState = acceptanceStatus === 'pass' ? 'acceptance_reviewed' : 'acceptance_rework';
  const nextAgent = acceptanceStatus === 'pass' ? 'evidence' : 'developer';
  console.log('```json\n' + JSON.stringify({
    "result": "success",
    "acceptance_status": acceptanceStatus,
    "next_state": nextState,
    "changed_files": [
      ".ai-agent/acceptance/REQ-MVP-004-acceptance-review.json",
      ".ai-agent/acceptance/REQ-MVP-004-acceptance-review.md"
    ],
    "artifacts": [
      ".ai-agent/acceptance/REQ-MVP-004-acceptance-review.json",
      ".ai-agent/acceptance/REQ-MVP-004-acceptance-review.md"
    ],
    "risks": [
      acceptanceStatus === 'pass' ? "Acceptance review passed." : "Acceptance review failed. Developer rework required."
    ],
    "next_agent": nextAgent
  }, null, 2) + '\n```');
} else {
  console.log('```json\n' + JSON.stringify({
    "result": "success"
  }) + '\n```');
}
