# Deploy Core Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync local fixes to remote node 192.168.1.32, compile Open5GS, and restart UPF/SMF services.

**Architecture:** Use `scp` (via `sshpass`) to sync modified files, then `ssh` to run remote compilation and service management commands.

**Tech Stack:** Bash, SSH, SCP, Ninja, Open5GS.

---

### Task 1: Sync Modified Files to Remote Node

**Files:**
- Local: `src/upf/n4-handler.c`, `lib/pfcp/rule-match.c`
- Remote: `192.168.1.32:/root/open5gs/`

- [ ] **Step 1: Sync `src/upf/n4-handler.c` to remote**

Run: `sshpass -p '198366zyf' scp -o StrictHostKeyChecking=no open5gs/src/upf/n4-handler.c root@192.168.1.32:/root/open5gs/src/upf/n4-handler.c`
Expected: File transferred successfully.

- [ ] **Step 2: Sync `lib/pfcp/rule-match.c` to remote**

Run: `sshpass -p '198366zyf' scp -o StrictHostKeyChecking=no open5gs/lib/pfcp/rule-match.c root@192.168.1.32:/root/open5gs/lib/pfcp/rule-match.c`
Expected: File transferred successfully.

### Task 2: Compile Open5GS on Remote Node

**Files:**
- Remote: `/root/open5gs/build`

- [ ] **Step 1: Run compilation via ninja**

Run: `sshpass -p '198366zyf' ssh -o StrictHostKeyChecking=no root@192.168.1.32 'cd /root/open5gs/build && ninja'`
Expected: `ninja: no work to do.` or successful compilation message.

### Task 3: Restart Core Network Services

**Files:**
- Remote: `/opt/open5gs/bin/open5gs-upfd`, `/opt/open5gs/bin/open5gs-smfd`

- [ ] **Step 1: Restart UPF and SMF**

Run: `sshpass -p '198366zyf' ssh -o StrictHostKeyChecking=no root@192.168.1.32 'killall -9 open5gs-upfd open5gs-smfd || true; nohup /opt/open5gs/bin/open5gs-upfd -c /opt/open5gs/etc/open5gs/upf.yaml > /var/log/open5gs-r4-prp/upf.log 2>&1 & nohup /opt/open5gs/bin/open5gs-smfd -c /opt/open5gs/etc/open5gs/smf.yaml > /var/log/open5gs-r4-prp/smf.log 2>&1 &'`
Expected: Services restarted and running in background.

### Task 4: Verify Services are Running

- [ ] **Step 1: Check process list on remote**

Run: `sshpass -p '198366zyf' ssh -o StrictHostKeyChecking=no root@192.168.1.32 'ps aux | grep open5gs-'`
Expected: `open5gs-upfd` and `open5gs-smfd` should be in the list.
