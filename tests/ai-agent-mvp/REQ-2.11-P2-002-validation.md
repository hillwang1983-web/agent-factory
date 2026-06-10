# Validation Plan: REQ-2.11-P2-002

## 1. Metadata
- **ADU ID:** REQ-2.11-P2-002
- **ADU Title:** 5G LAN 配置简化与Subscriber向导下发 (5G LAN Config Simplification & Subscriber Wizard Provisioning)
- **Target State:** `test_red`
- **Target Level:** L3
- **Focus:** Backend REST API (5glan-config-controller), SQLite transactional persistence (DmSubscriberRepository), dual-write MongoDB coordination (WizardSubmitUseCase), and React 4-step wizard UI (5gLanConfigWizard.tsx).

---

## 2. Objective

Validate that the NMS provides a secure, transactional 5G LAN subscriber provisioning flow:
- Wizard-based UI guides operators through VN group selection, profile, security keys, and summary.
- Backend REST endpoints validate all inputs via Zod, enforce RBAC (admin role required for write), and execute dual-write transactional persistence (SQLite + MongoDB) with proper rollback on any failure.
- Automatic 5G LAN group signing injects Ethernet PDU session (type=5, 5QI=9, ARP priority=8) without manual JSON construction.
- All new functions have verified call sites; no dead code, placeholders, or data-path TODOs.

---

## 3. Required Commands (ADU Registry)

