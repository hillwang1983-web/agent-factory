# 控标点功能细分测试手册覆盖矩阵

**覆盖来源:** `control-point-integrated-test-manual-3gpp.md`  
**说明:** 该综合手册已整合原基础功能、专用环境和补充完整覆盖三部分测试用例。  
**覆盖状态说明:** `已覆盖` 表示综合手册中已有明确测试用例；`部分覆盖` 表示仅有相近测试路径但未完全拆到该功能点；`未覆盖` 表示综合手册中尚无明确测试用例。
**审核补充说明:** `control-point-test-manual-audit.md` 指出的扩展功能已作为审计补充用例纳入综合手册；这些用例不改变原 104 个功能细分统计。
**Excel 行数说明:** 审核报告中的 105 行为源表总行数；本矩阵统计 104 个独立可测试功能点，另 1 行为非独立功能明细或被合并说明行。若后续确认该行是独立功能，应追加为第 105 项。

| 序号 | 功能细分中的功能点 | 覆盖状态 | 已覆盖的测试用例 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 基于 3GPP R16 稳定商用版本 | 已覆盖 | 通用 3GPP 参考基线、CC-STD-001 | 增加版本一致性和能力声明专项 |
| 2 | 服务化架构 SBA，网元间采用 SBI | 已覆盖 | 通用启动检查、TC-OAM-001、CC-SBI-001 | 增加全 SBI 服务发现、鉴权、异常响应专项 |
| 3 | 4G/5G 融合核心网网元融合 | 已覆盖 | SE-HO-003、CC-FUSION-001 | 增加融合网元产品形态验收 |
| 4 | 支持 X86 或 ARM 服务器部署 | 已覆盖 | CC-COMP-001 | 增加多架构部署兼容性用例 |
| 5 | 支持国产 OS、达梦数据库、自主可控处理器 | 已覆盖 | CC-COMP-002 | 增加国产化兼容性用例 |
| 6 | 支持虚拟机部署 | 已覆盖 | TC-DEP-001、CC-DEP-001 | 增加 VM 平台兼容矩阵 |
| 7 | 5GC 网元 AMF/SMF/UPF/UDM/AUSF/UDR/PCF/NRF/NSSF 下沉部署 | 已覆盖 | 通用启动检查、TC-DEP-001、CC-DEP-002 | 增加逐网元下沉健康验收 |
| 8 | EPC 网元 MME/HSS/SGW/PGW/PCRF | 已覆盖 | SE-HO-003、CC-DEP-002、CC-FUSION-001 | 增加 EPC/融合网元部署验收 |
| 9 | 监控 UE 特定事件 | 已覆盖 | TC-OAM-002、TC-OAM-003、SE-PERF-001、CC-OAM-001 | 增加 UE 事件订阅专项 |
| 10 | 允许外部方提供 UE 信息 | 已覆盖 | TC-OAM-001、CC-OAM-001 | 增加外部系统输入 UE 信息专项 |
| 11 | 基于外部请求处理 QoS | 已覆盖 | TC-QOS-001、CC-OAM-001 | 增加外部 QoS 请求专项 |
| 12 | 初始注册、移动性注册更新、周期性注册 | 已覆盖 | TC-REG-001、TC-REG-003 | 注册流程和区域移动性已覆盖 |
| 13 | UE/AMF/UDM 发起去注册 | 已覆盖 | TC-REG-002 | 去注册正常和异常流程已覆盖 |
| 14 | TAI List 分配与管理 | 已覆盖 | TC-REG-003 | 合法 TAI 和禁止区域异常已覆盖 |
| 15 | 3GPP NR/LTE 接入注册 | 已覆盖 | TC-REG-001、SE-HO-003 | NR 注册和 LTE/NR 互操作已覆盖 |
| 16 | CM-IDLE 和 CM-CONNECTED 状态管理及转换 | 已覆盖 | TC-CONN-001 | 状态转换和 Context 异常已覆盖 |
| 17 | NAS 信令连接建立、维护与释放 | 已覆盖 | TC-CONN-001、TC-REG-002 | 连接恢复和释放已覆盖 |
| 18 | UE 发起业务请求，UPF 不变 | 已覆盖 | TC-SR-001 | UE 触发 Service Request 已覆盖 |
| 19 | 网络侧下行数据/信令触发业务请求 | 已覆盖 | TC-PAGE-001、TC-SR-001 | 下行触发寻呼和用户面恢复已覆盖 |
| 20 | 基于签约信息的 RAT 限制、禁止区域 | 已覆盖 | TC-REG-003 | 移动性限制和拒绝原因已覆盖 |
| 21 | gNodeB 间 Xn 切换和 N2 切换 | 已覆盖 | SE-HO-001、SE-HO-002 | 已在专用环境手册展开 |
| 22 | 有/无 N26 的 4G/5G 双向切换及空闲态移动性 | 已覆盖 | SE-HO-003 | 已覆盖带 N26/无 N26 场景 |
| 23 | CM-IDLE 移动终止数据触发寻呼 | 已覆盖 | TC-PAGE-001 | 下行数据触发 Paging 已覆盖 |
| 24 | MICO 模式 | 已覆盖 | TC-PAGE-001 | 作为寻呼异常/延迟场景覆盖 |
| 25 | PDU 会话建立、修改、释放 | 已覆盖 | TC-PDU-001 | 生命周期三流程已覆盖 |
| 26 | UE IP 地址分配与管理 | 已覆盖 | TC-PDU-001、TC-PDU-002 | IPv4/IPv6/IPv4v6 分配已覆盖 |
| 27 | 下行数据通知 | 已覆盖 | TC-PAGE-001 | 通过下行寻呼/缓存通知路径覆盖 |
| 28 | IPv4/IPv6/IPv4v6 PDU 会话类型 | 已覆盖 | TC-PDU-002 | 三种 IP 会话类型已覆盖 |
| 29 | Ethernet PDU Session | 已覆盖 | TC-PDU-003、TC-5GLAN-001 | Ethernet 建会话和二层转发已覆盖 |
| 30 | SSC Mode 1，会话释放后 IP 地址保留 | 已覆盖 | TC-PDU-001、CC-PDU-001 | 增加 SSC Mode 1 IP 保持专项 |
| 31 | 用户面数据转发、接入外部数据网 | 已覆盖 | TC-UP-001 | N3/N6 转发已覆盖 |
| 32 | N3、N6 接口 | 已覆盖 | 通用启动检查、TC-UP-001 | 监听和转发抓包均覆盖 |
| 33 | QoS 执行 | 已覆盖 | TC-QOS-001、TC-PFCP-002 | QoS Rule/QER 覆盖 |
| 34 | IDLE 态下行数据缓存 | 已覆盖 | TC-PAGE-001、CC-DDN-001 | 增加缓存队列和不可达异常专项 |
| 35 | 生成并向 SMF 发送下行数据通知 | 已覆盖 | TC-PAGE-001、CC-DDN-001 | 增加 N4 下行数据通知断言 |
| 36 | UPF 或 SMF 生成 End Marker | 已覆盖 | CC-ENDM-001 | 增加 End Marker 正常、丢失、重复、乱序专项 |
| 37 | N6 NAT 隐藏 UE 真实 IP | 已覆盖 | TC-NAT-001、TC-5GLAN-003 | 普通 NAT 和 L2/L3 SNAT 均覆盖 |
| 38 | PFCP 节点管理、会话 CRUD、心跳 | 已覆盖 | TC-PFCP-001、TC-PFCP-002 | Association、Heartbeat、Session CRUD 已覆盖 |
| 39 | PDR/FAR/QER 规则管理 | 已覆盖 | TC-PFCP-002、TC-QOS-001 | 规则下发和 QoS 执行已覆盖 |
| 40 | 注册过程中建立 AM 策略关联，下发移动性限制 | 已覆盖 | TC-REG-003、TC-QOS-001、CC-AM-001 | 增加 AM Policy Association 专项 |
| 41 | 动态及预定义 PCC 规则激活/去激活 | 已覆盖 | TC-QOS-001 | PCC/QoS 生效和异常覆盖 |
| 42 | QoS Flow、QoS 配置文件、QoS 规则、QoS 映射、上下行流量控制 | 已覆盖 | TC-QOS-001 | QoS 规则和流量控制覆盖 |
| 43 | AMBR/MFBR、UE-Slice-MBR 强制和速率限制 | 已覆盖 | TC-QOS-001 | 作为 QoS/限速测试覆盖 |
| 44 | IP 包过滤集和 Ethernet 包过滤集 | 已覆盖 | TC-QOS-001、TC-5GLAN-001、TC-PFCP-002 | IP/Ethernet 匹配均覆盖 |
| 45 | 5G LAN 单播、组播、广播 | 已覆盖 | TC-5GLAN-001、SE-HA-003 | 二层组网和 HA 后组播覆盖 |
| 46 | IPv4 和 IPv6 组播 | 已覆盖 | TC-5GLAN-001、SE-HA-003、CC-MCAST-001 | 增加 IGMP/MLD、IPv4/IPv6 Join/Leave 专项 |
| 47 | VLAN 透传，N6 配置 VLAN | 已覆盖 | TC-5GLAN-002 | VLAN 正常和非法 VLAN 异常已覆盖 |
| 48 | 广播风暴抑制和环路检测 | 已覆盖 | TC-5GLAN-001、CC-L2ROBUST-001 | 增加 MAC 老化、风暴抑制、环路检测专项 |
| 49 | NAT/虚拟路由实现三层终端访问二层 5G LAN 设备 | 已覆盖 | TC-5GLAN-003 | L2/L3 互通、ARP/NDP、SNAT、后路由覆盖 |
| 50 | AMF Set/MME Pool 冗余与负荷分担 | 已覆盖 | SE-HA-001 | 专用环境手册已覆盖 |
| 51 | AMF 负载均衡与负载重平衡 | 已覆盖 | SE-HA-001 | 正常和故障重平衡覆盖 |
| 52 | 主备 UPF 切换，二层业务 100ms 内恢复，MAC 表实时同步 | 已覆盖 | TC-HA-001、SE-HA-002、SE-HA-003 | 基础和专用环境均覆盖 |
| 53 | 浮动 IP 实现业务无感知切换 | 已覆盖 | SE-HA-002 | 浮动 N3/N6 IP 接管覆盖 |
| 54 | 单基站双发选收，两个模组接入同一基站 | 已覆盖 | SE-RED-001 | 专用环境手册已覆盖 |
| 55 | 双基站双发选收，两个模组接入两个不同频基站 | 已覆盖 | SE-RED-002 | 专用环境手册已覆盖 |
| 56 | 20ms 时延可靠性 99.999% | 已覆盖 | SE-RED-003 | 指标验收流程已覆盖 |
| 57 | 网络切片选择功能，切片管理、配置、查询、选择 | 已覆盖 | TC-SLICE-001、TC-OAM-001 | 切片选择和配置管理覆盖 |
| 58 | 基于 UE 签约的 NSSAI 配置 | 已覆盖 | TC-SLICE-001 | 签约 NSSAI 正常/异常覆盖 |
| 59 | NSSAI 绑定 DNN、DNN 下配置 QoS 规则、基站 RB 资源预留/共享 | 已覆盖 | TC-SLICE-001、TC-QOS-001、CC-RAN-001 | 增加基站 RB 资源预留/动态共享专项 |
| 60 | 切片准入控制，最大终端数、最大 PDU 会话数 | 已覆盖 | TC-SLICE-002 | 超限拒绝和告警覆盖 |
| 61 | 工业网关/CPE 下挂设备自动发现并上报综合管理平台 | 已覆盖 | TC-DEV-001 | 发现、上报、冲突异常覆盖 |
| 62 | 添加 5G 网关下挂设备子网，DN 主动访问下挂私网设备 | 已覆盖 | TC-5GLAN-003 | 后路由和 L3 到 L2 访问覆盖 |
| 63 | RedCap Indication 和 NR_REDCAP RAT 处理 | 已覆盖 | CC-REDCAP-001 | 增加 RedCap IE/RAT 处理专项 |
| 64 | RedCap 初始注册、移动性注册更新、4G/5G 互操作 | 已覆盖 | TC-REG-001、TC-REG-003、SE-HO-003、CC-REDCAP-001 | 增加 RedCap 特定注册、移动性、互操作专项 |
| 65 | RedCap eDRX 节电功能 | 已覆盖 | CC-REDCAP-002 | 增加 RedCap eDRX 专项 |
| 66 | LTE Cat.1 终端接入、移动性和数据路由优化 | 已覆盖 | SE-HO-003、CC-IOT-001 | 增加 Cat.1 接入、TAU、路由和速率专项 |
| 67 | NB-IoT CP 模式、PSM/eDRX、速率控制 | 已覆盖 | CC-IOT-002 | 增加 NB-IoT CP/PSM/eDRX/速率专项 |
| 68 | 5G 终端白名单接入控制 | 已覆盖 | TC-WL-001 | SUPI/IMEI 允许和拒绝覆盖 |
| 69 | USIM 卡与终端 IMEI 一对一绑定 | 已覆盖 | TC-WL-001 | 绑定校验异常覆盖 |
| 70 | 从白名单删除 UE 后主动去注册 | 已覆盖 | TC-WL-001 | 在线 UE 删除后的主动释放覆盖 |
| 71 | 基站白名单接入控制 | 已覆盖 | TC-WL-002 | NG Setup 正常/非法 gNB 覆盖 |
| 72 | SM2/SM3/SM4 将 SUPI 加密为 SUCI | 已覆盖 | SE-GM-001 | 国密 SUCI 专项覆盖 |
| 73 | 国密算法进行 UE 与核心网双向身份认证 | 已覆盖 | SE-GM-002 | 国密 AKA 和重放异常覆盖 |
| 74 | ZUC 保护空口控制信令和用户面数据 | 已覆盖 | SE-GM-003 | ZUC/NAS/用户面安全协商覆盖 |
| 75 | 基于 ZUC 对 NAS 信令进行机密性与完整性保护 | 已覆盖 | SE-GM-003 | Security Mode 和算法异常覆盖 |
| 76 | 跨地域部署采用国密 IPSec 加密链路 | 已覆盖 | SE-IPSEC-001 | 跨站点 IPSec 正常和异常覆盖 |
| 77 | 配置 GM/T 0028 二级及以上密码模块，如 PCIe 加密卡 | 已覆盖 | SE-HSM-001 | HSM/PCIe 加密卡接入覆盖 |
| 78 | 对接第三方密码机 | 已覆盖 | SE-HSM-001 | 第三方密码机/HSM 异常覆盖 |
| 79 | 可配置 GM/T 0028 二级及以上密码模块 | 已覆盖 | SE-HSM-001 | 与 77 同类覆盖 |
| 80 | 基于 IP 五元组的违规外联检测、告警与阻断 | 已覆盖 | TC-SEC-002、SE-DEF-001 | 基础和专项均覆盖 |
| 81 | 异常信令检测、信令采集与上报 | 已覆盖 | SE-DEF-002 | NGAP/NAS/PFCP 异常覆盖 |
| 82 | 信令过载控制等 DDoS 攻击检测与防护 | 已覆盖 | SE-DEF-003 | 过载/DDoS 正常和异常覆盖 |
| 83 | 单节点集成 P-CSCF/I-CSCF/S-CSCF/UDM/SMSC 等网元 | 已覆盖 | SE-IMS-001、SE-IMS-002、CC-IMS-001 | 增加 IMS 单节点组件健康和业务验收 |
| 84 | 单节点 2000 用户注册、500 路语音并发 | 已覆盖 | CC-IMS-002 | 增加 IMS 容量专项 |
| 85 | IMS 初始注册、重注册，AKA/SIP Digest 鉴权 | 已覆盖 | SE-IMS-001、SE-IMS-002 | IMS 注册和鉴权失败覆盖 |
| 86 | SIP 话机/门禁接入，与 VoLTE/VoNR 终端语音互通 | 已覆盖 | SE-IMS-001、SE-IMS-002 | SIP 与移动终端互通覆盖 |
| 87 | IMS 会话建立、刷新 UPDATE、释放、业务触发、消息管理 | 已覆盖 | SE-IMS-001、SE-IMS-003、CC-IMS-003 | 增加 UPDATE、业务触发、消息管理专项 |
| 88 | SMSC 支持复杂多媒体短信格式 | 已覆盖 | CC-IMS-004 | 增加多媒体短信专项 |
| 89 | 5GC 支持 IMS Voice over PS、P-CSCF 地址下发/发现 | 已覆盖 | TC-IMS-001、SE-IMS-002 | IMS DNN 和 P-CSCF 下发覆盖 |
| 90 | 语音域选择、EPS Fallback/RAT Fallback | 已覆盖 | SE-HO-003、SE-IMS-002、CC-IMS-005 | 增加 EPS/RAT Fallback 专项 |
| 91 | 与 PSTN、运营商移动/固话网络对接 | 已覆盖 | SE-IMS-003 | PSTN/运营商互通覆盖 |
| 92 | 协议转换、语音编解码转换、灵活呼叫路由 | 已覆盖 | SE-IMS-003 | 作为异常和验收点覆盖 |
| 93 | 主备冗余、负载均衡的语音高可靠方案 | 已覆盖 | SE-IMS-003、CC-IMS-006 | 增加 IMS/SBC/MGW 主备和负载均衡专项 |
| 94 | 呼叫前转到第三方网络 | 已覆盖 | CC-IMS-007 | 增加呼叫前转专项 |
| 95 | 本地 LMT 管理维护页面，网元配置、开户、状态、告警、安全策略查询 | 已覆盖 | TC-OAM-001、TC-OAM-002、TC-SEC-002、CC-LMT-001 | 增加 LMT 页面全流程专项 |
| 96 | 查询、导出、导入网元配置，配置同步与激活 | 已覆盖 | TC-OAM-001 | 配置生命周期覆盖 |
| 97 | 性能测量任务管理、数据采集、补采、报表生成 | 已覆盖 | TC-OAM-003、SE-PERF-001 | 基础和专项均覆盖 |
| 98 | 性能门限管理 | 已覆盖 | TC-OAM-003、SE-PERF-001 | 门限和告警覆盖 |
| 99 | 接口跟踪、用户跟踪及跟踪信息导出 | 已覆盖 | TC-OAM-002 | 跟踪导出和权限异常覆盖 |
| 100 | 网元/OMC 操作日志管理、安全事件日志记录与保护 | 已覆盖 | TC-OAM-002、SE-DEF-001、SE-DEF-002、CC-LOG-001 | 增加 OMC 操作日志和防篡改专项 |
| 101 | UDM 开户、APN/DNN 签约、速率设置 | 已覆盖 | TC-OAM-001、TC-PDU-001、TC-QOS-001、CC-UDM-001 | 增加开户 UI/API 和签约速率专项 |
| 102 | 大网开户数据与本地专网开户数据同步 | 已覆盖 | CC-UDM-002 | 增加开户数据同步专项 |
| 103 | 综合管理平台一键部署，单机、CP/UP 分离、高可靠主备 | 已覆盖 | TC-DEP-001、SE-HA-002 | 部署和 HA 环境覆盖 |
| 104 | 综合管理平台一键软件升级 | 已覆盖 | TC-DEP-001 | 升级和失败回退覆盖 |

