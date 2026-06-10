# 核心网产品 2.11 全量需求 Token 使用量评估

来源：

- `docs/core-network-2.11-0630-full-scope-agent-plan.md`
- `docs/core-network-2.11-code-volume-estimate.md`
- `docs/core-network-2.11-ai-agent-effort-estimate.md`

目标口径：评估 2026-06-30 前完成全部 34 条需求时，AI Agent 工厂模式下的大致 token 使用量。

## 一、结论

按当前规划，2.11 全量需求交付的总 token 使用量大致为：

| 交付口径 | 总 token | 其中可缓存/重复上下文 | 净新增推理 token | 说明 |
| --- | ---: | ---: | ---: | --- |
| L2 软件侧全量完成 | 28M-55M | 12M-25M | 16M-30M | 外部依赖以 mock/simulator/provider 完成。 |
| L3 尽量真实验收 | 45M-90M | 18M-40M | 27M-50M | 增加硬件、RAN/UE/IMS、达梦、加密卡、国密、SM4 联调循环。 |
| 高风险上限 | 100M-160M | 35M-70M | 65M-90M | 如果出现大规模返工、OAM 平台化、DPI 深解析、多线程扩散、硬件 SDK 反复适配。 |

推荐预算线：

> **总 token 预算按 60M-80M 准备，净新增推理 token 按 35M-45M 控制。**

如果严格限制 scope，复用 Context Pack，禁止 Agent 重复读全仓，且硬件依赖走 mock 优先，软件侧全量完成可压在 **50M token 左右**。

## 二、估算基础

### 2.1 ADU 数量假设

全量 34 条需求按 Agent 工厂拆分后，建议使用：

| 类型 | ADU 数 |
| --- | ---: |
| Context/Contract ADU | 35-50 |
| Implementation ADU | 90-150 |
| Test/Debug ADU | 70-120 |
| Review ADU | 40-80 |
| Evidence/Release ADU | 25-45 |
| 合计 | 260-445 ADU |

说明：早期工作量文档中的 `179-317 ADU` 是较保守的功能交付 ADU；全量 6/30 压缩计划为了并发和验收，会把测试、证据、release、mock、联调拆得更细，因此实际执行 ADU 会扩大到 `260-445`。

### 2.2 单 ADU token 模型

| ADU 类型 | 输入 token | 输出 token | 可缓存比例 | 说明 |
| --- | ---: | ---: | ---: | --- |
| Context Pack | 60k-180k | 4k-12k | 60%-80% | 读取需求、代码路径、测试入口、历史文档。 |
| Contract/Spec | 30k-90k | 4k-10k | 40%-70% | 固定接口、数据模型、验收断言。 |
| Implementation | 80k-260k | 6k-30k | 35%-65% | 读相关代码、生成 patch、跑局部验证。 |
| Test/Debug | 60k-220k | 4k-20k | 30%-60% | 测试失败分析、修复、日志解释。 |
| Review | 40k-160k | 3k-12k | 30%-60% | 代码审查、风险、回归点。 |
| Evidence/Release | 30k-120k | 3k-10k | 40%-70% | 验收矩阵、测试报告、发布说明。 |

单个实现类 ADU 的实际 token 中位数通常在 **120k-220k**，复杂安全/HA/互操作 ADU 可达到 **300k-500k**，特别是反复调试时。

## 三、按阶段估算

| 阶段 | 目标 | Token 区间 |
| --- | --- | ---: |
| T+0h ~ T+12h：全量 Context Pack | 34 条需求拆分、代码路径、测试路径、验收断言初稿 | 3M-7M |
| T+12h ~ T+24h：Contract Freeze | 全部接口、schema、feature flag、mock/provider contract | 2M-5M |
| T+24h ~ T+72h：First Vertical Slices | 六大群组端到端纵切 | 5M-10M |
| T+4d ~ T+7d：Feature Burst 1 | A/B/C 主体功能，D/E/F 核心接口和 PoC | 8M-16M |
| T+8d ~ T+12d：Feature Burst 2 | 34 条需求进入 implemented/reviewed | 10M-22M |
| T+13d ~ T+16d：Integration Hardening | 跨模块冲突、P0 修复、回归矩阵 | 5M-12M |
| T+17d ~ T+20d：Full Regression | 全量回归、长稳、压力、硬件补证 | 5M-14M |
| T+21d ~ T+23d：RC | 打包、发布文档、证据整理 | 2M-5M |
| 6/30 Release | 验收回放、最终矩阵、限制说明 | 1M-3M |
| 合计 | L2/L3 混合交付 | 41M-94M |

阶段估算和总控估算略有差异，原因是阶段估算假设所有 lane 高并发推进；若复用上下文缓存和共享 contract，实际可压到 `28M-55M` 的 L2 区间。

## 四、按交付群组估算

