# 5GC 控标点专用环境功能测试手册

**适用范围:** “可测试，但强依赖专用环境”的控标点功能  
**数据来源:** `5GC产品功能清单及控标点-20260402.xlsx` 的 `功能细分` 列，以及 `control-point-functional-test-manual-3gpp.md` 的专项功能分组  
**规范参考日期:** 2026-05-23  
**规范锚点:** 3GPP Release 19 为稳定验收基线，Release 20 作为增强跟踪项  
**测试对象:** Open5GS 5GC、Open5GS-NMS、真实/仿真 gNB、真实 UE/CPE/工业网关、主备 UPF、IMS/SBC/PSTN 网关、安全设备、性能测试平台

---

## 1. 文档定位

本手册覆盖普通 UERANSIM 单机环境难以充分验证的功能。这些功能本身可测试，但需要以下至少一类专用条件：

- 多 gNB、多小区、可控无线环境或 RAN 仿真仪。
- 多 UPF、多网卡、浮动 IP、VRRP/BFD、时间同步和故障注入环境。
- 双模组终端、双基站或工业冗余传输设备。
- 国密 USIM、密码机、HSM/PCIe 加密卡或算法适配模块。
- IMS/SBC/P-CSCF/I-CSCF/S-CSCF、SIP 终端、VoNR/VoLTE 终端、PSTN/媒体网关。
- 流量发生器、DDoS/异常信令模拟器、KPI/性能采集平台。

这些用例不要求全部在当前 Open5GS 单机环境一次性完成，但每个用例都给出可验收的环境、步骤、正常流程、异常流程和证据。

---

## 2. 专用环境总览

| 环境编号 | 环境名称 | 覆盖功能 | 必需设备/系统 |
| --- | --- | --- | --- |
| LAB-HO | 移动性与互操作实验室 | Xn/N2 切换、4G/5G 互操作、EPS Fallback/RAT Fallback | 至少 2 个 gNB 或 RAN 仿真仪、可移动 UE、EPC/5GC、N26 可选 |
| LAB-HA | 高可靠用户面实验室 | AMF Set、UPF 主备、浮动 N3/N6、MAC 表同步 | 2 台 UPF、独立 N3/N6/sync 网络、VRRP/BFD/故障注入 |
| LAB-RED | 双发选收实验室 | 单/双基站双模组、PRP/FRER、20ms 可靠性 | 双模组 CPE、双链路 RAN、序列号/去重设备、时延仪 |
| LAB-SEC | 安全与国密实验室 | SUCI 国密、国密 AKA、ZUC、IPSec、HSM、违规外联、防攻击 | 国密 USIM、密码机/HSM、安全网关、攻击流量发生器 |
| LAB-IMS | 语音与 IMS 实验室 | IMS DNN、P-CSCF、SIP 终端、VoNR/VoLTE、PSTN 互通 | IMS Core、SBC、SIP 终端、VoNR/VoLTE UE、PSTN 网关 |
| LAB-PERF | 性能与容量实验室 | 性能采集、补采、报表、门限、容量与稳定性 | UE/RAN 仿真器、流量仪、Prometheus/Grafana/NMS |

---

## 3. 通用测试证据要求

每个专项用例至少保存以下证据：

- 拓扑图、版本清单、配置快照、测试时间窗口。
- AMF/SMF/UPF/NRF/UDM/PCF/NMS 日志。
- N2/N3/N4/N6 抓包，必要时包含 RAN 侧 Xn/N2 或 IMS SIP 抓包。
- 故障注入记录，包括断链、杀进程、断电、禁用网卡、修改策略的时间点。
- KPI 数据，包括中断时长、丢包、时延、抖动、注册成功率、会话成功率、告警时间。
- NMS/API 响应、告警记录、审计记录、报表导出文件。

专项测试结论必须包含三类判断：

- `PASS`: 正常流程通过，异常流程按预期失败或降级。
- `WARN`: 主要业务通过，但存在环境能力不足、指标未完全覆盖或非核心噪声。
- `FAIL`: 功能不可用、异常流程放行、数据面错误转发、进程崩溃、敏感信息泄露或指标未达标。

---

## 4. 用例总览

