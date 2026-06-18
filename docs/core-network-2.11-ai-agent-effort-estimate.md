# 核心网产品 2.11 AI Agent 工作量评估

来源：

- `$HOME/5GC_2.11/核心网产品 2.11 版本功能清单.md`
- `docs/core-network-2.11-requirement-analysis.md`
- 当前 `<workspace-root>` 工作区的 Open5GS/Open5GS-NMS/UERANSIM 能力基线

本文不使用传统“人月/人日”模式。所有工作量均按 AI Agent 开发模式评估，重点衡量上下文复杂度、可拆分性、验证闭环、外部依赖和并发执行能力。

## 一、AI Agent 评估模型

### 1.1 基本单位：ADU

本文使用 **ADU（Agentic Delivery Unit）** 作为工作量单位。

一个 ADU 表示一个 AI Agent 在完整上下文包下可独立完成的一次可交付闭环，通常包含：

- 读取需求、相关代码、已有测试和约束；
- 输出或修改设计/接口/代码/测试/部署脚本；
- 运行最小验证；
- 产出可审查证据：diff、测试日志、接口样例、问题清单或验收记录。

ADU 不是人日，也不是人月。它衡量的是“一个可交给 Agent 独立推进并能被验证的任务包”。

### 1.2 ADU 分级

| 级别 | 含义 | 典型交付 |
| --- | --- | --- |
| S | 小型 Agent 闭环 | 单模块接口、配置项、文档、测试补齐、轻量 NMS 页面或 API。 |
| M | 中型 Agent 闭环 | 一个清晰功能纵切，涉及 2-4 个模块，有自动化测试和运行态验证。 |
| L | 大型 Agent 闭环 | 跨网元/前后端/部署/测试环境，需要多 Agent 并行和集成复审。 |
| XL | 架构级 Agent 项目 | 涉及核心架构、外部系统、协议互通或长期稳定性，需要分阶段探索、实现、集成和压测。 |

### 1.3 评估维度

| 维度 | 评分 | 说明 |
| --- | --- | --- |
| 上下文复杂度 | 1-5 | 需要读取和理解的代码、协议、部署、历史文档数量。 |
| 修改面 | 1-5 | 涉及的模块数量和核心路径风险。 |
| 验证难度 | 1-5 | 是否能用本地自动化验证，是否需要真实 RAN/UE/IMS/硬件/数据库。 |
| 外部依赖 | 1-5 | 是否依赖客户环境、第三方硬件、厂商 SDK、专用测试设备。 |
| Agent 并发度 | 1-5 | 可并行拆分程度；5 表示非常适合多 Agent 并发。 |

综合判断：

- **低风险快交付**：上下文、修改面、验证难度均不高，外部依赖低。
- **适合 Agent 并发**：能拆成规格、后端、前端、测试、文档、验收脚本等相互独立任务。
- **需要探索尖兵**：需求不清、外部依赖多或技术路径未定，先派 Agent 做 Spike/PoC。
- **暂不宜直接实现**：协议/硬件/客户环境未确认，先输出方案和联调计划。

## 二、总体工作量结论

### 2.1 总规模

| 范围 | 需求条数 | AI Agent 工作量 | 说明 |
| --- | ---: | ---: | --- |
| GC_V2.11.0_SP01 | 2 | 14-22 ADU | KPI 与 4G 运维能力，适合并发做状态模型、metrics、NMS、告警、验证。 |
| GC_V2.11.0_SP02 | 13 | 72-116 ADU | 主体工作量最大；5G-LAN/HA/SIM 子网可结合当前分支推进，互操作/国密/达梦/EIR/ARPF 外部依赖较多。 |
| IMS_V2.11.0_SP01 | 5 | 14-28 ADU | 若只做核心网侧接口和 OAM 对齐较小；若包括 IMS 实现和联调则增大。 |
| 未分配版本 | 14 | 79-151 ADU | 多线程、zk、SM4、工业增强网关、业务分析服务器属于架构或新产品级，需先 Spike。 |
| 合计 | 34 | 179-317 ADU | 不建议作为一个单体项目推进，应拆成多个 Agent swarm 并行流。 |

### 2.2 推荐交付策略