The validation plan requires executing the following exact commands from the ADU registry:

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
cd open5gs-nms/backend && npm run build 2>&1
```
*Purpose: Confirms backend TypeScript code compiles cleanly with zero errors.*

### 3.4 Frontend Code Compilation
```bash
cd open5gs-nms/frontend && npm run build 2>&1
```
*Purpose: Confirms React + Vite + Tailwind frontend builds without errors.*

### 3.5 Call Site Compliance Verification (git grep)
```bash
git grep -n 'create5gLanConfigRouter\|WizardSubmitUseCase\|DmSubscriberRepository\|VnGroupEntity' -- open5gs-nms/
```
*Purpose: Every exported function symbol has at least one call site outside its definition file. If any function appears only in its own definition file, the implementation fails AC-6.*

### 3.6 Database File Existence Check
```bash
test -f open5gs-nms/backend/data/dameng.db || echo 'DB not yet created (expected before test run)'
```
*Purpose: Confirms the SQLite proxy database file exists at the expected path. The file is created by DmSubscriberRepository on first use.*

---

## 4. Acceptance Criteria Mapping

The contract defines 8 acceptance criteria. Each maps to specific verification steps:

### AC-1: Relational Transaction Success
| Field | Value |
|---|---|
| **Method** | POST /api/5glan-config/wizard-submit with valid payload |
| **Expected** | 201 Created. All 4 SQL tables (dm_subscribers, dm_subscriber_security, dm_subscriber_slices, dm_subscriber_sessions) populated with correct FK relationships. MongoDB subscriber document also created. |
| **Verification** | `TX-OK-001`: Submit valid payload, inspect both databases |

### AC-2: Transaction Rollback on Duplicate IMSI
| Field | Value |
|---|---|
| **Method** | POST /api/5glan-config/wizard-submit with an IMSI already in SQLite |
| **Expected** | 409 Conflict. Zero records in SQLite tables; zero records in MongoDB. |
| **Verification** | `TX-FAIL-DUP-001`: Submit duplicate IMSI, verify clean rollback |

### AC-3: Automated 5G LAN Ethernet Binding
| Field | Value |
|---|---|
| **Method** | Inspect saved MongoDB subscriber document |
| **Expected** | Slice SST matches VN group SST. Session DNN matches VN group DNN. Session type = 5 (Ethernet). QoS index = 9, ARP priority = 8. |
| **Verification** | `TX-OK-001`: Post-commit inspection of MongoDB document fields |

### AC-4: Build Integration
| Field | Value |
|---|---|
| **Method** | npm run build (backend + frontend) |
| **Expected** | Clean TypeScript compilation, zero errors, zero broken imports. |
| **Verification** | Commands 3.3 and 3.4 exit code 0 |

### AC-5: RBAC Enforced
| Field | Value |
|---|---|
| **Method** | POST with viewer session |
| **Expected** | 403 Forbidden. No records created in either database. |
| **Verification** | Submit with viewer cookie, verify 403 response and zero DB records |

### AC-6: Active Call Site Compliance
| Field | Value |
|---|---|
| **Method** | git grep on all new functions |
| **Expected** | No dead code. Every exported function has at least one call site outside its definition file. |
| **Verification** | Command 3.5 — each symbol appears in at least 2 files (definition + call site) |

### AC-7: VN Group Not Found
| Field | Value |
|---|---|
| **Method** | POST with invalid vn_group_name |
| **Expected** | 400 Bad Request with clear error message. No database writes. |
| **Verification** | Submit with non-existent group, verify 400 and zero DB records |

### AC-8: Validation Rejects Invalid Keys
| Field | Value |
|---|---|
| **Method** | POST with K < 32 hex chars or invalid AMF |
| **Expected** | 400 Bad Request with Zod validation error details. |
| **Verification** | `VAL-HEX-001`: Submit 31-char K, verify rejection; submit 3-char AMF, verify rejection |

---

## 5. Detailed Test Cases

The following test cases are derived from the detailed design (Section 7) and must be executed in order.

### 5.1 DDL & Schema Tests

#### REL-DDL-001: SQL Schema Creation
- **Operation:** Call `DmSubscriberRepository.initSchema()` and verify table structure.
- **Expected:**
  - Table `dm_subscribers` exists with columns: imsi (PK), nickname, iccid, subscriber_status, access_restriction_data, network_access_mode, subscribed_rau_tau_timer, ambr_downlink, ambr_downlink_unit, ambr_uplink, ambr_uplink_unit, created_at, updated_at.
  - Table `dm_subscriber_security` exists with columns: imsi (PK/FK), k, amf, opc. FK references dm_subscribers with CASCADE.
  - Table `dm_subscriber_slices` exists with columns: id (PK autoincrement), imsi (FK), sst, sd, default_indicator. FK references dm_subscribers with CASCADE.
  - Table `dm_subscriber_sessions` exists with columns: id (PK autoincrement), slice_id (FK), name, type, qos_index, qos_arp_priority, qos_arp_pre_emption_cap, qos_arp_pre_emption_vul, ambr_downlink, ambr_downlink_unit, ambr_uplink, ambr_uplink_unit. FK references dm_subscriber_slices with CASCADE.
  - Index `idx_dm_slices_imsi` on dm_subscriber_slices(imsi).
  - Index `idx_dm_sessions_slice_id` on dm_subscriber_sessions(slice_id).

### 5.2 Validation Tests

#### VAL-HEX-001: Hex Key Length Rejection
- **Operation:** POST /api/5glan-config/wizard-submit with K of 31 hex chars.
- **Expected:** 400 Bad Request. Response body contains Zod validation error referencing the K field. No DB writes.
- **Operation (variant):** POST with K of 33 hex chars.
- **Expected:** 400 Bad Request.
- **Operation (variant):** POST with K valid (32 chars) but AMF of 3 hex chars.
- **Expected:** 400 Bad Request. Response body contains "AMF must be 4 hex chars".
- **Operation (variant):** POST with OPc of 32 chars but containing non-hex character 'g'.
- **Expected:** 400 Bad Request.

#### VAL-FQDN-001: FQDN Label Length Rejection
- **Operation:** POST with a group_id containing a dot-separated segment of 64 characters.
- **Expected:** 400 Bad Request. Response body contains "Group/DNN labels must not exceed 63 characters (ogs_fqdn_build limit)". No DB writes.

#### VAL-IMSI-001: IMSI Format Rejection
- **Operation:** POST with IMSI of 14 digits.
- **Expected:** 400 Bad Request. "IMSI must be exactly 15 digits".
- **Operation (variant):** POST with IMSI containing non-digit character.
- **Expected:** 400 Bad Request.

#### VAL-MISSING-001: Missing Required Fields
- **Operation:** POST with missing `imsi` field.
- **Expected:** 400 Bad Request. Zod indicates `imsi` is required.
- **Operation (variant):** POST with missing `security.k` field.
- **Expected:** 400 Bad Request.
- **Operation (variant):** POST with missing `ambr.uplink.value` field.
- **Expected:** 400 Bad Request.

### 5.3 Transactional & Dual-Write Integration Tests

#### TX-OK-001: Successful Dual-Write Submission
- **Precondition:** VN group "factory-lan-1" exists in config (DNN=factory, SST=1, SD=000001).
- **Operation:** POST /api/5glan-config/wizard-submit with valid payload:
  ```json
  {
    "imsi": "001010000000001",
    "vn_group_name": "factory-lan-1",
    "nickname": "PLC-Industrial-Robot-A",
    "iccid": "8986000000000000001",
    "msisdn": "13800000001",
    "security": {
      "k": "00112233445566778899aabbccddeeff",
      "opc": "ffeeddccbbaa99887766554433221100",
      "amf": "8000"
    },
    "ambr": {
      "uplink": { "value": 1000, "unit": 1 },
      "downlink": { "value": 1000, "unit": 1 }
    }
  }
  ```
- **Expected:** 201 Created. Response body:
  ```json
  {
    "success": true,
    "data": {
      "imsi": "001010000000001",
      "vn_group": "factory-lan-1",
      "slices_created": 1,
      "sessions_created": 1
    }
  }
  ```
- **Post-verification (SQLite):**
  - `dm_subscribers` has 1 row with imsi="001010000000001".
  - `dm_subscriber_security` has 1 row linked by imsi FK.
  - `dm_subscriber_slices` has 1 row with sst=1, sd="000001".
  - `dm_subscriber_sessions` has 1 row with type=5, qos_index=9, qos_arp_priority=8, name="factory".
- **Post-verification (MongoDB):**
  - `subscribers` collection has document with imsi="001010000000001".
  - Document contains `slice[0].sst === 1` and `slice[0].sd === "000001"`.
  - First session in slice has `type === 5` (Ethernet PDU).
  - First session has `qos.index === 9` and `qos.arp.priority_level === 8`.
  - First session has `name === "factory"` (matching VN group DNN).

#### TX-FAIL-DUP-001: Duplicate IMSI Rollback
- **Precondition:** IMSI "001010000000001" already exists from TX-OK-001.
- **Operation:** POST the exact same payload again.
- **Expected:** 409 Conflict. Response body:
  ```json
  {
    "success": false,
    "error": "Subscriber with IMSI 001010000000001 already exists"
  }
  ```
- **Post-verification:**
  - SQLite `dm_subscribers` still has exactly 1 row (no duplicate).
  - SQLite `dm_subscriber_slices` still has exactly 1 row.
  - MongoDB `subscribers` still has exactly 1 document for this IMSI.
  - No partial records in any table.

#### TX-FAIL-MONGO-001: MongoDB Failure Triggers SQL Rollback
- **Precondition:** MongoDB connection is forcibly disrupted (stop container or mock).
- **Operation:** POST valid payload with a new IMSI "001010000000002".
- **Expected:** 500 Internal Server Error. Response body:
  ```json
  {
    "success": false,
    "error": "MongoDB write failed, SQLite rolled back"
  }
  ```
- **Post-verification (after restoring MongoDB):**
  - SQLite `dm_subscribers` has zero rows for IMSI "001010000000002".
  - MongoDB has zero documents for IMSI "001010000000002".
  - The original "001010000000001" entry remains intact in both databases.

#### TX-FAIL-GROUP-001: VN Group Not Found
- **Operation:** POST with `vn_group_name` = "non-existent-group".
- **Expected:** 400 Bad Request. Response body:
  ```json
  {
    "success": false,
    "error": "VN group 'non-existent-group' not found"
  }
  ```
- **Post-verification:** Zero new records in any database.

### 5.4 RBAC Tests

#### RBAC-ADMIN-001: Admin Can Write
- **Precondition:** Authenticated as admin user.
- **Operation:** POST valid payload with new IMSI.
- **Expected:** 201 Created.

#### RBAC-VIEWER-001: Viewer Cannot Write
- **Precondition:** Authenticated as viewer user (non-admin).
- **Operation:** POST valid payload.
- **Expected:** 403 Forbidden. Response body:
  ```json
  {
    "success": false,
    "error": "Forbidden: admin role required"
  }
  ```
- **Post-verification:** Zero new records in SQLite and MongoDB.

#### RBAC-UNAUTH-001: Unauthenticated Cannot Access
- **Precondition:** No valid session cookie.
- **Operation:** POST valid payload.
- **Expected:** 401 Unauthorized (handled by authMiddleware before controller). Zero DB writes.

### 5.5 Frontend UI Tests

#### UI-WIZARD-001: 4-Step Wizard Navigation
- **Expected:** Page renders a multi-step stepper with 4 steps: Select VN Group, Subscriber Profile, Security & Credentials, Summary & Confirmation.
- **Expected:** "Next" and "Previous" buttons navigate between steps.
- **Expected:** Form validation prevents advancing past step with invalid inputs.

#### UI-WIZARD-002: VN Group Dropdown Population
- **Operation:** Navigate to Step 1.
- **Expected:** Dropdown fetches and displays groups from GET /api/5glan-config/groups. Shows group name, DNN, and SST for each.

#### UI-WIZARD-003: Form Field Validation
- **Expected:** IMSI field rejects non-15-digit input.
- **Expected:** K field and OPc field reject non-32-hex-char input.
- **Expected:** AMF field rejects non-4-hex-char input.

#### UI-WIZARD-004: Summary Card Display
- **Expected:** Step 4 shows summary cards with:
  - Selected VN group name and DNN.
  - IMSI and optional subscriber fields.
  - Session type = "Ethernet (5)", QoS index = 9, ARP priority = 8.
  - "Submit" button triggers POST /api/5glan-config/wizard-submit.
- **Expected:** Success shows toast and 201 response data.
- **Expected:** Error shows toast with backend error message.

#### UI-NAV-001: Sidebar Navigation Entry
- **Expected:** Layout.tsx sidebar has "5G LAN Wizard" entry with icon (Wand2, Network, or Radio).
- **Expected:** App.tsx routes "5g-lan-wizard" tab to render 5gLanConfigWizard component.

### 5.6 Data Flow Closure Test

#### FLOW-001: End-to-End Data Flow
Trace one complete cycle:
```
User → Wizard UI Step 1-4 → POST /api/5glan-config/wizard-submit
  → Zod validation (wizardSubmitSchema)
  → Auth middleware + requireAdmin check
  → Controller: parse payload
  → WizardSubmitUseCase.execute()
    → SimpleMutex.acquire()
    → Lookup VN Group from SMF YAML config
    → Synthesize subscriber document (session_type=5, qos_index=9, arp_priority=8)
    → DmSubscriberRepository.beginTransaction()
    → DmSubscriberRepository.save() — write 4 SQL tables
    → MongoSubscriberRepository.create() — async MongoDB write
    → On success: DmSubscriberRepository.commit() → Release Mutex → 201
    → On failure: DmSubscriberRepository.rollback() → Release Mutex → 500
  → Response to frontend
  → Toast notification to user
