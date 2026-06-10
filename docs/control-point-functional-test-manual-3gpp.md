# 5GC 控标点可测试功能测试手册

**数据来源:** Google Drive `5GC产品功能清单及控标点-20260402.xlsx` 的 `功能细分` 列  
**规范参考日期:** 2026-05-23  
**规范锚点:** 以 3GPP Release 19 为稳定测试锚点，兼顾 Release 20 已发布但仍处于变更控制中的条目  
**测试对象:** Open5GS 5GC、Open5GS-NMS、UERANSIM、5G-LAN Ethernet PDU Session、N3/N4/N6 用户面  
**测试原则:** 每个功能至少覆盖正常流程、异常流程、可观测证据、判定标准

---

## 1. 3GPP 参考基线

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

---

## 2. 通用测试环境

### 2.1 推荐组件

| 组件 | 用途 |
| --- | --- |
| Open5GS NRF/AMF/SMF/UPF/AUSF/UDM/UDR/PCF/NSSF | 5GC 被测系统 |
| Open5GS-NMS | 用户、DNN、切片、策略、安全与运维配置面 |
| MongoDB | 订阅数据、策略与测试数据存储 |
| UERANSIM | gNB/UE、注册、PDU Session、切片和 NAS 流程模拟 |
| `tests/5glan/` | Ethernet PDU、5G-LAN L2/L3、UPF HA 相关测试资产 |
| tcpdump/tshark/scapy | N3/N6/NAS/PFCP/以太网帧抓包与断言 |
| curl/jq | SBI、NMS API、Prometheus/metrics 验证 |

### 2.2 通用启动检查

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

### 2.3 通用证据要求

每个用例至少保留以下证据之一：

- AMF/SMF/UPF 日志中的 SUPI、PDU Session ID、DNN、S-NSSAI、Cause。
- N2/NAS 抓包中的 Registration、Service Request、PDU Session、Deregistration、Paging、NG Setup 消息。
- N4/PFCP 抓包中的 Association、Session Establishment/Modification/Deletion、PDR/FAR/QER。
- N3/N6 抓包中的 ICMP/TCP/UDP/Ethernet/VLAN/ARP/NDP/组播报文。
- NMS/API 响应、数据库记录、告警、性能计数器。

---

## 3. 测试用例总览

| 编号 | 功能域 | 正常流程 | 异常流程 |
| --- | --- | --- | --- |
| TC-REG-001 | 注册管理 | 初始注册成功 | 非法 SUPI/鉴权失败被拒绝 |
| TC-REG-002 | 去注册 | UE/AMF/UDM 发起去注册 | 重复去注册、未知 UE 去注册 |
| TC-REG-003 | TAI List | 合法 TAI 分配 | 禁止区域/不支持 TAI 拒绝 |
| TC-CONN-001 | 连接管理 | CM-IDLE 到 CM-CONNECTED | Context 缺失或状态异常恢复 |
| TC-SR-001 | 业务请求 | UE 触发 Service Request | 无有效会话或安全上下文失败 |
| TC-PAGE-001 | 寻呼 | 下行数据触发 Paging | 不可达 UE、MICO UE 不寻呼或延迟 |
| TC-PDU-001 | 会话生命周期 | 建立/修改/释放 PDU Session | 非法 DNN、非法 S-NSSAI、资源不足 |
| TC-PDU-002 | IP 会话类型 | IPv4/IPv6/IPv4v6 分配 | 不支持类型拒绝 |
| TC-PDU-003 | Ethernet 会话 | Ethernet PDU Session 建立 | IP DNN 请求 Ethernet 或配置缺失 |
| TC-UP-001 | N3/N6 转发 | UE 到 DN 正常转发 | N6 不通、MTU/路由异常 |
| TC-NAT-001 | NAT | UE 源地址经 N6 NAT | NAT 关闭或端口耗尽 |
| TC-PFCP-001 | PFCP 节点 | Association/Heartbeat 正常 | UPF 心跳超时、Association 失败 |
| TC-PFCP-002 | PFCP 会话 | PDR/FAR/QER 下发 | QER/PDR 缺失、非法 FAR |
| TC-QOS-001 | QoS | PCC/QoS Flow 生效 | 未授权 QoS、限速不生效 |
| TC-SLICE-001 | 切片选择 | NSSAI 选择和 DNN 绑定 | 未签约切片拒绝 |
| TC-SLICE-002 | 切片准入 | 最大 UE/PDU 会话数限制 | 超限拒绝并告警 |
| TC-5GLAN-001 | L2 组网 | 单播/广播/组播 | 未知 MAC、广播风暴、环路 |
| TC-5GLAN-002 | VLAN | VLAN 透传和 N6 VLAN | 非法 VLAN、标签丢失 |
| TC-5GLAN-003 | L2/L3 互通 | ARP/NDP 代理、SNAT、后路由 | 无绑定、错误 MAC、路由缺失 |
| TC-HA-001 | UPF HA | 主备切换和状态同步 | Standby 不可用、双主保护 |
| TC-DEV-001 | 下挂设备发现 | ARP/ND/DHCP/流量学习上报 | 设备消失、伪造 MAC/IP |
| TC-WL-001 | UE 白名单 | SUPI+IMEI 允许注册 | 未授权 UE/IMEI 拒绝 |
| TC-WL-002 | gNB 白名单 | 合法 gNB NG Setup | 非法 gNB/IP/TAC 拒绝 |
| TC-SEC-001 | SUCI/NAS 安全 | SUCI 解密、NAS 安全建立 | SUCI 解密失败、完整性失败 |
| TC-SEC-002 | 违规外联 | 五元组命中告警并阻断 | 误报、绕过、策略冲突 |
| TC-IMS-001 | IMS 接入 | IMS DNN、P-CSCF 下发 | IMS DNN 未签约、P-CSCF 缺失 |
| TC-OAM-001 | 运维配置 | 查询/导入/导出/激活 | 配置冲突、回滚 |
| TC-OAM-002 | 日志跟踪 | 接口/用户跟踪导出 | 权限不足、脱敏检查 |
| TC-OAM-003 | 性能管理 | 任务采集、报表、门限 | 采集失败、门限告警 |
| TC-DEP-001 | 一键部署升级 | 单机/CP-UP 分离/升级 | 部署失败回滚、升级失败回退 |

