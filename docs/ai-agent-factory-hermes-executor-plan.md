# 使用 Hermes 作为 5G 核心网 AI Agent 工厂执行器的落地方案

评估日期：2026-06-07

目标：使用本机已安装的开源 Hermes 作为 AI Agent 工厂的执行器，支撑 5G 核心网需求开发、测试、调试、证据收集和发布准备。

本机观察到的 Hermes 能力：

- CLI：`/Users/hill/.local/bin/hermes`
- 支持 `--oneshot`、`--worktree`、`--toolsets`、`--skills`、`--model`、`--provider`
- 支持 profile：`/Users/hill/.hermes/profiles/*`
- 支持 terminal tool：local、docker、modal 等后端
- 支持 V4A patch parser
- 支持 batch runner、checkpoint、sessions、kanban、cron、gateway、ACP server、tools registry
- 当前默认模型配置在 `/Users/hill/.hermes/config.yaml`

## 一、结论

可以用 Hermes 做执行器。

但建议定位清楚：

| 层级 | 是否由 Hermes 承担 | 说明 |
| --- | --- | --- |
| 模型调用 | 是 | Hermes 已有 provider/model 配置。 |
| 工具执行 | 是 | terminal、file、patch、browser、MCP、skills 等。 |
| worktree 隔离 | 是 | Hermes CLI 支持 `--worktree`。 |
| 单 Agent 执行 | 是 | 通过 `hermes -z <prompt>` 执行。 |
| 批量并发 | 部分是 | 可复用 batch runner 或外部 wrapper。 |
| 工厂状态机 | 建议外置 | 用 `.ai-agent/registry/*.yaml` 管 ADU 状态。 |
| 发布门禁 | 不完全交给 Hermes | Release/HDE 仍由人类或上层 Orchestrator 判定。 |

推荐架构：

```text
.ai-agent registry / Orchestrator script
        |
        v
Hermes executor wrapper
        |
        v
hermes --oneshot --worktree --toolsets hermes-cli
        |
        v
Open5GS repo / tests / logs / evidence
```

一句话：

> Hermes 做执行器，不做全部大脑；工厂状态、ADU、Contract、Evidence 仍放在仓库内，由 Orchestrator 通过 Hermes 调度执行。

## 二、为什么 Hermes 适合做执行器

| Hermes 能力 | 对 Agent 工厂的价值 |
| --- | --- |
| `--oneshot` | 适合脚本化执行单个 Agent 任务。 |
| `--worktree` | 适合并行 Agent 隔离修改。 |
| `--toolsets` | 可按 Agent 类型限制工具。 |
| `--skills` | 可给不同 Agent 注入不同技能。 |
| profiles | 可隔离 coding、review、release、testing 等执行环境。 |
| terminal tool | 可编译、测试、跑脚本、启动服务。 |
| patch parser | 可处理 Codex/Cline 风格 patch。 |
| batch runner | 可跑批量 prompts，适合后续并发。 |
| checkpoints | 支持失败恢复和状态保存。 |
| sessions | 可追溯每个 Agent 的执行历史。 |
| kanban/cron/gateway | 后续可扩展任务看板、定时回归、消息通知。 |

## 三、推荐分层

### 3.1 工厂层

放在 Open5GS 仓库：

```text
.ai-agent/
  registry/
    adu.yaml
    runs.yaml
    agents.yaml
  prompts/
    orchestrator.md
    context-pack-agent.md
    contract-agent.md
    testwriter-agent.md
    developer-agent.md
    buildfix-debugger-agent.md
    evidence-agent.md
  context-packs/
  contracts/
  runs/
  evidence/
scripts/
  hermes_agent_run.py
  hermes_agent_next.py
  hermes_agent_collect.py
```

职责：

| 工厂层组件 | 职责 |
| --- | --- |
| `adu.yaml` | 管需求、状态、允许路径、下一 Agent。 |
| `agents.yaml` | 管 Agent 角色、prompt、模型、toolsets、profile。 |
| `runs/` | 保存每次 Hermes 执行输入输出。 |
| `evidence/` | 保存最终验收证据。 |
| wrapper scripts | 调 Hermes、收输出、推进状态。 |

### 3.2 Hermes 执行层

由 Hermes 负责：

