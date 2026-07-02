import os
from dataclasses import dataclass
from pathlib import Path

class WritePolicyError(ValueError):
    pass

SENSITIVE_MONITORED_PATHS = [
    ".ai-agent/registry/projects.json",
    ".ai-agent/registry/adus.json",
    ".ai-agent/registry/agents.json",
    ".ai-agent/registry/runs.json",
    ".ai-agent/registry/overrides.json"
]

FORBIDDEN_PREFIXES = (
    ".git/",
    ".github/",
    ".ai-agent/registry/",
    ".ai-agent/operations/",
    ".ai-agent/locks/",
    "build/",
    "dist/",
    "coverage/"
)

def normalize_repo_path(path_value: str) -> str:
    if not path_value:
        raise WritePolicyError("Path cannot be empty.")
    
    # Check for absolute path
    if path_value.startswith("/") or os.path.isabs(path_value):
        raise WritePolicyError(f"Absolute paths are forbidden: {path_value}")
        
    # Replace backslashes
    cleaned = path_value.replace("\\", "/")
    
    # Check for directory traversal / escape
    parts = cleaned.split("/")
    if ".." in parts:
        raise WritePolicyError(f"Path traversal '..' is forbidden: {path_value}")
        
    norm = os.path.normpath(cleaned).replace("\\", "/")
    if norm == "." or norm == "":
        raise WritePolicyError(f"Root path '.' or empty is forbidden: {path_value}")
        
    return norm

@dataclass(frozen=True)
class AgentWritePolicy:
    agent_name: str
    exact_paths: frozenset[str]
    directory_prefixes: tuple[str, ...]

    def allows(self, path_value: str) -> bool:
        try:
            normalized = normalize_repo_path(path_value)
        except WritePolicyError:
            return False

        # Reject sensitive/runtime/generated prefixes
        for prefix in FORBIDDEN_PREFIXES:
            if normalized.startswith(prefix):
                return False

        # Exact path check
        if normalized in self.exact_paths:
            return True

        # Directory prefix check using component boundaries
        for prefix in self.directory_prefixes:
            if normalized.startswith(prefix):
                # Ensure it matches as a directory component boundary
                # e.g., if prefix is "src/", "src/allowed.c" matches, but "src_extra/" doesn't
                return True

        return False

def build_agent_write_policy(
    agent_name: str,
    target_id: str,
    is_epic: bool,
    adu_allowed_write_paths: list[str],
    agent_target_files: list[str],
) -> AgentWritePolicy:
    if not agent_name:
        raise WritePolicyError("Agent name cannot be empty.")

    exact_paths = set()
    directory_prefixes = []

    if agent_name == "developer":
        if not adu_allowed_write_paths:
            raise WritePolicyError("Developer allowed write paths cannot be empty.")
        for p in adu_allowed_write_paths:
            try:
                norm = normalize_repo_path(p)
            except WritePolicyError as e:
                # '.' or empty is forbidden
                raise WritePolicyError(f"Invalid developer allowed write path '{p}': {e}")
            
            if p.endswith("/"):
                # Must ensure suffix / is retained in prefix matching
                directory_prefixes.append(norm + "/")
            else:
                exact_paths.add(norm)
    else:
        # For non-developer agents, only allow the exact paths from agent_target_files
        for f in agent_target_files:
            try:
                norm = normalize_repo_path(f)
                exact_paths.add(norm)
            except WritePolicyError:
                pass

        if not exact_paths:
            # We fail closed if no target files could be verified
            raise WritePolicyError(f"No valid target files for agent {agent_name}")

    return AgentWritePolicy(
        agent_name=agent_name,
        exact_paths=frozenset(exact_paths),
        directory_prefixes=tuple(directory_prefixes)
    )

@dataclass(frozen=True)
class WriteAuthorizationResult:
    allowed: bool
    error_code: str | None
    declared_paths: tuple[str, ...]
    actual_paths: tuple[str, ...]
    undeclared_paths: tuple[str, ...]
    unchanged_declarations: tuple[str, ...]
    unauthorized_paths: tuple[str, ...]

def authorize_declared_and_actual_changes(
    policy: AgentWritePolicy,
    declared_paths: list[str],
    actual_delta: dict,
    runner_owned_paths: list[str],
) -> WriteAuthorizationResult:
    declared = set()
    for p in declared_paths:
        try:
            declared.add(normalize_repo_path(p))
        except WritePolicyError:
            pass

    actual = set()
    for key in ("created", "modified", "deleted"):
        for p in actual_delta.get(key, []):
            try:
                actual.add(normalize_repo_path(p))
            except WritePolicyError:
                pass

    runner_owned = set()
    for p in runner_owned_paths:
        try:
            runner_owned.add(normalize_repo_path(p))
        except WritePolicyError:
            pass

    agent_declared_runner = declared & runner_owned
    agent_actual = actual - runner_owned

    unauthorized = set()
    for p in declared | agent_actual:
        if not policy.allows(p):
            unauthorized.add(p)

    undeclared = agent_actual - declared
    unchanged = declared - agent_actual

    error_code = None
    if agent_declared_runner:
        error_code = "agent_declared_runner_owned_path"
        unauthorized |= agent_declared_runner
    elif unauthorized:
        error_code = "unauthorized_write_path"
    elif undeclared:
        error_code = "undeclared_actual_changes"
    elif unchanged:
        error_code = "declared_changes_unverified"

    return WriteAuthorizationResult(
        allowed=error_code is None,
        error_code=error_code,
        declared_paths=tuple(sorted(declared)),
        actual_paths=tuple(sorted(agent_actual)),
        undeclared_paths=tuple(sorted(undeclared)),
        unchanged_declarations=tuple(sorted(unchanged)),
        unauthorized_paths=tuple(sorted(unauthorized)),
    )
