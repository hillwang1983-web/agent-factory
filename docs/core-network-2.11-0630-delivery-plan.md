# 核心网产品 2.11 版本 6 月 30 日交付规划

规划日期：2026-06-06

目标日期：2026-06-30

规划口径：AI Agent 交付模式，不使用传统人月估算。工作按 ADU（Agentic Delivery Unit）组织，即一个 Agent 可独立完成并留下验证证据的交付闭环。

## 一、结论

如果要求在 **2026-06-30 前完成交付**，必须把目标定义为：

> 交付 `GC_V2.11.0_SP01` 可发布版本：KPI 上报增强 + 4G 核心网基础状态/告警/KPI；同时完成 2.11 后续需求的冻结、Spike 结论和 SP02 计划，不把 SP02 全量功能塞进 6 月 30 日发布包。

不建议把 34 条 2.11 全量需求作为 6 月 30 日交付目标。原因：

- 2.11 清单中真正计划 2026-06-30 发布的是 `GC_V2.11.0_SP01`，共 2 条需求。
- `GC_V2.11.0_SP02` 和 `IMS_V2.11.0_SP01` 计划发布时间为 2026-08-07。
- 未分配版本中的多线程、SM4 N3 隧道、工业增强网关、业务分析服务器、工业协议代理等属于架构级或新产品级需求。
- 加密卡、达梦、国密 USIM、4G/5G 互操作、IMS 等依赖外部硬件、数据库、RAN/UE/IMS 环境，AI Agent 可以做 PoC 和接口封装，但不能凭空完成联调验收。

## 二、6 月 30 日发布范围

### 2.1 必须交付

| 编号 | 需求 | 6/30 交付定义 | 工作量 |
| --- | --- | --- | ---: |
| R1 | KPI 上报增强 | 5GC 用户数、PDU Session、UPF 和主机资源基础 KPI；支持全部/TAC/Cell/UPF 等核心维度；提供 REST/Prometheus 输出和 NMS/OAM 查询入口。 | 8-12 ADU |
| R2 | 4G 核心网基础能力完善 | EPC 终端/eNB/网元状态查询；基础 KPI；关键链路和网元告警；与 5G 使用统一展示模型。 | 6-10 ADU |

### 2.2 应随包交付但不承诺完整商用闭环

| 项目 | 6/30 交付定义 | 工作量 |
| --- | --- | ---: |
| OAM/KPI/告警统一模型 | 作为 SP01 的支撑基座，固定指标字段、告警字段、北向接口格式和验收表。 | 4-6 ADU |
| IMS 麒麟 V10 转测支撑 | 如果 IMS 交付链已有主体产物，核心网侧只提供接口、部署检查和 OAM 对齐清单。 | 2-4 ADU |
| SP02 Spike 包 | 对 5G-LAN、UPF HA、License、SIM 子网、QoS、达梦、加密卡、ARPF/EIR 等输出技术决策和 8 月 7 日计划。 | 8-14 ADU |

### 2.3 明确不进入 6/30 发布包

| 需求 | 处理方式 |
| --- | --- |
| 5G-LAN 配置简化/实现优化/双活 HA | 只做 Spike、测试基线和 SP02 计划；不承诺 6/30 商用发布。 |
| 4G/5G 互操作 | 做方案、环境清单、QCI/5QI 映射；不承诺业务不中断验收。 |
| QoS 动态生效 | 做接口草案和最小 PoC 方案；不承诺完整 MQTT->UMS->核心网闭环。 |
| License 新架构 | 做 License MVP 设计，可选做使用量统计；不做硬阻断商用承诺，除非产品当天确认超限策略。 |
| 加密卡/达梦/ARPF/EIR/国密 | 做 provider/interface/联调计划；不承诺硬件或数据库 HA 真实验收。 |
| 多线程/zk/SM4/工业增强网关/业务分析服务器/工业协议代理 | 只进入预研池，不进入 6/30 代码发布。 |

## 三、Agent-Native 交付编排

从 2026-06-06 到 2026-06-30，若从 6 月 6 日当天启动，只有 25 个自然日；若按 6 月 7 日正式开工，则只有 24 个自然日。规划必须按“短周期、日收敛、冻结范围”执行。

这里不按“人 + 会议 + 人工排班”推进，而按 **自动化 Agent 编排流水线** 推进。每个需求被拆成 ADU 卡片，卡片在状态机中流转；Agent 只消费上下文包并产出证据，是否进入下一阶段由门禁检查决定。

### 3.1 ADU 状态机

每张 ADU 卡片必须经过以下状态：

