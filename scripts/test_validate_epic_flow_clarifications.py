#!/usr/bin/env python3
import sys
import pathlib
import hashlib

sys.path.append(str(pathlib.Path(__file__).resolve().parent))
import validate_epic_flow

def run_tests():
    print("Running validate_epic_flow clarification tests...")
    
    # Set mock fail
    def mock_fail(msg):
        raise AssertionError(msg)
    validate_epic_flow.fail = mock_fail

    # Common clarifications for EPIC-2026-1351
    clarifications = [
        {
            "question": "License 文件采用何种具体格式和编码？是否推荐采用带签名的 JSON (JWK/JWT) 或加密二进制格式以防篡改？",
            "answer": "License 文件使用带 RSA 数字签名的 JSON 格式。JSON 保存授权内容和签名信息，不使用不透明二进制格式。",
            "status": "answered",
            "impact": "design"
        },
        {
            "question": "当 UPF 吞吐率超出 License 限制时，应该采取何种丢包策略？是否需要令牌桶 (Token Bucket) 机制进行平滑限速？",
            "answer": "超过 License 吞吐率上限时直接丢包，不要求实现高精度排队整形；实现需保证快速路径性能 and 可观测的超限丢包计数。",
            "status": "answered",
            "impact": "implementation"
        },
        {
            "question": "License 的有效期过期或文件缺失等异常情况，应该执行什么失败策略 (Fail-Closed 拒绝工作，还是 Fail-Safe/Fail-Open 进入降级演示模式)？",
            "answer": "采用 Fail-Closed。License 文件缺失、过期、签名无效、内容损坏或配置非法时，相关 Open5GS 服务必须拒绝启动，并输出明确错误原因。",
            "status": "answered",
            "impact": "acceptance_criteria"
        },
        {
            "question": "授权状态查询机制应该通过何种接口暴露？是通过新增一个 WebUI API 接口，还是通过 Prometheus 指标供网管监控？",
            "answer": "通过 WebUI 提供 License 状态查询页面及相应后端 API，展示有效性、有效期、签约用户上限与当前用量、UPF 吞吐上限及当前统计状态。",
            "status": "answered",
            "impact": "design"
        }
    ]

    def get_sha256(text: str) -> str:
        return "sha256:" + hashlib.sha256(text.strip().encode("utf-8")).hexdigest()

    valid_traceability = [
        {
            "question_hash": get_sha256(clarifications[0]["question"]),
            "decision": "RSA",
            "applied_to": ["OP-01"]
        },
        {
            "question_hash": get_sha256(clarifications[1]["question"]),
            "decision": "直接丢包",
            "applied_to": ["OP-02"]
        },
        {
            "question_hash": get_sha256(clarifications[2]["question"]),
            "decision": "Fail-Closed",
            "applied_to": ["OP-03"]
        },
        {
            "question_hash": get_sha256(clarifications[3]["question"]),
            "decision": "WebUI API",
            "applied_to": ["OP-04"]
        }
    ]

    base_flow = {
        "epic_id": "EPIC-2026-1351",
        "business_operations": [
            {"id": "OP-01", "name": "加载 License", "entrypoints": ["CLI"], "state_changes": ["None"], "runtime_effects": ["None"]},
            {"id": "OP-02", "name": "限速校验", "entrypoints": ["CLI"], "state_changes": ["None"], "runtime_effects": ["None"]},
            {"id": "OP-03", "name": "服务守卫", "entrypoints": ["CLI"], "state_changes": ["None"], "runtime_effects": ["None"]},
            {"id": "OP-04", "name": "状态查询", "entrypoints": ["CLI"], "state_changes": ["None"], "runtime_effects": ["None"]}
        ],
        "acceptance_points": [
            "A-ACCEPT-1", "A-ACCEPT-2"
        ],
        "clarification_traceability": valid_traceability,
        "open_questions": []
    }

    # Case 1: Pass with valid flow
    print("Testing Case 1: Valid flow passing...")
    validate_epic_flow.check_clarification_consistency(base_flow, clarifications)

    # Case 2: Reopened answered question in open_questions
    print("Testing Case 2: Reopened question in open_questions...")
    import copy
    flow = copy.deepcopy(base_flow)
    flow["open_questions"] = ["License 文件采用何种具体格式和编码？是否推荐采用带签名的 JSON (JWK/JWT) 或加密二进制格式以防篡改？"]
    try:
        validate_epic_flow.check_clarification_consistency(flow, clarifications)
        assert False, "Expected reopen failure"
    except AssertionError as e:
        assert "reopened in open_questions" in str(e), f"Unexpected error message: {e}"

    # Case 3: Missing traceability for answered clarification
    print("Testing Case 3: Missing traceability...")
    flow = copy.deepcopy(base_flow)
    flow["clarification_traceability"] = valid_traceability[1:] # Drop first one
    try:
        validate_epic_flow.check_clarification_consistency(flow, clarifications)
        assert False, "Expected missing traceability failure"
    except AssertionError as e:
        assert "missing from clarification_traceability" in str(e), f"Unexpected error message: {e}"

    # Case 4: Token Bucket conflict (natural language conflict 1)
    print("Testing Case 4: Token Bucket conflict...")
    flow = copy.deepcopy(base_flow)
    flow["business_operations"][1]["name"] = "使用令牌桶平滑限速"
    try:
        validate_epic_flow.check_clarification_consistency(flow, clarifications)
        assert False, "Expected token bucket conflict"
    except AssertionError as e:
        assert "不使用令牌桶" in str(e), f"Unexpected error message: {e}"

    # Case 5: Fail-Open conflict (natural language conflict 2)
    print("Testing Case 5: Fail-Open conflict...")
    flow = copy.deepcopy(base_flow)
    flow["acceptance_points"].append("当过期时执行 fail-open 降级演示")
    try:
        validate_epic_flow.check_clarification_consistency(flow, clarifications)
        assert False, "Expected fail-open conflict"
    except AssertionError as e:
        assert "严禁 Fail-Open" in str(e), f"Unexpected error message: {e}"

    # Case 6: Prometheus conflict (natural language conflict 3)
    print("Testing Case 6: Prometheus conflict...")
    flow = copy.deepcopy(base_flow)
    flow["business_operations"][3]["runtime_effects"] = ["上报指标给 prometheus"]
    try:
        validate_epic_flow.check_clarification_consistency(flow, clarifications)
        assert False, "Expected prometheus conflict"
    except AssertionError as e:
        assert "不使用 Prometheus" in str(e), f"Unexpected error message: {e}"

    print("✅ All validate_epic_flow clarification tests passed!")

if __name__ == "__main__":
    try:
        run_tests()
    except Exception as e:
        print(f"Test failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