| 群组 | 覆盖范围 | L2 token | L3 token | 高消耗原因 |
| --- | --- | ---: | ---: | --- |
| A. 可观测与 OAM | KPI、4G 状态、告警、OAM、IMS 告警、LMT、ping | 5M-9M | 7M-13M | 多网元状态模型、前后端、指标一致性验证。 |
| B. 5G-LAN 与 HA | 5G-LAN、HA、工业增强接口、协议代理接口 | 6M-12M | 10M-20M | SMF/UPF/PFCP/数据面/测试回归上下文大。 |
| C. 策略与 License | License、SIM 子网、QoS、互操作 | 5M-10M | 8M-18M | 策略链路跨 AMF/SMF/UPF/PCF/NMS。 |
| D. 安全国产化 | 加密卡、达梦、ARPF、EIR、国密、TLS、信令/外联、SM4 | 9M-18M | 16M-32M | 外部 SDK、provider、mock、联调失败循环多。 |
| E. 架构可靠性 | 多线程、zk、备份恢复、内存池/OMU | 3M-7M | 5M-12M | 架构风险高，review/debug token 比例高。 |
| F. 新产品与分析 | 业务分析服务器、工业网关、协议代理 | 3M-7M | 5M-11M | 独立服务、协议样例、流量模拟。 |
| Cross-cutting | 共享 contract、测试 harness、release、证据 | 4M-10M | 6M-14M | 被所有群组复用。 |
| 合计 | 去重前 | 35M-73M | 57M-120M | 共享上下文去重后落入总控区间。 |

## 五、按代码量推算

代码量评估推荐控制线为 `95k-140k LOC`。AI Agent 生成、验证并稳定这些代码，不能只按输出 token 估算，因为每行代码通常伴随多轮上下文读取、测试失败、修复、review 和 evidence。

| 项目 | 估算 |
| --- | ---: |
| 代码输出 token | 8M-16M |
| 测试/脚本/配置输出 token | 3M-8M |
| 文档/证据输出 token | 2M-5M |
| 代码理解与上下文输入 token | 20M-45M |
| 调试/复审/返工 token | 10M-30M |
| 合计 | 43M-104M |

经验换算：

- 稳定新增 1k LOC 业务代码，大约消耗 `250k-600k token`。
- 涉及 C/C++ 核心路径、并发、PFCP/UPF/安全 provider 的 1k LOC，可能消耗 `600k-1.2M token`。
- 前端/NMS 页面和普通 API 的 1k LOC，通常消耗 `180k-450k token`。
- 测试/mock 代码虽然输出快，但日志分析会拉高 token。

## 六、Token 消耗最高的需求

| 排名 | 需求 | Token 区间 | 原因 |
| --- | --- | ---: | --- |
| 1 | 双活模式 HA | 4M-9M | SMF/UPF/PFCP/状态同步/故障注入/回归复杂。 |
| 2 | 4G/5G 互操作 | 4M-9M | 跨 EPC/5GC/IMS/RAN/UE，环境与日志调试重。 |
| 3 | 安全国产化组合 | 8M-18M | 加密卡、国密、ARPF、EIR、TLS、SM4 共享但复杂。 |
| 4 | 5G-LAN 实现优化 | 3M-7M | UPF 数据面、Ethernet PDU、VLAN、组播、L3 gateway。 |
| 5 | 5GC 多线程 | 3M-8M | 并发安全、压测、review 和回滚设计成本高。 |
| 6 | 违规外联检测 | 2.5M-6M | UPF 数据面 + 策略 + 阻断 + 性能验证。 |
| 7 | OAM 模块 | 2.5M-6M | 共享 API、状态、告警、权限、UI 和文档。 |

## 七、Token 控制策略

| 策略 | 可节省 token | 做法 |
| --- | ---: | --- |
| 统一 Context Pack | 20%-35% | 每个 lane 只生成一次上下文包，后续 Agent 引用摘要和文件路径。 |
| Contract 先冻结 | 10%-20% | 避免前后端、测试、实现各自发明字段。 |
| 限制每个 Agent 的文件范围 | 10%-25% | 每个 ADU 只读/改指定文件，不反复扫全仓。 |
| Evidence harness 统一 | 10%-15% | 测试报告、日志摘要、验收矩阵统一格式。 |
| 硬件先 mock 后 adapter | 15%-30% | 避免早期在真实硬件日志上高成本来回调试。 |
| 禁止 OAM 平台化扩展 | 10%-25% | OAM 只做状态、指标、告警、北向和最小 UI。 |

若严格执行上述策略，总 token 可从 `80M-100M` 压到 `50M-70M`。

## 八、预算建议

建议分三档准备 token 预算：

| 档位 | Token 预算 | 适用场景 |
| --- | ---: | --- |
| 保守软件侧 | 50M | 只承诺 L2 软件侧全量完成，硬件/现场项 mock。 |
| 推荐交付 | 70M | L2 全量 + 关键主线 L3 + 部分硬件补证。 |
| 冲刺全量 L3 | 100M | 尽量真实验收，外部资源齐备，接受更多联调/debug token。 |

最终建议：

> 为了支撑 6 月 30 日前完成全部 34 条需求，建议预留 **70M token 主预算 + 30M token 风险池**。  
> 主预算用于实现、测试、review 和证据；风险池只允许用于硬件联调、P0 debug、跨 lane 集成冲突和真实环境验收补证。