| 交付包 | 推荐优先级 | AI Agent 规模 | 建议模式 |
| --- | --- | ---: | --- |
| SP01 运维观测包 | 最高 | 14-22 ADU | 4-6 个 Agent 并发，先出统一指标/告警模型，再按 4G/5G 分域实现。 |
| 5G-LAN 产品化包 | 最高 | 24-38 ADU | 5-8 个 Agent 并发，围绕 NMS 配置、运行态回读、测试闭环、协议差异文档推进。 |
| UPF HA 包 | 高 | 12-22 ADU | 3-5 个 Agent，先固定主备切换验收，再扩展双活。 |
| SIM 子网与 License 包 | 高 | 10-18 ADU | 3-4 个 Agent，可与 NMS/OAM 并行。 |
| 安全国产化包 | 中 | 30-58 ADU | 先 4-6 个 Spike Agent 明确接口/硬件/数据库，再决定实现。 |
| 4G/5G 互操作包 | 中 | 14-26 ADU | 需要专门测试环境，Agent 可先做方案、配置、脚本和仿真验证。 |
| 架构可靠性与新产品包 | 低到中 | 75-143 ADU | 每项单独立项，不建议并入 2.11 主线交付。 |

### 2.3 AI Agent 并发上限

在当前代码规模和需求耦合度下，推荐最大并发：

| 阶段 | 推荐并发 | 原因 |
| --- | ---: | --- |
| 需求细化/设计 | 6-10 个 Agent | 可按需求域并行：KPI、4G、5G-LAN、HA、安全、数据库、IMS、架构预研。 |
| 代码实现 | 4-8 个 Agent | 超过 8 个容易在 NMS/OAM、SMF/UPF、配置模型上产生冲突。 |
| 测试与验收 | 6-12 个 Agent | 测试脚本、日志审查、回归矩阵、文档、部署检查可高度并行。 |
| 集成收敛 | 2-4 个 Agent | 需要少量 Agent 做合并、冲突处理、端到端验证和发布材料。 |

## 三、逐条需求 ADU 评估

### 3.1 GC_V2.11.0_SP01

| 编号 | 需求 | 建议 ADU | Agent 拆分 | 并发度 | 主要阻塞 | 验收闭环 |
| --- | --- | ---: | --- | ---: | --- | --- |
| 1 | KPI 上报增强 | 8-12 | 指标模型 Agent、AMF 统计 Agent、SMF 统计 Agent、UPF/主机资源 Agent、NMS 展示 Agent、验证 Agent | 5 | Cell 维度映射、指标标签基数、主机资源采集边界 | Prometheus/REST 输出、按 TAC/Cell/UPF 聚合、资源利用率采样一致 |
| 2 | 4G 核心网基础能力完善 | 6-10 | EPC 状态模型 Agent、MME/eNB/UE Agent、SGW/PGW bearer Agent、告警 Agent、NMS Agent、测试 Agent | 4 | EPC 与 5GC 状态模型差异、Diameter/S1AP 链路告警 | eNB/UE/网元状态查询、断链告警、Attach/KPI 统计 |

**SP01 评估结论：**适合直接进入 Agent swarm 开发。先由一个架构 Agent 固定统一 KPI/告警字段，再并发实现 5G 与 4G 侧适配，最后由验证 Agent 做指标一致性检查。

### 3.2 GC_V2.11.0_SP02