| 状态 | 进入条件 | 退出条件 | 自动失败条件 |
| --- | --- | --- | --- |
| `queued` | 已归属 R1/R2/SP01 支撑/SP02 Spike 之一 | 生成 Context Pack | 需求边界无法映射到 6/30 范围 |
| `contexted` | 相关需求、代码、测试、文档路径齐全 | 生成设计约束和验收断言 | 上下文缺关键仓库或环境 |
| `planned` | 有文件级任务、测试命令、回滚点 | 分派实现 Agent | 没有可运行验证命令 |
| `implemented` | diff 或文档产物生成 | 单元/接口/脚本验证通过 | 修改越过卡片边界 |
| `reviewed` | 独立 Review Agent 通过 | Evidence Agent 接收 | 发现 P0/P1 回归风险 |
| `evidenced` | 测试日志、接口样例、截图/抓包/运行态输出齐全 | Release Lane 可合入 | 只有代码无证据 |
| `accepted` | 验收断言全绿或有批准的降级说明 | 进入 RC 包 | 证据不可复现 |

### 3.2 时间窗与吞吐目标

| 日期 | 阶段 | 目标 | 退出条件 |
| --- | --- | --- | --- |
| 2026-06-06 ~ 2026-06-08 | Scope Lock | 生成全部 Context Pack；只允许 R1/R2/SP01 支撑进入主线 lane。 | 100% 主线 ADU 达到 `contexted`；SP02 全部进入 Spike lane。 |
| 2026-06-09 ~ 2026-06-14 | Vertical Slice | 形成 5GC KPI 与 EPC 状态查询两个端到端纵切。 | 至少 8 个主线 ADU 达到 `evidenced`。 |
| 2026-06-15 ~ 2026-06-20 | Completion Burst | 补齐 TAC/Cell/UPF、PDU Session、4G KPI、基础告警、OAM 查询。 | 主线 80% 以上 ADU 达到 `reviewed`，50% 以上达到 `evidenced`。 |
| 2026-06-21 ~ 2026-06-24 | Stabilization | 停止新增主线 ADU，只允许修复和证据补强。 | 100% 主线 ADU 达到 `evidenced` 或进入带原因的 `deferred`。 |
| 2026-06-25 ~ 2026-06-27 | RC Assembly | 生成可部署包、测试报告、API 样例、已知问题。 | RC 包由 Release Agent 从 `accepted` ADU 自动组装。 |
| 2026-06-28 ~ 2026-06-29 | Acceptance Replay | 使用独立验收 Agent 复放证据和部署步骤。 | 验收脚本可复跑；未通过项有降级说明。 |
| 2026-06-30 | Release | 发布 SP01 包。 | 版本包、文档、测试报告、已知问题、后续计划齐备。 |

### 3.3 自动化调度节奏

| 触发器 | 自动动作 | 产物 |
| --- | --- | --- |
| 新 ADU 进入 `queued` | Context Pack Agent 拉取需求、代码、测试、历史文档 | `context.md` + 相关路径清单 |
| `contexted` 卡片超过 lane 容量 | Scheduler 按依赖图和冲突域限流 | 下一批可执行 ADU 队列 |
| 任一 ADU 进入 `implemented` | Test Agent 自动执行绑定验证命令 | 测试日志和失败摘要 |
| 任一 ADU 进入 `reviewed` | Evidence Agent 收集证据并评分 | evidence bundle |
| 主线 P0 失败出现 | Scheduler 暂停同冲突域新任务 | 回滚建议和阻塞卡 |
| 每累计 6 小时 | Integration Agent 尝试合并所有 `evidenced` ADU | 集成分支和冲突报告 |
| 每累计 24 小时 | Release Risk Agent 重新计算交付概率 | burn-up、defer 建议、风险清单 |

## 四、Agent Swarm 组织

### 4.1 执行 Lane

6/30 交付窗口短，建议最多启用 4 条执行 lane。这里的 lane 不是人或小组，而是独立的上下文和冲突域；同一 lane 内的 Agent 可以替换、重启、并行，但共享同一接口契约。

| Lane | 并发槽位 | 冲突域 | 输出 |
| --- | ---: | --- | --- |
| `metric-5gc` | 4-5 | AMF/SMF/UPF metrics、Cell/UPF/PDU 统计 | R1 KPI 实现和验证证据 |
| `ops-epc` | 3-4 | MME/SGW/PGW/HSS/PCRF 状态、4G 告警 | R2 状态/KPI/告警证据 |
| `oam-evidence` | 3-4 | API、NMS/OAM 查询、发布文档、验收回放 | 查询入口、测试报告、发布包 |
| `sp02-spike` | 3-5 | 后续需求方案，不触碰 SP01 发布分支 | 8 月 7 日计划和风险证据 |

最高并发槽位：**12-16**。主线实现槽位最多 **8-10**；其余槽位只允许做测试、证据、Spike、文档和风险分析。

