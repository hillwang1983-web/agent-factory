# 控标点综合测试手册审核报告（Round 2）

**审核对象：** [control-point-integrated-test-manual-3gpp.md](./control-point-integrated-test-manual-3gpp.md)  
**对照基准：** `5GC产品功能清单及控标点-20260402.xlsx`（105 行，含 12 个控标点）  
**日期：** 2026-05-23  
**版本：** Round 2（本次为全量重审，取代 Round 1）

---

## 总体结论

**✅ 测试手册质量良好，可进测试阶段。**

文档自 Round 1 后经历显著扩充（2757 行 → 3178 行），所有 Round 1 识别的 Coverage Gap 均已通过新增 CC-* 用例补齐。12 个控标点均有测试用例覆盖。Round 1 审核报告存在若干事实错误，已在本轮全量纠正。

| 类别 | Round 1 | Round 2 修订 |
|------|---------|--------------|
| 用例总数 | 未完整统计 | **93 个**（30 TC-* + 22 SE-* + 41 Part 3） |
| Critical Gap | 3 | **0**（全部已补齐） |
| Important Gap | 5 | **0**（全部已补齐，其中 2 项 Round 1 识别有误） |
| Minor Gap | 7 | **0**（全部已补齐，其中 2 项 Round 1 识别有误） |
| Round 2 新发现 | — | **1 Important + 2 Minor**（非阻塞） |

---

## 第一部分：用例结构总览

### 文档三部分

| 部分 | 行范围 | 用例系列 | 用例数 | 定位 |
|------|--------|---------|--------|------|
| Part 1：基础功能 | 1 – 999 | TC-* | 30 | UERANSIM 可运行，无需专用仪器 |
| Part 2：专用环境 | 1002 – 1924 | SE-* | 22 | 切换/HA/安全/IMS/性能，需专用硬件或仿真仪 |
| Part 3：完整覆盖补充 | 1927 – 3178 | CC-* (+SE-TSN-001) | 41 | 第三方功能、IMS、IoT、OAM 补充；部分用例依赖专用平台 |
| **合计** | | | **93** | |

### Part 1 完整用例清单（30 个 TC-*）

| 编号 | 行 | 功能域 |
|------|----|--------|
| TC-REG-001 | 115 | 初始注册 |
| TC-REG-002 | 145 | **去注册**（非 Mobility Registration Update — 见 §Round1 错误纠正） |
| TC-REG-003 | 171 | TAI List 与移动性限制 |
| TC-CONN-001 | 196 | CM 状态转换 |
| TC-SR-001 | 220 | Service Request |
| TC-PAGE-001 | 245 | 下行数据寻呼 |
| TC-PDU-001 | 271 | PDU Session 建立/修改/释放 |
| TC-PDU-002 | 298 | IPv4/IPv6/IPv4v6 会话类型 |
| TC-PDU-003 | 322 | Ethernet PDU Session |
| TC-UP-001 | 357 | N3/N6 数据转发 |
| TC-NAT-001 | 383 | N6 NAT |
| TC-PFCP-001 | 407 | PFCP Association 与心跳 |
| TC-PFCP-002 | 433 | PDR/FAR/QER 规则下发 |
| TC-QOS-001 | 459 | QoS 与包过滤 |
| TC-SLICE-001 | 485 | 切片选择与 DNN 绑定 |
| TC-SLICE-002 | 511 | 切片准入控制 |
| TC-5GLAN-001 | 535 | 5G LAN 二层组网 |
| TC-5GLAN-002 | 567 | **VLAN 透传**（非 IGMP/MLD — 见 §Round1 错误纠正） |
| TC-5GLAN-003 | 591 | 二层三层互通与后路由 |
| TC-HA-001 | 624 | 5G LAN 用户面 HA |
| TC-DEV-001 | 652 | 下挂设备发现 |
| TC-WL-001 | 677 | 终端白名单与 USIM-IMEI 绑定（**含运行时动态更新** — 见 §Round1 错误纠正） |
| TC-WL-002 | 707 | 基站白名单 |
| TC-SEC-001 | 731 | SUCI、鉴权与 NAS 安全 |
| TC-SEC-002 | 757 | 违规外联检测、告警与阻断 |
| TC-IMS-001 | 783 | IMS DNN 与 P-CSCF 下发 |
| TC-OAM-001 | 810 | 配置查询、导入、导出、同步与激活 |
| TC-OAM-002 | 836 | 日志、接口跟踪与用户跟踪 |
| TC-OAM-003 | 860 | 性能采集、补采、报表与门限 |
| TC-DEP-001 | 886 | 一键部署与一键升级 |

