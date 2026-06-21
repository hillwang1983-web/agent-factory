# Agent Factory ADU-1351 遗留 BUG 修复阶段总结与交接说明

## 1. 文档目的

本文档记录 `ADU-1351-001` 真实开发链路结束后，Agent Factory 遗留 BUG 修复工作的当前状态，供新的开发 Agent 直接接手。

本轮工作的正式实施计划为：

```text
docs/superpowers/plans/2026-06-21-agent-factory-post-adu-1351-residual-bugfix-plan.md
```

计划覆盖 6 项缺陷：

| ID | 严重度 | 缺陷 |
|---|---|---|
| AF-1351-01 | P1 | Code Reviewer 事实性假通过 |
| AF-1351-02 | P1 | 完成信封与 stdout 业务 JSON 解析竞争 |
| AF-1351-03 | P1 | Agent 自报命令与可信命令验证没有隔离 |
| AF-1351-04 | P1 | Evidence Agent 错误声明 Registry/generated 文件 |
| AF-1351-05 | P2 | 缺少标准化人工纠偏机制 |
| AF-1351-06 | P2 | Token 汇总遗漏重复运行和最终 Agent |

截至本文档生成时：

- Task 1 至 Task 5 已有对应提交。
- Task 2、Task 3、Task 4 的专项测试已复验通过。
- Task 5 已提交初步修复，但仍应由接手 Agent 按计划补齐完整分类测试。
- Task 6 的现有实现审核不通过，必须重做。
- Task 7 至 Task 9 尚未完成。

## 2. 当前 Git 状态

当前分支：

```text
main
```

当前 HEAD：

```text
89f3248 feat(operator): implement Operator Override Service & API endpoints with process cancellation and locking support
```

生成本文档前，工作区为 clean，`git diff --check` 无输出。

相关提交顺序：

```text
5acbc4f test(agent-factory): add ADU-1351 regressions entrypoint
b8d8fd0 fix(agent-factory): make completion envelope authoritative and fix watchdog envelope priority
81c1316 feat(agent-factory): implement trusted command policy and verification logs
85d04b4 feat(agent-factory): prevent factual false pass in Code Reviewer
9a74026 feat(agent-factory): reject write path escape for non-developer agents
89f3248 feat(operator): implement Operator Override Service & API endpoints with process cancellation and locking support
```

注意：

`89f3248` 同时提交了正式实施计划文档，不建议直接执行：

```bash
git revert 89f3248
```

否则会连同计划文档一起删除。建议以新的修复提交替换错误的 Task 6 实现，并保留计划文档。

## 3. 已完成并复验的工作

### 3.1 Task 1：ADU-1351 回归入口

提交：

```text
5acbc4f
```

目标：

- 建立 `ADU-1351` 遗留缺陷统一回归入口。
- 后续 Task 完成后统一纳入回归套件。

接手 Agent 应确认该入口最终包含：

```text
scripts/test_agent_run_policy.py
scripts/test_command_policy.py
scripts/test_code_review_fact_gate.py
scripts/test_token_ledger.py
agent-factory-dashboard/backend/tools/test-operator-overrides.js
```

目前后两项尚未完整落地。

### 3.2 Task 2：完成信封优先级

提交：

```text
b8d8fd0
```

修改文件：

```text
scripts/agent_run_policy.py
scripts/hermes_agent_run.py
scripts/test_agent_run_policy.py
```

已实现：

1. 启用 completion 协议时，合法 `completion.json` 是终态结果的权威来源。
2. stdout 中先输出的业务 JSON 不能覆盖 completion 信封。
3. 完成信封状态区分为：
   - `not_expected`
   - `missing`
   - `invalid`
   - `valid`
4. 增加 completion priority 反例测试。

本轮复验命令：

```bash
python3 scripts/test_agent_run_policy.py
```

结果：

```text
10/10 PASS
```

其中 Case 10 验证：

```text
Explicit completion envelope priority
```

### 3.3 Task 3：可信命令策略与验证记录

提交：

```text
81c1316
```

新增文件：

```text
scripts/command_policy.py
scripts/run_trusted_verification.py
scripts/test_command_policy.py
```

已实现：

1. 命令 allowlist 判断。
2. blocked pattern 判断。
3. Shell 控制符阻断。
4. Runner 可信命令验证记录。
5. BuildFix Prompt 不再把 Agent 自报命令视为可信证据。