| 编号 | 需求 | 建议 ADU | Agent 拆分 | 并发度 | 主要阻塞 | 验收闭环 |
| --- | --- | ---: | --- | ---: | --- | --- |
| 3 | 新架构 License | 8-14 | License 模型 Agent、签名校验 Agent、AMF 用户数 Agent、UPF 吞吐 Agent、NMS 分组 Agent、测试 Agent | 4 | 授权策略未定、超限动作需产品确认 | 超用户数拒绝、吞吐限速/告警、CP/UP 分组统计 |
| 4 | 5G LAN 配置简化 | 8-12 | 配置向导 Agent、后端 API Agent、配置生成/应用 Agent、运行态回读 Agent、协议差异文档 Agent、E2E 测试 Agent | 5 | 热加载边界、标准与本地扩展差异 | NMS 创建 VN Group 后 UE 二层互通，状态可回读 |
| 5 | 5G LAN 实现优化 | 10-16 | 数据流梳理 Agent、PFCP/Ethernet 标识 Agent、UPF 一致性 Agent、SMF 编排 Agent、回归测试 Agent、文档 Agent | 4 | SMF/UPF 状态跨进程一致性、已有分支复杂度 | 单播/广播/组播/VLAN/L3 gateway 自动化回归 |
| 6 | 双活模式 HA | 12-22 | HA 模式定义 Agent、SMF HA Agent、UPF shadow/sync Agent、网络切换 Agent、NMS 状态 Agent、故障注入 Agent | 3 | 双活/主备边界、N3/N6 网络配合、状态同步范围 | 主 UPF 故障后会话恢复，记录中断时长和同步延迟 |
| 7 | 4G/5G 互操作 | 14-26 | 架构 Spike Agent、QCI/5QI 映射 Agent、会话连续性 Agent、IMS/语音边界 Agent、环境脚本 Agent、验收 Agent | 3 | 真实 UE/RAN/IMS 环境、N26/无 N26 方案选择 | 4->5、5->4 数据和语音场景验证 |
| 8 | QoS 动态生效 | 8-14 | 北向 API Agent、SMF policy update Agent、UPF QER Agent、N2 QoS Agent、MQTT/UMS adapter Agent、测试 Agent | 4 | 外部工业识别模块协议、是否需要 RAN 侧 QoS | 在线 UE 不重新注册即可 QoS 变更并可恢复 |
| 9 | SIM 子网独立配置 | 5-8 | 数据模型 Agent、NMS 表单 Agent、SMF 地址池 Agent、冲突校验 Agent、测试 Agent | 5 | 在线会话变更策略 | 同 DNN 不同 SIM 分配不同子网，耗尽/冲突可解释 |
| 10 | 江南信安加密卡适配 | 8-16 | Crypto provider Agent、SDK mock Agent、SUCI/密钥路径 Agent、NMS 设备状态 Agent、硬件联调 Agent | 3 | 厂商 SDK、硬件、驱动、部署权限 | 加密卡在线/故障两类路径均可验证 |
| 11 | 达梦数据库 HA 适配 | 8-16 | 数据访问抽象 Agent、达梦连接 Agent、迁移 Agent、HA 重连 Agent、NMS/OAM Agent、测试 Agent | 3 | 是否替换核心 MongoDB、达梦环境 | 主备切换后配置/订阅关键读写恢复 |
| 12 | OAM 模块开发 | 12-20 | OAM 架构 Agent、北向 API Agent、配置管理 Agent、告警/KPI Agent、权限审计 Agent、LMT adapter Agent | 5 | OAM 与 NMS/LMT 职责边界 | OAM 查询网元、KPI、告警并可审计配置变更 |
| 13 | ARPF 独立部署 | 8-14 | ARPF 接口 Agent、UDM/AUSF 调用 Agent、密钥管理 Agent、mTLS Agent、审计 Agent、测试 Agent | 3 | 私有接口、安全规范、密钥迁移 | UE 鉴权通过独立 ARPF，故障告警明确 |
| 14 | EIR 独立部署 | 6-10 | EIR 服务 Agent、AMF 注册校验 Agent、数据库模型 Agent、NMS 白名单 Agent、缓存/超时 Agent、测试 Agent | 4 | 同步调用时延、在线踢出策略 | 非白名单/错绑 IMEI 注册拒绝，可审计 |

**SP02 评估结论：**不要一个队列串行做。可拆成四个并发 swarm：

- 5G-LAN/HA swarm：需求 4、5、6；
- 运维/OAM/License swarm：需求 3、9、12；
- 策略互操作 swarm：需求 7、8；
- 安全国产化 swarm：需求 10、11、13、14。

### 3.3 IMS_V2.11.0_SP01

| 编号 | 需求 | 建议 ADU | Agent 拆分 | 并发度 | 主要阻塞 | 验收闭环 |
| --- | --- | ---: | --- | ---: | --- | --- |
| 15 | 银河麒麟 V10 操作系统适配 | 2-4 | 部署检查 Agent、依赖 Agent、服务管理 Agent、验证 Agent | 4 | 麒麟环境可用性、IMS 包依赖 | 安装、启动、重启、日志轮转、基础呼叫 |
| 16 | 国密 UDM/国密 USIM 卡对接 | 6-12 | 算法接口 Agent、USIM 参数 Agent、UDM/AUSF Agent、加密卡联动 Agent、互通测试 Agent | 3 | 卡商/算法/硬件、私有规范 | 国密 USIM 注册鉴权成功，普通 USIM 并存 |
| 17 | 达梦数据库适配 | 2-5 | IMS DAO Agent、达梦 schema Agent、连接/迁移 Agent、测试 Agent | 3 | IMS 数据模型、达梦环境 | IMS 基础数据读写和主备切换 |
| 18 | IMS 基础告警功能 | 2-4 | 告警模型 Agent、IMS 指标 Agent、OAM 接入 Agent、验证 Agent | 4 | IMS 网元告警来源 | IMS 断链/数据库/呼叫失败告警 |
| 19 | LMT 优化 | 2-3 | UI 规范 Agent、API 对齐 Agent、审计 Agent | 5 | 核心网 LMT 风格规范是否固定 | IMS LMT 与核心网风格和操作一致 |