### Part 3 补充用例（41 个）

| 编号 | 行 | 所属节 | 覆盖要点 |
|------|----|--------|---------|
| CC-STD-001 | 1977 | §2 标准/架构 | 3GPP 版本一致性与能力声明 |
| CC-SBI-001 | 2004 | §2 | SBA/SBI 全接口服务发现、鉴权与异常响应 |
| CC-FUSION-001 | 2035 | §2 | 4G/5G 融合网元形态 |
| CC-COMP-001 | 2062 | §2 | X86/ARM 服务器部署 |
| CC-COMP-002 | 2088 | §2 | 国产 OS、达梦 DB、自主 CPU |
| CC-DEP-001 | 2121 | §2 | 虚拟机部署兼容矩阵 |
| CC-DEP-002 | 2148 | §2 | 5GC/EPC 网元下沉健康验收 |
| CC-DEP-003 | 2174 | §2 | 容器化 / Kubernetes 部署冒烟 |
| CC-OAM-001 | 2211 | §3 能力/会话/UP | UE 事件订阅、外部 UE 信息、外部 QoS 请求 |
| CC-PDU-001 | 2240 | §3 | SSC Mode 1 IP 保持 |
| CC-PDU-002 | 2267 | §3 | SSC Mode 2 / LADN 区域会话 |
| CC-PDU-003 | 2299 | §3 | SSC Mode 3 / MA PDU Session |
| CC-DDN-001 | 2339 | §3 | IDLE 下行缓存与 N4 DDN |
| CC-ENDM-001 | 2367 | §3 | End Marker 生成和转发 |
| CC-UPF-001 | 2396 | §3 | N9 多 UPF / UL CL 分流 |
| CC-URR-001 | 2426 | §3 | PFCP URR 用量上报 |
| CC-AM-001 | 2455 | §3 | AM Policy Association 与移动性策略下发 |
| CC-AMF-001 | 2483 | §3 | AMF 负载均衡、重定向与隐式去注册 |
| CC-PCF-001 | 2512 | §3 | SM Policy Association 与动态 PCC 推送 |
| CC-CHG-001 | 2542 | §3 | Nchf 计费接口与 CDR |
| CC-AF-001 | 2572 | §3 | AF/NEF 流量影响 Traffic Influence |
| CC-MCAST-001 | 2605 | §4 5G-LAN/切片 | IPv4/IPv6 组播、IGMP/MLD |
| CC-VLAN-001 | 2633 | §4 | 802.1Q VLAN 透传深度测试 |
| CC-L2ROBUST-001 | 2662 | §4 | MAC 老化、广播风暴抑制、环路检测 |
| CC-RAN-001 | 2693 | §4 | 切片 RB 资源预留/动态共享 |
| SE-TSN-001 | 2725 | §4 | TSN / IEEE 802.1AS 工业时间同步（SE 前缀，位于 Part 3） |
| CC-REDCAP-001 | 2758 | §5 RedCap/IoT | RedCap 注册、移动性、4G/5G 互操作 |
| CC-REDCAP-002 | 2790 | §5 | RedCap eDRX 节电 |
| CC-IOT-001 | 2818 | §5 | LTE Cat.1 接入、移动性、路由优化 |
| CC-IOT-002 | 2844 | §5 | NB-IoT CP 模式、PSM/eDRX、速率控制 |
| CC-IMS-001 | 2875 | §6 IMS/SMS | IMS 单节点集成形态 |
| CC-IMS-002 | 2900 | §6 | IMS 2000 注册、500 路语音并发 |
| CC-IMS-003 | 2927 | §6 | IMS UPDATE、业务触发、消息管理 |
| CC-IMS-004 | 2955 | §6 | SMSC 多媒体短信 |
| CC-IMS-005 | 2982 | §6 | EPS Fallback/RAT Fallback 与语音域选择 |
| CC-IMS-006 | 3009 | §6 | IMS/SBC/MGW 主备冗余和负载均衡 |
| CC-IMS-007 | 3035 | §6 | 呼叫前转到第三方网络 |
| CC-LMT-001 | 3067 | §7 运维/日志 | 本地 LMT 页面全流程 |
| CC-LOG-001 | 3095 | §7 | OMC 操作日志、安全事件日志保护 |
| CC-UDM-001 | 3122 | §7 | UDM 开户、APN/DNN 签约、速率设置 UI/API |
| CC-UDM-002 | 3150 | §7 | 大网开户数据与本地专网数据同步 |

