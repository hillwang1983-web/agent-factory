#!/usr/bin/env python3
"""Rebuild the control-point test manual into a single deliverable structure."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANUAL = ROOT / "control-point-integrated-test-manual-3gpp.md"


CASE_RE = re.compile(r"^### ((?:TC|SE|CC)-[A-Z0-9-]+)\b.*$", re.M)
BOUNDARY_RE = re.compile(r"^(?:#{1,2} |### (?!TC-|SE-|CC-))", re.M)


DOMAIN_GROUPS = [
    (
        "5. 接入与移动性测试用例",
        "覆盖注册、去注册、连接管理、业务请求、寻呼、切换、互操作、AMF 负载均衡与移动性策略。",
        [
            "TC-REG-001",
            "TC-REG-002",
            "TC-REG-003",
            "TC-CONN-001",
            "TC-SR-001",
            "TC-PAGE-001",
            "SE-HO-001",
            "SE-HO-002",
            "SE-HO-003",
            "CC-AMF-001",
            "CC-AM-001",
        ],
    ),
    (
        "6. 会话管理、用户面与 PFCP 测试用例",
        "覆盖 PDU Session、SSC、LADN、MA PDU Session、N3/N6/N9、PFCP、URR、End Marker 与下行数据通知。",
        [
            "TC-PDU-001",
            "TC-PDU-002",
            "TC-PDU-003",
            "TC-UP-001",
            "TC-NAT-001",
            "TC-PFCP-001",
            "TC-PFCP-002",
            "CC-PDU-001",
            "CC-PDU-002",
            "CC-PDU-003",
            "CC-DDN-001",
            "CC-ENDM-001",
            "CC-UPF-001",
            "CC-URR-001",
        ],
    ),
    (
        "7. 策略、计费、切片与能力开放测试用例",
        "覆盖 QoS、PCC、切片选择/准入、NSSF/PCF、计费接口、NEF/AF 能力开放和 UE 事件订阅。",
        [
            "TC-QOS-001",
            "TC-SLICE-001",
            "TC-SLICE-002",
            "CC-PCF-001",
            "CC-CHG-001",
            "CC-AF-001",
            "CC-OAM-001",
        ],
    ),
    (
        "8. 5G-LAN、工业专网与高可靠测试用例",
        "覆盖 Ethernet PDU、5G-LAN 二层/三层互通、VLAN、组播、UPF HA、双发选收、TSN、RAN 资源与下挂设备发现。",
        [
            "TC-5GLAN-001",
            "TC-5GLAN-002",
            "TC-5GLAN-003",
            "TC-HA-001",
            "TC-DEV-001",
            "SE-HA-001",
            "SE-HA-002",
            "SE-HA-003",
            "SE-RED-001",
            "SE-RED-002",
            "SE-RED-003",
            "CC-MCAST-001",
            "CC-VLAN-001",
            "CC-L2ROBUST-001",
            "CC-RAN-001",
            "SE-TSN-001",
        ],
    ),
    (
        "9. 安全、准入控制与防护测试用例",
        "覆盖 UE/gNB 白名单、SUCI/NAS 安全、国密、HSM、安全存储、跨地域加密、违规外联与异常信令防护。",
        [
            "TC-WL-001",
            "TC-WL-002",
            "TC-SEC-001",
            "TC-SEC-002",
            "SE-GM-001",
            "SE-GM-002",
            "SE-GM-003",
            "SE-HSM-001",
            "SE-IPSEC-001",
            "SE-DEF-001",
            "SE-DEF-002",
            "SE-DEF-003",
        ],
    ),
    (
        "10. 物联网与特殊终端测试用例",
        "覆盖 RedCap、Cat.1、NB-IoT、eDRX、PSM、CP 模式和特殊终端速率控制。",
        [
            "CC-REDCAP-001",
            "CC-REDCAP-002",
            "CC-IOT-001",
            "CC-IOT-002",
        ],
    ),
    (
        "11. 语音、IMS 与短信测试用例",
        "覆盖 IMS DNN、P-CSCF、SIP 注册、VoNR/VoLTE、EPS/RAT Fallback、SMSC、SBC/MGW 冗余和呼叫前转。",
        [
            "TC-IMS-001",
            "SE-IMS-001",
            "SE-IMS-002",
            "SE-IMS-003",
            "CC-IMS-001",
            "CC-IMS-002",
            "CC-IMS-003",
            "CC-IMS-004",
            "CC-IMS-005",
            "CC-IMS-006",
            "CC-IMS-007",
        ],
    ),
    (
        "12. 运维、部署、兼容性与数据同步测试用例",
        "覆盖 OAM、日志跟踪、性能容量、版本一致性、SBI、融合部署、平台兼容、容器化、LMT、审计日志、UDM 开户与同步。",
        [
            "TC-OAM-001",
            "TC-OAM-002",
            "TC-OAM-003",
            "TC-DEP-001",
            "SE-PERF-001",
            "SE-PERF-002",
            "CC-STD-001",
            "CC-SBI-001",
            "CC-FUSION-001",
            "CC-COMP-001",
            "CC-COMP-002",
            "CC-DEP-001",
            "CC-DEP-002",
            "CC-DEP-003",
            "CC-LMT-001",
            "CC-LOG-001",
            "CC-UDM-001",
            "CC-UDM-002",
        ],
    ),
]


SPECIAL_ENV_CASES = {
    "CC-PDU-003",
    "CC-UPF-001",
    "CC-MCAST-001",
    "CC-VLAN-001",
    "CC-L2ROBUST-001",
    "CC-RAN-001",
    "CC-REDCAP-001",
    "CC-REDCAP-002",
    "CC-IOT-001",
    "CC-IOT-002",
    "CC-IMS-002",
    "CC-IMS-004",
    "CC-IMS-005",
    "CC-IMS-006",
    "CC-IMS-007",
    "CC-FUSION-001",
    "CC-COMP-002",
    "CC-DEP-003",
    "CC-UDM-002",
}


def extract_cases(text: str) -> dict[str, str]:
    matches = list(CASE_RE.finditer(text))
    cases: dict[str, str] = {}
    for idx, match in enumerate(matches):
        start = match.start()
        next_case = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        next_boundary = BOUNDARY_RE.search(text, match.end(), next_case)
        end = next_boundary.start() if next_boundary else next_case
        block = text[start:end].strip()
        case_id = match.group(1)
        if case_id in cases:
            raise SystemExit(f"duplicate case id: {case_id}")
        cases[case_id] = block
    return cases


def case_title(block: str) -> str:
    return block.splitlines()[0].removeprefix("### ").strip()


def case_type(case_id: str) -> str:
    if case_id.startswith("SE-") or case_id in SPECIAL_ENV_CASES:
        return "专用环境"
    return "通用环境"


def build_index(cases: dict[str, str]) -> str:
    lines = [
        "| 功能域 | 用例编号 | 用例名称 | 环境类型 |",
        "| --- | --- | --- | --- |",
    ]
    for heading, _, ids in DOMAIN_GROUPS:
        domain = heading.split(". ", 1)[1].replace("测试用例", "").strip()
        for case_id in ids:
            title = case_title(cases[case_id]).replace(case_id, "", 1).strip()
            lines.append(f"| {domain} | {case_id} | {title} | {case_type(case_id)} |")
    return "\n".join(lines)


def build_manual(cases: dict[str, str]) -> str:
    included = [case_id for _, _, ids in DOMAIN_GROUPS for case_id in ids]
    missing = sorted(set(cases) - set(included))
    extra = sorted(set(included) - set(cases))
    if missing or extra:
        raise SystemExit(f"case coverage mismatch: missing={missing}, extra={extra}")
    if len(included) != len(set(included)):
        dupes = sorted({case_id for case_id in included if included.count(case_id) > 1})
        raise SystemExit(f"duplicate case ids in domain groups: {dupes}")

    parts: list[str] = [
        "# 5GC 控标点综合测试手册",
        "",
        "**数据来源:** Google Drive `5GC产品功能清单及控标点-20260402.xlsx` 的 `功能细分` 列  ",
        "**规范参考日期:** 2026-05-23  ",
        "**规范锚点:** 以 3GPP Release 19 为稳定测试锚点，兼顾 Release 20 增强项  ",
        "**测试对象:** Open5GS 5GC、Open5GS-NMS、UERANSIM、5G-LAN、专用 RAN/UE/IMS/安全/性能环境  ",
        "**测试原则:** 104 个独立功能细分均有明确测试用例编号，覆盖正常流程、异常流程、可观测证据和判定标准；原 Excel 105 行中有 1 行为非独立功能明细或合并说明行，覆盖矩阵按 104 个可测试功能点统计。  ",
        "**用例编号说明:** `TC-*` 为基础/主流程用例，`SE-*` 为强依赖专用环境的用例，`CC-*` 为覆盖增强用例；环境分类仅使用 `通用环境` 和 `专用环境` 两类，编号不作为文档分册依据。",
        "",
        "---",
        "",
        "## 1. 文档说明与交付范围",
        "",
        "本手册面向 5GC 控标点验收和回归测试交付，按功能域组织测试内容，避免按来源材料或历史分册拆分。每个用例均给出规范依据、前置条件、正常流程、异常流程、预期结果和证据要求，可用于实验室测试、专网专项验收和产品版本回归。",
        "",
        "交付范围包括：",
        "",
        "1. 5GC 注册、连接、会话、用户面、PFCP、QoS、切片和 SBI 基础流程。",
        "2. 5G-LAN、工业专网、UPF 高可用、双发选收、TSN 和下挂设备发现。",
        "3. 白名单、国密、HSM、安全存储、异常信令、违规外联和过载防护。",
        "4. RedCap、Cat.1、NB-IoT、IMS、短信、语音和互操作业务。",
        "5. OAM、部署升级、性能容量、日志审计、UDM 开户与大网数据同步。",
        "",
        "## 2. 3GPP 参考基线",
        "",
        "| 领域 | 主要规范 | 用途 |",
        "| --- | --- | --- |",
        "| 5GS 架构 | TS 23.501 | AMF/SMF/UPF/UDM/PCF/NRF/NSSF、PDU Session、QoS、切片、5G LAN 架构依据 |",
        "| 5GS 流程 | TS 23.502 | 注册、去注册、业务请求、PDU Session 建立/修改/释放、寻呼、切片选择流程依据 |",
        "| 策略与 QoS | TS 23.503 | PCC、QoS Flow、QoS Rule、AMBR/MFBR、切片策略依据 |",
        "| NAS 协议 | TS 24.501 | 5GMM/5GSM、注册拒绝、会话拒绝、去注册、NAS 安全流程依据 |",
        "| SBI 接口 | TS 29.500/29.502/29.503/29.510/29.512 | AMF/SMF/UDM/PCF/NRF 服务接口与异常响应依据 |",
        "| PFCP/N4 | TS 29.244 | PFCP Association、Session Establishment/Modification/Deletion、PDR/FAR/QER/URR 依据 |",
        "| NGAP/N2 | TS 38.413 | NG Setup、UE Context、PDU Session Resource、Paging、Handover 信令依据 |",
        "| 安全 | TS 33.501 | SUPI/SUCI、鉴权、NAS 安全、用户面安全、密钥派生依据 |",
        "| 管理与 KPI | TS 28.554 等 SA5 规范 | 性能采集、KPI、网管验收依据 |",
        "",
        "> 说明：当前 3GPP Portal 显示 TS 23.501 Release 19 最新可见版本为 19.7.0，Release 20 已有 20.1.0；测试验收建议以 Release 19 为稳定基线，Release 20 作为增强项跟踪。",
        "",
        "## 3. 测试环境、准入与证据要求",
        "",
        "### 3.1 通用环境",
        "",
        "| 组件 | 用途 |",
        "| --- | --- |",
        "| Open5GS NRF/AMF/SMF/UPF/AUSF/UDM/UDR/PCF/NSSF | 5GC 被测系统 |",
        "| Open5GS-NMS | 用户、DNN、切片、策略、安全与运维配置面 |",
        "| MongoDB | 订阅数据、策略与测试数据存储 |",
        "| UERANSIM | gNB/UE、注册、PDU Session、切片和 NAS 流程模拟 |",
        "| `tests/5glan/` | Ethernet PDU、5G-LAN L2/L3、UPF HA 相关测试资产 |",
        "| tcpdump/tshark/scapy | N2/NAS/N4/N3/N6/以太网帧抓包与断言 |",
        "| curl/jq | SBI、NMS API、Prometheus/metrics 验证 |",
        "",
        "### 3.2 专用环境",
        "",
        "| 环境类别 | 典型资源 | 适用用例 |",
        "| --- | --- | --- |",
        "| RAN/切换 | 支持 Xn/N2 切换的双 gNB、4G/5G 互操作环境 | SE-HO、CC-RAN |",
        "| 高可靠用户面 | 双 UPF、双链路、故障注入、同步网络 | TC-HA、SE-HA、SE-RED |",
        "| 工业以太网 | 5G-LAN 终端、交换机、VLAN、组播、PTP/TSN 设备 | TC-5GLAN、CC-MCAST、CC-VLAN、SE-TSN |",
        "| 安全/密码 | 国密 USIM、密码机/HSM、IPSec 网关、安全审计系统 | SE-GM、SE-HSM、SE-IPSEC、SE-DEF |",
        "| IMS/语音 | IMS Core、SBC/MGW、SMSC、PSTN 或运营商互通模拟器 | TC-IMS、SE-IMS、CC-IMS |",
        "| 性能容量 | 批量 UE/gNB 模拟器、流量发生器、KPI/告警采集平台 | TC-OAM、SE-PERF |",
        "",
        "### 3.3 启动检查",
        "",
        "```bash",
        "cd /work/open5gs-src",
        "",
        "open5gs-nrfd --version",
        "open5gs-amfd --version",
        "open5gs-smfd --version",
        "open5gs-upfd --version",
        "",
        "sudo ss -lntup | grep -E '7777|38412|8805|2152'",
        "curl -s http://127.0.0.10:7777/nnrf-nfm/v1/nf-instances | jq .",
        "```",
        "",
        "**通过标准**",
        "",
        "- NRF、AMF、SMF、UPF、AUSF、UDM、UDR、PCF 进程启动。",
        "- AMF 监听 N2/SCTP，UPF 监听 N4/PFCP 和 N3/GTP-U。",
        "- NRF 可查询到已注册 NF。",
        "",
        "### 3.4 准入与退出",
        "",
        "**准入条件**",
        "",
        "- 基础 5GC 冒烟用例已通过，至少包括注册、PDU Session、N3/N6、PFCP。",
        "- 专用设备的版本、授权、配置、时间同步和恢复方案已确认。",
        "- 抓包、日志、KPI、NMS 告警和测试报告目录已预演。",
        "",
        "**退出条件**",
        "",
        "- 每个已执行用例都有结论、证据目录、失败项和复测建议。",
        "- 未执行用例说明缺少的设备、软件、外部系统或替代证据。",
        "- S1/S2 缺陷有明确归属和复测计划。",
        "",
        "### 3.5 证据目录建议",
        "",
        "```text",
        "test-results-control-point/",
        "  00-env/",
        "    topology.png",
        "    versions.txt",
        "    configs.tar.gz",
        "  01-logs/",
        "    amf.log",
        "    smf.log",
        "    upf-a.log",
        "    upf-b.log",
        "    nms.log",
        "  02-pcaps/",
        "    n2.pcap",
        "    n3-before-after.pcap",
        "    n4.pcap",
        "    n6.pcap",
        "    sip-ims.pcap",
        "  03-kpi/",
        "    latency.csv",
        "    packet-loss.csv",
        "    nf-metrics.json",
        "  04-reports/",
        "    summary.md",
        "    defects.md",
        "```",
        "",
        "## 4. 测试用例索引",
        "",
        build_index(cases),
        "",
    ]

    for heading, description, ids in DOMAIN_GROUPS:
        parts.extend(["---", "", f"## {heading}", "", description, ""])
        for case_id in ids:
            parts.extend([cases[case_id], ""])

    parts.extend(
        [
            "---",
            "",
            "## 13. 执行优先级与判定标准",
            "",
            "### 13.1 优先级建议",
            "",
            "| 优先级 | 用例范围 |",
            "| --- | --- |",
            "| P0 必测 | TC-REG-001、TC-PDU-001、TC-PDU-002、TC-UP-001、TC-PFCP-001、TC-PFCP-002、TC-5GLAN-001、TC-5GLAN-003、TC-WL-001、TC-WL-002、SE-HA-002、SE-DEF-001、CC-STD-001、CC-SBI-001 |",
            "| P1 重点增强 | 连接/寻呼/切片/QoS、5G-LAN VLAN/组播/健壮性、UPF HA、国密、安全存储、计费、能力开放、IMS 基础能力、OAM 配置与日志 |",
            "| P2 专项验收 | 切换互操作、TSN、双发选收性能指标、RedCap/Cat.1/NB-IoT、IMS 并发/互通、国产化平台、容器化、容量压测 |",
            "",
            "### 13.2 推荐执行顺序",
            "",
            "1. 基础 5GC 冒烟：TC-REG-001、TC-PDU-001、TC-UP-001。",
            "2. N4/NAS 稳定性：TC-PFCP-001、TC-PFCP-002、TC-CONN-001、TC-SR-001。",
            "3. 切片、策略与计费：TC-SLICE-001、TC-SLICE-002、TC-QOS-001、CC-PCF-001、CC-CHG-001。",
            "4. 5G-LAN 与工业专网：TC-PDU-003、TC-5GLAN-001、TC-5GLAN-002、TC-5GLAN-003、CC-MCAST-001、CC-VLAN-001、SE-TSN-001。",
            "5. 高可靠与安全：TC-HA-001、SE-HA-002、SE-RED-001、TC-WL-001、TC-WL-002、TC-SEC-001、SE-GM-001、SE-DEF-001。",
            "6. 语音、IoT 与互操作：TC-IMS-001、SE-IMS-001、CC-IMS-005、CC-REDCAP-001、CC-IOT-001。",
            "7. 运维部署与数据同步：TC-OAM-001、TC-OAM-002、TC-OAM-003、TC-DEP-001、CC-UDM-001、CC-UDM-002。",
            "",
            "### 13.3 通过/失败判定",
            "",
            "- 正常流程完成，且关键消息、日志、抓包、API 响应或 KPI 证据齐全。",
            "- 异常流程触发预期 Cause、告警、拒绝、回滚、隔离或限流行为。",
            "- 异常流程不导致核心网进程崩溃、残留会话、错误转发或敏感信息泄露。",
            "- P0 用例全部通过；P1/P2 如受专用环境限制未执行，必须说明未测原因和替代证据。",
            "- 已知环境噪声只能降级为 WARN，不得掩盖核心流程失败。",
            "",
            "| 等级 | 定义 |",
            "| --- | --- |",
            "| S1 | 进程崩溃、注册/PDU 基础流程不可用、非法接入放行、用户面错误转发、安全策略失效 |",
            "| S2 | 单功能失败、异常流程 Cause 错误、状态残留、告警缺失、同步错误、回滚失败 |",
            "| S3 | 日志不完整、错误信息不清晰、统计不准确、文档或脚本可用性问题 |",
            "",
            "## 14. 参考链接",
            "",
            "- 3GPP Release 19: https://www.3gpp.org/specifications-technologies/releases/release-19",
            "- 3GPP 5G System overview: https://www.3gpp.org/technologies/5g-system-overview",
            "- TS 23.501: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3144",
            "- TS 23.502: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3145",
            "- TS 24.501: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3370",
            "- TS 29.244: https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3111",
            "",
        ]
    )
    return "\n".join(parts)


def main() -> None:
    text = MANUAL.read_text(encoding="utf-8")
    cases = extract_cases(text)
    rebuilt = build_manual(cases)
    MANUAL.write_text(rebuilt, encoding="utf-8")
    print(f"rewrote {MANUAL} with {len(cases)} test cases")


if __name__ == "__main__":
    main()