**IMS 评估结论：**如果只评估 Open5GS 工作区侧的接口、OAM 对齐和联调支持，规模较小；如果 IMS 代码也纳入交付，需另建 IMS 代码仓库上下文包重新估算。

### 3.4 未分配版本

| 编号 | 需求 | 建议 ADU | Agent 拆分 | 并发度 | 主要阻塞 | 验收闭环 |
| --- | --- | ---: | --- | ---: | --- | --- |
| 20 | 5GC 单线程 -> 多线程 | 18-35 | Profiling Agent、线程模型 Agent、AMF 试点 Agent、SMF 试点 Agent、锁/内存 Agent、压测 Agent | 2 | 核心状态机并发安全、长期稳定性 | TPS 提升、状态无错乱、长稳无内存破坏 |
| 21 | zk 同步写 -> 异步写 | 6-12 | 现状追踪 Agent、队列/WAL Agent、一致性 Agent、监控 Agent、故障恢复 Agent | 3 | zk 在当前产品中的真实用途 | 延迟下降、故障恢复、一致性窗口可观测 |
| 22 | 单机备份与恢复 | 5-9 | 备份范围 Agent、打包 Agent、恢复 Agent、加密 Agent、健康检查 Agent | 5 | 敏感数据加密、版本兼容 | 新机器恢复后 UE 注册/PDU 成功 |
| 23 | zk 内存池优化 | 5-10 | 内存 profile Agent、pool/slab Agent、OMU diff Agent、clear 命令 Agent、长稳 Agent | 3 | zk/OMU 代码上下文未在当前仓库完全可见 | RSS/碎片改善，主备 context diff/clear 可审计 |
| 24 | SBI 支持 TLS2.0 | 4-8 | TLS 需求澄清 Agent、mTLS Agent、证书管理 Agent、UDM-ARPF 联调 Agent | 4 | TLS2.0 表述不明确、国密 TLS 可能性 | 错证书拒绝、正确证书鉴权成功、轮换可控 |
| 25 | 5GC 内置信令分析模块 | 8-14 | 事件模型 Agent、AMF/SMF 事件 Agent、规则引擎 Agent、告警 Agent、存储/脱敏 Agent | 4 | 全量事件量、隐私和存储 | 异常注册/失败率升高能告警并追溯 |
| 26 | 违规外联流量检测与分析 | 8-16 | UPF 五元组 Agent、策略 Agent、阻断 Agent、NMS 告警 Agent、性能 Agent | 4 | DPI 边界、性能影响 | 黑名单流量告警和阻断，证据完整 |
| 27 | N3 接口 SM4 隧道加密 | 10-22 | 方案 Spike Agent、UPF 加密 Agent、gNB 适配 Agent、密钥 Agent、性能 Agent、联调 Agent | 2 | 基站配合、非标准协议、性能 | 抓包不可见明文，密钥错误告警，吞吐达标 |
| 28 | 链路检测 ping 功能 | 3-5 | OAM API Agent、Agent 执行器 Agent、权限 Agent、结果展示 Agent、测试 Agent | 5 | 源接口选择、权限控制 | AMF->gNB、UPF->业务服务器探测结果明确 |
| 29 | 独立工业增强网关 | 12-24 | 产品边界 Agent、VxLAN Agent、双发选收 Agent、负载分担 Agent、Open5GS 接口 Agent、场景测试 Agent | 3 | 新产品边界、端到端设备 | 双链路去重/切换，VxLAN L3/L2 成功 |
| 30 | 用户业务数据分析服务器 | 8-16 | 流量导出 Agent、L7 解析 Agent、AI 分析 Agent、隐私 Agent、OAM 回调 Agent | 4 | 数据规模、加密流量、模型准确性 | 指定协议识别，关联 SUPI/DNN/Cell/UPF |
| 31 | 工业协议代理 | 6-12 | 协议选择 Agent、代理 Agent、QoS 联动 Agent、抖动实验 Agent、边缘部署 Agent | 3 | 目标工业协议未定、协议一致性 | 抖动环境下指定协议超时率下降 |