---

## 第二部分：Round 1 错误纠正

以下 6 项错误已在 Round 1 报告中被识别并在本轮全量重审中纠正。

### 错误 1：TC-5GLAN-002 内容描述有误

| 项 | Round 1（错误）| Round 2（正确）|
|----|--------------|--------------|
| TC-5GLAN-002 | 被描述为 "IGMP/MLD 组播测试" | **VLAN 透传测试**（覆盖 802.1Q 标签、N6 VLAN、非法 VLAN 拒绝） |
| IGMP/MLD 测试 | 被认为缺失 | 由 **CC-MCAST-001**（第 2605 行）覆盖 |

### 错误 2：TC-REG-002 内容描述有误

| 项 | Round 1（错误）| Round 2（正确）|
|----|--------------|--------------|
| TC-REG-002 | 被标注为 "Mobility Registration Update" | **去注册（Deregistration）**：UE/AMF/UDM 发起去注册 |
| 移动性注册更新 | 被认为是 TC-REG-002 | 在 TC-REG-001 主流程和 TC-REG-003 TAI List 用例中覆盖 |

### 错误 3："VLAN 透传无专项测试" Gap 不成立

Round 1 将 "VLAN 透传" 列为 Important Gap，但：
- **TC-5GLAN-002**（第 567 行）= VLAN 透传基础测试
- **CC-VLAN-001**（第 2633 行）= 802.1Q VLAN 透传深度专项测试

Round 1 误以为 TC-5GLAN-002 是 IGMP 测试，导致此 Gap 被错误识别。

### 错误 4："白名单动态更新未测试" Gap 不成立

Round 1 将 "运行时动态白名单更新未测试" 列为 Minor Gap，但：

TC-WL-001 异常流步骤 4（第 702 行）已明确：
> 通过 NMS/API 在运行时**新增、禁用、恢复**白名单条目，不重启 AMF

此场景已完整覆盖，Round 1 遗漏了该步骤。

### 错误 5：用例总数统计有误

Round 1 基于较短版本（~2757 行）统计，遗漏了 3 个 TC-* 用例：
- **TC-REG-003**（第 171 行）：TAI List 与移动性限制
- **TC-PFCP-002**（第 433 行）：PDR/FAR/QER 规则下发
- **TC-SLICE-002**（第 511 行）：切片准入控制

正确的 TC-* 用例数为 **30**（非 27）。

### 错误 6：文档行数与版本状态

Round 1 审核的文档为 2757 行版本。当前版本已扩充至 **3178 行**，新增 Part 3 补充章节（Section 5-7），包含 RedCap/IoT/IMS/LMT/LOG/UDM 共 15 个新用例。

---

## 第三部分：12 个控标点覆盖验证

所有 12 个控标点（Excel 列"控标点="是""）均有对应测试用例覆盖：

| # | 控标点功能 | 覆盖用例 |
|---|-----------|---------|
| 1 | 5G-LAN L2 以太网 VN Group | TC-5GLAN-001/002/003、CC-MCAST-001、CC-VLAN-001、CC-L2ROBUST-001 |
| 2 | UPF HA 主备切换 | TC-HA-001、SE-HA-002、SE-HA-003 |
| 3 | 双发选收 (PDPR/FRER) | SE-RED-001/002/003 |
| 4 | 国密算法 (SM2/SM3/SM4/ZUC) | SE-GM-001/002/003 |
| 5 | 密码机 (GM/T 0028 HSM) | SE-HSM-001 |
| 6 | 跨地域 IPSec 加密 | SE-IPSEC-001 |
| 7 | Kubernetes 容器化部署 | CC-DEP-003 |
| 8 | 国产 OS/CPU/数据库 | CC-COMP-002 |
| 9 | TSN IEEE 802.1AS 工业同步 | SE-TSN-001 |
| 10 | AF/NEF 流量影响 | CC-AF-001 |
| 11 | Nchf 计费接口/CDR | CC-CHG-001 |
| 12 | SSC Mode 2/3 会话连续性 | CC-PDU-002 (SSC2)、CC-PDU-003 (SSC3) |

