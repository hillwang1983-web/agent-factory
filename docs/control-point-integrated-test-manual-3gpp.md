# 5GC 控标点综合测试手册

**数据来源:** Google Drive `5GC产品功能清单及控标点-20260402.xlsx` 的 `功能细分` 列  
**规范参考日期:** 2026-05-23  
**规范锚点:** 以 3GPP Release 19 为稳定测试锚点，兼顾 Release 20 增强项  
**测试对象:** Open5GS 5GC、Open5GS-NMS、UERANSIM、5G-LAN、专用 RAN/UE/IMS/安全/性能环境  
**测试原则:** 104 个独立功能细分均有明确测试用例编号，覆盖正常流程、异常流程、可观测证据和判定标准；原 Excel 105 行中有 1 行为非独立功能明细或合并说明行，覆盖矩阵按 104 个可测试功能点统计。  
**用例编号说明:** `TC-*` 为基础/主流程用例，`SE-*` 为强依赖专用环境的用例，`CC-*` 为覆盖增强用例；环境分类仅使用 `通用环境` 和 `专用环境` 两类，编号不作为文档分册依据。

---

## 1. 文档说明与交付范围

本手册面向 5GC 控标点验收和回归测试交付，按功能域组织测试内容，避免按来源材料或历史分册拆分。每个用例均给出规范依据、前置条件、正常流程、异常流程、预期结果和证据要求，可用于实验室测试、专网专项验收和产品版本回归。

交付范围包括：

1. 5GC 注册、连接、会话、用户面、PFCP、QoS、切片和 SBI 基础流程。
2. 5G-LAN、工业专网、UPF 高可用、双发选收、TSN 和下挂设备发现。
3. 白名单、国密、HSM、安全存储、异常信令、违规外联和过载防护。
4. RedCap、Cat.1、NB-IoT、IMS、短信、语音和互操作业务。
5. OAM、部署升级、性能容量、日志审计、UDM 开户与大网数据同步。

## 2. 3GPP 参考基线

| 领域 | 主要规范 | 用途 |
| --- | --- | --- |
| 5GS 架构 | TS 23.501 | AMF/SMF/UPF/UDM/PCF/NRF/NSSF、PDU Session、QoS、切片、5G LAN 架构依据 |
| 5GS 流程 | TS 23.502 | 注册、去注册、业务请求、PDU Session 建立/修改/释放、寻呼、切片选择流程依据 |
| 策略与 QoS | TS 23.503 | PCC、QoS Flow、QoS Rule、AMBR/MFBR、切片策略依据 |
| NAS 协议 | TS 24.501 | 5GMM/5GSM、注册拒绝、会话拒绝、去注册、NAS 安全流程依据 |
| SBI 接口 | TS 29.500/29.502/29.503/29.510/29.512 | AMF/SMF/UDM/PCF/NRF 服务接口与异常响应依据 |
| PFCP/N4 | TS 29.244 | PFCP Association、Session Establishment/Modification/Deletion、PDR/FAR/QER/URR 依据 |
| NGAP/N2 | TS 38.413 | NG Setup、UE Context、PDU Session Resource、Paging、Handover 信令依据 |
| 安全 | TS 33.501 | SUPI/SUCI、鉴权、NAS 安全、用户面安全、密钥派生依据 |
| 管理与 KPI | TS 28.554 等 SA5 规范 | 性能采集、KPI、网管验收依据 |

> 说明：当前 3GPP Portal 显示 TS 23.501 Release 19 最新可见版本为 19.7.0，Release 20 已有 20.1.0；测试验收建议以 Release 19 为稳定基线，Release 20 作为增强项跟踪。

## 3. 测试环境、准入与证据要求

### 3.1 通用环境

| 组件 | 用途 |
| --- | --- |
| Open5GS NRF/AMF/SMF/UPF/AUSF/UDM/UDR/PCF/NSSF | 5GC 被测系统 |
| Open5GS-NMS | 用户、DNN、切片、策略、安全与运维配置面 |
| MongoDB | 订阅数据、策略与测试数据存储 |
| UERANSIM | gNB/UE、注册、PDU Session、切片和 NAS 流程模拟 |
| `tests/5glan/` | Ethernet PDU、5G-LAN L2/L3、UPF HA 相关测试资产 |
| tcpdump/tshark/scapy | N2/NAS/N4/N3/N6/以太网帧抓包与断言 |
| curl/jq | SBI、NMS API、Prometheus/metrics 验证 |

### 3.2 专用环境

| 环境类别 | 典型资源 | 适用用例 |
| --- | --- | --- |
| RAN/切换 | 支持 Xn/N2 切换的双 gNB、4G/5G 互操作环境 | SE-HO、CC-RAN |
| 高可靠用户面 | 双 UPF、双链路、故障注入、同步网络 | TC-HA、SE-HA、SE-RED |
| 工业以太网 | 5G-LAN 终端、交换机、VLAN、组播、PTP/TSN 设备 | TC-5GLAN、CC-MCAST、CC-VLAN、SE-TSN |
| 安全/密码 | 国密 USIM、密码机/HSM、IPSec 网关、安全审计系统 | SE-GM、SE-HSM、SE-IPSEC、SE-DEF |
| IMS/语音 | IMS Core、SBC/MGW、SMSC、PSTN 或运营商互通模拟器 | TC-IMS、SE-IMS、CC-IMS |
| 性能容量 | 批量 UE/gNB 模拟器、流量发生器、KPI/告警采集平台 | TC-OAM、SE-PERF |

### 3.3 启动检查

```bash
cd /work/open5gs-src

open5gs-nrfd --version
open5gs-amfd --version
open5gs-smfd --version
open5gs-upfd --version

sudo ss -lntup | grep -E '7777|38412|8805|2152'
curl -s http://127.0.0.10:7777/nnrf-nfm/v1/nf-instances | jq .
```

**通过标准**

- NRF、AMF、SMF、UPF、AUSF、UDM、UDR、PCF 进程启动。
- AMF 监听 N2/SCTP，UPF 监听 N4/PFCP 和 N3/GTP-U。
- NRF 可查询到已注册 NF。

### 3.4 准入与退出

**准入条件**

- 基础 5GC 冒烟用例已通过，至少包括注册、PDU Session、N3/N6、PFCP。
- 专用设备的版本、授权、配置、时间同步和恢复方案已确认。
- 抓包、日志、KPI、NMS 告警和测试报告目录已预演。

**退出条件**

- 每个已执行用例都有结论、证据目录、失败项和复测建议。
- 未执行用例说明缺少的设备、软件、外部系统或替代证据。
- S1/S2 缺陷有明确归属和复测计划。

### 3.5 证据目录建议