**未分配版本评估结论：**这部分不是一个 2.11 开发队列，而是多个预研项目集合。Agent 模式下也不能跳过问题澄清：多线程、SM4 隧道、工业增强网关、业务分析服务器都需要先做 Spike，拿到证据后再定实现 ADU。

## 四、按 Agent Swarm 的推荐拆分

### 4.1 Swarm A：KPI/告警/OAM 基座

**覆盖需求：**1、2、12、18、19、28。

**建议规模：**24-38 ADU。

**Agent 编队：**

| Agent | 职责 |
| --- | --- |
| A1 指标模型 Agent | 统一 KPI、状态、告警、北向字段。 |
| A2 5GC 状态 Agent | AMF/SMF/UPF 侧 UE、PDU、UPF、Cell 统计。 |
| A3 EPC 状态 Agent | MME/SGW/PGW/HSS/PCRF 状态和 KPI。 |
| A4 OAM API Agent | 北向接口、鉴权、审计、聚合查询。 |
| A5 NMS/LMT Agent | 页面、交互、风格统一。 |
| A6 验证 Agent | 指标采样、断链告警、链路检测、回归证据。 |

**关键产物：**

- KPI/告警统一模型；
- 5GC/EPC 状态采集；
- OAM/NMS 查询接口；
- 链路检测工具；
- 端到端验收脚本。

### 4.2 Swarm B：5G-LAN 产品化与 HA

**覆盖需求：**4、5、6、29、31 的核心网接口部分。

**建议规模：**42-74 ADU。

**Agent 编队：**

| Agent | 职责 |
| --- | --- |
| B1 5G-LAN 配置 Agent | VN Group/DNN/S-NSSAI/成员/VLAN/网关配置闭环。 |
| B2 SMF 编排 Agent | PFCP、Ethernet PDU、HA session 编排。 |
| B3 UPF 数据面 Agent | L2/L3/组播/VLAN/一致性修复。 |
| B4 HA Agent | 主备/双活模式、状态同步、故障切换。 |
| B5 NMS 状态 Agent | MAC 表、组播表、BUM 统计、HA 事件展示。 |
| B6 测试 Agent | UERANSIM、回归脚本、故障注入、抓包验证。 |
| B7 协议差异 Agent | 3GPP 差异、产品扩展和风险文档。 |

**关键产物：**

- 5G-LAN 配置向导；
- 运行态回读 API；
- 5G-LAN 回归矩阵；
- UPF HA 主备切换证据；
- 工业增强网关接口边界说明。

### 4.3 Swarm C：License、SIM 子网与策略控制

**覆盖需求：**3、8、9。

**建议规模：**21-36 ADU。

**Agent 编队：**

| Agent | 职责 |
| --- | --- |
| C1 License Agent | 授权文件、容量、CP/UP 分组、超限策略。 |
| C2 AMF/SMF 策略 Agent | 用户数、PDU Session、SIM 子网选择。 |
| C3 UPF 限速 Agent | 吞吐统计、限速或告警。 |
| C4 QoS 动态 Agent | 外部 API、SM policy、PFCP QER/N2 QoS 修改。 |
| C5 NMS Agent | License、SIM 子网、QoS 策略配置页面。 |
| C6 验证 Agent | 超限、地址池冲突、QoS 在线变更测试。 |

**关键产物：**

- License enforcement MVP；
- SIM 独立子网配置与 SMF 地址池选择；
- QoS 动态变更 API 和最小闭环。

### 4.4 Swarm D：安全国产化

**覆盖需求：**10、11、13、14、16、17、24、25、26、27。

**建议规模：**68-136 ADU。

**Agent 编队：**

