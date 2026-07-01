# Epic ADU Dependency Delivery Verification Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce deliverable physical integrity and commit traceability of ADU dependencies in Epics before scheduling child ADUs, ensuring correct verification without relying on uncommitted Git state.

**Architecture:**
1. **Manifest generation** in runner uses the union of contract allowed production write paths and actually modified files (`valid_changed_files`) as the source of truth for production deliverables, instead of Git commit diffing.
2. **Missing required outputs check** (`required_outputs ⊆ outputs_hash`) is verified during validation. If any file in `required_outputs` is not hashed, verification fails.
3. **TS Backend Security** implements strict regex format checks on `delivery_commit` before shell execution to eliminate injection risks.
4. **TS Dashboard State Alignment** checks for canceled or missing dependencies and sets health status to `blocked`.
5. **No Native Debug Code** or temporary scripts are committed.
6. **Code Formatting** verified with `git diff --check` and standard lints to ensure clean formatting.

---

### Task 1: Refined Manifest Generation in Runner

**Files:**
- Modify: `scripts/hermes_agent_run.py`

- [ ] **Step 1: Write base_commit bootstrapper at run start**
  Only bootstrap for ADU runs. Record the base commit in a draft manifest:
  ```python
      # Record base_commit when first starting
      if not is_epic_run and args.agent != "project-profiler" and not args.intake_draft:
          manifest_path = project_repo_path / ".ai-agent" / "evidence" / f"{adu['id']}-manifest.json"
          if not manifest_path.exists():
              try:
                  proc_head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(project_repo_path), capture_output=True, text=True)
                  if proc_head.returncode == 0:
                      base_commit = proc_head.stdout.strip()
                      manifest_path.parent.mkdir(parents=True, exist_ok=True)
                      with open(manifest_path, "w", encoding="utf-8") as f:
                          json.dump({"adu_id": adu["id"], "base_commit": base_commit}, f, indent=2)
              except Exception:
                  pass
  ```

- [ ] **Step 2: Implement manifest generator helper**
  At the top-level of `scripts/hermes_agent_run.py`, define the generator using contract write paths and run file declarations:
  ```python
  def generate_adu_manifest(adu: dict, repo_root: Path, file_decls: dict = None):
      """Generate and save an ADU delivery manifest inside .ai-agent/evidence/."""
      import hashlib
      import datetime as dt
      manifest_path = repo_root / ".ai-agent" / "evidence" / f"{adu['id']}-manifest.json"

      # 1. Get delivery commit
      proc_head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(repo_root), capture_output=True, text=True)
      delivery_commit = proc_head.stdout.strip() if proc_head.returncode == 0 else "unknown"

      # 2. Get branch name
      proc_branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=str(repo_root), capture_output=True, text=True)
      branch_name = proc_branch.stdout.strip() if proc_branch.returncode == 0 else "unknown"

      # 3. Get base commit from draft manifest
      base_commit = None
      if manifest_path.exists():
          try:
              with open(manifest_path, "r", encoding="utf-8") as f:
                  base_commit = json.load(f).get("base_commit")
          except Exception:
              pass
      if not base_commit:
          base_commit = delivery_commit

      # 4. Resolve production deliverables from Contract allowed_write_paths
      contract_outputs = []
      contract_path = repo_root / ".ai-agent" / "contracts" / f"{adu['id']}.json"
      if contract_path.exists():
          try:
              with open(contract_path, "r", encoding="utf-8") as f:
                  contract = json.load(f)
              allowed_paths = contract.get("scope", {}).get("allowed_write_paths", [])
              for p in allowed_paths:
                  if p.startswith(".ai-agent/"):
                      continue
                  full_p = repo_root / p
                  if full_p.is_file():
                      contract_outputs.append(p)
                  elif full_p.is_dir():
                      # Recurse directory
                      for sub_p in full_p.rglob("*"):
                          if sub_p.is_file():
                              rel_sub = str(sub_p.relative_to(repo_root))
                              if not rel_sub.startswith(".ai-agent/") and not rel_sub.startswith(".git/"):
                                  contract_outputs.append(rel_sub)
          except Exception:
              pass

      # 5. Resolve production deliverables from actual run file declarations
      run_outputs = []
      if file_decls and "valid_changed_files" in file_decls:
          for fpath in file_decls["valid_changed_files"]:
              if not fpath.startswith(".ai-agent/") and not fpath.startswith(".git/"):
                  run_outputs.append(fpath)

      # Union of both lists
      required_outputs = sorted(list(set(contract_outputs + run_outputs)))

      # 6. Calculate hashes for all existing production deliverables
      outputs_hash = {}
      for fpath in required_outputs:
          full_path = repo_root / fpath
          if full_path.is_file():
              hasher = hashlib.sha256()
              with open(full_path, "rb") as f:
                  while chunk := f.read(8192):
                      hasher.update(chunk)
              outputs_hash[fpath] = hasher.hexdigest()

      manifest = {
          "adu_id": adu["id"],
          "base_commit": base_commit,
          "delivery_commit": delivery_commit,
          "branch": branch_name,
          "required_outputs": required_outputs,
          "outputs_hash": outputs_hash,
          "generated_at": dt.datetime.now(dt.timezone.utc).isoformat() + "Z"
      }

      manifest_path.parent.mkdir(parents=True, exist_ok=True)
      with open(manifest_path, "w", encoding="utf-8") as f:
          json.dump(manifest, f, indent=2)
  ```