### 4.2 Agent 类型

| Agent 类型 | 输入 | 输出 | 禁止事项 |
| --- | --- | --- |
| Context Pack Agent | 需求编号、仓库路径、历史文档 | 最小上下文包、相关文件、验证入口 | 不做实现 |
| Contract Agent | Context Pack | 指标/告警/API/验收断言 | 不引入未确认范围 |
| Implementation Agent | Contract + 任务文件范围 | diff、迁移脚本、接口实现 | 不越权改冲突域外文件 |
| Test Agent | diff + 验收断言 | 自动化测试、接口样例、日志断言 | 不用“人工观察”替代命令证据 |
| Review Agent | diff + 测试输出 | 缺陷、回归风险、是否可合入 | 不修代码 |
| Evidence Agent | 测试输出 + 运行态 | evidence bundle、验收矩阵 | 不接受无命令输出的完成声明 |
| Release Agent | accepted ADU 集合 | RC 包、发布说明、已知问题 | 不接收未 evidence 的 ADU |
| Spike Agent | 后移需求 Context Pack | 技术决策、PoC、风险矩阵 | 不把 Spike 代码合进 SP01 |

## 五、功能拆解与验收口径

### 5.1 KPI 上报增强

| 交付项 | 最小验收 | 截止日期 |
| --- | --- | --- |
| 指标模型 | 指标命名、标签、单位、采样周期、接口格式固定。 | 2026-06-08 |
| UE 用户数统计 | 支持全部/TAC/Cell/gNB 维度，在线/注册状态可区分。 | 2026-06-14 |
| PDU Session 统计 | 支持全部/Cell/UPF/DNN/S-NSSAI 维度。 | 2026-06-18 |
| UPF 指标 | PFCP session、N3/N6 流量、丢包/错误计数。 | 2026-06-18 |
| 主机资源 | CPU/内存/硬盘实时利用率，采样周期和单位一致。 | 2026-06-20 |
| 北向/NMS | REST 或 Prometheus 输出 + NMS/OAM 查询样例。 | 2026-06-22 |
| 回归证据 | 模拟多 Cell/多 UPF 场景或最小替代验证，输出测试日志。 | 2026-06-24 |

### 5.2 4G 核心网基础能力完善

| 交付项 | 最小验收 | 截止日期 |
| --- | --- | --- |
| EPC 状态模型 | eNB、UE、MME、SGW/PGW、HSS/PCRF 状态字段固定。 | 2026-06-08 |
| 终端状态查询 | UE Attach/Detach、ECM/EMM 状态可查询。 | 2026-06-14 |
| 基站状态查询 | eNB/S1AP/SCTP peer 状态可查询。 | 2026-06-16 |
| 网元状态查询 | EPC 网元进程、接口、Diameter peer 基础状态。 | 2026-06-18 |
| 4G KPI | Attach 成功/失败、Bearer 数、GTP tunnel、接口请求统计。 | 2026-06-20 |
| 基础告警 | eNB 断链、Diameter 断链、网元不可用、Attach 失败率告警。 | 2026-06-22 |
| 回归证据 | 断链/恢复、Attach 成功/失败、状态查询样例。 | 2026-06-24 |

### 5.3 OAM/NMS 支撑

| 交付项 | 最小验收 | 截止日期 |
| --- | --- | --- |
| 统一 API | `/metrics`、`/status`、`/alarms` 或等价接口格式固定。 | 2026-06-10 |
| 查询页面/样例 | 至少可展示 5GC KPI、EPC 状态、告警列表。 | 2026-06-20 |
| 权限/审计 | 查询类操作有基础鉴权；配置类不进入 SP01。 | 2026-06-22 |
| 发布文档 | API 说明、部署说明、验收手册、已知问题。 | 2026-06-27 |

## 六、P0/P1 风险与砍项规则

### 6.1 必须提前固化的机器可判定开关

| 截止日期 | 开关 | 默认值 |
| --- | --- | --- |
| 2026-06-08 | `release.scope` | `SP01_ONLY` |
| 2026-06-08 | `kpi.export_mode` | `REST_AND_PROMETHEUS_MINIMAL` |
| 2026-06-10 | `cell.validation_mode` | `SIMULATED_IF_NO_MULTI_CELL_ENV` |
| 2026-06-10 | `epc.validation_mode` | `MOCK_OR_UNIT_IF_NO_4G_ENV` |
| 2026-06-14 | `oam.ui_level` | `API_PLUS_MINIMAL_QUERY_VIEW` |

### 6.2 自动降级规则

若 Release Risk Agent 预测 6/30 通过率低于 80%，Scheduler 按以下顺序自动把 ADU 标为 `deferred`：