| Agent | 职责 |
| --- | --- |
| D1 安全架构 Agent | 国密、ARPF、EIR、加密卡、TLS、SM4 的统一边界。 |
| D2 Crypto Provider Agent | 软件/PKCS#11/江南信安 SDK 抽象。 |
| D3 ARPF/UDM Agent | 独立认证服务与 UDM/AUSF 对接。 |
| D4 EIR Agent | IMEI 白名单、机卡绑定、AMF 注册校验。 |
| D5 达梦 Agent | NMS/OAM/IMS/核心库适配边界和 PoC。 |
| D6 安全检测 Agent | 信令分析、违规外联、告警和阻断。 |
| D7 SM4/N3 Agent | 基站协同方案、加密隧道 PoC、性能验证。 |
| D8 联调 Agent | 硬件、卡商、数据库、基站、证书环境联调。 |

**关键产物：**

- 安全国产化总体架构；
- 加密卡 provider mock 和联调版本；
- ARPF/EIR PoC；
- 达梦适配 PoC；
- 信令/流量安全检测 MVP；
- SM4 N3 隧道技术决策报告。

### 4.5 Swarm E：架构可靠性与新产品预研

**覆盖需求：**20、21、22、23、30。

**建议规模：**45-82 ADU。

**Agent 编队：**

| Agent | 职责 |
| --- | --- |
| E1 Profiling Agent | 找到 5GC 性能瓶颈和线程化候选点。 |
| E2 多线程 Spike Agent | 小范围试点线程模型和锁策略。 |
| E3 zk/OMU Agent | 同步异步化、内存池、context diff/clear。 |
| E4 备份恢复 Agent | 配置、数据库、证书、license 的备份包。 |
| E5 业务分析服务器 Agent | 流量导出、L7/AI 边界、隐私风险。 |
| E6 长稳 Agent | 压测、长稳、恢复演练和风险证据。 |

**关键产物：**

- 性能瓶颈报告；
- 多线程最小 PoC；
- 备份恢复 MVP；
- zk/OMU 优化方案；
- 业务分析服务器边界和 PoC。

## 五、AI Agent 执行流程建议

### 5.1 每个需求的标准 Agent 流水线

每条需求建议使用下面的 7 步闭环：

1. **Context Pack Agent**：收集需求、相关代码、历史文档、测试入口、外部依赖。
2. **Spec Agent**：输出需求边界、接口、数据模型、验收标准。
3. **Plan Agent**：拆成可执行任务，标明文件、测试、风险。
4. **Implementation Agent**：实现最小纵切，不扩大范围。
5. **Test Agent**：补自动化测试、脚本、抓包、日志断言。
6. **Review Agent**：做代码/设计复审，找回归风险。
7. **Evidence Agent**：整理验收证据、未覆盖项和下一轮任务。

### 5.2 Agent 交付件格式

每个 Agent 任务完成时必须留下：

- 变更摘要；
- 修改文件列表；
- 运行过的验证命令；
- 通过/失败结果；
- 未验证原因；
- 风险和下一步；
- 对应需求编号。

没有验证证据的任务不计为完成 ADU，只能计为 Spike 或草稿。

### 5.3 并发与冲突控制

建议采用“先窄后宽”的并发方式：

| 阶段 | 动作 | 目标 |
| --- | --- | --- |
| 第 0 阶段 | 每个 swarm 先跑 1 个架构 Agent | 固定数据模型、接口和边界，避免后续冲突。 |
| 第 1 阶段 | 同一 swarm 内 3-6 个 Agent 并发 | 后端、前端、测试、文档并行。 |
| 第 2 阶段 | 集成 Agent 合并 | 处理接口不一致、配置冲突、测试缺口。 |
| 第 3 阶段 | 验收 Agent 独立复核 | 用需求验收表逐条打勾，不能由实现 Agent 自证完成。 |

## 六、优先级与推荐路线

### 6.1 推荐纳入 2.11 主线的需求

| 优先级 | 需求 | 原因 | 工作量 |
| --- | --- | --- | ---: |
| P0 | KPI 上报增强 | SP01 交付核心，依赖低，可快速形成运维价值 | 8-12 ADU |
| P0 | 4G 基础状态/KPI/告警 | SP01 交付核心，可复用 5G/OAM 模型 | 6-10 ADU |
| P0 | 5G-LAN 配置简化 | 与当前分支能力高度相关，客户可见价值高 | 8-12 ADU |
| P0 | 5G-LAN 实现优化 | 是 5G-LAN 产品化前提 | 10-16 ADU |
| P0 | UPF HA 主备切换 | 与当前分支 HA 代码相关，适合做可验证纵切 | 12-22 ADU |
| P1 | SIM 子网独立配置 | 范围清晰，NMS+SMF 可形成闭环 | 5-8 ADU |
| P1 | License MVP | 商业交付需要，但策略需先定 | 8-14 ADU |
| P1 | OAM 基础模块 | 多需求公共底座，应先做最小基座 | 12-20 ADU |