---

## 第四部分：Round 1 Gap 闭合情况

### 原 Critical Gap（全部闭合）

| Gap | 闭合用例 | 状态 |
|-----|---------|------|
| SSC Mode 2 / LADN 区域会话 | CC-PDU-002（第 2267 行） | ✅ |
| N9 多 UPF / UL CL 分流 | CC-UPF-001（第 2396 行） | ✅ |
| Nchf 计费接口与 CDR | CC-CHG-001（第 2542 行） | ✅ |

### 原 Important Gap（全部闭合；其中 2 项 Round 1 本身有误）

| Gap | 状态 | 说明 |
|-----|------|------|
| VLAN 透传无专项 | ✅（Round 1 错误）| TC-5GLAN-002 是 VLAN 测试；CC-VLAN-001 是深度专项 |
| SM Policy / PCF 动态 PCC | ✅ 新增 CC-PCF-001 | |
| AF/NEF 流量影响 | ✅ 新增 CC-AF-001 | |
| SBI 全接口完整性 | ✅ CC-SBI-001 增强 | |
| TSN IEEE 802.1AS | ✅ 新增 SE-TSN-001 | |

### 原 Minor Gap（全部闭合；其中 2 项 Round 1 本身有误）

| Gap | 状态 | 说明 |
|-----|------|------|
| AMF 负载均衡 / 重定向 | ✅ 新增 CC-AMF-001 | |
| 白名单动态更新 | ✅（Round 1 错误）| TC-WL-001 异常流步骤 4 已覆盖 |
| MAC 老化/风暴抑制/环路检测 | ✅ 新增 CC-L2ROBUST-001 | |
| RedCap 专项 | ✅ 新增 CC-REDCAP-001/002 | |
| K8s 部署冒烟 | ✅ 新增 CC-DEP-003 | |
| URR 用量上报 | ✅ 新增 CC-URR-001 | |
| AM Policy Association | ✅ 新增 CC-AM-001 | |

---

## 第五部分：Round 2 新发现问题

### 🟡 I-R2-1 — 28 个 CC-* 用例缺少显式 规范依据 字段

**严重程度：** Important（可在开发过程中同步补充，不阻塞测试执行）  
**位置：** Part 3 共 41 个用例中 28 个仅有 `**覆盖:**` 而无 `**规范依据:**`

TC-* 和 SE-* 系列统一使用 `**规范依据:**` 明确指向 3GPP TS 规范条款，但以下 28 个 CC-* 用例缺少此字段：

```
CC-STD-001, CC-SBI-001, CC-FUSION-001, CC-COMP-001, CC-COMP-002,
CC-DEP-001, CC-DEP-002, CC-DEP-003, CC-OAM-001, CC-PDU-001,
CC-DDN-001, CC-MCAST-001, CC-RAN-001,
CC-REDCAP-001, CC-REDCAP-002, CC-IOT-001, CC-IOT-002,
CC-IMS-001~007 (7 个), CC-LMT-001, CC-LOG-001, CC-UDM-001, CC-UDM-002
```

这些用例均有明确的 3GPP 规范依据（例如 RedCap → TS 38.306/TS 23.501 §5.30；NB-IoT → TS 24.301/TS 36.321；IMS → TS 23.228/TS 24.229），缺少显式引用会降低审计可追溯性。

**建议**：在每个用例 `**前置条件:**` 行前补充 `**规范依据:**` 字段，引用主要 TS 规范及章节号。

---

### 🔵 M-R2-1 — SE-TSN-001 使用 SE 前缀但位于 Part 3（CC-* 区）