本轮复验命令：

```bash
python3 scripts/test_command_policy.py
```

结果：

```text
PASS
```

边界说明：

本功能是 Runner 可信执行和状态推进门禁，不是容器、虚拟机或内核级命令沙箱。

### 3.4 Task 4：Code Reviewer 确定性事实门

提交：

```text
85d04b4
```

新增文件：

```text
scripts/code_review_fact_gate.py
scripts/test_code_review_fact_gate.py
```

修改文件：

```text
scripts/validate_quality_report.py
.ai-agent/prompts/code-reviewer-agent.md
```

已实现：

1. Code Review pass 必须提供可验证事实声明。
2. Validator 可检查文件事实与报告是否矛盾。
3. 质量报告 Validator 接入事实门。
4. Code Reviewer Prompt 禁止仅用自然语言声称“完全覆盖”“不存在某模式”。

本轮复验命令：

```bash
python3 scripts/test_code_review_fact_gate.py
python3 scripts/test_validate_quality_report.py
```

结果：

```text
Code Review Fact Gate: PASS
validate_quality_report: 16/16 PASS
```

### 3.5 Task 5：Evidence 文件声明初步限制

提交：

```text
9a74026
```

修改文件：

```text
scripts/hermes_agent_run.py
.ai-agent/prompts/evidence-agent.md
```

已实现的初步行为：

- 非 Developer Agent 声明越界写路径时会被拒绝。
- Evidence Prompt 限制其声明的产物范围。

当前不足：

正式计划要求将文件声明分为：

```text
valid_changed_files
runtime_managed_files
generated_files
errors
```

并为 Evidence Agent 增加正反例测试。当前提交规模只有 14 行，尚不能视为完整满足 Task 5。

接手 Agent 必须重新对照计划中的 Task 5 检查：

1. Registry 文件是否被归入 `runtime_managed_files`。
2. `build/`、`dist/`、`coverage/` 是否被归入 `generated_files`。
3. Evidence 声明源码路径时是否返回：

```text
evidence_agent_declared_source_change
```

4. 分类结果是否进入 run record。
5. 是否存在针对 ADU-1351 Evidence 错报场景的测试。

最终 Evidence Validator 当前仍通过：

```bash
python3 scripts/validate_evidence_package.py \
  --adu ADU-1351-001 \
  --repo-root <repo-root> \
  --registry-dir <workspace-root>/.ai-agent/registry
```

输出：

```text
PASS: All contract assertions have valid evidence/waivers.
```

该结果只证明当前 ADU 的人工修正版 Evidence 有效，不能证明 Task 5 已完整实现。

## 4. Task 6 当前实现及审核结论

### 4.1 当前提交

提交：

```text
89f3248
```

新增或修改：

```text
agent-factory-dashboard/backend/src/domain/operator-override.ts
agent-factory-dashboard/backend/src/application/operator-override-service.ts
agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts
agent-factory-dashboard/backend/tools/test-operator-override.js
agent-factory-dashboard/backend/package.json
```

当前实现提供了：

```text
APPROVE_COMMAND_POLICY
APPROVE_ENVIRONMENT_WAIVER
FORCE_STEP
REVERT_STATE
RESET_BUDGET
SUSPEND_RUN
```

但正式 Task 6 要求的是：

```text
对指定 failed run 执行 accept_validator_result
```

两者不是同一功能。

### 4.2 审核结论

Task 6：

```text
REJECTED
```

当前提交不能作为 Task 6 完成证据。

### 4.3 P0：任意状态跳转

当前代码直接接受：

```typescript
override.payload.target_state
```

并写入：

```typescript
adu.state = targetState;
```

缺少：

1. 状态白名单。
2. 当前状态校验。
3. Agent 与合法目标状态映射。
4. Quality Validator 成功证明。
5. run 绑定。

攻击或误操作可以直接将任意 ADU 写成：

```text
evidenced
```

必须删除或禁用：

```text
FORCE_STEP
REVERT_STATE
```

除非未来为其单独编写安全设计。

### 4.4 P0：进程终止竞态与误杀

当前实现顺序为：

1. 写回 `adu.json`。
2. 读取 lock PID。
3. 发送 SIGTERM。
4. 500ms 后无条件尝试 SIGKILL。
5. 立即删除 lock。

问题：