- [ ] **Step 3: Trigger manifest generation on transition to evidenced**
  In `scripts/hermes_agent_run.py`:
  ```python
          if run_result == "success" and next_state:
              adu["state"] = next_state
              if next_state == "evidenced":
                  generate_adu_manifest(adu, project_repo_path, file_decls=file_decls)
  ```


### Task 2: Refined Dependency Validation in Python Orchestrator

**Files:**
- Modify: `scripts/hermes_epic_orchestrator.py`

- [ ] **Step 1: Implement dependency health checker with subset checks**
  In `scripts/hermes_epic_orchestrator.py`, define the check function:
  ```python
  def check_dependency_health(adu_id: str, adu_data: dict, dep_map: dict, repo_root: str) -> dict:
      """Check health of dependencies for a child ADU. Returns a status dict."""
      import hashlib
      required_deps = dep_map.get(adu_id, [])
      terminal_states = {"evidenced", "canceled"}

      for dep_id in required_deps:
          dep_adu = next((a for a in adu_data["adus"] if a["id"] == dep_id), None)
          if not dep_adu:
              return {"status": "blocked", "gate_type": "dependency_blocked", "reason": f"Dependency {dep_id} not found."}

          if dep_adu.get("state") not in terminal_states:
              return {"status": "waiting", "reason": f"Dependency {dep_id} is in state {dep_adu.get('state')}."}

          if dep_adu.get("state") == "canceled":
              return {"status": "blocked", "gate_type": "dependency_blocked", "reason": f"Dependency {dep_id} was canceled."}

          # Manifest check
          manifest_path = Path(repo_root) / ".ai-agent" / "evidence" / f"{dep_id}-manifest.json"
          if not manifest_path.exists():
              return {
                  "status": "drifted",
                  "gate_type": "dependency_delivery_missing",
                  "reason": f"Dependency {dep_id} manifest is missing."
              }

          try:
              with open(manifest_path, "r", encoding="utf-8") as f:
                  manifest = json.load(f)
              if not isinstance(manifest, dict):
                  raise ValueError("Manifest JSON is not a dictionary object.")
          except Exception as e:
              return {
                  "status": "drifted",
                  "gate_type": "dependency_delivery_missing",
                  "reason": f"Dependency {dep_id} manifest failed to parse or is malformed: {e}."
              }

          delivery_commit = manifest.get("delivery_commit")
          if not delivery_commit:
              return {
                  "status": "drifted",
                  "gate_type": "dependency_delivery_missing",
                  "reason": f"Dependency {dep_id} manifest is missing delivery_commit."
              }

          # Check commit reachability safely
          try:
              proc = subprocess.run(["git", "merge-base", "--is-ancestor", delivery_commit, "HEAD"], cwd=repo_root, capture_output=True)
              if proc.returncode != 0:
                  return {
                      "status": "drifted",
                      "gate_type": "dependency_delivery_missing",
                      "reason": f"Dependency {dep_id} delivery commit {delivery_commit[:7]} is not reachable from HEAD."
                  }
          except Exception as e:
              return {
                  "status": "drifted",
                  "gate_type": "dependency_delivery_missing",
                  "reason": f"Failed to check git ancestor reachability for {dep_id}: {e}"
              }

          # Verify outputs_hash contains all required_outputs (required_outputs ⊆ outputs_hash)
          required_outputs = manifest.get("required_outputs", [])
          outputs_hash = manifest.get("outputs_hash", {})
          if not isinstance(outputs_hash, dict) or not isinstance(required_outputs, list):
              return {
                  "status": "drifted",
                  "gate_type": "dependency_delivery_missing",
                  "reason": f"Dependency {dep_id} manifest data structure is malformed."
              }

          for fpath in required_outputs:
              if fpath not in outputs_hash:
                  return {
                      "status": "drifted",
                      "gate_type": "dependency_delivery_missing",
                      "reason": f"Dependency {dep_id} required deliverable file is missing from manifest outputs_hash: {fpath}."
                  }

          # Check outputs existence and hash safely
          for fpath, expected_hash in outputs_hash.items():
              normalized_path = normalize_repo_relative_path(fpath)
              if not normalized_path:
                  return {
                      "status": "drifted",
                      "gate_type": "dependency_delivery_missing",
                      "reason": f"Dependency {dep_id} deliverable path is invalid or unsafe: {fpath}."
                  }
              full_path = Path(repo_root) / normalized_path
              if not full_path.is_file():
                  return {
                      "status": "drifted",
                      "gate_type": "dependency_delivery_missing",
                      "reason": f"Dependency {dep_id} deliverable file is missing from disk: {fpath}."
                  }

              try:
                  hasher = hashlib.sha256()
                  with open(full_path, "rb") as f:
                      while chunk := f.read(8192):
                          hasher.update(chunk)
                  if hasher.hexdigest() != expected_hash:
                      return {
                          "status": "drifted",
                          "gate_type": "dependency_delivery_missing",
                          "reason": f"Dependency {dep_id} deliverable file hash mismatch: {fpath}."
                      }
              except Exception as e:
                  return {
                      "status": "drifted",
                      "gate_type": "dependency_delivery_missing",
                      "reason": f"Failed to read/hash deliverable file {fpath}: {e}."
                  }

      return {"status": "healthy"}
  ```