| 执行能力 | Hermes 方式 |
| --- | --- |
| 单次 Agent 执行 | `hermes -z "<prompt>"` |
| 隔离修改 | `hermes --worktree -z "<prompt>"` |
| 指定模型 | `hermes -m <model>` |
| 指定工具 | `hermes -t hermes-cli` |
| 指定技能 | `hermes -s <skill>` |
| 恢复会话 | `hermes --resume <session_id>` |
| profile 隔离 | `hermes profile ...` 或按 profile 配置运行 |
| 批量任务 | `batch_runner.py` 或自定义 wrapper |

## 四、Agent 到 Hermes 的映射

### 4.1 MVP 7 个 Agent

| Agent | Hermes profile | toolsets | 是否 `--worktree` | 模型档位 |
| --- | --- | --- | --- | --- |
| Orchestrator | coding | 低权限/文件读写 | 否 | 中/高 |
| Context Pack | coding | 文件读取、搜索 | 否 | 中/高 |
| Contract | coding | 文件读写 | 否 | 高 |
| TestWriter | coding | 文件、terminal | 是 | 中 |
| Developer | coding | 文件、terminal、patch | 是 | 中/高 |
| BuildFix/Debugger | coding | terminal、file、patch | 是 | 高 |
| Evidence | coding | terminal、file | 否 | 中 |

说明：profile 名可以后续新建；MVP 可以先统一用 `coding` 或默认 profile。

### 4.2 生产阶段 Agent

| Agent | Hermes 执行方式 |
| --- | --- |
| Requirement Analyst | oneshot，无 worktree。 |
| Architecture Agent | oneshot，无 worktree，高推理模型。 |
| Compatibility Agent | oneshot，无 worktree，读 contract diff。 |
| Risk Review Agent | oneshot，无 worktree，高推理模型。 |
| Security Review Agent | oneshot，无 worktree，限制 secret 读取。 |
| Chaos Agent | oneshot + terminal，专用 testing profile。 |
| Release Agent | oneshot，无 worktree，读 evidence。 |

## 五、最小运行命令

### 5.1 单 Agent 执行

```bash
hermes -z "你是 Context Pack Agent。请读取当前仓库..."
```

### 5.2 使用 worktree 隔离

```bash
hermes --worktree -z "你是 Developer Agent。只允许修改 tests/demo 和 src/demo..."
```

### 5.3 指定工具和模型

```bash
hermes -t hermes-cli -m google/gemini-3.5-flash -z "执行 ADU ..."
```

### 5.4 推荐 wrapper 形式

```bash
python scripts/hermes_agent_run.py --adu REQ-DEMO-001 --agent testwriter
python scripts/hermes_agent_run.py --adu REQ-DEMO-001 --agent developer
python scripts/hermes_agent_run.py --adu REQ-DEMO-001 --agent evidence
```

wrapper 负责：

1. 从 `.ai-agent/registry/adu.yaml` 读取 ADU。
2. 读取 `.ai-agent/prompts/<agent>.md`。
3. 拼接 prompt。
4. 调用 Hermes。
5. 保存 stdout/stderr/session id。
6. 更新 ADU 状态。
7. 必要时触发下一个 Agent。

## 六、Hermes 执行器输入输出契约

### 6.1 输入

```yaml
adu_id: REQ-DEMO-001
agent: developer
state: test_red
workspace: /Users/hill/open5gs
allowed_paths:
  - tests/demo
  - src/demo
contracts:
  - .ai-agent/contracts/demo.yaml
required_commands:
  - ninja -C build
  - meson test -C build demo
output_required:
  - patch summary
  - commands run
  - artifacts
  - next state
```

### 6.2 Hermes prompt 模板

```text
你是 {{agent_name}}。

任务 ADU：{{adu_id}}
当前状态：{{state}}
工作目录：{{workspace}}

允许读取：
{{read_paths}}

允许修改：
{{allowed_paths}}

必须遵守：
{{contracts}}

必须运行或说明无法运行的验证命令：
{{required_commands}}

输出必须包含：
1. result: success / blocked / failed
2. changed_files
3. commands_run
4. artifacts
5. risks
6. next_agent

不要修改 allowed_paths 之外的文件。
不要口头宣称完成，必须给出日志或证据路径。
```

### 6.3 输出

Hermes 最终输出应要求为 YAML/JSON：

```yaml
result: success
adu_id: REQ-DEMO-001
agent: developer
state_transition:
  from: test_red
  to: implemented
changed_files:
  - tests/demo/test_demo.py
commands_run:
  - command: pytest tests/demo/test_demo.py
    result: pass
artifacts:
  - .ai-agent/runs/REQ-DEMO-001/developer/output.md
risks:
  - none
next_agent: evidence
```