```
- **Expected:** Every link in this chain is reachable. No function returns early with a placeholder or throws unimplemented. The full cycle must execute without `(void)param;` stubs, `// TODO`, or `// deferred to M2` comments on the critical path.

---

## 6. Call Site Compliance Checklist

The following symbols must appear in at least TWO files each (definition + call site):

| Symbol | Definition File | Expected Call Site(s) |
|---|---|---|
| `create5gLanConfigRouter` | interfaces/rest/5glan-config-controller.ts | index.ts (app.use mount) |
| `WizardSubmitUseCase` | application/use-cases/wizard-submit.ts | index.ts (instantiation), 5glan-config-controller.ts (injection) |
| `DmSubscriberRepository` | infrastructure/dameng/dm-subscriber-repository.ts | index.ts (instantiation), wizard-submit.ts (injection) |
| `VnGroup` / `VnGroupEntity` | domain/entities/vn-group.ts | 5glan-config-controller.ts, wizard-submit.ts |
| `wizardSubmitSchema` | domain/services/validation-schemas.ts | 5glan-config-controller.ts |
| `5gLanConfigApi` | frontend/src/api/5gLanConfig.ts | 5gLanConfigWizard.tsx |
| `5gLanConfigWizard` | frontend/src/pages/5gLanConfigWizard.tsx | App.tsx |