| 编号 | 功能域 | 专用依赖 | 正常流程 | 异常流程 |
| --- | --- | --- | --- | --- |
| SE-HO-001 | Xn 切换 | 双 gNB 或 RAN 仿真仪 | UE 从源 gNB 切到目标 gNB | 目标 gNB 不可用、切换准备失败 |
| SE-HO-002 | N2 切换 | 双 gNB、AMF、SMF、UPF | 经 AMF 完成 N2 切换 | Path Switch 失败、资源不足 |
| SE-HO-003 | 4G/5G 互操作 | EPC+5GC、N26 可选 | 5GS 到 EPS/ EPS 到 5GS 移动 | 无 N26、签约缺失、TAU/Registration 失败 |
| SE-HA-001 | AMF Set/MME Pool | 多 AMF 或多 MME | AMF 冗余与负载分担 | 单 AMF 故障、负载重平衡失败 |
| SE-HA-002 | UPF 主备切换 | 双 UPF、浮动 IP、状态同步 | 主 UPF 故障后备用接管 | Standby 不可用、双主、同步丢失 |
| SE-HA-003 | 5G-LAN MAC/组播状态同步 | 双 UPF、Ethernet PDU、VN Group | 切换后无需重新学习 MAC | MAC 表过期、组播状态不一致 |
| SE-RED-001 | 单基站双发选收 | 双模组 CPE、同 gNB | 两链路冗余发送、接收端去重 | 单链路丢包、重复包、乱序 |
| SE-RED-002 | 双基站双发选收 | 双 gNB、双模组 CPE | 两基站链路冗余 | 一基站故障、时延差过大 |
| SE-RED-003 | 20ms/99.999% 可靠性 | 时延仪、流量仪、长期运行 | 指标达标 | 注入无线抖动、拥塞、丢包 |
| SE-GM-001 | 国密 SUCI | 国密 USIM、SM2/SM3/SM4 模块 | SUPI 加密为 SUCI 并解密 | 错误密钥、非法 SUCI |
| SE-GM-002 | 国密 AKA | 国密 USIM、UDM/AUSF 算法插件 | 双向鉴权成功 | 鉴权向量错误、重放攻击 |
| SE-GM-003 | ZUC/NAS/用户面安全 | 支持 NEA3/NIA3/EEA3/EIA3 的 UE/RAN | 算法协商成功 | 不支持算法、完整性失败 |
| SE-HSM-001 | 安全存储与密码机 | HSM/PCIe 加密卡/第三方密码机 | 密钥加密存储和调用 | HSM 不可达、密钥轮换失败 |
| SE-IPSEC-001 | 跨地域 IPSec | 安全网关、国密算法套件可选 | 跨站点链路加密 | 隧道断开、证书/密钥错误 |
| SE-DEF-001 | 违规外联检测与阻断 | 流量镜像/UPF 策略/安全平台 | 命中五元组告警并阻断 | 策略冲突、IPv6/端口绕过 |
| SE-DEF-002 | 异常信令检测 | NGAP/NAS/PFCP 攻击模拟器 | 异常信令被统计和告警 | 高速异常信令、畸形消息 |
| SE-DEF-003 | 过载与 DDoS 防护 | 流量仪、信令压测仪 | 过载保护触发并恢复 | 阈值过低/过高、误伤合法 UE |
| SE-IMS-001 | SIP 终端接入 | IMS Core、SIP 终端、SBC | SIP 终端注册并与移动终端互通 | 鉴权失败、NAT/媒体失败 |
| SE-IMS-002 | VoNR/VoLTE 与 P-CSCF | VoNR/VoLTE UE、IMS DNN | P-CSCF 下发、IMS 注册 | P-CSCF 缺失、IMS DNN 未签约 |
| SE-IMS-003 | PSTN/运营商互通 | SBC/MGW/PSTN 网关 | 专网呼叫外部号码 | 路由失败、编解码不匹配、主备切换 |
| SE-PERF-001 | 性能采集与补采 | KPI 平台、NMS、时间同步 | 任务采集、补采、报表 | 指标源中断、重复数据 |
| SE-PERF-002 | 容量与并发 | UE/RAN 仿真器、流量仪 | 注册/会话/吞吐容量达标 | 资源耗尽、部分 NF 重启 |

---

## 5. 详细测试用例

### SE-HO-001 Xn 切换

**规范依据:** TS 23.501 移动性架构，TS 23.502 Handover procedure，TS 38.413 NGAP，RAN 侧 XnAP 规范  
**专用环境:** 两个支持 Xn 的 gNB 或 RAN 仿真仪，1 个可移动 UE，Open5GS AMF/SMF/UPF，连续 N3/N6 抓包。

**前置条件**

- 源 gNB 与目标 gNB 均完成 NG Setup。
- UE 在源 gNB 注册并建立 PDU Session。
- 源 gNB 与目标 gNB 之间 Xn 链路可达。
- UE 业务流持续运行，例如 `iperf3` UDP 1 Mbps 或 ICMP 20 ms 间隔。

**正常流程**