## 七、Hermes profile 建议

MVP 可以先用一个 profile。生产阶段建议拆 profile：

| Profile | 用途 | 权限 |
| --- | --- | --- |
| `coding` | 写测试、写代码、debug。 | 可 terminal、file、patch。 |
| `review` | review、risk、安全审查。 | 只读为主。 |
| `release` | evidence、release note、验收矩阵。 | 写 docs/evidence。 |
| `testing` | 长稳、仿真、Chaos。 | terminal 强权限，但隔离环境。 |

profile 的价值是隔离模型、工具、环境变量、gateway、日志和权限。

## 八、落地路线

### Day 1：不改 Hermes，跑通手工 oneshot

目标：证明 Hermes 能在 `/Users/hill/open5gs` 执行一个 Agent 任务。

动作：

1. 创建 `.ai-agent/prompts/context-pack-agent.md`。
2. 创建 `.ai-agent/registry/adu.yaml`。
3. 用 `hermes -z` 生成一个 context pack。
4. 保存输出到 `.ai-agent/runs/...`。

### Day 2：封装 wrapper

目标：不用手动拼 prompt。

动作：

1. 写 `scripts/hermes_agent_run.py`。
2. 支持 `--adu`、`--agent`。
3. 自动读取 registry 和 prompt。
4. 自动调用 Hermes。
5. 自动保存 run 结果。

### Day 3：跑 TestWriter + Developer

目标：使用 Hermes 完成一个小需求的测试和代码变更。

动作：

1. 选低风险 demo 需求。
2. TestWriter 先写测试。
3. Developer 在 `--worktree` 下实现。
4. BuildFix/Debugger 修失败。

### Day 4：Evidence 闭环

目标：从 Hermes run 结果生成 evidence。

动作：

1. Evidence Agent 读取 build/test log。
2. 生成 `evidence.yaml`。
3. 更新 ADU 状态为 `evidenced`。

### Day 5：并发和状态机

目标：支持多个 ADU 队列。

动作：

1. `hermes_agent_next.py` 选择下一个可跑 ADU。
2. 每个实现型 ADU 使用 `--worktree`。
3. 失败超过 3 次进入 `human_gate`。

## 九、是否需要改 Hermes 源码

MVP 不需要。

优先级：

| 阶段 | 是否改 Hermes |
| --- | --- |
| MVP | 不改，只用 CLI。 |
| 可用工厂 | 尽量不改，用 wrapper 和 profile。 |
| 生产工厂 | 可考虑接 ACP server 或 batch_runner。 |
| 企业版 | 再考虑定制 Hermes 工具、dashboard、kanban 集成。 |

不建议一开始 fork Hermes 深改。先把执行链路跑通。

## 十、风险和约束

| 风险 | 处理 |
| --- | --- |
| Hermes oneshot 输出不稳定 | prompt 强制 YAML/JSON 输出，wrapper 做解析校验。 |
| Agent 修改范围失控 | 使用 `--worktree` + prompt 白名单 + git diff 检查。 |
| 并发冲突 | ADU registry 维护冲突域，同一文件同一时间只给一个 Agent。 |
| session 难追踪 | wrapper 保存 session、stdout、stderr、命令、git diff。 |
| Hermes local terminal 权限过大 | coding/testing profile 分开，危险命令仍需审批或禁用。 |
| 模型能力不稳定 | 按 Agent 类型指定模型，失败自动升级模型或进入 HDE。 |

## 十一、最终建议

使用 Hermes 作为执行器是可行的，而且是当前最现实的路线。

推荐不要一开始做复杂平台，而是先做：

```text
.ai-agent registry
+ prompt templates
+ Hermes oneshot wrapper
+ Hermes --worktree
+ evidence collector
```

最小闭环：

```text
Orchestrator script
  -> hermes Context Agent
  -> hermes Contract Agent
  -> hermes TestWriter Agent
  -> hermes Developer Agent --worktree
  -> hermes BuildFix/Debugger Agent --worktree
  -> hermes Evidence Agent
```

第一阶段只需要 5 天左右，目标不是完成所有 Agent，而是证明：

> Hermes 可以作为执行器，完成一个真实 5GC 小需求的 context -> contract -> test -> code -> validation -> evidence 闭环。