Verify with:
```bash
git grep -n 'create5gLanConfigRouter\|WizardSubmitUseCase\|DmSubscriberRepository\|VnGroup\|wizardSubmitSchema\|5gLanConfigApi\|5gLanConfigWizard' -- open5gs-nms/
```

Each symbol must have at least 2 matches. A symbol with only 1 match (its own definition) fails AC-6.

---

## 7. Design Artifacts Verification

The developer must create these files (from contract Section design_artifacts_to_create):

| # | Path | Description |
|---|---|---|
| 1 | `open5gs-nms/backend/src/domain/entities/vn-group.ts` | VnGroup entity |
| 2 | `open5gs-nms/backend/src/domain/interfaces/dm-subscriber-repository.ts` | IDmSubscriberRepository interface |
| 3 | `open5gs-nms/backend/src/infrastructure/database/dm-subscriber-repository.ts` | DmSubscriberRepository impl |
| 4 | `open5gs-nms/backend/src/domain/entities/5glan-config.ts` | DTOs for wizard payload |
| 5 | `open5gs-nms/backend/src/application/use-cases/wizard-submit.ts` | WizardSubmitUseCase |
| 6 | `open5gs-nms/backend/src/interfaces/rest/5glan-config-controller.ts` | REST controller |
| 7 | `open5gs-nms/frontend/src/api/5gLanConfig.ts` | Frontend API client |
| 8 | `open5gs-nms/frontend/src/pages/5gLanConfigWizard.tsx` | Wizard page |