1. UE 驻留源 gNB，小区 A 信号优于小区 B。
2. 启动连续业务流，记录源 gNB、AMF、UPF 日志时间戳。
3. 通过衰减器或 RAN 仿真仪降低小区 A 信号，提高小区 B 信号。
4. 触发 Xn Handover。
5. 观察 UE 在目标 gNB 上继续保持 PDU Session。

**预期结果**

- UE 不重新注册或仅执行必要移动性更新。
- PDU Session 保持，IP 地址不变。
- 用户面中断时长在项目指标内。
- N2/N3/N6 抓包能看到路径切换前后业务恢复。

**异常流程 A: 目标 gNB 资源不足**

1. 在目标 gNB 配置资源不足或拒绝 admission。
2. 重复触发切换。

**异常预期 A**

- 切换准备失败，UE 保持源 gNB 或执行回退。
- AMF/RAN 日志记录明确失败 cause。
- 业务不中断或中断后可恢复。

**异常流程 B: Xn 链路断开**

1. 断开源/目标 gNB 间 Xn 链路。
2. 触发移动。

**异常预期 B**

- 系统转入 N2 切换或重新建立流程。
- 不产生重复 UE Context 或残留隧道。

**证据**

- RAN 切换日志、AMF UE Context 日志、N3/N6 中断统计、UE IP 保持记录。

### SE-HO-002 N2 切换

**规范依据:** TS 23.502 N2 based handover，TS 38.413 PDU Session Resource Handover  
**专用环境:** 两个 gNB 无 Xn 或关闭 Xn，AMF 参与切换控制。

**正常流程**

1. 禁用 Xn 或配置无 Xn 邻区。
2. UE 在源 gNB 建立 PDU Session。
3. 触发到目标 gNB 的移动。
4. AMF 执行 Handover Required/Request/Command/Notify 相关流程。
5. SMF/UPF 完成路径切换。

**预期结果**

- UE 移动到目标 gNB 后业务恢复。
- UPF 中目标 N3 TEID 更新正确。
- 源路径资源被释放。

**异常流程**

- 在 Path Switch 阶段阻断 SMF 或 UPF。

**异常预期**

- AMF/SMF 返回失败 cause。
- 不保留错误 PDR/FAR。
- UE 可重新发起注册或业务请求恢复。

**证据**

- NGAP Handover 消息、PFCP Session Modification、源/目标 N3 TEID 差异、业务中断时长。

### SE-HO-003 4G/5G 互操作

**规范依据:** TS 23.501 interworking with EPS，TS 23.502 EPS/5GS mobility，TS 24.501/24.301 NAS  
**专用环境:** EPC+5GC，支持 LTE/NR 的 UE，N26 接口可选。

**正常流程 A: 5GS 到 EPS**

1. UE 在 5GS 注册并建立 PDU Session。
2. 触发 UE 从 NR 覆盖移动到 LTE 覆盖。
3. 根据环境执行带 N26 或无 N26 的互操作流程。
4. 检查业务 IP 连续性。

**预期结果 A**

- 支持的场景下会话连续或按策略重建。
- UE 业务恢复，策略和 QoS 映射正确。

**正常流程 B: EPS 到 5GS**

1. UE 在 LTE/EPC 附着并建立 PDN Connection。
2. 移动到 NR/5GC 覆盖。
3. UE 执行 5GS 注册和会话迁移或重建。

**预期结果 B**

- UE 成功注册 5GS。
- DNN/APN、QoS、IP 连续性符合配置策略。

**异常流程**

- 缺失互操作签约、关闭 N26、配置不匹配 APN/DNN。

**异常预期**

- UE 被拒绝或执行可解释的重建流程。
- 不出现重复计费会话、重复 IP 分配或策略错配。

**证据**

- MME/AMF/SMF/PGW-C/UPF 日志，NAS 抓包，IP 连续性结果。

### SE-HA-001 AMF Set/MME Pool 冗余与负载分担

**规范依据:** TS 23.501 AMF Set，TS 23.502 AMF selection/re-allocation  
**专用环境:** 至少 2 个 AMF 实例，共享 NRF/UDM/PCF，gNB 支持多 AMF 或 AMF Set 配置。

**正常流程**

1. 启动 AMF-A 和 AMF-B，均注册到 NRF。
2. gNB 配置 AMF Set 或多个 AMF 目标。
3. 批量启动 UE，观察 UE 在 AMF-A/AMF-B 上分布。
4. 对 AMF-A 做优雅下线。
5. 新 UE 注册到 AMF-B，已在线 UE 按策略保持或迁移。

**预期结果**