---

## 4. 详细测试用例

### TC-REG-001 初始注册

**规范依据:** TS 23.502 注册流程，TS 24.501 5GMM，TS 33.501 鉴权与 NAS 安全  
**前置条件:** UDM 中存在合法 SUPI，AMF/UDM/AUSF 可用，gNB 已完成 NG Setup。

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

### TC-PDU-001 PDU Session 建立、修改、释放

**规范依据:** TS 23.502 PDU Session Establishment/Modification/Release，TS 24.501 5GSM  

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

### TC-WL-001 终端白名单与 USIM-IMEI 绑定

**规范依据:** TS 23.501 access control，TS 24.501 Registration Reject，TS 33.501 SUPI/PEI 安全  

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

**异常预期**

- 未授权 UE 被 Registration Reject。
- 错误 IMEI 被拒绝或进入待审计状态。
- 删除在线 UE 后 AMF 主动去注册或释放会话。

### TC-WL-002 基站白名单

**规范依据:** TS 38.413 NG Setup，TS 23.501 AMF access control  

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

## 5. 优先级建议

| 优先级 | 用例 |
| --- | --- |
| P0 必测 | TC-REG-001、TC-PDU-001、TC-PDU-002、TC-UP-001、TC-PFCP-001、TC-PFCP-002、TC-5GLAN-001、TC-5GLAN-003、TC-WL-001、TC-WL-002 |
| P1 重点增强 | TC-SR-001、TC-PAGE-001、TC-QOS-001、TC-SLICE-001、TC-SLICE-002、TC-DEV-001、TC-SEC-001、TC-SEC-002、TC-OAM-001 |
| P2 专项验收 | TC-HA-001、TC-5GLAN-002、TC-IMS-001、TC-OAM-002、TC-OAM-003、TC-DEP-001 |

---

## 6. 通过/失败判定

### 6.1 单用例通过

- 正常流程完成，且关键消息、日志、抓包或 API 证据齐全。
- 异常流程触发预期 Cause、告警或拒绝行为。
- 异常流程不导致核心网进程崩溃、残留会话、错误转发或敏感信息泄露。

### 6.2 回归通过

- P0 用例全部通过。
- P1 用例允许存在环境限制，但必须给出未测原因和替代证据。
- 已知环境噪声只能降级为 WARN，不得掩盖核心流程失败。
- 每次回归需保存版本、配置、日志目录、抓包目录、测试报告。

### 6.3 失败分级

| 等级 | 定义 |
| --- | --- |
| S1 | 进程崩溃、注册/PDU 基础流程不可用、非法接入放行、用户面错误转发 |
| S2 | 单功能失败、异常流程 Cause 错误、状态残留、告警缺失 |
| S3 | 日志不完整、错误信息不清晰、统计不准确、文档或脚本可用性问题 |

---

## 7. 建议执行顺序

1. 基础 5GC 冒烟：TC-REG-001、TC-PDU-001、TC-UP-001。
2. N4/NAS 稳定性：TC-PFCP-001、TC-PFCP-002、TC-CONN-001、TC-SR-001。
3. 切片与策略：TC-SLICE-001、TC-SLICE-002、TC-QOS-001。
4. 5G-LAN：TC-PDU-003、TC-5GLAN-001、TC-5GLAN-002、TC-5GLAN-003。
5. 安全接入：TC-WL-001、TC-WL-002、TC-SEC-001、TC-SEC-002。
6. 专网增强：TC-HA-001、TC-DEV-001、TC-IMS-001。
7. 运维验收：TC-OAM-001、TC-OAM-002、TC-OAM-003、TC-DEP-001。

---

## 8. 参考链接

- 3GPP Release 19: https://www.3gpp.org/specifications-technologies/releases/release-19
- 3GPP 5G System overview: https://www.3gpp.org/technologies/5g-system-overview
- TS 23.501: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3144
- TS 23.502: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3145
- TS 24.501: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3370
- TS 29.244: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3111