**严重程度：** Minor（不影响测试执行）  
**位置：** 第 2725 行，Part 3 第 4 节  

SE-TSN-001 使用 SE-* 前缀（专用环境用例），但编排在 Part 3 的 CC-* 用例区。从内容看，它确实需要 TSN 专用硬件，应归属 Part 2（SE-* 专用环境）。当前位置与 Part 2 中的其他 SE-* 用例（SE-HA-002、SE-RED-001 等）不一致。

**建议**：将 SE-TSN-001 迁移到 Part 2 SE-* 章节；或在 Part 2 目录表中补充引用此用例。

---

### 🔵 M-R2-2 — 文档头声称 "104 个功能细分" 与 Excel 105 行存在 1 行差异

**严重程度：** Minor（需确认，不影响控标点覆盖）  
**位置：** 第 7 行：`测试原则: 104 个功能细分均有明确测试用例编号`  

Excel 数据源共有 105 行（含 12 个控标点），文档头仅声明 104 个功能细分。差异为 1 行，可能原因：
- Excel 其中 1 行为章节标题行或小计行（不是独立功能细分）
- 文档将 2 个相邻功能合并为 1 个用例

**建议**：对照 Excel 确认第 105 行的内容，若为功能细分则在文档头更新计数并确认覆盖；若为非功能行则注明。

---

## 第六部分：新增用例质量评估

本次审核全量阅读了 Round 1 后新增的 15 个用例（CC-REDCAP-001/002、CC-IOT-001/002、CC-IMS-001~007、CC-LMT-001、CC-LOG-001、CC-UDM-001/002），结合早先已核查的 CC-PDU-002/003、CC-UPF-001、CC-AMF-001 等关键用例：

| 质量维度 | 评估结果 |
|---------|---------|
| 前置条件 | ✅ 所有新用例均有明确前置条件（设备、平台、配置要求）|
| 正常流程 | ✅ 步骤清晰，可操作，含测量目标（如 IMS-002 的注册成功率和并发路数）|
| 预期结果 | ✅ 均有可量化或可观测的结果描述 |
| 异常流程 | ✅ 所有用例均包含异常场景（非法参数、资源耗尽、设备故障）|
| 异常预期 | ✅ 明确定义拒绝行为、错误 cause 和隔离要求 |
| 规范依据 | ⚠️ 28 个 CC-* 用例仅有"覆盖"字段，无显式 TS 规范引用（见 I-R2-1）|

---

## 第七部分：问题汇总

| ID | 严重程度 | 位置 | 描述 | 建议 |
|----|---------|------|------|------|
| I-R2-1 | 🟡 Important | Part 3，28 个 CC-* 用例 | 缺少显式 规范依据 字段 | 补充 TS 规范引用，如 TS 38.306/TS 23.228 等 |
| M-R2-1 | 🔵 Minor | 第 2725 行 SE-TSN-001 | SE 前缀用例位于 CC-* 区 | 迁移到 Part 2 或在 Part 2 目录中补充引用 |
| M-R2-2 | 🔵 Minor | 第 7 行 | 文档头 104 vs Excel 105 行 | 对照 Excel 确认差异来源 |

### 当前未处理问题计数

| 严重程度 | 数量 |
|---------|------|
| 🔴 Critical | 0 |
| 🟡 Important | 1 |
| 🔵 Minor | 2 |
| **合计** | **3（均非阻塞）** |

---

## 结论

测试手册已从 Round 1 的 2757 行扩充至 3178 行，新增 15 个用例，**覆盖了全部 12 个控标点**，补齐了 Round 1 报告中识别的所有 Critical/Important/Minor Coverage Gap（包括 SSC Mode 2、N9 UL CL、Nchf 等关键控标点相关场景）。

Round 1 报告中的若干事实错误（TC-5GLAN-002 内容、TC-REG-002 流程名称、VLAN Gap 不成立、白名单动态更新已覆盖）已在本轮全量重审中纠正。

仅剩 1 个 Important 非阻塞问题（28 个 CC-* 用例补充规范依据引用）和 2 个 Minor 问题，**测试手册可进入执行阶段**。

> Round 2 完成于 2026-05-23，全量重审，取代 Round 1 报告。