```text
test-results-control-point/
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

## 4. 测试用例索引

| 功能域 | 用例编号 | 用例名称 | 环境类型 |
| --- | --- | --- | --- |
| 接入与移动性 | TC-REG-001 | 初始注册 | 通用环境 |
| 接入与移动性 | TC-REG-002 | 去注册 | 通用环境 |
| 接入与移动性 | TC-REG-003 | TAI List 与移动性限制 | 通用环境 |
| 接入与移动性 | TC-CONN-001 | CM 状态转换与 NAS 连接 | 通用环境 |
| 接入与移动性 | TC-SR-001 | Service Request | 通用环境 |
| 接入与移动性 | TC-PAGE-001 | 下行数据寻呼 | 通用环境 |
| 接入与移动性 | SE-HO-001 | Xn 切换 | 专用环境 |
| 接入与移动性 | SE-HO-002 | N2 切换 | 专用环境 |
| 接入与移动性 | SE-HO-003 | 4G/5G 互操作 | 专用环境 |
| 接入与移动性 | CC-AMF-001 | AMF 负载均衡、重定向与隐式去注册 | 通用环境 |
| 接入与移动性 | CC-AM-001 | AM Policy Association 与移动性策略下发 | 通用环境 |
| 会话管理、用户面与 PFCP | TC-PDU-001 | PDU Session 建立、修改、释放 | 通用环境 |
| 会话管理、用户面与 PFCP | TC-PDU-002 | IPv4/IPv6/IPv4v6 会话类型 | 通用环境 |
| 会话管理、用户面与 PFCP | TC-PDU-003 | Ethernet PDU Session | 通用环境 |
| 会话管理、用户面与 PFCP | TC-UP-001 | N3/N6 数据转发 | 通用环境 |
| 会话管理、用户面与 PFCP | TC-NAT-001 | N6 NAT | 通用环境 |
| 会话管理、用户面与 PFCP | TC-PFCP-001 | PFCP Association 与心跳 | 通用环境 |
| 会话管理、用户面与 PFCP | TC-PFCP-002 | PDR/FAR/QER 规则下发 | 通用环境 |
| 会话管理、用户面与 PFCP | CC-PDU-001 | SSC Mode 1 IP 保持专项 | 通用环境 |
| 会话管理、用户面与 PFCP | CC-PDU-002 | SSC Mode 2 / LADN 区域会话专项 | 通用环境 |
| 会话管理、用户面与 PFCP | CC-PDU-003 | SSC Mode 3 / MA PDU Session 专项 | 专用环境 |
| 会话管理、用户面与 PFCP | CC-DDN-001 | IDLE 下行缓存与 N4 下行数据通知专项 | 通用环境 |
| 会话管理、用户面与 PFCP | CC-ENDM-001 | End Marker 生成和转发专项 | 通用环境 |
| 会话管理、用户面与 PFCP | CC-UPF-001 | N9 多 UPF / UL CL 分流专项 | 专用环境 |
| 会话管理、用户面与 PFCP | CC-URR-001 | PFCP URR 用量上报专项 | 通用环境 |
| 策略、计费、切片与能力开放 | TC-QOS-001 | QoS 与包过滤 | 通用环境 |
| 策略、计费、切片与能力开放 | TC-SLICE-001 | 切片选择与 DNN 绑定 | 通用环境 |
| 策略、计费、切片与能力开放 | TC-SLICE-002 | 切片准入控制 | 通用环境 |
| 策略、计费、切片与能力开放 | CC-PCF-001 | SM Policy Association 与动态 PCC 推送 | 通用环境 |
| 策略、计费、切片与能力开放 | CC-CHG-001 | Nchf 计费接口与 CDR 专项 | 通用环境 |
| 策略、计费、切片与能力开放 | CC-AF-001 | AF/NEF 流量影响 Traffic Influence | 通用环境 |
| 策略、计费、切片与能力开放 | CC-OAM-001 | UE 事件订阅、外部 UE 信息输入、外部 QoS 请求 | 通用环境 |
| 5G-LAN、工业专网与高可靠 | TC-5GLAN-001 | 5G LAN 二层组网 | 通用环境 |
| 5G-LAN、工业专网与高可靠 | TC-5GLAN-002 | VLAN 透传 | 通用环境 |
| 5G-LAN、工业专网与高可靠 | TC-5GLAN-003 | 二层三层互通与后路由 | 通用环境 |
| 5G-LAN、工业专网与高可靠 | TC-HA-001 | 5G LAN 用户面 HA | 通用环境 |
| 5G-LAN、工业专网与高可靠 | TC-DEV-001 | 下挂设备发现 | 通用环境 |
| 5G-LAN、工业专网与高可靠 | SE-HA-001 | AMF Set/MME Pool 冗余与负载分担 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | SE-HA-002 | UPF 主备切换 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | SE-HA-003 | 5G-LAN MAC/组播状态同步 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | SE-RED-001 | 单基站双发选收 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | SE-RED-002 | 双基站双发选收 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | SE-RED-003 | 20ms/99.999% 可靠性指标 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | CC-MCAST-001 | IPv4/IPv6 组播、IGMP/MLD 专项 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | CC-VLAN-001 | 802.1Q VLAN 透传专项 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | CC-L2ROBUST-001 | MAC 老化、广播风暴抑制、环路检测 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | CC-RAN-001 | 切片 RB 资源预留/动态共享 | 专用环境 |
| 5G-LAN、工业专网与高可靠 | SE-TSN-001 | TSN / IEEE 802.1AS 工业时间同步 | 专用环境 |
| 安全、准入控制与防护 | TC-WL-001 | 终端白名单与 USIM-IMEI 绑定 | 通用环境 |
| 安全、准入控制与防护 | TC-WL-002 | 基站白名单 | 通用环境 |
| 安全、准入控制与防护 | TC-SEC-001 | SUCI、鉴权与 NAS 安全 | 通用环境 |
| 安全、准入控制与防护 | TC-SEC-002 | 违规外联检测、告警与阻断 | 通用环境 |
| 安全、准入控制与防护 | SE-GM-001 | 国密 SUCI | 专用环境 |
| 安全、准入控制与防护 | SE-GM-002 | 国密 AKA 双向鉴权 | 专用环境 |
| 安全、准入控制与防护 | SE-GM-003 | ZUC/NAS/用户面安全 | 专用环境 |
| 安全、准入控制与防护 | SE-HSM-001 | 数据安全存储与密码机 | 专用环境 |
| 安全、准入控制与防护 | SE-IPSEC-001 | 跨地域链路加密 | 专用环境 |
| 安全、准入控制与防护 | SE-DEF-001 | 违规外联检测与阻断 | 专用环境 |
| 安全、准入控制与防护 | SE-DEF-002 | 异常信令检测 | 专用环境 |
| 安全、准入控制与防护 | SE-DEF-003 | 过载与 DDoS 防护 | 专用环境 |
| 物联网与特殊终端 | CC-REDCAP-001 | RedCap Indication、NR_REDCAP RAT、注册与移动性 | 专用环境 |
| 物联网与特殊终端 | CC-REDCAP-002 | RedCap eDRX 节电功能 | 专用环境 |
| 物联网与特殊终端 | CC-IOT-001 | LTE Cat.1 接入、移动性和路由优化 | 专用环境 |
| 物联网与特殊终端 | CC-IOT-002 | NB-IoT CP 模式、PSM/eDRX、速率控制 | 专用环境 |
| 语音、IMS 与短信 | TC-IMS-001 | IMS DNN 与 P-CSCF 下发 | 通用环境 |
| 语音、IMS 与短信 | SE-IMS-001 | SIP 终端接入与互通 | 专用环境 |
| 语音、IMS 与短信 | SE-IMS-002 | VoNR/VoLTE 与 P-CSCF 下发 | 专用环境 |
| 语音、IMS 与短信 | SE-IMS-003 | PSTN/运营商网络互通 | 专用环境 |
| 语音、IMS 与短信 | CC-IMS-001 | IMS 单节点集成形态 | 通用环境 |
| 语音、IMS 与短信 | CC-IMS-002 | IMS 2000 注册、500 路语音并发 | 专用环境 |
| 语音、IMS 与短信 | CC-IMS-003 | IMS UPDATE、业务触发、消息管理 | 通用环境 |
| 语音、IMS 与短信 | CC-IMS-004 | SMSC 多媒体短信 | 专用环境 |
| 语音、IMS 与短信 | CC-IMS-005 | EPS Fallback/RAT Fallback 与语音域选择 | 专用环境 |
| 语音、IMS 与短信 | CC-IMS-006 | IMS/SBC/MGW 主备冗余和负载均衡 | 专用环境 |
| 语音、IMS 与短信 | CC-IMS-007 | 呼叫前转到第三方网络 | 专用环境 |
| 运维、部署、兼容性与数据同步 | TC-OAM-001 | 配置查询、导入、导出、同步与激活 | 通用环境 |
| 运维、部署、兼容性与数据同步 | TC-OAM-002 | 日志、接口跟踪与用户跟踪 | 通用环境 |
| 运维、部署、兼容性与数据同步 | TC-OAM-003 | 性能采集、补采、报表与门限 | 通用环境 |
| 运维、部署、兼容性与数据同步 | TC-DEP-001 | 一键部署与一键升级 | 通用环境 |
| 运维、部署、兼容性与数据同步 | SE-PERF-001 | 性能采集、补采、报表与门限 | 专用环境 |
| 运维、部署、兼容性与数据同步 | SE-PERF-002 | 容量与并发 | 专用环境 |
| 运维、部署、兼容性与数据同步 | CC-STD-001 | 3GPP 版本一致性和能力声明 | 通用环境 |
| 运维、部署、兼容性与数据同步 | CC-SBI-001 | SBA/SBI 全接口服务发现、鉴权和异常响应 | 通用环境 |
| 运维、部署、兼容性与数据同步 | CC-FUSION-001 | 4G/5G 融合网元产品形态 | 专用环境 |
| 运维、部署、兼容性与数据同步 | CC-COMP-001 | X86/ARM 服务器部署 | 通用环境 |
| 运维、部署、兼容性与数据同步 | CC-COMP-002 | 国产 OS、达梦数据库、自主 CPU | 专用环境 |
| 运维、部署、兼容性与数据同步 | CC-DEP-001 | 虚拟机部署兼容矩阵 | 通用环境 |
| 运维、部署、兼容性与数据同步 | CC-DEP-002 | 5GC/EPC 网元下沉和逐网元健康验收 | 通用环境 |
| 运维、部署、兼容性与数据同步 | CC-DEP-003 | 容器化 / Kubernetes 部署冒烟 | 专用环境 |
| 运维、部署、兼容性与数据同步 | CC-LMT-001 | 本地 LMT 页面全流程 | 通用环境 |
| 运维、部署、兼容性与数据同步 | CC-LOG-001 | OMC 操作日志、安全事件日志保护 | 通用环境 |
| 运维、部署、兼容性与数据同步 | CC-UDM-001 | UDM 开户、APN/DNN 签约、速率设置 UI/API | 通用环境 |
| 运维、部署、兼容性与数据同步 | CC-UDM-002 | 大网开户数据与本地专网数据同步 | 专用环境 |

---

## 5. 接入与移动性测试用例

覆盖注册、去注册、连接管理、业务请求、寻呼、切换、互操作、AMF 负载均衡与移动性策略。

### TC-REG-001 初始注册

**规范依据:** TS 23.502 注册流程，TS 24.501 5GMM，TS 33.501 鉴权与 NAS 安全  
**前置条件:** UDM 中存在合法 SUPI，AMF/UDM/AUSF 可用，gNB 已完成 NG Setup。  
**本地自动化:** `open5gs/tests/regression/core-p0/test_core_p0.py`

**正常流程**

1. 启动合法 UE，发起 Registration Request。
2. AMF 触发 AUSF/UDM 鉴权并建立 NAS 安全上下文。
3. AMF 返回 Registration Accept，包含 Allowed NSSAI、TAI List、GUTI。
4. UE 返回 Registration Complete。

**预期结果**

- UE 进入 `5GMM-REGISTERED`。
- AMF 日志显示 `Registration complete`。
- NAS 抓包包含 Registration Accept/Complete。
- NMS/数据库可查询 UE 注册状态。

**异常流程**

1. 删除该 SUPI 或配置错误 K/OPc。
2. 再次发起注册。

**异常预期**

- 网络返回 Registration Reject 或鉴权失败。
- AMF/AUSF 日志包含失败 Cause。
- 不创建 PDU Session，不分配 IP。

### TC-REG-002 去注册

**规范依据:** TS 23.502 Deregistration，TS 24.501 5GMM Deregistration  

**正常流程**

1. UE 注册并建立 PDU Session。
2. UE 发起 Deregistration Request。
3. AMF 释放 UE Context，并触发 SMF/UPF 释放会话。
4. UE 收到 Deregistration Accept。

**预期结果**

- AMF UE Context 被删除或进入去注册状态。
- SMF 释放会话，UPF 收到 PFCP Session Deletion。
- N6 不再转发该 UE 流量。

**异常流程**

- 对未知 SUPI 或已去注册 UE 再次发起去注册。

**异常预期**

- 系统幂等处理，不崩溃。
- 返回合理 NAS Cause 或仅记录警告。

### TC-REG-003 TAI List 与移动性限制

**规范依据:** TS 23.501 Mobility restrictions，TS 23.502 Registration Area 管理  

**正常流程**

1. 为 UE 签约允许 PLMN/TAC。
2. UE 从合法 gNB/TAC 注册。
3. 检查 Registration Accept 中 TAI List。

**预期结果**

- TAI List 与 AMF 配置/签约一致。
- UE 可在允许区域内周期性注册更新。

**异常流程**

1. 将 UE 接入禁止 TAC 或不支持 TAI。
2. 发起注册或移动性注册更新。

**异常预期**

- AMF 返回禁止区域或不允许服务相关 Cause。
- 日志记录 SUPI、TAC、拒绝原因。

### TC-CONN-001 CM 状态转换与 NAS 连接

**规范依据:** TS 23.501 Connection Management，TS 24.501 NAS-MM  

**正常流程**

1. UE 注册后释放 RRC/NAS 信令连接，进入 CM-IDLE。
2. UE 主动发起上行业务或 NAS 消息。
3. AMF 恢复 N2 UE Context，UE 进入 CM-CONNECTED。

**预期结果**

- AMF 状态从 CM-IDLE 转为 CM-CONNECTED。
- UE Context 与 PDU Session 绑定保持正确。

**异常流程**

- 删除 AMF 中 UE Context 后让 UE 发起 Service Request。

**异常预期**

- AMF 触发重新注册或上下文恢复失败处理。
- 不产生空指针、重复会话或错误 UPF 规则。

### TC-SR-001 Service Request

**规范依据:** TS 23.502 Service Request，TS 24.501 Service Request  

**正常流程**

1. UE 注册并建立 PDU Session。
2. UE 进入 CM-IDLE。
3. UE 发送上行数据，触发 Service Request。
4. AMF/SMF 恢复用户面路径。

**预期结果**

- UE 用户面恢复，ping 或 TCP 连接成功。
- UPF 规则不重复创建，PDR/FAR 仍唯一有效。

**异常流程**

- 删除 SMF 会话后让 UE 发起 Service Request。

**异常预期**

- 网络拒绝或触发 PDU Session 重新建立。
- 日志中可定位会话不存在原因。

### TC-PAGE-001 下行数据寻呼

**规范依据:** TS 23.502 Paging，TS 38.413 Paging  

**正常流程**

1. UE 注册并建立 PDU Session 后进入 CM-IDLE。
2. DN 侧向 UE IP 发送下行数据。
3. UPF/SMF/AMF 触发 Paging。
4. UE 响应后恢复用户面。

**预期结果**

- N2 抓包出现 Paging。
- UE 被寻呼后恢复下行转发。
- 下行数据缓存或通知流程符合配置。

**异常流程**

- UE 启用 MICO 或模拟不可达。

**异常预期**

- 系统不无限重试。
- 记录不可达状态、缓存策略或丢弃策略。

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

### CC-AMF-001 AMF 负载均衡、重定向与隐式去注册

**覆盖:** AMF Load Re-balancing、NRF 引导到备用 AMF、网络侧隐式去注册。  
**规范依据:** TS 23.501 AMF Set 和 AMF re-allocation，TS 23.502 registration management。  
**前置条件:** 至少两个 AMF 实例，NRF 可用，gNB 支持多 AMF 或 AMF Set。

**正常流程**

1. 启动 AMF-A 和 AMF-B，并注册到 NRF。
2. 批量启动 UE，观察初始注册在 AMF 间分布。
3. 提高 AMF-A 负载或设置 AMF-A 为 draining。
4. 新 UE 注册应被引导到 AMF-B。
5. 对长期不可达 UE 等待隐式去注册定时器超时。

**预期结果**

- 新注册 UE 按负载策略选择 AMF。
- AMF-A draining 后不再承接新 UE。
- 不可达 UE 超时后由网络侧清理上下文和会话。

**异常流程**

- AMF-B 不可用、NRF 返回过期 NFProfile、隐式去注册时 SMF 不可达。

**异常预期**

- AMF 选择失败有明确日志。
- 去注册清理可重试，不留下永久残留会话。

### CC-AM-001 AM Policy Association 与移动性策略下发

**覆盖:** 注册过程中建立 AM 策略关联，下发服务区域限制等移动性策略。  
**规范依据:** TS 23.502 AM Policy Association，TS 29.507 Npcf_AMPolicyControl。  
**前置条件:** PCF 可用，UE 签约移动性限制策略。

**正常流程**

1. UE 发起注册。
2. AMF 向 PCF 建立 AM Policy Association。
3. PCF 返回服务区域限制、RAT 限制或 RFSP 等策略。
4. AMF 在注册接受或后续移动性流程中执行策略。

**预期结果**

- SBI 抓包或日志显示 AM Policy Association 创建成功。
- 策略内容与 PCF 配置一致。
- UE 在允许区域成功，在禁止区域被拒绝或受限。

**异常流程**

- PCF 不可用、策略冲突、PCF 返回非法区域。

**异常预期**

- AMF 按本地策略降级或拒绝。
- 策略冲突有明确告警。

---

---

---

## 6. 会话管理、用户面与 PFCP 测试用例

覆盖 PDU Session、SSC、LADN、MA PDU Session、N3/N6/N9、PFCP、URR、End Marker 与下行数据通知。

### TC-PDU-001 PDU Session 建立、修改、释放

**规范依据:** TS 23.502 PDU Session Establishment/Modification/Release，TS 24.501 5GSM  
**本地自动化:** `open5gs/tests/regression/core-p0/test_core_p0.py`

**正常流程**

1. UE 请求 DNN `internet`、S-NSSAI `sst=1` 建立 IPv4 PDU Session。
2. SMF 选择 UPF 并下发 PFCP 规则。
3. UE 获取 IP。
4. 修改会话 QoS 或用户面路径。
5. 释放会话。

**预期结果**

- NAS 返回 PDU Session Establishment Accept。
- N4 有 PFCP Session Establishment/Modification/Deletion。
- IP 分配、路由和 N6 转发正常。

**异常流程**

- 请求未签约 DNN、未签约切片或不存在的 DNN。

**异常预期**

- UE 收到 PDU Session Establishment Reject。
- SMF 不创建 UPF 残留会话。

### TC-PDU-002 IPv4/IPv6/IPv4v6 会话类型

**规范依据:** TS 23.501 PDU Session Type，TS 24.501 5GSM Cause  
**本地自动化:** `open5gs/tests/regression/core-p0/test_core_p0.py`

**正常流程**

1. 分别配置 IPv4、IPv6、IPv4v6 DNN。
2. UE 分别请求对应会话类型。
3. 验证 IP 分配、路由、DNS、N6 连通。

**预期结果**

- IPv4 获取 IPv4 地址。
- IPv6 获取 IPv6 prefix 或地址。
- IPv4v6 同时获取 IPv4 和 IPv6 参数。

**异常流程**

- UE 请求网络未配置的会话类型。

**异常预期**

- 网络返回不支持 PDU Session Type 或相关 5GSM Cause。

### TC-PDU-003 Ethernet PDU Session

**规范依据:** TS 23.501 Ethernet PDU Session，TS 23.502 Session Management，TS 29.244 Ethernet PDR 匹配  
**本地自动化:** `open5gs/tests/5glan/test_l2_switch.py`

**正常流程**

1. 初始化 5G-LAN TAP 环境。
2. 导入 UE-A/UE-B 订阅数据。
3. 建立两个 Ethernet PDU Session。
4. UE-A 向 UE-B 发送单播以太网帧。

```bash
cd /work/open5gs-src
sudo bash tests/5glan/setup_env.sh
mongosh open5gs < tests/5glan/add_subscribers.js
sudo python3 tests/5glan/test_l2_switch.py
```

**预期结果**

- UE-A/UE-B 均建立 Ethernet PDU Session。
- 单播帧仅转发给目标 UE。
- 广播帧转发到组内 UE 和 N6 TAP。
- 未知 MAC 不错误泄漏到已知 UE。

**异常流程**

- 用 IP DNN 请求 Ethernet Session，或删除 `vn_group` 配置后建会话。

**异常预期**

- 会话建立被拒绝。
- SMF 日志指出 DNN/session type 不匹配或 VN Group 不存在。

### TC-UP-001 N3/N6 数据转发

**规范依据:** TS 23.501 UPF，TS 29.244 FAR/PDR  
**本地自动化:** `open5gs/tests/regression/core-p0/test_core_p0.py`

**正常流程**

1. UE 建立 IPv4 PDU Session。
2. UE ping N6 DN 主机。
3. DN 主机回 ping UE。
4. 抓取 N3 GTP-U 和 N6 明文包。

**预期结果**

- N3 包含正确 TEID。
- N6 包源/目的地址符合 DNN 路由或 NAT 配置。
- 往返丢包率为 0 或在环境允许范围内。

**异常流程**

- 删除 N6 路由或关闭 DN 接口。

**异常预期**

- 会话仍保持，但用户面不可达。
- UPF/系统日志可定位 N6 路由或接口错误。

### TC-NAT-001 N6 NAT

**规范依据:** TS 23.501 UPF data forwarding，TS 29.244 FAR forwarding behavior  

**正常流程**

1. DNN 启用 NAT。
2. UE 访问外部 DN。
3. 在 N6 抓包检查源地址。

**预期结果**

- N6 侧看到源地址为 UPF/N6 地址，不暴露 UE 私网地址。
- 回包能正确反向映射到 UE。

**异常流程**

- 关闭 NAT 后访问无回程路由的外部地址。

**异常预期**

- 上行包源地址为 UE 地址。
- 若 DN 无回程路由，回包失败但 UPF 不崩溃。

### TC-PFCP-001 PFCP Association 与心跳

**规范依据:** TS 29.244 PFCP Association Setup/Heartbeat  
**本地自动化:** `open5gs/tests/regression/core-p0/test_core_p0.py`

**正常流程**

1. 启动 UPF。
2. 启动 SMF。
3. 抓取 N4 PFCP。
4. 观察 Association Setup 和 Heartbeat。

**预期结果**

- SMF/UPF 完成 PFCP Association。
- Heartbeat 周期正常，Recovery Time Stamp 合理。

**异常流程**

- 阻断 SMF 到 UPF 的 UDP/8805。

**异常预期**

- SMF 标记 UPF 不可用。
- 新建会话不再选择故障 UPF。
- 恢复后可重新 Association。

### TC-PFCP-002 PDR/FAR/QER 规则下发

**规范依据:** TS 29.244 PDR/FAR/QER  
**本地自动化:** `open5gs/tests/regression/core-p0/test_core_p0.py`

**正常流程**

1. UE 建立 PDU Session。
2. 抓取 PFCP Session Establishment Request。
3. 检查 PDR、FAR、QER。
4. 发送匹配流量。

**预期结果**

- PDR 匹配 UE IP、TEID、DNN 或 Ethernet 过滤规则。
- FAR 指向正确 N3/N6 转发动作。
- QER 限速或 QoS 标记符合策略。

**异常流程**

- 配置非法 QoS 或缺失 FAR。

**异常预期**

- SMF 拒绝配置或 UPF 返回 PFCP Cause。
- 不产生半成功会话。

### CC-PDU-001 SSC Mode 1 IP 保持专项

**覆盖:** SSC Mode 1，会话释放/重建后 IP 地址保留。  
**规范依据:** TS 23.501 SSC mode 1，TS 23.502 PDU Session establishment/release，TS 24.501 5GSM。  
**前置条件:** UE 签约 SSC Mode 1，DNN 地址池支持保留策略。

**正常流程**

1. UE 建立 PDU Session，记录 IP 地址、DNN、PDU Session ID。
2. UE 释放 PDU Session。
3. 在保留窗口内重新建立同 DNN 会话。
4. 检查新会话 IP 地址。

**预期结果**

- 重新建立后 IP 地址与首次一致。
- SMF 日志显示 SSC Mode 1 或地址保留策略生效。

**异常流程**

- 超过保留时间后重建；地址池耗尽；用户签约不支持 SSC Mode 1。

**异常预期**

- 超时后可分配新地址并记录原因。
- 地址池耗尽返回明确 reject cause。
- 未签约用户不能获得 SSC Mode 1 保证。

### CC-PDU-002 SSC Mode 2 / LADN 区域会话专项

**覆盖:** SSC Mode 2、LADN 区域绑定、离开区域触发会话释放、重入区域重建。  
**规范依据:** TS 23.501 SSC mode 和 LADN，TS 23.502 PDU Session Establishment/Release。  
**前置条件:** 配置 LADN DNN、LADN 服务区域、UE 签约 SSC Mode 2。

**正常流程**

1. UE 在 LADN 服务区域内注册。
2. UE 请求 LADN DNN，建立 SSC Mode 2 PDU Session。
3. 验证 SMF 选择 LADN 区域内 UPF 或本地 DN。
4. UE 移动到 LADN 服务区域外。
5. 网络触发 PDU Session 释放或通知 UE 重新激活。
6. UE 重新进入 LADN 服务区域并重新建立会话。

**预期结果**

- 区域内 PDU Session 建立成功。
- 离开区域后会话按策略释放，NAS cause 与配置一致。
- 重入区域后可重新建立会话。
- 重建后 IP 地址不要求保持，区别于 SSC Mode 1。

**异常流程**

- UE 在 LADN 区域外直接请求 LADN DNN。
- UE 未签约 SSC Mode 2 但请求 LADN。

**异常预期**

- 会话建立被拒绝或转为默认策略。
- SMF/AMF 日志记录 TAI、LADN、DNN 和拒绝原因。

### CC-PDU-003 SSC Mode 3 / MA PDU Session 专项

**覆盖:** SSC Mode 3 多会话迁移、MA PDU Session 多接入连续性。  
**规范依据:** TS 23.501 SSC Mode 3、MA PDU Session，TS 23.502 session continuity procedures。  
**前置条件:** UE、AMF、SMF 和接入网支持 SSC Mode 3 或 MA PDU Session；至少两个可用接入或两个 PSA。

**正常流程 A: SSC Mode 3**

1. UE 建立原 PDU Session，记录 IP、UPF、PSA。
2. 网络因移动性、负载或策略触发建立新 PDU Session。
3. 新旧会话短时间并存。
4. 应用流迁移到新会话。
5. 旧会话释放。

**预期结果 A**

- 新旧会话并存期间业务不中断或中断在指标内。
- 旧会话释放后无残留 PDR/FAR/QER。

**正常流程 B: MA PDU Session**

1. UE 通过 3GPP 接入建立 PDU Session。
2. UE 增加非 3GPP 或第二接入路径。
3. 网络建立 MA PDU Session 关联。
4. 分别验证主路径、备用路径和路径切换。

**预期结果 B**

- 多接入路径状态可查询。
- 单路径故障时业务按策略切换。

**异常流程**

- 新 PSA 建立失败、第二接入鉴权失败、旧会话释放失败。

**异常预期**

- 网络回退到原会话或明确拒绝。
- 不出现重复 IP、重复计费或错误转发。

### CC-DDN-001 IDLE 下行缓存与 N4 下行数据通知专项

**覆盖:** IDLE 态下行数据缓存、UPF 向 SMF 发送下行数据通知。  
**规范依据:** TS 23.502 network triggered service request，TS 29.244 Downlink Data Report，TS 38.413 Paging。  
**前置条件:** UE 注册并建立 PDU Session，可进入 CM-IDLE；N4 抓包开启。

**正常流程**

1. UE 进入 CM-IDLE。
2. DN 向 UE 发送下行包。
3. UPF 缓存或按配置处理下行包。
4. UPF 向 SMF 发送 Downlink Data Report 或项目实现的等效通知。
5. SMF/AMF 触发 Paging，UE 恢复后下行包到达。

**预期结果**

- N4 抓包能看到下行数据通知。
- AMF 触发 Paging。
- UE 恢复后下行业务可达。

**异常流程**

- 禁用缓存、缓存队列满、UE 不可达。

**异常预期**

- 系统按策略丢弃或限量缓存。
- 告警/日志记录缓存满或 UE 不可达。

### CC-ENDM-001 End Marker 生成和转发专项

**覆盖:** UPF 或 SMF 生成 End Marker。  
**规范依据:** TS 23.502 切换和路径切换过程中的 End Marker handling，TS 29.281 GTP-U End Marker，TS 29.244 PFCP FAR/PDR 更新。  
**前置条件:** 支持切换或路径切换的 RAN/UPF 环境，N3 抓包开启。

**正常流程**

1. UE 建立 PDU Session 并持续下行业务。
2. 触发 Xn/N2 切换或 UPF 路径切换。
3. 源路径停止转发用户数据。
4. 源 UPF 或 SMF 控制的节点发送 End Marker。
5. 目标路径继续承载业务。

**预期结果**

- N3 抓包中出现 End Marker 或项目定义的等效路径结束标识。
- 目标路径收到结束标识后正确处理乱序/缓存。
- 用户面无长时间黑洞。

**异常流程**

- End Marker 丢失、重复、乱序到达。

**异常预期**

- 目标侧能超时清理旧路径。
- 重复 End Marker 不导致会话释放两次。

### CC-UPF-001 N9 多 UPF / UL CL 分流专项

**覆盖:** N9 接口、多 UPF 部署、UL CL、Branching Point、本地分流。  
**规范依据:** TS 23.501 多 PDU Session Anchor、UL CL 和 Branching Point，TS 23.502 SMF 插入/重配 UL CL，TS 29.244 PFCP 规则下发。  
**前置条件:** SMF 配置 UL CL、PSA1 本地 DN、PSA2 中心 DN，N9 网络可达。

**正常流程**

1. UE 建立 DNN `local-factory` 的 PDU Session。
2. SMF 分配 UL CL 和两个 PSA。
3. 配置分流规则：目标 `10.0.0.0/8` 走 PSA1，其余流量走 PSA2。
4. UE 访问本地地址和公网地址。
5. 在 PSA1、PSA2 的 N6 接口和 N9 接口抓包。
6. 停止 PSA1，验证本地流量 fallback、阻断或告警策略。

**预期结果**

- 本地流量和公网流量进入不同 PSA。
- PFCP PDR/FAR 明确体现 UL CL 分流规则。
- PSA1 故障时系统按策略切换或告警。

**异常流程**

- N9 断链、PSA1 不可用、分流规则冲突。

**异常预期**

- SMF 不下发冲突规则，或 UPF 返回明确 PFCP cause。
- 已有流量不被错误送往未授权 DN。

### CC-URR-001 PFCP URR 用量上报专项

**覆盖:** PDR/URR 上报、时间阈值和字节阈值 Usage Report。  
**规范依据:** TS 29.244 URR、Usage Report、Volume/Time Threshold。  
**前置条件:** SMF 下发 URR，UPF 支持用量统计。

**正常流程**

1. UE 建立 PDU Session。
2. SMF 在 PFCP Session Establishment 中下发 URR。
3. UE 产生上下行流量，达到字节阈值。
4. 继续保持会话，达到时间阈值。
5. UE 释放会话，触发最终 Usage Report。

**预期结果**

- UPF 在阈值触发时发送 Usage Report。
- 报告包含 URR ID、上下行字节数、时间戳、触发原因。
- 会话释放时生成最终统计。

**异常流程**

- URR ID 冲突、计数器回绕、UPF 重启。

**异常预期**

- 冲突规则被拒绝。
- 重启后统计按策略恢复或标记缺口。

---

---

---

## 7. 策略、计费、切片与能力开放测试用例

覆盖 QoS、PCC、切片选择/准入、NSSF/PCF、计费接口、NEF/AF 能力开放和 UE 事件订阅。

### TC-QOS-001 QoS 与包过滤

**规范依据:** TS 23.503 PCC/QoS，TS 24.501 QoS Rules，TS 29.244 QER  

**正常流程**

1. 为 UE 配置 PCC 规则和 5QI/ARP/AMBR。
2. 建立 PDU Session。
3. 发送匹配五元组流量。
4. 检查 NAS QoS Rule、PFCP QER、UPF 计数器。

**预期结果**

- UE 收到正确 QoS Rule。
- UPF 对匹配流量执行限速或标记。
- 非匹配流量进入默认 QoS Flow。

**异常流程**

- UE 请求未授权 QoS 或配置超出 AMBR。

**异常预期**

- PCF/SMF 降级或拒绝策略。
- 日志记录策略冲突。

### TC-SLICE-001 切片选择与 DNN 绑定

**规范依据:** TS 23.501 Network Slicing，TS 23.502 NSSF/AMF/SMF 流程  

**正常流程**

1. UDM 配置 UE 签约 NSSAI。
2. AMF 配置 Allowed NSSAI。
3. UE 请求指定 S-NSSAI 和 DNN。
4. 建立 PDU Session。

**预期结果**

- Registration Accept 包含 Allowed NSSAI。
- PDU Session 绑定正确 S-NSSAI/DNN。
- SMF 选择符合切片配置。

**异常流程**

- UE 请求未签约 S-NSSAI 或 DNN 与切片不匹配。

**异常预期**

- 注册或会话建立被拒绝。
- Cause 明确指出切片或 DNN 不允许。

### TC-SLICE-002 切片准入控制

**规范依据:** TS 23.501 Slice admission control，TS 23.502 AMF/SMF 策略流程  

**正常流程**

1. 配置某切片最大 UE 数和最大 PDU Session 数。
2. 依次启动 UE 到阈值内。
3. 检查注册和会话成功。

**预期结果**

- 阈值内 UE 和会话成功。
- NMS/metrics 记录当前占用数。

**异常流程**

- 启动超过阈值的 UE 或会话。

**异常预期**

- 超限请求被拒绝。
- 告警包含切片、DNN、当前值、阈值。

### CC-PCF-001 SM Policy Association 与动态 PCC 推送

**覆盖:** Npcf_SMPolicyControl 创建、更新、删除，PCF 主动更新 PCC 规则。  
**规范依据:** TS 23.503 PCC，TS 29.512 Npcf_SMPolicyControl。  
**前置条件:** PCF、SMF、UPF 可用，配置可动态调整的 PCC 规则。

**正常流程**

1. UE 建立 PDU Session，SMF 向 PCF 创建 SM Policy Association。
2. PCF 返回默认 PCC 和 QoS 决策。
3. UE 产生匹配流量，UPF 执行默认 QER。
4. PCF 主动推送更新，调整 PCC/QoS。
5. SMF 修改 PFCP 规则，UPF 执行新策略。
6. UE 释放会话，SMF 删除 SM Policy Association。

**预期结果**

- 创建、更新、删除均有 SBI 证据。
- 动态 PCC 推送能落到 PFCP QER/PDR/FAR。
- 释放后 PCF 不保留活动策略关联。

**异常流程**

- PCF 返回非法 PCC、推送时 SMF 不可达、策略版本冲突。

**异常预期**

- SMF 拒绝非法策略或保持旧策略。
- 策略冲突记录可审计。

### CC-CHG-001 Nchf 计费接口与 CDR 专项

**覆盖:** Nchf_ConvergedCharging、离线 CDR、用量统计和会话终止计费。  
**规范依据:** TS 32.255/32.291/32.298 计费架构和 CDR，TS 29.594 Nchf_ConvergedCharging。  
**前置条件:** CHF 或 OCS/OFCS 可用，SMF 配置计费 DNN。

**正常流程**

1. UE 建立计费 DNN 的 PDU Session。
2. SMF 触发 Nchf Charging Data Request 创建计费会话。
3. UE 产生上下行流量。
4. SMF 按时间或用量阈值发送更新。
5. UE 释放 PDU Session，SMF 发送终止请求。
6. 从 CHF 或文件系统获取 CDR。

**预期结果**

- Nchf 接口返回 2xx 或项目定义成功响应。
- CDR 包含 SUPI、PDU Session ID、DNN、开始/结束时间、上下行字节数、QoS。
- 计费更新值与 UPF/URR 统计在误差范围内一致。

**异常流程**

- CHF 不可达、余额不足、CDR 写入失败。

**异常预期**

- 离线计费不可达时按策略缓存或告警，不错误释放非强制会话。
- 在线计费余额不足时按策略限速或释放。

### CC-AF-001 AF/NEF 流量影响 Traffic Influence

**覆盖:** AF 经 NEF/PCF 请求流量引导到指定 UPF/DN。  
**规范依据:** TS 23.502 Traffic Influence，TS 23.503 Policy Authorization，TS 29.522 Nnef_TrafficInfluence，TS 29.514/29.512 PCF 策略接口。  
**前置条件:** NEF、AF 模拟器、PCF、SMF、至少两个 DN/UPF 路径。

**正常流程**

1. UE 建立 PDU Session。
2. AF 通过 NEF 提交流量影响请求，指定应用流、目标 DN 或本地 UPF。
3. NEF/PCF 校验 AF 权限并生成策略。
4. SMF 更新 PDR/FAR，将匹配应用流引导到目标路径。
5. UE 访问目标应用，抓包验证路径变化。

**预期结果**

- AF 请求有授权、策略和生效记录。
- 匹配流量被引导到指定 DN/UPF。
- 非匹配流量不受影响。

**异常流程**

- AF 未授权、请求非法 DNN、目标 UPF 不可用。

**异常预期**

- 请求被拒绝或策略不生效。
- 现有业务路径不被错误修改。

---

### CC-OAM-001 UE 事件订阅、外部 UE 信息输入、外部 QoS 请求

**覆盖:** 监控 UE 特定事件、允许外部方提供 UE 信息、基于外部请求处理 QoS。  
**规范依据:** TS 23.502 exposure and policy procedures，TS 23.503 policy control，TS 29.522 NEF services，TS 29.514 policy authorization。  
**前置条件:** NMS/API 网关、外部系统模拟器、合法 API 凭证。

**正常流程**

1. 外部系统订阅 UE 注册、去注册、PDU Session 建立、位置变化事件。
2. UE 执行注册、建会话、移动性更新、去注册。
3. 外部系统提交 UE 补充信息，例如企业资产编号、终端类型、白名单属性。
4. 外部系统请求调整 UE QoS 策略。
5. 验证 NMS、PCF/SMF、UPF 的状态变化。

**预期结果**

- 外部系统收到订阅事件，字段包含 SUPI/匿名 ID、事件类型、时间。
- UE 补充信息可被查询并用于策略。
- QoS 请求经授权后转化为 PCC/QER 或被明确拒绝。

**异常流程**

- 使用过期 token、提交非法 UE、请求超出授权 QoS、重复订阅。

**异常预期**

- API 返回 401/403/404/409 或项目定义错误。
- 不改变未授权 UE 策略。
- 重复事件可去重。

---

---

---

## 8. 5G-LAN、工业专网与高可靠测试用例

覆盖 Ethernet PDU、5G-LAN 二层/三层互通、VLAN、组播、UPF HA、双发选收、TSN、RAN 资源与下挂设备发现。

### TC-5GLAN-001 5G LAN 二层组网

**规范依据:** TS 23.501 5G LAN-type service，TS 29.244 Ethernet packet filter  
**本地自动化:** `open5gs/tests/5glan/test_l2_switch.py`

**正常流程**

1. 建立 UE-A/UE-B Ethernet PDU Session。
2. UE-A 广播，触发 MAC 学习。
3. UE-B 广播，触发 MAC 学习。
4. UE-A 到 UE-B 单播。
5. UE-A 发送组播帧。

**预期结果**

- MAC 学习表记录 UE-A/UE-B。
- 单播只到目标 UE。
- 广播/组播按 VN Group 策略复制。
- N6 TAP 可观察必要广播/组播。

**异常流程**

1. 发送未知目标 MAC。
2. 持续发送高 PPS 广播。
3. 构造环回帧或重复源 MAC。

**异常预期**

- 未知 MAC 不泄漏到错误 UE。
- 广播风暴被限速并告警。
- 环路或 MAC flapping 被检测并记录。

### TC-5GLAN-002 VLAN 透传

**规范依据:** TS 23.501 Ethernet PDU Session，IEEE 802.1Q 作为以太网承载依据  

**正常流程**

1. N6 创建 VLAN 子接口。
2. UE-A 发送带 VLAN Tag 的以太网帧。
3. UE-B 或 N6 接收并检查 VLAN ID。

**预期结果**

- VLAN Tag 不被错误剥离或改写。
- 配置允许的 VLAN 可透传。

**异常流程**

- 发送未授权 VLAN ID 或双层 VLAN。

**异常预期**

- 未授权 VLAN 被丢弃或告警。
- 不影响其他 VLAN 的转发。

### TC-5GLAN-003 二层三层互通与后路由

**规范依据:** TS 23.501 UPF/5G LAN，TS 29.244 PDR/FAR，TS 23.502 Session Management  
**本地自动化:** `open5gs/tests/5glan/test_l2_l3_gateway.py`

**正常流程**

1. VN Group 配置虚拟网关 IP/MAC。
2. L2 UE 通过 ARP/NDP 获取网关 MAC。
3. L2 UE 访问外部 DN，UPF 执行三层转发或 SNAT。
4. DN 主动访问 CPE 下挂设备子网，UPF 按后路由转发。

```bash
cd /work/open5gs-src
sudo python3 tests/5glan/test_l2_l3_gateway.py
```

**预期结果**

- ARP/NDP 代理响应正确。
- IP-MAC 绑定表正确学习或加载。
- L2 到 L3、L3 到 L2 双向互通。
- SNAT 开启时 N6 源地址为网关或 UPF 地址。

**异常流程**

- 删除 IP-MAC 绑定、配置错误网关 MAC、删除后路由。

**异常预期**

- 相关流量失败但同组 L2 单播不受影响。
- UPF/NMS 显示绑定缺失或路由缺失原因。

### TC-HA-001 5G LAN 用户面 HA

**规范依据:** TS 23.501 UPF selection/reselection，TS 29.244 PFCP session handling，SA5 KPI 可用于恢复时间统计  
**本地文档:** `open5gs/docs/features/5g-lan-ethernet/r3-test-manual.md`

**正常流程**

1. 启动 Active UPF 和 Standby UPF。
2. 建立 Ethernet PDU Session。
3. 验证 MAC 表、PFCP 会话、组播状态同步。
4. 停止 Active UPF。
5. Standby 接管 N3/N6 浮动 IP。

**预期结果**

- 会话不中断或中断时间满足目标，例如 100ms 级指标按项目要求验收。
- MAC 表无需重新学习或在可接受时间内恢复。
- SMF/NMS 状态显示主备切换。

**异常流程**

- Standby 不可达、同步链路中断、Active/Standby 同时宣称 Active。

**异常预期**

- 系统阻止双主。
- NMS 告警明确区分 UPF 故障、同步故障、脑裂风险。

### TC-DEV-001 下挂设备发现

**规范依据:** TS 23.501 5G LAN/UPF 数据面，管理上报参考 SA5 管理规范  

**正常流程**

1. CPE/工业网关 UE 建立 PDU Session。
2. 下挂设备发送 ARP/ND/DHCP 或首个 IP 流。
3. UPF 或采集模块学习 MAC/IP/UE/PDU Session 关系。
4. 上报 NMS。

**预期结果**

- NMS 显示下挂设备 MAC、IP、所属 SUPI、DNN、首次发现时间、最后活跃时间。
- 设备离线后状态更新。

**异常流程**

- 同一 IP 出现不同 MAC，或同一 MAC 出现在不同 UE。

**异常预期**

- 产生冲突告警。
- 不覆盖可信静态绑定，或按策略隔离可疑设备。

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
**本地自动化:** `open5gs/tests/ha/test_ha.sh`

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

### CC-MCAST-001 IPv4/IPv6 组播、IGMP/MLD 专项

**覆盖:** IPv4 组播、IPv6 组播、IGMP/MLD 加入/离开。  
**规范依据:** TS 23.501 5G LAN-type service and Ethernet PDU Session，TS 29.244 Ethernet packet filters，RFC 3376 IGMPv3，RFC 3810 MLDv2。  
**前置条件:** Ethernet PDU Session、VN Group、UE-A/UE-B/UE-C、N6 TAP。

**正常流程**

1. UE-B 发送 IGMP Join 加入 IPv4 组播组。
2. UE-A 向该 IPv4 组播地址发送流量。
3. UE-C 未加入组播组。
4. UE-B 发送 Leave。
5. 重复执行 IPv6 MLD Join/Leave。

**预期结果**

- 已加入 UE 收到组播，未加入 UE 不收到。
- Leave 后不再接收。
- IPv4 和 IPv6 组播状态分别可观测。

**异常流程**

- 发送非法组播地址、快速 Join/Leave、组播风暴。

**异常预期**

- 非法组播被丢弃或告警。
- 快速变更不导致组播表泄漏。

### CC-VLAN-001 802.1Q VLAN 透传专项

**覆盖:** Ethernet PDU Session 内 802.1Q VLAN Tag 透明传输、N6 VLAN 子接口。  
**规范依据:** TS 23.501 Ethernet PDU Session，IEEE 802.1Q。  
**前置条件:** UE-A/UE-B 建立 Ethernet PDU Session，N6 TAP 支持 VLAN 子接口。

**正常流程**

1. 在 N6 创建 VLAN 100 子接口。
2. UE-A 发送带 VLAN ID 100 的以太网帧。
3. UE-B 和 N6 TAP 抓包验证 VLAN Tag。
4. UE-B 回送 VLAN ID 100 帧。
5. 发送不带 VLAN 的普通以太帧，验证不受影响。

**预期结果**

- VLAN Tag 在 VN Group 内透明保留。
- N6 VLAN 子接口能收到正确 VLAN ID。
- 普通无 VLAN 帧仍正常转发。

**异常流程**

- 发送未授权 VLAN ID、双层 VLAN、畸形 VLAN Tag。

**异常预期**

- 未授权或畸形 VLAN 被丢弃或告警。
- 不影响授权 VLAN 的转发。

### CC-L2ROBUST-001 MAC 老化、广播风暴抑制、环路检测

**覆盖:** MAC aging、广播/未知单播风暴抑制、L2 环路检测。  
**规范依据:** TS 23.501 5G LAN-type service，项目 5G-LAN 数据面设计。  
**前置条件:** VN Group 配置 MAC 老化时间、BUM 限速、环路检测阈值。

**正常流程**

1. UE-A/UE-B 发送业务，形成 MAC 学习表。
2. 停止 UE-A 流量并等待超过 MAC 老化时间。
3. UE-B 向 UE-A 原 MAC 发送单播。
4. 以受控速率发送广播和未知单播，低于阈值。

**预期结果**

- UE-A MAC 表项按时老化。
- 老化后未知目标按 BUM 策略处理。
- 低于阈值的 BUM 流量正常转发。

**异常流程**

1. 高速发送广播/未知单播超过阈值。
2. 构造源 MAC 在两个 UE 间快速漂移。
3. 构造环回路径或重复帧。

**异常预期**

- 风暴流量被限速并产生告警。
- MAC flapping 被记录，冲突表项按策略冻结或更新。
- 环路检测触发告警，不造成无限复制。

### CC-RAN-001 切片 RB 资源预留/动态共享

**覆盖:** NSSAI 绑定 DNN、DNN 下 QoS 规则、基站 RB 资源静态预留/动态共享。  
**规范依据:** TS 23.501 network slicing，TS 23.503 QoS and policy control，TS 28.541 slice management，RAN 厂商切片 RB 配置规范。  
**前置条件:** 支持切片 RB 资源配置的 gNB 或 RAN 仿真仪。

**正常流程**

1. 配置切片 A 静态 RB 预留比例，切片 B 动态共享。
2. UE-A 使用切片 A 和 DNN-A 建会话。
3. UE-B 使用切片 B 和 DNN-B 建会话。
4. 分别施加流量，观察 RAN 侧 RB 分配和核心网 QoS。

**预期结果**

- NSSAI-DNN-QoS 绑定正确。
- 切片 A 获得预留资源。
- 空闲资源可按策略被切片 B 共享。

**异常流程**

- 切片 A 超出预留资源，切片 B 高负载争抢。

**异常预期**

- RAN 按优先级或预留策略调度。
- 核心网不会错误修改切片签约。

**前置条件不满足时的处理**

- 若没有支持切片 RB 控制的 gNB，可执行核心网 NSSAI-DNN-QoS 绑定和 N2 配置下发检查，结论记为 `WARN`。
- RAN 资源预留本身必须在真实 gNB 或 RAN 仿真仪上验证后才能判定通过。

### SE-TSN-001 TSN / IEEE 802.1AS 工业时间同步

**覆盖:** TSN 时间同步、IEEE 802.1AS/gPTP、5G 时间同步承载。  
**规范依据:** TS 23.501/23.502 5GS support for time sensitive communication and time synchronization，IEEE 802.1AS。  
**前置条件:** TSN-aware gNB 或仿真仪，支持 gPTP 的工业终端，时间同步测量工具。

**正常流程**

1. 配置 5GS 时间同步能力和 TSN 域。
2. 工业终端通过 5G 接入 TSN 网络。
3. 启动 gPTP/802.1AS 同步。
4. 测量终端与主时钟之间的时间偏差。
5. 在轻负载和业务负载下重复测量。

**预期结果**

- 终端能加入 TSN 时间域。
- 时间偏差、抖动和保持时间满足项目指标。
- 业务负载不破坏同步稳定性。

**异常流程**

- 主时钟失效、gPTP 报文丢失、切换期间同步中断。

**异常预期**

- 系统产生同步失效告警。
- 主时钟恢复后终端可重新同步。

---

---

---

## 9. 安全、准入控制与防护测试用例

覆盖 UE/gNB 白名单、SUCI/NAS 安全、国密、HSM、安全存储、跨地域加密、违规外联与异常信令防护。

### TC-WL-001 终端白名单与 USIM-IMEI 绑定

**规范依据:** TS 23.501 access control，TS 24.501 Registration Reject，TS 33.501 SUPI/PEI 安全  
**本地自动化:** `open5gs/tests/regression/core-p0/test_core_p0.py`

**正常流程**

1. NMS 添加 SUPI、IMEI/IMEISV、允许状态。
2. UE 使用匹配 SUPI+IMEI 注册。
3. 建立 PDU Session。

**预期结果**

- 注册成功。
- AMF/NMS 记录 SUPI+PEI 绑定校验通过。

**异常流程**

1. 使用未授权 SUPI 注册。
2. 使用合法 SUPI 但错误 IMEI 注册。
3. 在线 UE 从白名单删除。
4. 通过 NMS/API 在运行时新增、禁用、恢复白名单条目，不重启 AMF。

**异常预期**

- 未授权 UE 被 Registration Reject。
- 错误 IMEI 被拒绝或进入待审计状态。
- 删除在线 UE 后 AMF 主动去注册或释放会话。
- 运行时更新在下一次注册或策略刷新时立即生效。
- 白名单更新失败不影响已有合法条目。

### TC-WL-002 基站白名单

**规范依据:** TS 38.413 NG Setup，TS 23.501 AMF access control  
**本地自动化:** `open5gs/tests/regression/core-p0/test_core_p0.py`

**正常流程**

1. NMS 配置允许的 gNB ID、TAI、PLMN、SCTP peer IP。
2. 合法 gNB 发起 NG Setup。
3. UE 通过该 gNB 注册。

**预期结果**

- NG Setup 成功。
- AMF 记录合法 gNB 接入审计。

**异常流程**

- 修改 gNB ID、TAC、PLMN 或 SCTP peer IP 后发起 NG Setup。

**异常预期**

- AMF 拒绝 NG Setup 或断开 SCTP。
- NMS 生成非法基站接入告警。

### TC-SEC-001 SUCI、鉴权与 NAS 安全

**规范依据:** TS 33.501，TS 24.501 Security mode control  

**正常流程**

1. 配置 SUCI Profile 和归属网公钥。
2. UE 使用 SUCI 注册。
3. AUSF/UDM 鉴权成功。
4. AMF 发起 Security Mode Command。

**预期结果**

- SUPI 解密或解析成功。
- NAS 完整性和加密算法协商成功。
- 后续 NAS 消息受保护。

**异常流程**

- 使用错误 SUCI key、篡改 NAS MAC、配置不支持算法。

**异常预期**

- 注册被拒绝或 Security Mode 失败。
- 日志记录安全失败原因，不泄露 K/OPc/SUPI 明文敏感信息。

### TC-SEC-002 违规外联检测、告警与阻断

**规范依据:** TS 23.501 UPF traffic handling，TS 29.244 forwarding rule，SA5 告警管理参考  

**正常流程**

1. 配置允许目的网段和禁止目的网段。
2. UE 访问允许地址。
3. UE 访问禁止地址。

**预期结果**

- 允许流量通过。
- 禁止流量被记录五元组、触发告警并阻断。
- NMS 可查询命中策略、SUPI、DNN、时间戳。

**异常流程**

- 配置重叠策略、端口绕过、IPv6 等价目的地址。

**异常预期**

- 策略优先级确定。
- IPv4/IPv6 均按规则处理。
- 冲突策略被拒绝或要求显式确认。

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
**本地自动化:** `open5gs/tests/regression/run_regression_separated.py`

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

---

---

---

## 10. 物联网与特殊终端测试用例

覆盖 RedCap、Cat.1、NB-IoT、eDRX、PSM、CP 模式和特殊终端速率控制。

### CC-REDCAP-001 RedCap Indication、NR_REDCAP RAT、注册与移动性

**覆盖:** RedCap Indication、NR_REDCAP RAT、RedCap 注册、移动性注册更新、4G/5G 互操作。  
**规范依据:** TS 23.501 RedCap support，TS 23.502 registration and mobility procedures，TS 24.501 NAS，TS 38.306 UE radio access capabilities。  
**前置条件:** RedCap UE 或 RAN/UE 仿真仪支持 RedCap IE。

**正常流程**

1. RedCap UE 发起初始注册，携带 RedCap Indication 或 NR_REDCAP RAT。
2. AMF/SMF/PCF/UDM 正确识别 RedCap 属性。
3. UE 建立 PDU Session。
4. 触发移动性注册更新。
5. RedCap UE 从 NR 移动到 LTE 覆盖，触发 5GS 到 EPS 互操作或重注册。
6. 检查 LTE 侧是否保留 RedCap 相关策略或按 Cat.1/IoT 策略降级。
7. RedCap UE 从 LTE 返回 NR 覆盖，触发 EPS 到 5GS 注册。
8. 验证 AMF/SMF 恢复 RedCap 标识、DNN、切片和节电策略。

**预期结果**

- 日志和上下文中记录 RedCap 标识。
- 策略可按 RedCap 终端差异化处理。
- 注册、更新、互操作成功。
- 4G/5G 往返过程中失败 cause、策略降级和恢复行为可追踪。

**异常流程**

- 普通 UE 伪造 RedCap Indication；RedCap UE 请求不允许的切片或 DNN。

**异常预期**

- 伪造或不匹配策略被拒绝或审计。
- 不影响普通 UE 注册。

### CC-REDCAP-002 RedCap eDRX 节电功能

**覆盖:** RedCap eDRX。  
**规范依据:** TS 23.501 power saving support，TS 23.502 eDRX handling，TS 24.501 eDRX NAS parameters，TS 38.306 RedCap UE capability。  
**前置条件:** RedCap UE 支持 eDRX，AMF 配置 eDRX 策略。

**正常流程**

1. UE 在注册请求中携带 eDRX 参数。
2. AMF/UDM 根据签约决定是否允许。
3. 网络返回 eDRX 配置。
4. UE 进入节电周期。
5. 下行数据到达时验证寻呼时机和延迟。

**预期结果**

- eDRX 参数协商成功。
- 寻呼窗口和周期符合配置。
- 节电状态下业务按预期延迟或恢复。

**异常流程**

- UE 请求超出签约范围的 eDRX 周期；下行数据在不可达窗口到达。

**异常预期**

- 网络拒绝或调整参数。
- 下行数据按缓存/丢弃策略处理。

### CC-IOT-001 LTE Cat.1 接入、移动性和路由优化

**覆盖:** LTE Cat.1 终端接入、移动性、数据路由优化。  
**规范依据:** TS 23.401 EPS attach and mobility，TS 24.301 EMM/ESM，TS 36.306 UE radio access capabilities。  
**前置条件:** Cat.1 终端或 LTE UE 仿真仪，EPC 或融合核心网。

**正常流程**

1. Cat.1 终端完成 LTE Attach。
2. 建立 PDN Connection。
3. 执行小区重选或 TAU。
4. 验证数据路由、低速率业务和保持连接能力。

**预期结果**

- Cat.1 终端可接入。
- 移动性流程成功。
- 路由策略和速率限制符合配置。

**异常流程**

- Cat.1 终端请求未签约 APN、移动到禁止 TA。

**异常预期**

- Attach/PDN/TAU 返回明确 cause。

### CC-IOT-002 NB-IoT CP 模式、PSM/eDRX、速率控制

**覆盖:** NB-IoT CP 模式、PSM、eDRX、速率控制。  
**规范依据:** TS 23.401 CIoT EPS optimizations，TS 24.301 CP CIoT optimization/PSM/eDRX，TS 36.321 MAC，TS 36.306 NB-IoT UE capabilities。  
**前置条件:** NB-IoT 终端或仿真仪，EPC NB-IoT 能力。

**正常流程**

1. NB-IoT 终端附着。
2. 使用 CP 模式发送小数据。
3. 协商 PSM 和 eDRX。
4. 施加低速率业务并验证速率控制。

**预期结果**

- CP 小数据无需完整用户面承载即可完成。
- PSM/eDRX 参数符合签约。
- 速率控制生效。

**异常流程**

- 请求超出签约的 PSM/eDRX，或超过速率限制发送。

**异常预期**

- 网络拒绝、调整参数或限速。
- 不影响其他 IoT 终端。

---

---

---

## 11. 语音、IMS 与短信测试用例

覆盖 IMS DNN、P-CSCF、SIP 注册、VoNR/VoLTE、EPS/RAT Fallback、SMSC、SBC/MGW 冗余和呼叫前转。

### TC-IMS-001 IMS DNN 与 P-CSCF 下发

**规范依据:** TS 23.501 IMS voice support，TS 23.502 PDU Session，TS 24.501 PCO/5GSM  

**正常流程**

1. UE 签约 IMS DNN。
2. SMF 配置 P-CSCF 地址。
3. UE 建立 IMS PDU Session。
4. UE 获得 P-CSCF 地址并向外部 IMS 注册。

**预期结果**

- PDU Session 建立成功。
- PCO 或相关参数包含 P-CSCF。
- IMS 注册可到达外部 IMS/SBC。

**异常流程**

- IMS DNN 未签约、P-CSCF 缺失、外部 IMS 不可达。

**异常预期**

- 未签约 DNN 被拒绝。
- P-CSCF 缺失时会话建立失败或产生明确告警。
- 外部 IMS 不可达不影响 5GC 其他 DNN。

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

### CC-IMS-001 IMS 单节点集成形态

**覆盖:** 单节点集成 P-CSCF/I-CSCF/S-CSCF/UDM/SMSC 等网元。  
**规范依据:** TS 23.228 IMS architecture，TS 24.229 SIP/IMS signalling，TS 23.501 IMS support in 5GS。  
**前置条件:** IMS 单节点部署包或容器，5GC IMS DNN。

**正常流程**

1. 在单节点启动 P-CSCF/I-CSCF/S-CSCF/UDM/SMSC。
2. 检查各 IMS 服务端口和健康状态。
3. UE 建立 IMS PDU Session。
4. UE 完成 IMS 注册并发送测试消息或呼叫。

**预期结果**

- 单节点所有声明 IMS 组件运行。
- IMS 注册和基本业务成功。

**异常流程**

- 停止其中一个 IMS 组件，例如 S-CSCF 或 SMSC。

**异常预期**

- 相关业务失败，健康检查定位到具体组件。

### CC-IMS-002 IMS 2000 注册、500 路语音并发

**覆盖:** 单节点 2000 用户注册、500 路语音通话并发。  
**规范依据:** TS 23.228 IMS architecture，TS 24.229 SIP registration/session control，TS 28.554 IMS/packet core KPI principles，项目容量指标。  
**前置条件:** SIP/IMS 压测仪，IMS 单节点，媒体流量发生器。

**正常流程**

1. 逐步注册 2000 个 IMS 用户。
2. 保持注册状态。
3. 发起 500 路并发语音呼叫。
4. 持续运行项目要求时长。
5. 统计注册成功率、呼叫建立成功率、MOS/丢包/抖动。

**预期结果**

- 2000 用户注册成功率满足指标。
- 500 路并发通话建立和保持满足指标。
- CPU、内存、端口、媒体资源不过载。

**异常流程**

- 超过 2000 注册或 500 通话继续加压。

**异常预期**

- 系统可控拒绝新请求，不影响已建立呼叫。

### CC-IMS-003 IMS UPDATE、业务触发、消息管理

**覆盖:** IMS 会话刷新 UPDATE、业务触发、消息管理。  
**规范依据:** TS 24.229 SIP UPDATE/session control，TS 23.228 IMS service control，RFC 3311 SIP UPDATE。  
**前置条件:** IMS Core、SIP UE、SIP 抓包。

**正常流程**

1. SIP UE 建立通话。
2. 会话中发送 UPDATE 刷新媒体参数。
3. 触发呼叫保持、恢复或补充业务。
4. 发送 SIP MESSAGE 或项目定义消息。
5. 释放通话。

**预期结果**

- UPDATE 事务成功。
- 业务触发符合 IMS 策略。
- 消息收发和会话释放正常。

**异常流程**

- UPDATE 携带非法 SDP；业务触发无权限；消息目的用户不存在。

**异常预期**

- 返回明确 SIP cause。
- 不影响原有会话状态。

### CC-IMS-004 SMSC 多媒体短信

**覆盖:** SMSC 支持图像、音频等复杂多媒体短信格式。  
**规范依据:** TS 23.040 SMS，TS 23.140 MMS，TS 24.011 SMS over NAS/CS interworking as applicable，项目 SMSC/MMS 能力要求。  
**前置条件:** SMSC/MMS 测试平台，支持发送图像/音频消息的终端或模拟器。

**正常流程**

1. 终端 A 发送文本短信。
2. 终端 A 发送含图像的多媒体短信。
3. 终端 A 发送含音频的多媒体短信。
4. 终端 B 接收并回执。

**预期结果**

- 文本、图像、音频消息均能投递。
- 消息大小、编码、内容类型记录正确。
- 失败重试和回执正确。

**异常流程**

- 发送超大附件、非法 MIME 类型、离线接收方。

**异常预期**

- 超限或非法消息被拒绝。
- 离线消息按策略缓存或失败回执。

### CC-IMS-005 EPS Fallback/RAT Fallback 与语音域选择

**覆盖:** 语音域选择、EPS Fallback、RAT Fallback。  
**规范依据:** TS 23.501 IMS voice support and EPS fallback，TS 23.502 EPS fallback procedures，TS 24.501 UE capability/registration signalling。  
**前置条件:** VoNR/VoLTE UE，NR/LTE 覆盖，IMS Core。

**正常流程**

1. UE 注册 5GS 并完成 IMS 注册。
2. 发起语音呼叫。
3. 根据策略触发 VoNR、EPS Fallback 或 RAT Fallback。
4. 呼叫建立并保持媒体。

**预期结果**

- 语音域选择符合策略。
- fallback 后呼叫成功。
- UE 数据业务按策略保持或恢复。

**异常流程**

- LTE 覆盖不可用、IMS 未注册、fallback 策略冲突。

**异常预期**

- 呼叫失败原因明确。
- UE 不进入异常循环重试。

### CC-IMS-006 IMS/SBC/MGW 主备冗余和负载均衡

**覆盖:** 语音主备冗余、负载均衡高可靠方案。  
**规范依据:** TS 23.228 IMS architecture，TS 24.229 SIP session control，TS 28.554 availability/KPI principles，项目 IMS/SBC HA 设计。  
**前置条件:** 双 P-CSCF/SBC/MGW 或等效主备组件。

**正常流程**

1. 注册多个 IMS 用户，确认分布到不同 P-CSCF/SBC。
2. 建立多路呼叫。
3. 停止主 SBC 或主 MGW。
4. 观察新呼叫分配和已有呼叫恢复。

**预期结果**

- 新呼叫自动选择可用节点。
- 已有呼叫按设计保持或快速恢复。
- NMS 告警显示主备切换。

**异常流程**

- 主备间状态不同步、负载均衡器错误路由。

**异常预期**

- 不产生单通、重复计费或僵尸会话。

### CC-IMS-007 呼叫前转到第三方网络

**覆盖:** 当自身网络内无法呼通终端时，将呼叫转移到第三方网络。  
**规范依据:** TS 24.604 communication diversion supplementary service，TS 24.229 SIP session control，TS 23.228 IMS service control。  
**前置条件:** IMS Core、第三方网络/SBC 路由、被叫前转规则。

**正常流程**

1. 为被叫配置无应答或不可达前转号码。
2. 主叫呼叫被叫。
3. 被叫不可达。
4. IMS 将呼叫前转到第三方网络号码。
5. 第三方号码接通并释放。

**预期结果**

- 前转规则命中。
- SIP 路由到第三方网络。
- CDR/日志记录原被叫、前转号码和原因。

**异常流程**

- 第三方网络不可达、前转号码非法、循环前转。

**异常预期**

- 返回明确失败 cause。
- 循环前转被检测并阻断。

---

---

---

## 12. 运维、部署、兼容性与数据同步测试用例

覆盖 OAM、日志跟踪、性能容量、版本一致性、SBI、融合部署、平台兼容、容器化、LMT、审计日志、UDM 开户与同步。

### TC-OAM-001 配置查询、导入、导出、同步与激活

**规范依据:** SA5 管理规范族，项目 NMS API 设计  

**正常流程**

1. NMS 导出当前 AMF/SMF/UPF/用户/切片配置。
2. 修改一项低风险配置，例如新增 DNN。
3. 导入配置并激活。
4. 通过 UE 建会话验证新配置。

**预期结果**

- 导出文件完整可回放。
- 导入前有校验，激活后业务生效。
- 配置版本号递增，保留操作者和时间。

**异常流程**

- 导入语法错误、重复 DNN、非法切片。

**异常预期**

- 导入失败且不污染运行配置。
- 错误定位到字段级别。

### TC-OAM-002 日志、接口跟踪与用户跟踪

**规范依据:** SA5 运维管理，TS 33.501 安全审计要求参考  

**正常流程**

1. 在 NMS 开启指定 SUPI 的用户跟踪。
2. 执行注册、PDU Session、去注册。
3. 导出跟踪文件。

**预期结果**

- 跟踪包含时间、网元、SUPI/匿名化标识、消息类型、Cause。
- 可关联 AMF/SMF/UPF 日志。

**异常流程**

- 非授权账号导出跟踪，或导出包含敏感密钥字段。

**异常预期**

- 权限不足被拒绝。
- 导出内容对 K/OPc、密钥、令牌脱敏。

### TC-OAM-003 性能采集、补采、报表与门限

**规范依据:** TS 28.554 KPI，SA5 性能管理  

**正常流程**

1. 创建性能测量任务，采集注册成功率、PDU Session 成功率、UPF 吞吐、PFCP 心跳状态。
2. 暂停采集进程后恢复。
3. 执行补采或生成缺口标记。
4. 设置门限并触发告警。

**预期结果**

- 报表包含时间粒度、指标值、网元维度。
- 补采成功或明确标记缺失。
- 超门限产生告警。

**异常流程**

- 指标源不可达、时间倒退、重复数据。

**异常预期**

- 采集任务降级为失败或部分成功。
- 不写入错误时间序列。

### TC-DEP-001 一键部署与一键升级

**规范依据:** 产品化运维验收，SA5 管理思想参考  

**正常流程**

1. 选择单机模式部署。
2. 执行健康检查。
3. 选择 CP/UP 分离模式部署。
4. 执行版本升级。
5. 升级后跑冒烟测试：注册、PDU Session、N6 ping。

**预期结果**

- 部署脚本可重复执行。
- 升级保留订阅数据和关键配置。
- 冒烟测试通过。

**异常流程**

- 模拟配置错误、镜像缺失、升级中断。

**异常预期**

- 部署失败时有明确错误码和日志。
- 升级失败时可回退到旧版本。
- 回退后冒烟测试通过。

---

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

### CC-STD-001 3GPP 版本一致性和能力声明

**覆盖:** 基于 3GPP R16 稳定商用版本，同时验证手册采用的 Release 19/20 跟踪口径不会掩盖 R16 基础能力。  
**规范依据:** TS 21.101 3GPP specification release management，TS 23.501 5GS architecture，TS 23.502 5GS procedures。  
**前置条件:** 产品版本说明、NF 支持能力表、配置模板、接口 OpenAPI/ASN.1 版本清单。  
**本地自动化:** `open5gs/tests/regression/run_regression_separated.py`

**正常流程**

1. 收集 AMF/SMF/UPF/UDM/AUSF/PCF/NRF/NSSF 的版本和支持能力清单。
2. 将注册、PDU Session、QoS、切片、PFCP、NAS 安全、5G-LAN 的实现能力映射到 TS 23.501/23.502/24.501/29.244。
3. 执行本手册 P0 用例，确认 R16 基础流程全部可运行。
4. 对 Release 19/20 增强项单独标注为增强能力，不作为 R16 基础失败项。

**预期结果**

- 版本声明、接口行为和测试结果一致。
- R16 基础能力有用例证据。
- Release 19/20 增强项不影响 R16 基础流程判定。

**异常流程**

- 发现产品声明支持某 R16 能力，但无配置、无接口或无测试证据。

**异常预期**

- 标记为声明不一致。
- 输出缺失能力、影响范围和补测用例。

### CC-SBI-001 SBA/SBI 全接口服务发现、鉴权和异常响应

**覆盖:** SBA 架构、SBI 接口、服务发现、异常响应。  
**规范依据:** TS 23.501 SBA architecture，TS 29.500 SBI common principles，TS 29.510 NRF/Nnrf，TS 29.571 common data types，TS 29.531 Nnssf。  
**前置条件:** NRF、AMF、SMF、UDM、AUSF、PCF、NSSF、UDR 已启动。  
**本地自动化:** `open5gs/tests/regression/run_regression_separated.py`

**正常流程**

1. 检查各 NF 向 NRF 注册的 NFProfile。
2. 逐项调用 NRF discovery，验证 AMF 查 UDM/AUSF，SMF 查 PCF/UDM/UPF，AMF 查 NSSF。
3. 独立调用 Nnssf_NSSelection 或项目等效 NSSF 查询，验证 Allowed NSSAI、Rejected NSSAI、目标 AMF/SMF 选择信息。
4. 对每类 SBI 请求验证成功响应、HTTP 状态码、ProblemDetails 格式。
5. 验证 TLS/OAuth 或项目定义的服务间鉴权配置。

**预期结果**

- NFProfile 包含服务名、版本、IP、端口、状态。
- 服务发现结果与配置一致。
- 正常请求返回 2xx，异常请求返回规范化错误。

**异常流程**

1. 停止 UDM 或 PCF。
2. 发送非法 token、非法 JSON、未知 SUPI、未知 DNN。

**异常预期**

- 调用方收到明确错误，不崩溃。
- NRF 状态和日志能反映服务不可用。
- 错误响应包含 cause/problem detail。
- NSSF 不可用时 AMF 按本地切片配置降级或拒绝，并记录原因。

### CC-FUSION-001 4G/5G 融合网元产品形态

**覆盖:** AMF/MME、UDM/HSS、PCF/PCRF、SMF/PGW-C、UPF/PGW-U 等融合网元声明。  
**规范依据:** TS 23.501 EPC interworking architecture，TS 23.502 EPS/5GS interworking procedures，TS 23.401 EPS architecture。  
**前置条件:** EPC 与 5GC 融合部署方案、共享用户数据或同步机制、LTE/NR 双模 UE。

**正常流程**

1. 检查融合网元部署拓扑和进程/服务清单。
2. 使用同一用户数据完成 LTE Attach 和 5GS Registration。
3. 分别建立 EPS PDN Connection 和 5GS PDU Session。
4. 检查策略、签约、计费或 QoS 数据是否在融合网元间一致。

**预期结果**

- 同一用户在 EPC/5GC 下均可接入。
- 用户数据、DNN/APN、QoS 策略一致。
- 互操作用例 SE-HO-003 可复用该融合环境。

**异常流程**

- 只配置 5GC 数据、不配置 EPC 数据；或反向配置。

**异常预期**

- 缺失侧接入失败，错误原因清晰。
- 不出现错误授权或重复开户。

### CC-COMP-001 X86/ARM 服务器部署

**覆盖:** 支持 X86 或 ARM 服务器部署。  
**规范依据:** TS 28.541 management service model，TS 28.532 management services，项目部署兼容性要求。  
**前置条件:** 至少一台 x86_64 服务器、一台 ARM64 服务器，使用同一版本包或镜像。

**正常流程**

1. 在 x86_64 安装 Open5GS 5GC 和 NMS。
2. 执行基础冒烟：注册、PDU Session、N3/N6、PFCP。
3. 在 ARM64 重复安装和冒烟。
4. 对比配置、日志、性能基线和失败项。

**预期结果**

- 两种架构均能安装、启动和完成基础业务。
- 包、镜像、依赖和服务脚本适配目标架构。

**异常流程**

- 使用不匹配架构的包、缺失依赖、字节序/对齐相关异常。

**异常预期**

- 安装阶段明确失败，不产生半安装状态。
- 运行阶段异常有日志和回滚步骤。

### CC-COMP-002 国产 OS、达梦数据库、自主 CPU

**覆盖:** 银河麒麟 V10、达梦 V8.4、鲲鹏/飞腾/海光等国产化适配。  
**规范依据:** TS 28.541 management service model，TS 28.532 management services，GM/T 0028 密码模块要求，项目国产化适配要求。  
**前置条件:** 国产 OS 与 CPU 环境、达梦数据库实例、数据库适配层或迁移工具。

**正常流程**

1. 在国产 OS 上安装 5GC 和 NMS。
2. 将用户、订阅、策略、NMS 配置迁移到达梦数据库。
3. 执行开户、注册、PDU Session、QoS、切片、日志查询。
4. 执行重启、备份、恢复。

**预期结果**

- 服务可启动并连接达梦数据库。
- 关键业务数据读写正确。
- 备份恢复后业务可继续。

**异常流程**

- 数据库断连、字符集不一致、SQL 方言不兼容、国产 CPU 缺少依赖包。

**异常预期**

- 应用返回明确错误。
- 不写入损坏数据。
- 恢复后可继续业务。

**前置条件不满足时的处理**

- 若无达梦数据库环境，可执行数据库适配层静态检查、SQL 迁移脚本语法检查和 MongoDB 基线回归，但结论只能记为 `WARN`。
- 若无国产 CPU 服务器，可用交叉编译和容器镜像架构检查作为替代证据，不能替代真实硬件通过结论。

### CC-DEP-001 虚拟机部署兼容矩阵

**覆盖:** 支持虚拟机部署。  
**规范依据:** TS 28.541 management service model，TS 28.532 management services，项目虚拟化部署要求。  
**前置条件:** KVM/VMware/Hyper-V 或项目指定虚拟化平台。

**正常流程**

1. 在每个平台创建同规格 VM。
2. 安装 5GC、NMS、数据库。
3. 检查 SCTP、GTP-U、PFCP、N6 网卡、时间同步。
4. 执行 P0 冒烟和一次重启恢复。

**预期结果**

- VM 网络支持 N2/N3/N4/N6。
- 重启后服务自动恢复。
- 虚拟网卡 MTU 和 offload 不破坏 GTP-U。

**异常流程**

- 关闭时间同步、修改 MTU、禁用 promiscuous/mac spoofing。

**异常预期**

- 失败原因定位到虚拟化网络或时间配置。
- 文档给出平台侧配置要求。

### CC-DEP-002 5GC/EPC 网元下沉和逐网元健康验收

**覆盖:** 5GC 全网元下沉部署、EPC 网元部署。  
**规范依据:** TS 23.501 5GS architecture，TS 23.401 EPS architecture，TS 28.541 management service model。  
**前置条件:** 边缘节点或下沉节点，5GC/EPC 网元清单。

**正常流程**

1. 按下沉拓扑部署 NRF/AMF/SMF/UPF/UDM/AUSF/UDR/PCF/NSSF。
2. 逐网元执行健康检查、端口检查、日志检查、NRF 注册检查。
3. 部署 EPC 网元 MME/HSS/SGW/PGW/PCRF 或融合等效服务。
4. 执行 NR 注册、LTE Attach、PDU/PDN 会话、N6 转发。

**预期结果**

- 每个声明网元都有运行实例、健康状态和业务证据。
- 下沉部署下本地业务时延和转发路径符合设计。

**异常流程**

- 单个网元缺失、端口冲突、NRF 注册失败、边缘链路中断。

**异常预期**

- 健康检查定位到具体网元。
- 业务失败不被误判为 UE 问题。

### CC-DEP-003 容器化 / Kubernetes 部署冒烟

**覆盖:** 容器化部署、Kubernetes 部署、滚动升级和服务恢复。  
**规范依据:** TS 28.541 management service model，TS 28.532 management services，项目容器化部署和升级要求。  
**前置条件:** Docker Compose 或 Kubernetes 集群，镜像仓库，持久化存储，N2/N3/N4/N6 网络插件或等效网络方案。

**正常流程**

1. 使用容器编排文件部署 NRF、AMF、SMF、UPF、UDM、AUSF、UDR、PCF、NMS 和数据库。
2. 检查 Pod/Container 健康状态、端口、日志、NRF 注册信息。
3. 执行 UE 注册、PDU Session 建立、N3/N6 转发、PFCP 心跳冒烟。
4. 对 AMF 或 SMF 执行滚动重启，观察服务恢复。
5. 对 UPF 执行节点驱逐或容器重启，观察会话影响和告警。

**预期结果**

- 容器化环境能完成基础业务。
- 网络插件支持 SCTP、GTP-U、PFCP 和 N6 路由。
- 滚动重启期间新请求按策略重试或切换，已有业务影响可度量。

**异常流程**

- 镜像拉取失败、PVC 不可用、CNI 不支持 SCTP/GTP-U、Pod 被调度到无 N6 网卡节点。

**异常预期**

- 部署失败原因定位到镜像、存储、网络或节点亲和配置。
- 系统不产生半激活网元或错误 NRF 注册。

**前置条件不满足时的处理**

- 若无 Kubernetes 集群，至少执行 Docker Compose 冒烟并记录 `WARN: K8s not available`。
- 若 CNI 不支持 SCTP/GTP-U，保留配置检查和 Pod 健康证据，但业务转发判定为未执行，不计为通过。

---

### CC-LMT-001 本地 LMT 页面全流程

**覆盖:** 本地 LMT 管理维护页面，网元配置、开户、状态、告警、安全策略查询。  
**规范依据:** TS 28.532 management services，TS 28.541 management service model，TS 28.545 fault supervision，项目 LMT/NMS UI 规范。  
**前置条件:** LMT/NMS 页面可访问，测试账号具备不同权限角色。

**正常流程**

1. 登录 LMT。
2. 查看网元拓扑和状态。
3. 新增测试用户并配置 DNN/切片/速率。
4. 查询告警和安全策略。
5. 导出配置和日志。

**预期结果**

- 页面展示与后端状态一致。
- 表单校验、提交、查询、导出可用。
- 权限角色限制生效。

**异常流程**

- 使用只读账号提交配置；输入非法 DNN/切片；后端 API 超时。

**异常预期**

- 页面阻止越权操作。
- 错误提示清晰，不丢失已有配置。

### CC-LOG-001 OMC 操作日志、安全事件日志保护

**覆盖:** 网元/OMC 操作日志管理、安全事件日志记录与保护。  
**规范依据:** TS 28.532 management services，TS 28.545 fault supervision，TS 33.501 security audit principles，项目审计日志要求。  
**前置条件:** NMS/OMC 日志模块、安全事件模块、审计账号。

**正常流程**

1. 用户登录、修改配置、导入配置、删除用户。
2. 触发安全事件，例如非法 UE、非法 gNB、违规外联。
3. 查询和导出操作日志、安全事件日志。
4. 校验日志签名、哈希或防篡改机制。

**预期结果**

- 每次操作记录操作者、时间、对象、前后值、结果。
- 安全事件记录来源、等级、处置动作。
- 普通用户不能篡改或删除审计日志。

**异常流程**

- 尝试直接删除日志、修改系统时间、重复导出敏感日志。

**异常预期**

- 删除/篡改被拒绝或留下二次审计。
- 时间异常被标记。

### CC-UDM-001 UDM 开户、APN/DNN 签约、速率设置 UI/API

**覆盖:** UDM 开户、APN/DNN 签约、速率设置。  
**规范依据:** TS 23.501 subscription data，TS 23.502 Nudm interactions，TS 29.503 Nudm，TS 23.503 QoS/subscription policy。  
**前置条件:** NMS/UDM API 可用。

**正常流程**

1. 通过 NMS 新增用户 SUPI/K/OPc。
2. 配置 DNN/APN、切片、AMBR/MFBR。
3. UE 注册并建立对应 DNN 会话。
4. 施加流量验证速率设置。
5. 修改签约后重新建会话验证生效。

**预期结果**

- 开户数据写入 UDM/数据库。
- DNN/APN 签约控制会话建立。
- 速率设置通过 QoS/QER 生效。

**异常流程**

- 重复开户、非法 SUPI、DNN 未授权、速率字段越界。

**异常预期**

- API/UI 返回字段级错误。
- 不写入半成品用户。

### CC-UDM-002 大网开户数据与本地专网数据同步

**覆盖:** 大网开户数据与本地专网开户数据同步。  
**规范依据:** TS 23.501 subscription data management，TS 29.503 Nudm，TS 28.532 management data synchronization principles，项目开户同步接口规范。  
**前置条件:** 大网数据源模拟器、本地 UDM/NMS、同步任务。

**正常流程**

1. 大网侧新增用户和签约数据。
2. 启动同步任务。
3. 本地专网侧生成或更新用户数据。
4. UE 使用同步后的数据注册并建会话。
5. 大网侧修改或删除用户，重复同步。

**预期结果**

- 新增、修改、删除均同步。
- 冲突规则明确，例如本地优先或大网优先。
- 同步记录包含批次、数量、失败原因。

**异常流程**

- 大网源不可达、重复数据、字段缺失、同步中断。

**异常预期**

- 同步任务可重试或断点续传。
- 错误记录到具体用户和字段。
- 不破坏已存在合法本地数据。

---

---

---

## 13. 执行优先级与判定标准

### 13.1 优先级建议

| 优先级 | 用例范围 |
| --- | --- |
| P0 必测 | TC-REG-001、TC-PDU-001、TC-PDU-002、TC-UP-001、TC-PFCP-001、TC-PFCP-002、TC-5GLAN-001、TC-5GLAN-003、TC-WL-001、TC-WL-002、SE-HA-002、SE-DEF-001、CC-STD-001、CC-SBI-001 |
| P1 重点增强 | 连接/寻呼/切片/QoS、5G-LAN VLAN/组播/健壮性、UPF HA、国密、安全存储、计费、能力开放、IMS 基础能力、OAM 配置与日志 |
| P2 专项验收 | 切换互操作、TSN、双发选收性能指标、RedCap/Cat.1/NB-IoT、IMS 并发/互通、国产化平台、容器化、容量压测 |

### 13.2 推荐执行顺序

1. 基础 5GC 冒烟：TC-REG-001、TC-PDU-001、TC-UP-001。
2. N4/NAS 稳定性：TC-PFCP-001、TC-PFCP-002、TC-CONN-001、TC-SR-001。
3. 切片、策略与计费：TC-SLICE-001、TC-SLICE-002、TC-QOS-001、CC-PCF-001、CC-CHG-001。
4. 5G-LAN 与工业专网：TC-PDU-003、TC-5GLAN-001、TC-5GLAN-002、TC-5GLAN-003、CC-MCAST-001、CC-VLAN-001、SE-TSN-001。
5. 高可靠与安全：TC-HA-001、SE-HA-002、SE-RED-001、TC-WL-001、TC-WL-002、TC-SEC-001、SE-GM-001、SE-DEF-001。
6. 语音、IoT 与互操作：TC-IMS-001、SE-IMS-001、CC-IMS-005、CC-REDCAP-001、CC-IOT-001。
7. 运维部署与数据同步：TC-OAM-001、TC-OAM-002、TC-OAM-003、TC-DEP-001、CC-UDM-001、CC-UDM-002。

### 13.3 通过/失败判定

- 正常流程完成，且关键消息、日志、抓包、API 响应或 KPI 证据齐全。
- 异常流程触发预期 Cause、告警、拒绝、回滚、隔离或限流行为。
- 异常流程不导致核心网进程崩溃、残留会话、错误转发或敏感信息泄露。
- P0 用例全部通过；P1/P2 如受专用环境限制未执行，必须说明未测原因和替代证据。
- 已知环境噪声只能降级为 WARN，不得掩盖核心流程失败。

| 等级 | 定义 |
| --- | --- |
| S1 | 进程崩溃、注册/PDU 基础流程不可用、非法接入放行、用户面错误转发、安全策略失效 |
| S2 | 单功能失败、异常流程 Cause 错误、状态残留、告警缺失、同步错误、回滚失败 |
| S3 | 日志不完整、错误信息不清晰、统计不准确、文档或脚本可用性问题 |

## 14. 参考链接

- 3GPP Release 19: https://www.3gpp.org/specifications-technologies/releases/release-19
- 3GPP 5G System overview: https://www.3gpp.org/technologies/5g-system-overview
- TS 23.501: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3144
- TS 23.502: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3145
- TS 24.501: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3370
- TS 29.244: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3111