- 新注册 UE 在 AMF 间负载分担。
- AMF-A 下线后新 UE 不再选择 AMF-A。
- NMS 显示 AMF Set 状态。

**异常流程**

- AMF-A 非优雅崩溃，NRF 未及时发现。

**异常预期**

- gNB 或 NRF 在检测周期后停止向 AMF-A 分发新 UE。
- 受影响 UE 可重新注册恢复。
- 告警包含 AMF 实例、检测时间、恢复时间。

**证据**

- NRF NFProfile、AMF UE 数、gNB SCTP 连接、NMS 拓扑状态。

### SE-HA-002 UPF 主备切换

**规范依据:** TS 23.501 UPF selection/reselection，TS 29.244 PFCP，SA5 KPI  
**专用环境:** Active/Standby UPF、同步链路、浮动 N3/N6 IP 或外部 VRRP/BFD、故障注入能力。

**前置条件**

- UE 已建立 IP PDU Session 或 Ethernet PDU Session。
- Active UPF 与 Standby UPF 状态同步正常。
- 业务流持续运行并记录序列号。

**正常流程**

1. 验证 Active UPF 承载 N3/N6 流量。
2. 检查 Standby UPF 已同步 PFCP Session、PDR/FAR/QER、TEID 和必要 MAC/IP 状态。
3. 停止 Active UPF 进程或断开 Active N3/N6。
4. Standby 接管浮动 IP。
5. 业务流恢复。

**预期结果**

- 切换后 UE 不重新建会话，或按设计进行快速恢复。
- 业务中断时长满足项目目标。
- Standby 接管后 N3/N6 抓包方向正确。
- SMF/NMS 状态从 Active/Standby 更新为新的角色。

**异常流程 A: Standby 不可用**

1. 先停止 Standby。
2. 再停止 Active。

**异常预期 A**

- NMS 产生高危告警。
- SMF 不误判为已完成切换。
- 新建会话按策略拒绝或选择其他可用 UPF。

**异常流程 B: 双主**

1. 阻断同步链路但保留业务链路。
2. 人为触发两台 UPF 同时持有浮动 IP。

**异常预期 B**

- VRRP/BFD 或仲裁机制阻止双主。
- 若检测到双主，至少一侧主动降级。
- NMS 记录脑裂风险告警。

**证据**

- 故障注入时间点、N3/N6 抓包、业务序列号丢包统计、UPF 角色日志、NMS 告警。

### SE-HA-003 5G-LAN MAC/组播状态同步

**规范依据:** TS 23.501 5G LAN-type service，TS 29.244 Ethernet PDR  
**专用环境:** 双 UPF、Ethernet PDU Session、VN Group、主备同步链路。

**正常流程**

1. UE-A/UE-B 建立 Ethernet PDU Session。
2. 发送单播、广播、组播流量，形成 MAC 表和组播成员状态。
3. 确认 Standby UPF 已同步 MAC 表和组播状态。
4. 切断 Active UPF。
5. UE-A 继续向 UE-B 单播，组播源继续发送。

**预期结果**

- 切换后 UE-A 到 UE-B 单播不需要重新广播学习。
- 组播成员仍能收到组播流量。
- MAC 表时间戳、老化时间和 VN Group ID 保持一致。

**异常流程**

- 切换前制造 MAC flapping 或组播成员快速加入/离开。

**异常预期**

- Standby 对冲突状态按最后可信事件或版本号处理。
- 不把错误 MAC 映射扩散到新 Active。

**证据**

- Active/Standby MAC 表快照、组播状态快照、切换前后以太网帧抓包。

### SE-RED-001 单基站双发选收

**规范依据:** 3GPP 冗余传输和 URLLC 相关架构原则，项目 PRP/FRER 设计  
**专用环境:** 双模组 CPE，两个 UE 模组接入同一 gNB，接收端具备序列号去重/选收能力。

**正常流程**

1. CPE 的两个模组分别注册并建立 PDU Session。
2. 业务源对同一业务流复制发送到两条链路。
3. 接收端按序列号或业务标识去重，只向上层交付一次。
4. 记录两链路时延、抖动、重复包和丢包。

**预期结果**

- 两条链路均在线时，业务无重复交付。
- 单包以更早到达的一路为准。
- NMS 显示双链路状态、主选链路、重复包统计。

**异常流程**

- 注入单链路随机丢包、延迟突增或乱序。

**异常预期**

- 另一链路补偿丢包。
- 乱序不导致重复交付。
- 超出重排序窗口的包被记录并按策略丢弃。

**证据**

- 双链路抓包、序列号去重日志、业务层丢包率、时延统计。

### SE-RED-002 双基站双发选收

