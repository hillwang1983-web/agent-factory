# UPF Ethernet Matching Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the UPF PDR matching logic to correctly handle Ethernet frames in Ethernet PDU sessions, ensuring PRP (redundancy) packets are properly matched and non-IP traffic is supported.

**Architecture:**
1. Modify `src/upf/n4-handler.c` to ensure the `is_ethernet_pdu` flag is set when either `vngroup` or `pair` metadata is found in the DNN.
2. Refactor `lib/pfcp/rule-match.c` to allow non-IP packets to match "Match-All" rules in Ethernet PDU sessions.
3. Re-run integration tests to verify.

**Tech Stack:** C, Open5GS, PFCP, GTP-U

---

### Task 1: metadata-Aware is_ethernet_pdu Flagging

**Files:**
- Modify: `open5gs/src/upf/n4-handler.c`

- [ ] **Step 1: Update DNN token parsing logic**

Modify the loop in `upf_n4_handle_session_establishment_request` (around line 300-400) to set the flag if a pair ID is found.

```c
// Find the loop that parses tokens like "vngroup=", "pair="
// Ensure that if pair_id is found, it also triggers:
ogs_list_for_each(&sess->pfcp.pdr_list, pdr)
    pdr->is_ethernet_pdu = true;
```

### Task 2: Refactor PFCP Rule Matching for Non-IP Support

**Files:**
- Modify: `open5gs/lib/pfcp/rule-match.c`

- [ ] **Step 1: Update ethernet_ip_payload_offset to return bool indicating if it's IP**

Change the function signature or return logic to indicate whether it's an IP payload, but always calculate the offset correctly for Ethernet frames.

- [ ] **Step 2: Update ogs_pfcp_pdr_rule_find_by_packet to handle non-IP frames**

If `is_ethernet_pdu` is true, allow the matching to continue even if the payload is not IP. Skip the `ip_h->ip_v` check for non-IP frames and allow them to match rules where `ipfw->proto == 0`.

### Task 3: Build and Deploy Core Network

**Files:**
- Modify: Remote state on `192.168.1.32`

- [ ] **Step 1: Compile Open5GS on VM 1.32**

```bash
sshpass -p '198366zyf' ssh -o StrictHostKeyChecking=no root@192.168.1.32 'cd /root/open5gs/build && ninja'
```

- [ ] **Step 2: Restart UPF and SMF**

```bash
sshpass -p '198366zyf' ssh -o StrictHostKeyChecking=no root@192.168.1.32 'killall -9 open5gs-upfd open5gs-smfd || true; nohup /opt/open5gs/bin/open5gs-upfd -c /opt/open5gs/etc/open5gs/upf.yaml > /var/log/open5gs-r4-prp/upf.log 2>&1 & nohup /opt/open5gs/bin/open5gs-smfd -c /opt/open5gs/etc/open5gs/smf.yaml > /var/log/open5gs-r4-prp/smf.log 2>&1 &'
```

### Task 4: Final Verification

**Files:**
- Execute: `/tmp/test_r4_prp_opt1.py` on `192.168.1.37`

- [ ] **Step 1: Establish Sessions**

```bash
sshpass -p '198366zyf' ssh -o StrictHostKeyChecking=no root@192.168.1.37 'killall -9 nr-ue nr-gnb 2>/dev/null || true; nohup /work/UERANSIM/build/nr-gnb -c /work/open5gs-src/tests/regression/5glan/ueransim/gnb.yaml > /tmp/gnb-prp.log 2>&1 & sleep 2; nohup /work/UERANSIM/build/nr-ue -c /work/open5gs-src/tests/regression/5glan/ueransim/ue-c.yaml > /tmp/ue-c.log 2>&1 & sleep 5; /work/UERANSIM/build/nr-cli imsi-999700000000003 -e "ps-establish IPv4 --sst 1 --dnn factory" && sleep 5'
```

- [ ] **Step 2: Run Integration Test**

```bash
sshpass -p '198366zyf' ssh -o StrictHostKeyChecking=no root@192.168.1.37 'python3 /tmp/test_r4_prp_opt1.py'
```

Expected Output: `3/3 passed`.