---

## 汇总

| 状态 | 数量 |
| --- | ---: |
| 已覆盖 | 104 |
| 部分覆盖 | 0 |
| 未覆盖 | 0 |

## 原未覆盖功能点补齐清单

| 序号 | 功能点 | 建议补充手册 |
| --- | --- | --- |
| 4 | X86/ARM 服务器部署 | CC-COMP-001 |
| 5 | 国产 OS、达梦数据库、自主可控处理器 | CC-COMP-002 |
| 36 | End Marker | CC-ENDM-001 |
| 65 | RedCap eDRX | CC-REDCAP-002 |
| 67 | NB-IoT CP/PSM/eDRX/速率控制 | CC-IOT-002 |
| 84 | IMS 单节点 2000 注册、500 路语音并发 | CC-IMS-002 |
| 88 | 多媒体短信 SMSC | CC-IMS-004 |
| 94 | 呼叫前转到第三方网络 | CC-IMS-007 |
| 102 | 大网开户数据与本地专网开户数据同步 | CC-UDM-002 |

## 审核报告补充用例清单

| 审核问题 | 补充用例 | 说明 |
| --- | --- | --- |
| SSC Mode 2 / LADN 缺失 | CC-PDU-002 | 增加 LADN 区域内建会话、离区释放、重入重建 |
| SSC Mode 3 / MA PDU Session 缺失 | CC-PDU-003 | 增加多会话迁移和多接入路径切换 |
| N9 多 UPF / UL CL 缺失 | CC-UPF-001 | 增加 UL CL、双 PSA、N9 抓包和故障场景 |
| Nchf / CDR 缺失 | CC-CHG-001 | 增加计费会话创建、更新、终止和 CDR 字段校验 |
| SM Policy Association 薄弱 | CC-PCF-001 | 增加 Npcf_SMPolicyControl 创建、更新、删除和动态 PCC |
| NSSF 独立验证薄弱 | CC-SBI-001 | 增加 Nnssf_NSSelection 查询步骤 |
| AF Traffic Influence 缺失 | CC-AF-001 | 增加 AF/NEF/PCF 流量引导 |
| VLAN 透传专项不足 | CC-VLAN-001 | 增加 802.1Q Tag 透明传输专项 |
| MAC 老化/风暴/环路薄弱 | CC-L2ROBUST-001 | 增加 L2 健壮性专项 |
| RedCap 互操作步骤不足 | CC-REDCAP-001 | 扩展 NR->LTE->NR 往返互操作步骤 |
| 白名单动态更新未测 | TC-WL-001 | 增加 NMS/API 运行时更新白名单异常流 |
| URR 上报薄弱 | CC-URR-001 | 增加 PFCP URR 用量上报专项 |
| TSN/IEEE 802.1AS 缺失 | SE-TSN-001 | 增加工厂时间同步专项 |
| 容器化/K8s 部署未覆盖 | CC-DEP-003 | 增加容器化/Kubernetes 冒烟 |