And modify these existing files:

| # | Path | Change |
|---|---|---|
| 9 | `open5gs-nms/backend/src/index.ts` | Import + mount router + instantiate use case |
| 10 | `open5gs-nms/frontend/src/App.tsx` | Add case for '5g-lan-wizard' tab |
| 11 | `open5gs-nms/frontend/src/components/common/Layout.tsx` | Add NAV_ITEMS entry |
| 12 | `open5gs-nms/backend/src/domain/services/validation-schemas.ts` | Change session type max to 5, add wizardSubmitSchema |
| 13 | `open5gs-nms/backend/src/domain/entities/smf-config.ts` | Add VnGroupConfig interface |

Verify all 13 paths exist and contain non-trivial implementation (no empty stubs, no data-path TODOs).

---

## 8. Risk Assessment

| Risk | Severity | Mitigation | Validation Gate |
|---|---|---|---|
| Dual-write partial failure | Medium | SQL first, rollback on MongoDB failure | TX-FAIL-MONGO-001 |
| SQL dialect incompatibility | Low | ANSI SQL-92 only | REL-DDL-001 |
| SMF YAML vn_group format undefined | Medium | Fallback mock groups or standalone JSON | AC-7, TX-FAIL-GROUP-001 |
| better-sqlite3 sync vs MongoDB async coordination | Low | SimpleMutex queue | TX-OK-001 + concurrent submission test |
| FQDN label > 63 chars crashes UPF | Medium | Zod validation in wizardSubmitSchema | VAL-FQDN-001 |
| No existing 5G LAN code (greenfield) | Low | Follow LinkDiagnostics pattern exactly | AC-4 build pass |
| Dead code / placeholder delivery | High | Pre-commit git grep verification | AC-6 call site check |
| Broken imports after file creation | Medium | Create files in dependency order (Task 1-9) | AC-4 build pass |

---

## 9. Error Code Verification Matrix

The contract defines 6 error codes. Each must be demonstrable:

| Error Code | HTTP Status | Trigger | Expected Response |
|---|---|---|---|
| VALIDATION_ERROR | 400 | Invalid Zod schema (bad K, bad AMF, missing field) | `{"success":false,"error":"Validation failed: ..."}` |
| FORBIDDEN | 403 | Viewer session POST | `{"success":false,"error":"Forbidden: admin role required"}` |
| DUPLICATE_IMSI | 409 | POST existing IMSI | `{"success":false,"error":"Subscriber with IMSI ... already exists"}` |
| GROUP_NOT_FOUND | 400 | POST non-existent vn_group_name | `{"success":false,"error":"VN group '...' not found"}` |
| MONGO_FAILURE | 500 | MongoDB down during write | `{"success":false,"error":"MongoDB write failed, SQLite rolled back"}` |
| INTERNAL_ERROR | 500 | Unexpected server error | `{"success":false,"error":"Internal server error"}` |

---

## 10. Completion Gates

The full ADU validation passes if and only if:

1. All 6 commands in Section 3 exit with status 0.
2. Backend and frontend build produce zero TypeScript errors.
3. All 8 acceptance criteria (AC-1 through AC-8) are verified.
4. All 13 design artifacts exist with non-trivial content (no data-path TODOs/stubs).
5. Every new symbol passes the call site compliance check (Section 6).
6. The end-to-end data flow (Section 5.6) completes from user click to database persistence without early returns.
7. All 6 error codes in Section 9 are demonstrable.
8. No code is written outside allowed_write_paths.
9. The dameng.db SQLite file exists at `open5gs-nms/backend/data/dameng.db`.
