#!/usr/bin/env node
const { deriveAgentRuntimeView } = require('../dist/application/agent-runtime-status');

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`✅  ${label}`);
    passed++;
  } else {
    console.error(`❌  ${label}`);
    failed++;
  }
}

function eq(a, b, label) {
  if (a === b) {
    console.log(`✅  ${label}`);
    passed++;
  } else {
    console.error(`❌  ${label}: expected ${JSON.stringify(b)} but got ${JSON.stringify(a)}`);
    failed++;
  }
}

function runTests() {
  const baseAgent = { id: 'test-agent' };
  const now = new Date('2026-06-22T10:00:00Z').getTime();

  // 1. 有 next_agent、无 Operation：ready
  let view1 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], operations: [], humanGates: [], now, staleAfterSeconds: 60,
    aduViews: [{ id: 'adu-1', next_agent: 'test-agent', state: 'created' }]
  });
  eq(view1.runtime_status, 'ready', 'Scenario 1: ready');
  eq(view1.queued_targets.length, 1, 'Scenario 1: queue length 1');

  // 2. 有活跃 Operation、current_agent 匹配：running
  let view2 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], aduViews: [], humanGates: [], now, staleAfterSeconds: 60,
    operations: [{ operation_id: 'op-1', scope: 'adu', target_id: 'adu-1', status: 'running', current_agent: 'test-agent' }]
  });
  eq(view2.runtime_status, 'running', 'Scenario 2: running');

  // 3. 历史最后一次失败、当前无未解决问题：idle
  let view3 = deriveAgentRuntimeView({
    agent: baseAgent, aduViews: [], operations: [], humanGates: [], now, staleAfterSeconds: 60,
    runs: [{ timestamp: '2026-06-22T09:00:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'failed', returncode: 1 }]
  });
  eq(view3.runtime_status, 'idle', 'Scenario 3: idle');
  eq(view3.last_result.result, 'failed', 'Scenario 3: last_result is failed');

  // 4. 当前控制性失败未解决：needs_attention
  let view4 = deriveAgentRuntimeView({
    agent: baseAgent, operations: [], humanGates: [], now, staleAfterSeconds: 60,
    runs: [{ timestamp: '2026-06-22T09:00:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'failed', returncode: 1 }],
    aduViews: [{
      id: 'adu-1', state: 'failed', latest_run: { timestamp: '2026-06-22T09:00:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'failed', returncode: 1 }
    }]
  });
  eq(view4.runtime_status, 'needs_attention', 'Scenario 4: needs_attention');

  // 5. Human Gate 指向该 Agent：needs_attention
  let view5 = deriveAgentRuntimeView({
    agent: baseAgent, aduViews: [], runs: [], operations: [], now, staleAfterSeconds: 60,
    humanGates: [{ gate_id: 'hg-1', scope: 'adu', target_id: 'adu-1', status: 'pending', source_agent: 'test-agent' }]
  });
  eq(view5.runtime_status, 'needs_attention', 'Scenario 5: needs_attention');

  // 6. 同时 Running 和 Ready：running，队列仍保留
  let view6 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], humanGates: [], now, staleAfterSeconds: 60,
    operations: [{ operation_id: 'op-1', scope: 'adu', target_id: 'adu-1', status: 'running', current_agent: 'test-agent' }],
    aduViews: [{ id: 'adu-2', next_agent: 'test-agent', state: 'created' }]
  });
  eq(view6.runtime_status, 'running', 'Scenario 6: running');
  eq(view6.queued_targets.length, 1, 'Scenario 6: queue retains target');

  // 7. 同时 Needs attention 和 Ready：needs_attention
  let view7 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], operations: [], now, staleAfterSeconds: 60,
    humanGates: [{ gate_id: 'hg-1', scope: 'adu', target_id: 'adu-1', status: 'pending', source_agent: 'test-agent' }],
    aduViews: [{ id: 'adu-2', next_agent: 'test-agent', state: 'created' }]
  });
  eq(view7.runtime_status, 'needs_attention', 'Scenario 7: needs_attention');

  // 8. Running 心跳超时：running 且 stale_warning.stale=true
  let view8 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], aduViews: [], humanGates: [], now, staleAfterSeconds: 60,
    operations: [{ operation_id: 'op-1', scope: 'adu', target_id: 'adu-1', status: 'running', current_agent: 'test-agent', started_at: '2026-06-22T09:50:00Z', last_progress_at: '2026-06-22T09:50:00Z' }]
  });
  eq(view8.runtime_status, 'running', 'Scenario 8: running');
  eq(view8.stale_warning.stale, true, 'Scenario 8: stale is true');

  // 9. 后续成功 Run 解决旧失败：不再 Needs attention
  let view9 = deriveAgentRuntimeView({
    agent: baseAgent, operations: [], humanGates: [], now, staleAfterSeconds: 60,
    runs: [
      { timestamp: '2026-06-22T09:00:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'failed', returncode: 1 },
      { timestamp: '2026-06-22T09:10:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'success', returncode: 0 }
    ],
    aduViews: [{
      id: 'adu-1', state: 'implemented', latest_run: { timestamp: '2026-06-22T09:10:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'success', returncode: 0 }
    }]
  });
  eq(view9.runtime_status, 'idle', 'Scenario 9: idle');

  // 10. Operator Override 解决失败：最近结果按有效结果显示
  let view10 = deriveAgentRuntimeView({
    agent: baseAgent, aduViews: [], operations: [], humanGates: [], now, staleAfterSeconds: 60,
    runs: [{ timestamp: '2026-06-22T09:00:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'failed', returncode: 1, effective_returncode: 0 }]
  });
  eq(view10.last_result.effective_returncode, 0, 'Scenario 10: effective return code is used');

  // 11. 无 Run：成功率为 null
  let view11 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], aduViews: [], operations: [], humanGates: [], now, staleAfterSeconds: 60
  });
  eq(view11.success_rate, null, 'Scenario 11: success rate is null');
  
  // Terminal calculation check
  let view12 = deriveAgentRuntimeView({
    agent: baseAgent, aduViews: [], operations: [], humanGates: [], now, staleAfterSeconds: 60,
    runs: [
      { timestamp: '2026-06-22T09:00:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'failed', returncode: 1 },
      { timestamp: '2026-06-22T09:10:00Z', adu_id: 'adu-1', agent: 'test-agent', result: 'success', returncode: 0 }
    ]
  });
  eq(view12.success_rate, 50, 'Scenario 12: 50% success rate');

  // 13. Epic waiting state aggregation
  let view13 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], operations: [], humanGates: [], now, staleAfterSeconds: 60, aduViews: [],
    epicViews: [{ id: 'epic-1', title: 'Epic 1', next_agent: 'test-agent', state: 'created', updated_at: '2026-06-22T09:00:00Z' }]
  });
  eq(view13.queued_targets.length, 1, 'Scenario 13: Epic in queued_targets');
  eq(view13.queued_targets[0].target_type, 'epic', 'Scenario 13: Epic target type');

  // 14. Quality Decisions Needs Attention (analysis_review -> requirement-analyst)
  let view14 = deriveAgentRuntimeView({
    agent: { id: 'requirement-analyst' }, runs: [], operations: [], humanGates: [], now, staleAfterSeconds: 60, aduViews: [], epicViews: [],
    qualityDecisions: [{ review_id: 'rev-1', adu_id: 'adu-1', state: 'analysis_review', status: 'rework_requested' }]
  });
  eq(view14.runtime_status, 'needs_attention', 'Scenario 14: Quality Decision (analysis_review) needs attention for requirement-analyst');
  eq(view14.attention_items[0].kind, 'quality_decision', 'Scenario 14: Attention item kind is quality_decision');

  // 15. Quality Decisions Needs Attention (design_review -> detail-designer)
  let view15 = deriveAgentRuntimeView({
    agent: { id: 'detail-designer' }, runs: [], operations: [], humanGates: [], now, staleAfterSeconds: 60,
    aduViews: [{ id: 'adu-1', state: 'designed', next_agent: null, workflow: [] }], epicViews: [],
    qualityDecisions: [{ review_id: 'rev-2', adu_id: 'adu-1', state: 'design_review', status: 'pending' }]
  });
  eq(view15.runtime_status, 'needs_attention', 'Scenario 15: Quality Decision (design_review) needs attention for detail-designer');

  // 16. Rework Chains active
  let view16 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], operations: [], humanGates: [], now, staleAfterSeconds: 60, aduViews: [], epicViews: [],
    reworkChains: [{ agent: 'test-agent', target_id: 'adu-1', id: 'adu-1' }]
  });
  eq(view16.runtime_status, 'needs_attention', 'Scenario 16: Rework Chain needs attention');
  eq(view16.attention_items[0].kind, 'rework_required', 'Scenario 16: Attention item kind is rework_required');

  // 17. Failed Operations Needs Attention (Latest Op Failed)
  let view17 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], humanGates: [], now, staleAfterSeconds: 60, aduViews: [], epicViews: [],
    operations: [{ operation_id: 'op-1', target_id: 'adu-1', current_agent: 'test-agent', status: 'failed', created_at: '2026-06-22T09:00:00Z' }]
  });
  eq(view17.runtime_status, 'needs_attention', 'Scenario 17: Failed Operation needs attention');

  // 18. Failed Operations DO NOT Need Attention if superceded by a running/success op
  let view18 = deriveAgentRuntimeView({
    agent: baseAgent, runs: [], humanGates: [], now, staleAfterSeconds: 60, aduViews: [], epicViews: [],
    operations: [
      { operation_id: 'op-1', target_id: 'adu-1', current_agent: 'test-agent', status: 'failed', created_at: '2026-06-22T09:00:00Z' },
      { operation_id: 'op-2', target_id: 'adu-1', current_agent: 'other-agent', status: 'running', created_at: '2026-06-22T09:05:00Z' }
    ]
  });
  eq(view18.runtime_status, 'idle', 'Scenario 18: Failed Operation superceded does not need attention');

  console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