1. Orchestrator 可能在终止前用内存旧状态覆盖刚写入的 ADU 状态。
2. SIGKILL 前没有重新检查 PID 和 owner。
3. PID 被系统复用时存在误杀风险。
4. lock 在进程真正退出前被删除，其他操作可并发启动。
5. Operation Store 没有完成一致性收敛。

Task 6 的 `accept_validator_result` 本身不要求杀进程。接手实现时不应保留这套进程终止逻辑。

### 4.5 P1：缺少计划要求的 run 纠偏

正式计划要求路由：

```text
POST /api/agent-factory/adus/:aduId/runs/:runTimestamp/override
GET  /api/agent-factory/adus/:aduId/overrides
```

当前只有：

```text
POST /api/agent-factory/adus/:aduId/operator-override
```

当前缺少：

1. `runTimestamp`。
2. 目标 run 存在性校验。
3. run 已经 success 时返回 `409`。
4. `validator.command`。
5. `validator.exit_code === 0`。
6. `validator.output`。
7. `reason_code`。
8. Agent 到合法终态映射。
9. 保存 `original_result`。
10. 保存 `original_effective_returncode`。
11. `operator_override_id`。
12. 幂等操作。
13. Operation event：

```text
operator_override_applied
```

### 4.6 P1：Registry RMW 未加锁

当前 Service 对以下文件执行无锁读改写：

```text
.ai-agent/registry/adu.json
.ai-agent/registry/operator-overrides.json
```

未使用：

```typescript
RegistryLock.runLocked(...)
```

这会与 Orchestrator、Human Gate 和其他 API 的 Registry 写入发生覆盖。

必须把以下动作放入同一锁事务：

1. 读取 ADU。
2. 读取目标 run。
3. 校验 override。
4. 追加审计记录。
5. 保留并更新 run。
6. 更新 ADU state。

损坏的 `operator-overrides.json` 不能被静默覆盖，应返回明确错误。

### 4.7 P1：API 输入可伪造

当前 API 从客户端接受：

```text
approved_by
timestamp 之外的全部 action/payload
```

问题：

1. `approved_by` 可伪造。
2. `aduId` 未使用 `/^[A-Za-z0-9_.-]+$/` 校验。
3. 非法 action 最终返回 `500`。
4. ADU 不存在返回 `500`，而不是 `404`。
5. comment 没有 `10..4000` 长度限制。
6. validator output 没有 `20000` 字符上限。

新的 API 不得接受客户端提供：

```text
from_result
from_state
actor
created_at
override_id
```

这些字段必须由后端生成。

### 4.8 P2：运行态文件治理未完成

以下文件尚未同步：

```text
.gitignore
scripts/agent_factory_bootstrap.py
scripts/agent_factory_doctor.py
scripts/check_tracked_path_leaks.py
```

目标运行态文件：

```text
.ai-agent/registry/operator-overrides.json
```

必须：

1. Git ignore。
2. Bootstrap 初始化为合法空结构。
3. Doctor 阻止被 staged。
4. Portability 扫描按运行态文件处理。

### 4.9 P2：测试覆盖不足

现有测试：

```text
agent-factory-dashboard/backend/tools/test-operator-override.js
```

只有两个 Service 正向用例：

```text
FORCE_STEP
RESET_BUDGET
```

这两个操作不属于正式 Task 6。

正式测试必须覆盖：

1. ADU 不存在返回 `404`。
2. run 不存在返回 `404`。
3. run 原本 success 返回 `409`。
4. 缺少 Validator 证据返回 `400`。
5. Validator exit code 非 0 返回 `400`。
6. 非法目标状态返回 `400`。
7. 重复请求幂等。
8. 原始 run 结果被保留。
9. ADU 和 run 在同一锁事务更新。
10. GET overrides 返回审计记录。

建议将测试文件按正式计划命名为：

```text
agent-factory-dashboard/backend/tools/test-operator-overrides.js
```

## 5. 本轮验证结果

### 5.1 通过

```text
Backend npm run build: PASS
test_agent_run_policy.py: 10/10 PASS
test_command_policy.py: PASS
test_code_review_fact_gate.py: PASS
test_validate_quality_report.py: 16/16 PASS
ADU-1351 evidence validator: PASS
git diff --check: PASS
```

### 5.2 未完整通过

`npm run test:operator` 在当前 Codex 沙箱中运行至 `test-phase37-bugs.js` 时失败：