1. 延后 NMS 美化 ADU，只保留 API 和最小查询页。
2. 延后复杂告警聚合 ADU，只保留关键断链/网元不可用告警。
3. 延后主机资源高级统计 ADU，只保留 CPU/内存/硬盘基础采样。
4. 把真实多 Cell 环境验收 ADU 改为模拟验证 ADU，并生成限制说明。
5. R1/R2 的核心查询和基础 KPI ADU 不允许自动降级；若它们无法 evidence，则发布目标必须降级。

## 七、质量门禁

### 7.1 Feature Complete 门禁（2026-06-20）

必须满足：

- R1/R2 主流程代码完成；
- 关键 API 可调用；
- 至少一组 5GC KPI 与一组 EPC 状态查询通过；
- 已知 P0 阻塞数为 0；
- 所有未完成 ADU 都处于 `deferred` 且带有机器可读原因。

### 7.2 Release Candidate 门禁（2026-06-25）

必须满足：

- 无 P0 缺陷；
- P1 缺陷有规避方案或产品确认；
- 回归脚本可重复运行；
- API 样例、日志样例、验收表完整；
- SP02 后移需求有计划，不混入 RC。

### 7.3 发布门禁（2026-06-30）

必须满足：

- 版本包可部署；
- R1/R2 验收表通过；
- 发布说明、部署说明、API 文档、测试报告齐全；
- 已知问题清单明确影响范围；
- 8 月 7 日 SP02 计划作为后续路线附带输出。

## 八、SP02/后续需求处理

6/30 前不应闲置 SP02 需求，但处理方式应是 Spike 和计划，而不是强行合入发布。

| 需求包 | 6/30 前产物 | Agent lane |
| --- | --- | --- |
| 5G-LAN/HA | 当前实现基线审计、测试缺口、SP02 任务拆分、风险清单。 | `sp02-spike.5glan-ha` |
| License/SIM/QoS | License 策略决策表、SIM 子网模型、QoS 动态接口草案。 | `sp02-spike.policy` |
| 安全国产化 | 加密卡 provider、达梦适配范围、ARPF/EIR 接口方案。 | `sp02-spike.security` |
| 4G/5G 互操作 | 测试环境清单、N26/无 N26 方案、IMS 边界。 | `sp02-spike.interop` |
| 架构/新产品 | 多线程 profiling 计划、SM4/工业网关/业务分析边界。 | `sp02-spike.arch` |

Spike 产物必须进入 8 月 7 日计划，不允许以半成品代码形式进入 6 月 30 日包。

## 九、推荐执行顺序

### 第 0 步：初始化 Agent 编排

- 生成 `2.11-SP01-0630` ADU backlog。
- 把 34 条需求标成：`sp01_required`、`sp01_support`、`sp02_spike`、`deferred_research`。
- 为每张主线 ADU 生成 Context Pack。
- 初始化 `metric-5gc`、`ops-epc`、`oam-evidence`、`sp02-spike` 四条 lane。

### 第 1 步：6 月 8 日前完成

- 冻结 KPI/告警/OAM 字段模型。
- 冻结 R1/R2 验收表。
- 准备 5GC/4G 最小测试环境。
- 所有 SP02 ADU 从 release lane 移出，只保留 Spike lane 卡片。

### 第 2 步：6 月 14 日前完成

- 5GC KPI 第一条纵切跑通。
- EPC 状态查询第一条纵切跑通。
- NMS/OAM 查询样例跑通。
- 回归脚本框架可运行。

### 第 3 步：6 月 20 日前完成

- R1/R2 feature complete。
- PDU Session、Cell/UPF、4G KPI、基础告警补齐。
- 发布文档初稿完成。

### 第 4 步：6 月 24 日前完成

- 集成冻结。
- 回归脚本稳定。
- 所有 P0 缺陷清零。

### 第 5 步：6 月 27 日前完成

- RC 包。
- 测试报告。
- API 文档。
- 已知问题清单。

### 第 6 步：6 月 30 日完成

- 发布 SP01。
- 输出 SP02 计划。
- 输出后移需求风险清单。

## 十、最终建议

6 月 30 日前想完成交付，规划上要坚持三条线：

1. **发布线只做 SP01**：KPI 上报增强 + 4G 基础状态/告警/KPI。
2. **支撑线只做最小 OAM/NMS**：为 SP01 提供查询、接口、验收证据，不扩成完整 OAM 平台。
3. **探索线服务 SP02**：5G-LAN、HA、License、安全国产化、互操作等只做 Spike 和 8 月计划。

这样 6 月 30 日可以交付一个边界清晰、可验证、可发布的 `GC_V2.11.0_SP01`，同时不牺牲后续 SP02 的技术路线。
