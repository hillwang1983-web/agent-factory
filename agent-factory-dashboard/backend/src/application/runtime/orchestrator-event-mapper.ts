/**
 * Orchestrator event mapper — normalizes NDJSON events from orchestrator stdout
 * into structured Operation updates.
 *
 * Handles both ADU and Epic orchestrator event formats:
 *   - Direct: {event: "agent_started", agent: "...", state: "..."}
 *   - Wrapped: {type: "epic_agent_started", payload: {agent: "...", ...}}
 *   - NDJSON via WebSocket: {type: "agentFactoryEvent", payload: {kind: "epic", action: "epic_state_changed"}}
 */

export interface OrchestrationOperation {
  operation_id?: string;
  scope?: string;
  target_id?: string;
  targetType?: string;
  targetId?: string;
  project_id?: string;
  action?: any;
  mode?: string;
  status?: string;
  current_agent?: string | null;
  current_state?: string | null;
  last_progress_at?: string | null;
  result?: string | null;
  error?: string | null;
  finished_at?: string | null;
  prompt_bytes?: number | null;
  estimated_input_tokens?: number | null;
  termination_reason?: string | null;
}

/**
 * Map an incoming orchestrator event to a partial Operation update.
 * Handles {type, payload} wrapper, scope prefixes (epic_/adu_/child_),
 * and both NDJSON and WebSocket formats.
 */
export function mapOrchestratorEvent(
  raw: Record<string, any>
): Partial<OrchestrationOperation> {
  const updates: Partial<OrchestrationOperation> = {};
  const timestamp = raw.timestamp || new Date().toISOString();

  // Unwrap double-wrapped WebSocket events: {type: "agentFactoryEvent", payload: {kind, action, ...}}
  let event = raw;
  if (raw.type === 'agentFactoryEvent' && raw.payload) {
    event = raw.payload;
  }

  // Unwrap {type, payload} broadcast format
  const payload = event.payload || event;

  // Determine the real event type:
  // - ADU orchestrator:  {type: "agent_factory_orchestrator_event", payload: {event: "step_completed", action: "...", ...}}
  //   → use payload.event or payload.action, NOT the outer wrapper type
  // - Epic orchestrator: {type: "epic_state_changed", payload: {...}}
  //   → use the outer type
  // - Direct:            {event: "state_changed", agent: "...", ...}
  //   → use event.event
  const outerType = (event.type || event.event || '').toString();
  const innerType = (payload.type || payload.event || payload.action || '').toString();

  // If the outer type is a known wrapper, use inner payload type; otherwise use outer
  const isWrapper = outerType === 'agent_factory_orchestrator_event';
  const eventType = isWrapper ? innerType : (outerType || innerType);

  // Normalize: strip scope prefix, strip _event suffix
  const normalized = eventType
    .replace(/^(epic|adu|child)_/, '')
    .replace(/_event$/, '')
    .replace(/^agentFactory/, '');

  // Extract fields from payload if wrapped, else direct from event
  const agent = event.agent || payload.agent || payload.next_agent || payload.agent_id || null;
  const state = event.state || payload.state || payload.next_state ||
                payload.to_state || payload.from_state || null;
  const errorMsg = payload.error || event.error || event.message || payload.message ||
                  payload.stderr || null;

  if (normalized.includes('agent_started')) {
    if (agent) updates.current_agent = agent;
    if (state) updates.current_state = state;
    updates.status = 'running';
    updates.last_progress_at = timestamp;
  } else if (normalized.includes('agent_completed')) {
    if (agent) updates.current_agent = agent;
    if (state) updates.current_state = state;
    updates.last_progress_at = timestamp;
  } else if (normalized.includes('state_changed') || normalized === 'step_completed') {
    if (state) updates.current_state = state;
    updates.last_progress_at = timestamp;
  } else if (normalized.includes('artifact_written') || normalized.includes('artifact_updated')) {
    updates.last_progress_at = timestamp;
  } else if (normalized.includes('human_gate') || normalized.includes('review_')) {
    updates.status = 'waiting_human';
    updates.last_progress_at = timestamp;
  } else if (normalized.includes('agent_failed') || normalized.includes('validation_failed') || normalized.includes('failed')) {
    updates.status = 'failed';
    updates.result = 'failed';
    updates.error = errorMsg || `${eventType} failed`;
    updates.last_progress_at = timestamp;
  } else if (normalized.includes('closed')) {
    updates.status = 'completed';
    updates.result = 'success';
  }

  // Copy through numeric fields if present
  if (payload.prompt_bytes !== undefined && payload.prompt_bytes !== null) {
    updates.prompt_bytes = Number(payload.prompt_bytes);
  } else if (event.prompt_bytes !== undefined) {
    updates.prompt_bytes = Number(event.prompt_bytes);
  }
  if (payload.estimated_input_tokens !== undefined && payload.estimated_input_tokens !== null) {
    updates.estimated_input_tokens = Number(payload.estimated_input_tokens);
  } else if (event.estimated_input_tokens !== undefined) {
    updates.estimated_input_tokens = Number(event.estimated_input_tokens);
  }
  if (payload.termination_reason) {
    updates.termination_reason = String(payload.termination_reason);
  } else if (event.termination_reason) {
    updates.termination_reason = String(event.termination_reason);
  }

  return updates;
}