主线合计：69-114 ADU。

### 6.2 建议先 Spike 后决定的需求

| 需求 | Spike ADU | Spike 产物 |
| --- | ---: | --- |
| 4G/5G 互操作 | 4-6 | N26/无 N26 方案、测试环境清单、QCI/5QI 映射、风险矩阵。 |
| QoS 动态生效 | 3-5 | MQTT/UMS 接口草案、SMF/UPF 最小修改点、是否需要 N2 QoS 判断。 |
| 江南信安加密卡 | 3-5 | SDK mock、provider 接口、驱动/部署要求、联调计划。 |
| 达梦 HA | 3-5 | 适配范围决策：NMS/OAM 优先还是核心订阅库。 |
| ARPF/EIR | 4-6 | SBI/内部接口、缓存策略、AMF/UDM/AUSF 修改点。 |
| 多线程 | 5-8 | profiling 证据、试点网元和线程模型。 |
| SM4 N3 隧道 | 4-8 | 与基站协同方案、标准风险、性能预估。 |
| 工业增强网关/业务分析/协议代理 | 5-8 | 产品边界、部署位置、Open5GS 接口、PoC 拓扑。 |

### 6.3 不建议直接进入 2.11 实现队列的需求

| 需求 | 原因 |
| --- | --- |
| 5GC 单线程 -> 多线程 | 核心架构风险高，必须先 profiling 和小范围 PoC。 |
| zk 同步写 -> 异步写 | 当前 Open5GS 仓库上下文不足，需要产品集群框架代码。 |
| zk 内存池优化 | 同上，需要 OMU/zk 实际代码和长稳证据。 |
| N3 SM4 隧道加密 | 基站强依赖且可能非标准，需先联调方案。 |
| 独立工业增强网关 | 本质是新产品，不宜塞入核心网主线。 |
| 用户业务数据分析服务器 | 本质是旁路分析产品，需数据合规和模型路线。 |
| 工业协议代理 | 依赖具体工业协议，需逐协议验证。 |

## 七、风险缓冲方式

AI Agent 模式下不建议使用“加人月缓冲”，而应使用以下缓冲：

| 风险 | Agent 缓冲方式 |
| --- | --- |
| 需求不清 | 先派 Spike Agent，产出决策文档和验收标准。 |
| 代码上下文大 | 建 Context Pack，并限制每个 Agent 只改一个纵切。 |
| 多 Agent 冲突 | 先冻结接口和数据模型，再并发实现。 |
| 测试环境不足 | 独立 Test Environment Agent 准备 Docker/UERANSIM/脚本。 |
| 外部硬件不可用 | 先做 SDK mock/provider interface，不阻塞主线。 |
| 验证不可自动化 | Evidence Agent 负责抓包、日志、手工步骤和未验证声明。 |
| 架构风险高 | Spike -> MVP -> 压测 -> 产品化四段，不直接大改。 |

## 八、最终建议

1. **2.11 主线先锁定 69-114 ADU**：KPI、4G 运维、5G-LAN、UPF HA、SIM 子网、License MVP、OAM 基座。
2. **另设 30-51 ADU 的 Spike 池**：4G/5G 互操作、QoS 动态、加密卡、达梦、ARPF/EIR、多线程、SM4、工业新产品。
3. **第一轮并发不要超过 5 个 swarm**：A 运维、B 5G-LAN/HA、C License/SIM/QoS、D 安全、E 架构预研。
4. **每个 swarm 必须有独立 Review Agent 和 Evidence Agent**：避免实现 Agent 自证完成。
5. **所有需求以验收证据关闭，而不是以代码提交关闭**：没有测试日志、接口样例、抓包或运行态截图的任务，最多算完成实现，不算完成交付。

按上述方式，2.11 可以从“34 条大需求”转化为一组可并发、可复审、可验证的 Agentic Delivery Units。这样评估出来的是 AI Agent 工作流的吞吐量和风险结构，而不是传统人月口径。
