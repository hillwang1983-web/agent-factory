# Common Context Pack

Purpose: This context pack is shared by all Hermes-executed Agent Factory roles.

## Factory Rules

- Hermes is the execution layer.
- `.ai-agent/registry/adu.json` is the source of truth for ADU state.
- `.ai-agent/registry/agents.json` is the source of truth for Agent execution configuration.
- Each Agent must output structured JSON at the end of its response.
- The runtime project payload is authoritative for repository location, architecture, and technology stack.
- Production code must not be modified unless the ADU and contract explicitly allow that path.
- Read and write paths are controlled by the runtime `artifact_paths` and ADU policy. Do not assume fixed project directories.
- Do not claim completion without command output or artifact paths.

## Workflow Scope

The ADU or Epic state supplied in the runtime payload is the source of truth.
Follow the role-specific `next_state` contract and do not skip configured analysis,
design, review, verification, or human-gate stages.

## Evidence Rules

Every run must produce:

- command list;
- changed file list;
- artifact path list;
- next state recommendation;
- risk list;
- JSON result block.

## Human Gate Rules

Move to `human_gate` if:

- the same ADU exceeds its configured retry limit;
- the Agent needs files outside `allowed_write_paths`;
- the Agent needs to change executor or model configuration;
- the Agent needs to run a blocked or destructive command;
- the Agent cannot produce the required structured result.

## Language Policy

除非 ADU 明确指定其他语言，所有过程文档、分析说明、设计说明、测试说明和验收说明默认使用中文。
代码、命令、路径、API 字段、协议字段、配置项、日志关键字、英文缩写和标准名称保持原文。
如果中文说明中需要引用原始英文术语，请保留英文术语并用中文解释其作用。
