# Validation Plan: REQ-2.11-P3-001

## 1. Metadata
- **ADU ID:** REQ-2.11-P3-001
- **ADU Title:** 链路检测 ping 功能 (Link Diagnostics Ping Feature)
- **Target State:** `test_red`
- **Focus:** Backend Link Diagnostics API, Input Sanitization (Anti-Injection), Multi-Platform Ping Execution, and React operator frontend view.

---

## 2. Objective
Validate that the NMS provides a robust, safe, and authenticated link diagnostics ping feature toward gNodeB base stations or business servers. The validation suite ensures that the backend and frontend are properly structured, inputs are sanitized against command injection vectors, ping arguments adapt dynamically to macOS vs Linux hosts, and compilation/tests run with zero errors.

---

## 3. Required Commands (ADU Registry)

The validation plan requires executing the following exact validation commands from the ADU registry:

### 3.1 ADU Registry JSON Validation
```bash
python3 -m json.tool .ai-agent/registry/adu.json
```
*Purpose: Verifies the integrity of the ADU registry file.*

### 3.2 Agent Config JSON Validation
```bash
python3 -m json.tool .ai-agent/registry/agents.json
```
*Purpose: Verifies that the Agent execution configuration remains well-formed.*

### 3.3 Backend Code Compilation
```bash
cd open5gs-nms/backend && npm run build
```
*Purpose: Confirms backend TypeScript code compiles cleanly to ES modules/JavaScript.*

### 3.4 Frontend Code Compilation
```bash
cd open5gs-nms/frontend && npm run build
```
*Purpose: Confirms React and Tailwind frontend assets build without errors.*

### 3.5 Monitor Test Harness
```bash
cd open5gs-nms/backend && npm run test:monitor
```
*Purpose: Verifies existing monitor suite tests pass successfully.*

---

## 4. Key Functional & Technical Verifications

To guide the Developer and BuildFix-Debugger agents, the validation plan checks the following four critical modules:

### 4.1 Backend Endpoint Security and Sanitization
- **Path:** `POST /api/link-diagnostics`
- **Authentication:** Must require Express `authMiddleware`.
- **Target Sanitization:** Regex must strictly filter `target` to block spaces, wildcards, semicolons, or redirection characters. Standard IPv4/IPv6 and FQDN hosts only:
  - Allowed: `127.0.0.1`, `8.8.8.8`, `google.com`, `gnodeb-base-station.local`
  - Blocked: `127.0.0.1; rm -rf /`, `8.8.8.8 && ls`, `cat /etc/passwd`
- **Boundary Sanitization:**
  - `count` must be restricted to integers between `1` and `10` (default `4`).
  - `timeout` must be restricted to integers between `1` and `15` seconds (default `5`).

### 4.2 Multi-Platform Execution & Parsing Logic
- **Process platform branching:**
  - On Darwin (macOS): `ping -c <count> -t <timeout> <target>`
  - On Linux (Ubuntu/Debian): `ping -c <count> -W <timeout> <target>`
- **Output Regex Extraction:**
  - Packet loss percentage extraction matching `/(\d+(?:\.\d+)?)%\s+packet\s+loss/`.
  - Latency round-trip metrics (min/avg/max/stddev or mdev) matching `/(?:round-trip|rtt) min\/avg\/max\/(?:stddev|mdev) = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+) ms/`.

### 4.3 React operator frontend view
- **Path:** `LinkDiagnosticsPage.tsx`
- **Fields:** Dark-themed inputs for target hostname/IP, packet count, and timeout seconds.
- **Display:** Displays a card grid for metrics (reachability status, packet loss, min/avg/max latency) and a clean terminal-style container showing raw stdout/stderr logs.

---

## 5. Acceptance Criteria
The overall ADU validation is successful if and only if:
1. All commands in Section 3 finish with exit status `0`.
2. The compilation steps for backend and frontend produce zero TypeScript or build environment errors.
3. No code changes are introduced outside of the allowed write paths.
4. Input validation blocks malicious ping targets and throws proper `400 Bad Request` responses on invalid inputs.

---

## 6. Risk Assessment
- **Command Injection Risk:** Very low. Input sanitation is strictly locked via Regex, and `IHostExecutor` uses child-process arguments without a shell layer.
- **Production Impact:** None. All core C-based 5GC network systems are untouched.