**规范依据:** 同 SE-RED-001，另需 RAN 多基站接入与移动性能力  
**专用环境:** 双模组 CPE 分别接入两个不同频点或不同 gNB。

**正常流程**

1. 模组 A 接入 gNB-A，模组 B 接入 gNB-B。
2. 两个模组建立独立 PDU Session 或冗余会话。
3. 发送冗余业务流。
4. 关闭 gNB-A 或模拟小区 A 信号消失。

**预期结果**

- gNB-A 故障时业务经 gNB-B 保持。
- NMS 显示链路 A 故障和链路 B 承载。
- 应用层无连接重建或重建时间满足指标。

**异常流程**

- 两条链路时延差超过去重窗口。

**异常预期**

- 系统按策略增大窗口、降级为单链路或告警。
- 不因迟到包污染业务流。

**证据**

- 两 gNB 日志、双 PDU Session 状态、链路故障时间点、应用层连续性记录。

### SE-RED-003 20ms/99.999% 可靠性指标

**规范依据:** 项目指标，URLLC/工业可靠性验收思想  
**专用环境:** 高精度时钟同步、时延仪、流量仪、长期稳定性平台。

**正常流程**

1. 使用固定包长和固定发送周期，例如 64/256/512 字节、1 ms 或 10 ms 周期。
2. 运行不少于项目约定时长的业务流。
3. 采集端到端时延、丢包、重复包、乱序包。
4. 计算 20ms 内到达比例和可靠性。

**预期结果**

- 20ms 内到达比例满足 99.999% 或项目定义。
- 去重后应用层无重复交付。
- 指标可由原始包日志复算。

**异常流程**

- 注入无线干扰、基站切换、单链路拥塞、UPF 切换。

**异常预期**

- 指标下降时产生告警。
- 报表区分网络丢包、重复丢弃、超时丢弃和应用丢包。

**证据**

- 原始时延 CSV、统计脚本、报表截图、测试配置。

### SE-GM-001 国密 SUCI

**规范依据:** TS 33.501 SUPI/SUCI 框架，国密算法按项目/行业规范适配  
**专用环境:** 国密 USIM 或可编程 USIM、SM2/SM3/SM4 算法模块、UDM/SIDF 适配。

**正常流程**

1. 在 UDM/SIDF 配置国密归属网私钥和 profile。
2. UE/USIM 使用国密算法将 SUPI 保护为 SUCI。
3. UE 发起注册。
4. UDM/SIDF 解密 SUCI 并恢复 SUPI。
5. 鉴权继续执行。

**预期结果**

- 空口和 NAS 日志不出现明文 SUPI。
- UDM/SIDF 能正确恢复 SUPI。
- 注册成功并建立 NAS 安全。

**异常流程**

- 使用错误公钥、错误 profile、篡改 SUCI 字段。

**异常预期**

- 解密失败，注册被拒绝。
- 日志不泄露私钥、K、OPc 或完整 SUPI。
- NMS 记录安全失败审计。

**证据**

- SUCI 抓包、SIDF 解密日志、注册结果、敏感字段脱敏检查。

### SE-GM-002 国密 AKA 双向鉴权

**规范依据:** TS 33.501 鉴权框架，国密 AKA 为项目适配能力  
**专用环境:** 国密 USIM、AUSF/UDM 国密鉴权插件、可抓取认证向量的安全审计日志。

**正常流程**

1. 为 UE 配置国密 USIM 参数。
2. UE 发起注册。
3. AUSF/UDM 生成国密鉴权向量。
4. UE 校验网络侧鉴权参数并返回响应。
5. 网络校验 UE 响应并派生安全上下文。

**预期结果**

- UE 与网络双向鉴权成功。
- NAS Security Mode 完成。
- 鉴权向量不以明文方式出现在普通日志。

**异常流程 A: 错误 USIM 参数**

1. 修改 USIM 或 UDM 中的鉴权密钥。
2. 发起注册。

**异常预期 A**

- 鉴权失败。
- AUSF/AMF 返回明确失败原因。

**异常流程 B: 重放鉴权响应**

1. 记录一次合法响应。
2. 在后续注册中重放。

**异常预期 B**

- 重放被拒绝。
- 计数器或随机挑战校验生效。

**证据**

- AUSF/UDM 鉴权审计、NAS 抓包、失败 cause、脱敏检查。

### SE-GM-003 ZUC/NAS/用户面安全

**规范依据:** TS 33.501 安全算法协商，TS 24.501 Security Mode Control  
**专用环境:** 支持 NIA3/NEA3 或 EIA3/EEA3 的 UE/RAN，核心网配置对应算法。

