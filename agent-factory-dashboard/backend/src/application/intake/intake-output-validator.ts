import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

const BLOCKED_COMMAND_FRAGMENTS = [
  'rm -rf', 'sudo ', 'curl ', 'wget ', 'ssh ', 'scp ', 'rsync ',
  'chmod -R 777', '> /dev/', 'dd ', 'mkfs', 'launchctl', 'security ',
  'git push', 'git clean', 'git reset --hard',
  '|', ';', '&&', '||', '>', '<', '`',
];

const BLOCKED_WRITE_PATH_PREFIXES = ['.git/', '.agent-factory/', '~/', '/Users/', '/home/', '/etc/', '/tmp/', '/var/'];

function validateRepoRelativePath(input: string, label: string): string {
  const v = input.trim().replace(/\\/g, '/');
  if (!v) throw new Error(`${label}: path must not be empty`);
  if (v.startsWith('/')) throw new Error(`${label}: path must not start with "/" — got "${input}"`);
  if (v.includes('..')) throw new Error(`${label}: path must not contain ".." — got "${input}"`);
  if (v.includes('\0')) throw new Error(`${label}: path contains NUL bytes`);
  return v;
}

export function validateDraftFields(updates: any): void {
  if (updates.preferredReadPaths !== undefined) {
    for (const p of updates.preferredReadPaths) validateRepoRelativePath(p, 'preferredReadPaths');
  }
  if (updates.preferredWritePaths !== undefined) {
    for (const p of updates.preferredWritePaths) {
      validateRepoRelativePath(p, 'preferredWritePaths');
      for (const blocked of BLOCKED_WRITE_PATH_PREFIXES) {
        if (p.startsWith(blocked) || p === blocked.replace(/\/$/, '')) {
          throw new Error(`preferredWritePaths: blocked path "${p}"`);
        }
      }
    }
  }
  if (updates.requiredCommands !== undefined) {
    for (const cmd of updates.requiredCommands) {
      for (const fragment of BLOCKED_COMMAND_FRAGMENTS) {
        if (cmd.includes(fragment)) {
          throw new Error(`requiredCommands: blocked fragment "${fragment}" in command "${cmd}"`);
        }
      }
    }
  }
  if (updates.risk !== undefined && !['low', 'medium', 'high'].includes(updates.risk)) {
    throw new Error(`risk must be low, medium, or high — got "${updates.risk}"`);
  }
  if (updates.targetLevel !== undefined && !['mvp', 'production'].includes(updates.targetLevel)) {
    throw new Error(`targetLevel must be mvp or production — got "${updates.targetLevel}"`);
  }
  if (updates.question_answers !== undefined) {
    if (!Array.isArray(updates.question_answers)) {
      throw new Error('question_answers must be an array');
    }
    let totalLength = 0;
    for (const qa of updates.question_answers) {
      if (typeof qa.question !== 'string' || typeof qa.answer !== 'string') {
        throw new Error('question and answer must be strings');
      }
      if (!qa.question || !qa.question.trim()) {
        throw new Error('question must not be empty');
      }
      if (qa.answer.length > 4000) {
        throw new Error('single answer must not exceed 4000 characters');
      }
      if (!['unanswered', 'answered', 'defer_to_requirement_analyst', 'out_of_scope'].includes(qa.status)) {
        throw new Error(`Invalid status: ${qa.status}`);
      }
      if (!['scope', 'acceptance_criteria', 'design', 'implementation', 'test', 'unknown'].includes(qa.impact)) {
        throw new Error(`Invalid impact: ${qa.impact}`);
      }
      totalLength += qa.answer.length;
    }
    if (totalLength > 20000) {
      throw new Error('total answers length must not exceed 20000 characters');
    }
  }
}

export async function validateIntakeOutput(
  repoPath: string,
  draftPath: string,
  reportPath: string
): Promise<{ title: string; draftSha256: string; reportSha256: string }> {
  // 1. Check file existence
  let draftContent: string;
  let reportContent: string;

  try {
    draftContent = await fs.readFile(draftPath, 'utf8');
  } catch (err) {
    throw new Error(`Draft file does not exist at ${draftPath}`);
  }

  try {
    reportContent = await fs.readFile(reportPath, 'utf8');
  } catch (err) {
    throw new Error(`Report file does not exist at ${reportPath}`);
  }

  // 2. Validate JSON structure
  let draftData: any;
  try {
    draftData = JSON.parse(draftContent);
  } catch (err: any) {
    throw new Error(`Failed to parse draft JSON: ${err.message}`);
  }

  // 3. Title & Goal Validation
  if (!draftData.title || typeof draftData.title !== 'string' || !draftData.title.trim()) {
    throw new Error('Draft schema invalid: title is missing or empty');
  }
  if (!draftData.goal || typeof draftData.goal !== 'string' || !draftData.goal.trim()) {
    throw new Error('Draft schema invalid: goal is missing or empty');
  }

  // 4. Content Safety Check
  validateDraftFields(draftData);

  // 5. Report empty check
  if (!reportContent.trim()) {
    throw new Error('Draft schema invalid: report file is empty');
  }

  // 6. Return SHA-256 and Title
  const draftSha256 = crypto.createHash('sha256').update(draftContent, 'utf8').digest('hex');
  const reportSha256 = crypto.createHash('sha256').update(reportContent, 'utf8').digest('hex');

  return {
    title: draftData.title.trim(),
    draftSha256,
    reportSha256
  };
}
