#!/usr/bin/env python3
"""Create an internal-company version of the 5G product test manual."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "control-point-integrated-test-manual-3gpp.md"
OUT = ROOT / "company-internal-5g-product-test-manual-3gpp.md"


PATH_REPLACEMENTS = {
    "open5gs/tests/regression/core-p0/test_core_p0.py": "内部自动化测试套件/core-p0",
    "open5gs/tests/5glan/test_l2_switch.py": "内部自动化测试套件/5glan-l2-switch",
    "open5gs/tests/5glan/test_l2_l3_gateway.py": "内部自动化测试套件/5glan-l2-l3-gateway",
    "open5gs/tests/ha/test_ha.sh": "内部自动化测试套件/upf-ha",
    "open5gs/tests/regression/run_regression_separated.py": "内部自动化测试套件/regression-separated",
    "open5gs/docs/features/5g-lan-ethernet/r3-test-manual.md": "内部设计文档/5g-lan-ethernet/r3-test-manual.md",
}


CASE_RE = re.compile(r"^### ((?:TC|SE|CC)-[A-Z0-9-]+)\s*(.*)$")
COVERAGE_RE = re.compile(r"^\*\*覆盖[:：]\*\*\s*(.+?)\s*$")


def build_case_mapping(text: str) -> dict[str, str]:
    lines = text.splitlines()
    mapping: dict[str, str] = {}
    current_id: str | None = None
    current_title = ""
    current_coverage: str | None = None

    def flush() -> None:
        if not current_id:
            return
        value = current_coverage or current_title
        value = value.replace("。", "").strip()
        mapping[current_id] = value

    for line in lines:
        case_match = CASE_RE.match(line)
        if case_match:
            flush()
            current_id, current_title = case_match.groups()
            current_title = current_title.strip()
            current_coverage = None
            continue
        if current_id:
            coverage_match = COVERAGE_RE.match(line.strip())
            if coverage_match and not current_coverage:
                current_coverage = coverage_match.group(1).strip()
    flush()
    return mapping


def add_function_mapping_column(text: str) -> str:
    mapping = build_case_mapping(text)
    lines = text.splitlines()
    out: list[str] = []
    in_index = False
    for line in lines:
        if line == "| 功能域 | 用例编号 | 用例名称 | 环境类型 |":
            out.append("| 功能域 | 用例编号 | 用例名称 | 对应功能细分 | 环境类型 |")
            in_index = True
            continue
        if in_index and line == "| --- | --- | --- | --- |":
            out.append("| --- | --- | --- | --- | --- |")
            continue
        if in_index:
            if not line.startswith("|"):
                in_index = False
                out.append(line)
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) == 4:
                case_id = cells[1]
                function_detail = mapping.get(case_id, cells[2])
                out.append(
                    f"| {cells[0]} | {cells[1]} | {cells[2]} | {function_detail} | {cells[3]} |"
                )
                continue
        out.append(line)
    return "\n".join(out) + "\n"


def replace_code_block(text: str) -> str:
    old = """```bash
cd /work/open5gs-src

open5gs-nrfd --version
open5gs-amfd --version
open5gs-smfd --version
open5gs-upfd --version

sudo ss -lntup | grep -E '7777|38412|8805|2152'
curl -s http://127.0.0.10:7777/nnrf-nfm/v1/nf-instances | jq .
```"""
    new = """```bash
cd <公司5GC产品测试工程目录>

5gc-nrf --version
5gc-amf --version
5gc-smf --version
5gc-upf --version

sudo ss -lntup | grep -E '7777|38412|8805|2152'
curl -s http://127.0.0.10:7777/nnrf-nfm/v1/nf-instances | jq .
```"""
    return text.replace(old, new)


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    text = replace_code_block(text)

    replacements = [
        ("# 5GC 控标点综合测试手册", "# 公司 5G 产品功能测试手册"),
        ("**数据来源:** Google Drive `5GC产品功能清单及控标点-20260402.xlsx` 的 `功能细分` 列", "**数据来源:** 公司 5G 产品功能清单及控标点清单的 `功能细分` 列"),
        ("**测试对象:** Open5GS 5GC、Open5GS-NMS、UERANSIM、5G-LAN、专用 RAN/UE/IMS/安全/性能环境", "**测试对象:** 公司 5GC 核心网产品、公司 5GC 网管平台、UE/gNB 模拟器或测试仪表、5G-LAN、专用 RAN/UE/IMS/安全/性能环境"),
        ("Open5GS NRF/AMF/SMF/UPF/AUSF/UDM/UDR/PCF/NSSF", "公司 5GC 核心网 NF（NRF/AMF/SMF/UPF/AUSF/UDM/UDR/PCF/NSSF）"),
        ("Open5GS-NMS", "公司 5GC 网管平台"),
        ("Open5GS 5GC", "公司 5GC 核心网"),
        ("Open5GS AMF/SMF/UPF", "公司 5GC AMF/SMF/UPF"),
        ("Open5GS", "公司 5GC 产品"),
        ("UERANSIM", "UE/gNB 模拟器或测试仪表"),
        ("MongoDB", "产品数据库"),
        ("`tests/5glan/`", "5G-LAN 自动化测试套件"),
        ("`功能细分`", "`功能细分`"),
        ("本手册面向 5GC 控标点验收和回归测试交付", "本手册面向公司内部测试和研发人员，用于公司现有 5G 产品功能项的验收、回归和缺陷复现"),
        ("可用于实验室测试、专网专项验收和产品版本回归。", "可用于实验室测试、专网专项验收、版本回归、研发自测和问题定位。"),
        ("5GC 被测系统", "公司 5GC 被测系统"),
        ("用户、DNN、切片、策略、安全与运维配置面", "用户、DNN、切片、策略、安全与运维配置面"),
        ("mngosh open5gs", "mongosh <产品数据库>"),
        ("mongosh open5gs", "mongosh <产品数据库>"),
        ("cd /work/open5gs-src", "cd <公司5GC产品测试工程目录>"),
        ("在 x86_64 安装公司 5GC 产品 5GC 和 NMS。", "在 x86_64 环境安装公司 5GC 核心网和网管平台。"),
    ]
    for old, new in replacements:
        text = text.replace(old, new)

    for old, new in PATH_REPLACEMENTS.items():
        text = text.replace(old, new)

    text = re.sub(r"open5gs-[a-z0-9_-]+", lambda m: m.group(0).replace("open5gs", "5gc"), text, flags=re.I)
    text = re.sub(r"open5gs", "company-5g-product", text, flags=re.I)
    text = text.replace("/Users/hill/company-5g-product", "<内部工作目录>")
    text = text.replace("/work/company-5g-product-src", "<公司5GC产品测试工程目录>")
    text = text.replace("NMS", "网管平台")
    text = text.replace("nms.log", "management.log")
    text = text.replace("company-5g-product", "公司 5GC 产品")
    text = text.replace("安装 公司 5GC 核心网 和 网管平台", "安装公司 5GC 核心网和网管平台")

    if re.search(r"open5gs", text, re.I):
        raise SystemExit("internal manual still contains Open5GS naming")

    text = add_function_mapping_column(text)

    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