**正常流程**

1. 在 AMF/SMF/RAN/UE 配置允许 ZUC 算法。
2. UE 发起注册。
3. AMF 发起 Security Mode Command，协商 ZUC 完整性/加密算法。
4. 建立 PDU Session 并运行用户面流量。

**预期结果**

- NAS 安全算法协商为预期 ZUC 算法。
- 后续 NAS 消息完整性校验通过。
- 用户面安全策略符合 RAN/项目配置。

**异常流程**

- UE 不支持 ZUC 或 RAN 配置不支持。

**异常预期**

- 协商降级到允许算法，或注册被拒绝。
- 不应协商到禁用算法。

**证据**

- Security Mode 抓包、AMF 安全日志、算法配置快照。

### SE-HSM-001 数据安全存储与密码机

**规范依据:** TS 33.501 密钥安全原则，GM/T 0028 和项目密码模块要求  
**专用环境:** HSM、PCIe 加密卡或第三方密码机，PKCS#11 或厂商 SDK。

**正常流程**

1. 配置 HSM 连接、租户、密钥标签和访问凭证。
2. 将 K、OPc、SUCI 私钥等敏感数据以加密或引用方式入库。
3. UE 注册时通过 HSM 完成解密或签名/鉴权辅助。
4. 执行密钥轮换。

**预期结果**

- 数据库不保存敏感明文。
- HSM 调用成功，注册业务不受影响。
- 密钥轮换后新老 UE 按策略平滑过渡。

**异常流程**

- HSM 断连、密钥标签不存在、HSM 返回超时。

**异常预期**

- 核心网按策略拒绝高风险注册或使用安全缓存。
- NMS 告警标明 HSM 故障。
- 不回退到明文密钥存储。

**证据**

- 数据库抽样、HSM 审计日志、注册结果、密钥轮换记录。

### SE-IPSEC-001 跨地域链路加密

**规范依据:** TS 33.501 网络域安全原则，IPSec/IKEv2，国密 IPSec 按项目适配  
**专用环境:** 两站点核心网或 UPF/SMF 跨地域部署，安全网关。

**正常流程**

1. 建立站点 A 和站点 B 的 IPSec 隧道。
2. 核心网跨站点接口通过隧道通信。
3. UE 注册并建立 PDU Session。
4. 抓取外层链路，确认业务被加密封装。

**预期结果**

- 隧道建立成功。
- 核心网业务正常。
- 外层抓包不可见明文 NAS/SBI/PFCP 业务内容。

**异常流程**

- 证书过期、预共享密钥错误、隧道断开。

**异常预期**

- 跨站点业务中断或降级，NMS 告警。
- 不自动走未加密旁路，除非配置明确允许。

**证据**

- IPSec SA 状态、外层抓包、核心网接口连通性、告警。

### SE-DEF-001 违规外联检测与阻断

**规范依据:** TS 23.501 UPF traffic handling，TS 29.244 转发规则，SA5 告警管理  
**专用环境:** UPF 五元组采集、流量镜像或安全检测平台，策略下发能力。

**正常流程**

1. 配置允许网段、禁止网段和端口策略。
2. UE 访问允许地址。
3. UE 访问禁止地址和禁止端口。
4. 系统告警并阻断违规流量。

**预期结果**

- 合法流量通过。
- 违规流量被记录 SUPI、DNN、五元组、时间、策略 ID。
- 阻断规则生效，后续同类流量无法通过。

**异常流程**

- 配置重叠策略、IPv6 等价地址、端口跳变、短连接爆发。

**异常预期**

- 策略优先级明确。
- IPv4/IPv6 均覆盖。
- 高速短连接不绕过检测。

**证据**

- UPF 流日志、NMS 告警、阻断前后抓包、策略配置。

### SE-DEF-002 异常信令检测

**规范依据:** TS 24.501 NAS，TS 38.413 NGAP，TS 29.244 PFCP，SA5 告警管理  
**专用环境:** NAS/NGAP/PFCP 异常信令模拟器或可控测试工具。

**正常流程**

1. 建立合法 UE 注册和 PDU Session。
2. 启动异常信令模拟器，发送异常 NAS、重复 Service Request、畸形 NGAP 或 PFCP 消息。
3. 观察 AMF/SMF/UPF 处理和告警。

**预期结果**

- 合法 UE 业务不受明显影响。
- 异常消息被拒绝、丢弃或计数。
- NMS 产生异常信令告警并关联来源。

**异常流程**

- 提高异常信令速率到阈值以上。

**异常预期**