```text
listen EPERM: operation not permitted 0.0.0.0
```

这是当前执行环境禁止监听端口造成的限制。本轮不能据此判断业务测试失败，但也不能复述“完整 operator 测试已验证通过”。

新增的 Task 6 测试单独执行结果：

```text
2/2 PASS
```

但测试目标偏离正式计划，因此不构成验收证据。

### 5.3 Portability 和 Doctor 当前失败

命令：

```bash
cd agent-factory-dashboard/backend
npm run check:portable
npm run doctor -- --skip-hermes
```

当前失败原因：

```text
docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md
```

包含本机用户主目录的绝对路径及对应的 `file` URL。

这是已有调试文档中的本机路径泄漏，不是 `89f3248` 新增，但最终 Task 9 全量验收前必须修复。

## 6. 接手 Agent 的执行顺序

### 第一优先级：重做 Task 6

严格按照正式计划的 Task 6 实现：

```text
docs/superpowers/plans/2026-06-21-agent-factory-post-adu-1351-residual-bugfix-plan.md
```

推荐步骤：

1. 先把现有 `FORCE_STEP`、`REVERT_STATE`、`RESET_BUDGET`、`SUSPEND_RUN` 测试改成失败反例或删除。
2. 重写 `operator-override.ts`。
3. 重写 `operator-override-service.ts`。
4. 使用 `RegistryLock.runLocked()`。
5. 实现指定 run 的 `accept_validator_result`。
6. 实现 POST 和 GET API。
7. 补齐运行态文件治理。
8. 编写全部 7 个 API 反例和正向幂等测试。
9. 运行 Backend build、专项测试、doctor 和 portability。

不要继续扩展通用运维控制动作。

### 第二优先级：补齐 Task 5

确认 Evidence 文件声明分类实现完整，并增加测试。

### 第三优先级：执行 Task 7

只有 Task 6 后端通过审核后，才能开发：

```text
OperatorOverridePanel.tsx
```

前端不能调用当前不安全的：

```text
POST /adus/:aduId/operator-override
```

### 第四优先级：执行 Task 8

实现统一 Token Ledger，修复重复 Agent 用量覆盖和 Evidence Agent 缺失。

### 第五优先级：执行 Task 9

执行全量回归和隔离 ADU E2E。

## 7. Task 6 正确完成后的最小数据流

```text
failed quality run
  -> operator selects "accept validator result"
  -> backend validates ADU and run
  -> backend validates deterministic validator exit_code == 0
  -> backend checks agent-to-terminal-state mapping
  -> RegistryLock transaction starts
  -> append immutable operator override
  -> preserve original run result
  -> mark target run as overridden success
  -> update ADU state
  -> RegistryLock transaction ends
  -> emit operator_override_applied event
  -> Dashboard refreshes
```

不包含：

```text
arbitrary state jump
budget reset
process SIGKILL
lock deletion
client-supplied actor
```

## 8. Task 6 验收清单

只有以下全部满足，Task 6 才能标记完成：

- [ ] API 绑定指定 `aduId + runTimestamp`
- [ ] 只支持 `accept_validator_result`
- [ ] 目标 run 必须存在且当前不是 success
- [ ] Validator exit code 必须为 0
- [ ] 目标状态由后端 Agent 映射校验
- [ ] 原始 result 和 effective_returncode 被保留
- [ ] Override ID 由后端生成
- [ ] 重复请求幂等
- [ ] Registry RMW 使用统一锁
- [ ] 审计记录不可被静默覆盖
- [ ] 写入 `operator_override_applied` 事件
- [ ] POST 和 GET API 都存在
- [ ] `aduId` 和 `runTimestamp` 白名单校验
- [ ] comment 和 validator output 有长度限制
- [ ] `operator-overrides.json` 完成运行态治理
- [ ] 全部正反例测试通过
- [ ] Backend build 通过
- [ ] Doctor 和 portability 通过

## 9. 最终结论

当前阶段不是“全部修复完成”，而是：

```text
Task 1-4: 已实现并有专项测试证据
Task 5: 初步实现，待补齐分类和反例测试
Task 6: 实现方向偏离且存在 P0/P1 风险，必须重做
Task 7-9: 尚未完成
```

新的开发 Agent 应从重做 Task 6 开始，不需要重写已经通过专项测试的 completion、command policy 和 code review fact gate。