- [ ] **Step 2: Update scheduling checks to prevent stalls**
  In `get_runnable_child`, only schedule child if health is healthy.
  In `step_epic`, if no child is runnable, iterate children to find if any are blocked by dependency drift or block status, transitioning them to `human_gate` of type `dependency_delivery_missing` or `dependency_blocked` respectively.


### Task 3: TS Backend Dependency Validation and Health Calculation

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`
- Modify: `agent-factory-dashboard/backend/src/application/epic-monitor.ts`

- [ ] **Step 1: Refine TS health checker with security and subset check**
  Add strict hex regex check to `delivery_commit` to eliminate command injection.
  Perform `required_outputs ⊆ outputs_hash` check.
  Handle missing / canceled dependencies as `blocked`.
  Handle file sizes and safe path checking.

- [ ] **Step 2: Update agent-factory-monitor.ts health evaluation**
  Ensure it maps `delivery_drifted` and `blocked` statuses correctly.

- [ ] **Step 3: Update epic-monitor.ts health and state aggregation**
  Retrieve `allAdus` once in `getEpicDashboard` (eliminating N+1 database reads).
  Pass the correct fallback repo path (`epic.repo_path || this.repo.getWorkspaceRoot()`).
  Set correct health status mapping and aggregate blocked status correctly.


### Task 4: TS Next Action Advisor

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/operator/next-action-advisor.ts`

- [ ] **Step 1: Map advice for both dependency_delivery_missing and dependency_blocked**


### Task 5: Integration Tests

**Files:**
- Modify: `scripts/test_epic_orchestrator_integration.py`
- Modify: `agent-factory-dashboard/backend/tools/test-epic-dag.js`

- [ ] **Step 1: Add automated integration test scenarios**
  Add `test_e_dependency_delivery_verification` verifying:
  1. Healthy state
  2. Missing file check
  3. Hash mismatch check
  4. Unreachable commit check
  5. Missing expected output in `outputs_hash` check (subset check)
- [ ] **Step 2: Update TS DAG test expected count**
  Set expected count of tests to 5.
- [ ] **Step 3: Run CI checks locally**
  Run `git diff --check` to ensure no trailing whitespaces.
  Run python tests and TS backend build tests.