- 过载保护或限速生效。
- 进程不崩溃，内存和 CPU 不失控。
- 告警合并避免告警风暴。

**证据**

- 异常消息样本、NF 日志、CPU/内存曲线、告警记录。

### SE-DEF-003 过载与 DDoS 防护

**规范依据:** TS 23.501 overload control 原则，TS 24.501/29 系列异常处理，SA5 性能与告警  
**专用环境:** UE/RAN 信令压测仪、N6 DDoS 流量仪、监控平台。

**正常流程**

1. 建立基线负载，例如 30% 目标容量。
2. 逐步提升注册、PDU Session、Service Request 或 N6 流量。
3. 达到阈值后观察限流、拒绝、退避或过载通知。
4. 降低负载，观察恢复。

**预期结果**

- 过载阈值触发后系统保护关键服务。
- 合法已在线 UE 尽量保持业务。
- 过载解除后系统自动恢复。

**异常流程**

- 阈值配置过低或过高，或攻击流量伪装成合法 UE。

**异常预期**

- 阈值过低会产生误伤告警。
- 阈值过高不得导致核心进程崩溃。
- 系统能区分持续攻击和瞬时尖峰。

**证据**

- TPS/吞吐曲线、拒绝 cause 分布、CPU/内存、告警和恢复时间。

### SE-IMS-001 SIP 终端接入与互通

**规范依据:** TS 23.501 IMS voice support，IMS/SIP 相关 3GPP 规范族，SIP RFC 3261  
**专用环境:** IMS Core、SBC、SIP 话机/门禁、5GC IMS DNN。

**正常流程**

1. 配置 IMS DNN、P-CSCF 地址和路由。
2. SIP 终端通过专网接入 IMS。
3. SIP 终端完成 REGISTER。
4. SIP 终端呼叫 VoNR/VoLTE UE 或另一 SIP 终端。

**预期结果**

- SIP REGISTER 成功。
- INVITE/180/200/ACK/BYE 流程完整。
- RTP 双向媒体可达。
- 5GC 侧 IMS DNN 和 QoS 策略正确。

**异常流程**

- SIP 鉴权失败、SBC 不可达、NAT 配置错误、RTP 端口被阻断。

**异常预期**

- 注册或呼叫失败原因明确。
- 失败不影响普通数据 DNN。
- NMS 可定位 IMS DNN、SBC 或媒体路径问题。

**证据**

- SIP 抓包、RTP 抓包、IMS 日志、SMF/UPF 会话日志。

### SE-IMS-002 VoNR/VoLTE 与 P-CSCF 下发

**规范依据:** TS 23.501 IMS voice over PS，TS 23.502 PDU Session，TS 24.501 PCO/5GSM  
**专用环境:** VoNR/VoLTE 终端、IMS Core、P-CSCF。

**正常流程**

1. UE 注册 5GS。
2. UE 建立 IMS PDU Session。
3. SMF 通过 PCO 或等效机制下发 P-CSCF。
4. UE 执行 IMS 注册。
5. 发起 VoNR/VoLTE 呼叫。

**预期结果**

- IMS PDU Session 成功。
- UE 获取正确 P-CSCF。
- IMS 注册和呼叫成功。
- QoS/5QI 与语音业务策略一致。

**异常流程**

- IMS DNN 未签约、P-CSCF 地址错误、IMS Core 不可达。

**异常预期**

- 未签约 DNN 被拒绝。
- P-CSCF 错误导致 IMS 注册失败但 PDU Session 行为可解释。
- NMS 告警指向 IMS 配置问题。

**证据**

- NAS 5GSM/PCO、SIP 注册、SMF 策略、RTP 媒体质量。

### SE-IMS-003 PSTN/运营商网络互通

**规范依据:** IMS/PSTN 互通规范族，TS 23.501 5GC 与 IMS 锚点能力  
**专用环境:** IMS Core、SBC、媒体网关、PSTN 或运营商互联测试环境。

**正常流程**

1. 专网 UE 或 SIP 终端完成 IMS 注册。
2. 拨打 PSTN 测试号码。
3. 完成呼叫建立、媒体协商、通话、释放。
4. 测试外部 PSTN 呼入专网号码。

**预期结果**

- 呼出和呼入均成功。
- 编解码协商符合配置。
- 媒体双向可达，通话释放正常。
- 主备 SBC/MGW 场景可保持或快速恢复。

**异常流程**

- 路由缺失、号码格式错误、编解码不匹配、媒体网关主节点故障。

**异常预期**

- 返回明确 SIP cause 或运营商侧 cause。
- 不产生单通、僵尸会话或计费残留。
- 主备切换时告警和恢复时间可追踪。

**证据**

