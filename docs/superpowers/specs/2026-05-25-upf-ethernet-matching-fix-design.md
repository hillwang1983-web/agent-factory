# UPF Ethernet Matching Fix Design

**Goal:** Correct the architectural mismatch in Open5GS UPF PDR matching for Ethernet PDU sessions, allowing PRP (redundancy) and non-IP traffic (like ARP) to pass correctly.

## Problem Description
1.  **Flag Loss**: The `is_ethernet_pdu` flag, which instructs the matching logic to skip the 14-byte Ethernet header, is currently only set in the UPF when a `vngroup=` marker is present. R4 redundancy uses a `pair=` marker, which doesn't trigger the flag, causing the matching logic to misinterpret MAC addresses as IP versions.
2.  **IP-Only Enforcement**: `lib/pfcp/rule-match.c` currently drops any packet that doesn't parse as a valid IPv4/IPv6 packet. This prevents non-IP traffic (ARP, LLDP, raw L2) from matching "Match-All" PDRs in Ethernet sessions.

## Proposed Changes

### 1. UPF: Metadata-Aware Flagging
**File:** `open5gs/src/upf/n4-handler.c`
**Logic:** Update the DNN token parsing loop. If either `vngroup=` OR `pair=` is detected, set `pdr->is_ethernet_pdu = true` for all PDRs in the session.

### 2. PFCP: Non-IP Robust Matching
**File:** `open5gs/lib/pfcp/rule-match.c`
**Logic:**
- Update `ethernet_ip_payload_offset()` to return success even if the payload is not IP, but still set the `offset` correctly.
- In `ogs_pfcp_pdr_rule_find_by_packet()`:
    - If `pdr->is_ethernet_pdu` is true, check the return of `ethernet_ip_payload_offset()`.
    - If it's a non-IP frame, skip the IP/Port matching blocks but continue the loop.
    - A non-IP frame will successfully match a rule if `ipfw->proto == 0` (Match-All IP/Any) and no other IP-specific filters are violated (which is true for non-IP frames as they have no IP state).
    - Demote the `Invalid packet` error to `ogs_trace` for Ethernet sessions.

## Success Criteria
- Integration test `/tmp/test_r4_prp_opt1.py` on VM 1.37 reports `3/3 passed`.
- UPF logs no longer show `Invalid packet [IP version:3]` for Ethernet traffic.