- SIP ladder、RTP 质量、SBC/MGW 日志、呼叫详单。

### SE-PERF-001 性能采集、补采、报表与门限

**规范依据:** TS 28.554 KPI，SA5 性能管理规范族  
**专用环境:** NMS、Prometheus/Grafana 或等效性能平台，统一 NTP 时间。

**正常流程**

1. 创建性能测量任务：注册成功率、PDU Session 成功率、UPF 吞吐、PFCP 心跳、切片会话数。
2. 运行固定负载 30 分钟。
3. 暂停采集进程 5 分钟后恢复。
4. 执行补采或生成缺口标记。
5. 配置门限并触发告警。

**预期结果**

- 报表按网元、切片、DNN、时间粒度展示。
- 补采成功或缺口明确标记。
- 门限告警包含指标、阈值、实际值、持续时间。

**异常流程**

- 指标源不可达、时间回拨、重复上报、采样延迟。

**异常预期**

- 系统不写入错误时间序列。
- 重复数据被去重或标记。
- 指标源故障产生采集告警。

**证据**

- 原始 metrics、报表导出、告警记录、NTP 状态。

### SE-PERF-002 容量与并发

**规范依据:** TS 28.554 KPI，项目容量指标  
**专用环境:** UE/RAN 仿真器、流量仪、多核服务器、独立数据库和监控。

**正常流程**

1. 设定容量目标，例如并发注册 UE 数、PDU Session 数、N6 吞吐、PFCP 会话数。
2. 阶梯式增加 UE 注册速率。
3. 阶梯式建立 PDU Session。
4. 同时注入 N6 上下行业务。
5. 稳态运行不少于项目约定时间。

**预期结果**

- 注册成功率、会话成功率、吞吐和时延满足目标。
- CPU、内存、数据库连接、PFCP 心跳无异常。
- 业务结束后会话释放干净。

**异常流程**

- 超过容量目标继续加压，或重启单个 NF。

**异常预期**

- 系统进入可控过载，返回合理 cause。
- 不发生不可恢复崩溃。
- 负载恢复后系统回到正常状态。

**证据**

- 压测脚本、TPS 曲线、成功率、资源曲线、失败 cause 分布、恢复时间。

---

## 6. 执行优先级

| 优先级 | 用例 |
| --- | --- |
| P0 专网核心专项 | SE-HA-002、SE-HA-003、SE-WL 相关普通手册用例、SE-DEF-001、SE-PERF-001 |
| P1 高可靠/安全增强 | SE-HO-001、SE-HO-002、SE-RED-001、SE-RED-002、SE-GM-001、SE-GM-002、SE-HSM-001、SE-DEF-002、SE-DEF-003 |
| P2 互操作/容量专项 | SE-HO-003、SE-RED-003、SE-GM-003、SE-IPSEC-001、SE-IMS-001、SE-IMS-002、SE-IMS-003、SE-PERF-002 |

---

## 7. 专项测试准入与退出

### 7.1 准入条件

- 基础手册中的 P0 用例已通过，至少包括注册、PDU Session、N3/N6、PFCP、5G-LAN 基础流量。
- 所有专用设备的版本、授权、配置、时间同步已确认。
- 故障注入方案经过评审，明确恢复步骤。
- 抓包、日志、KPI、NMS 告警路径已预演。

### 7.2 退出条件

- 每个已执行用例都有结论、证据目录、失败项和复测建议。
- 未执行用例必须说明缺少的设备、软件或外部系统。
- S1/S2 缺陷有明确归属和复测计划。
- 测试报告包含正常流程、异常流程和指标统计。

### 7.3 建议证据目录

```text
test-results-special/
  00-env/
    topology.png
    versions.txt
    configs.tar.gz
  01-logs/
    amf.log
    smf.log
    upf-a.log
    upf-b.log
    nms.log
  02-pcaps/
    n2.pcap
    n3-before-after.pcap
    n4.pcap
    n6.pcap
    sip-ims.pcap
  03-kpi/
    latency.csv
    packet-loss.csv
    nf-metrics.json
  04-reports/
    summary.md
    defects.md
```

---

## 8. 与基础测试手册的关系

本手册不替代 `control-point-functional-test-manual-3gpp.md`。建议执行顺序为：

1. 先执行基础手册 P0，证明 Open5GS 基础 5GC、PDU Session、PFCP、用户面、5G-LAN 基础能力可用。
2. 再执行本手册中对应专项环境用例。
3. 若专项失败，先用基础手册中的最小用例隔离是基础功能故障还是专用环境故障。
4. 专项报告中引用基础用例结果，避免重复描述。

