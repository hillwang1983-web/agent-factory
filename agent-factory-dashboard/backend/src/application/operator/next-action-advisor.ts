import { AgentFactoryAdu, AgentFactoryEpicView } from '../../domain/agent-factory';
import { OperatorNextAction, OperatorActionType, OperatorActionPriority } from '../../domain/operator';

export class NextActionAdvisor {
  async getNextActionForAdu(adu: AgentFactoryAdu): Promise<OperatorNextAction> {
    const target = { type: 'adu' as const, id: adu.id, project_id: adu.project_id };
    const state = adu.state;
    let recommended_action: OperatorActionType | null = null;
    let priority: OperatorActionPriority = 'optional';
    let reason = '';
    const blocking_reasons: string[] = [];
    const required_inputs: OperatorNextAction['required_inputs'] = [];
    let safe_to_auto_continue = false;
    let estimated_risk: 'low' | 'medium' | 'high' = 'low';

    switch (state) {
      case 'created':
        recommended_action = 'start';
        priority = 'required';
        reason = 'ADU is created, start requirement analysis.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'analysis_review':
        // If has pending clarification questions, recommend answering them
        const hasPendingClarifications = adu.clarification_questions?.some(
          (q) => q.status === 'pending'
        );
        if (hasPendingClarifications) {
          recommended_action = 'answer_clarifications';
          priority = 'required';
          reason = 'Requirement clarification questions are pending operator answers.';
          estimated_risk = 'low';
          required_inputs.push({
            key: 'answers',
            label: 'Clarification Answers',
            type: 'text',
            required: true,
          });
        } else {
          recommended_action = 'approve_review';
          priority = 'required';
          reason = 'Requirement analysis completed. Human approval required.';
          estimated_risk = 'medium';
          required_inputs.push({
            key: 'comment',
            label: 'Approval/Rework Comment',
            type: 'text',
            required: false,
          });
        }
        break;

      case 'analyzed':
        recommended_action = 'step';
        priority = 'recommended';
        reason = 'Analysis approved. Move to detailing the design.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'contexted':
        recommended_action = 'step';
        priority = 'recommended';
        reason = 'Context packaging complete. Move to detailed design generation.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'design_review':
        recommended_action = 'approve_review';
        priority = 'required';
        reason = 'Detailed design completed. Human approval required.';
        estimated_risk = 'medium';
        required_inputs.push({
          key: 'comment',
          label: 'Approval/Rework Comment',
          type: 'text',
          required: false,
        });
        break;

      case 'designed':
        recommended_action = 'step';
        priority = 'recommended';
        reason = 'Design approved. Generate the code/test contract.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'contracted':
        recommended_action = 'step';
        priority = 'recommended';
        reason = 'Contract generated. Proceed to test writer agent.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'test_red':
      case 'code_rework':
      case 'acceptance_rework':
      case 'build_rework':
        recommended_action = 'step';
        priority = 'recommended';
        reason = `ADU is in state: ${state}. Proceed to developer implementation or rework.`;
        safe_to_auto_continue = true;
        estimated_risk = 'medium';
        break;

      case 'implemented':
        recommended_action = 'step';
        priority = 'recommended';
        reason = 'Code implemented. Proceed to code reviewer agent.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'code_reviewed':
        recommended_action = 'step';
        priority = 'recommended';
        reason = 'Code reviewed. Proceed to build/debug agent.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'debugged':
        recommended_action = 'step';
        priority = 'recommended';
        reason = 'Build successful. Proceed to acceptance reviewer agent.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'acceptance_reviewed':
        recommended_action = 'step';
        priority = 'recommended';
        reason = 'Acceptance passed. Proceed to evidence collector agent.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'evidenced':
      case 'mvp_ready':
        recommended_action = null;
        priority = 'optional';
        reason = 'ADU is successfully completed.';
        break;

      case 'human_gate':
        priority = 'required';
        estimated_risk = 'medium';
        if (adu.gate_type === 'write_path_approval' || adu.gate_type === 'write_path_expansion') {
          recommended_action = 'approve_write_path';
          reason = 'Write path expansion requires human operator approval.';
          required_inputs.push({
            key: 'request_id',
            label: 'Request ID',
            type: 'text',
            required: true,
          });
        } else if (adu.gate_type === 'token_budget_approval') {
          recommended_action = 'approve_review';
          reason = 'Token budget limit exceeded. Operator override required.';
          required_inputs.push({
            key: 'comment',
            label: 'Approval comment / budget increase reason',
            type: 'text',
            required: true,
          });
        } else if (adu.gate_type === 'environment_verification_required' || adu.gate_type === 'missing_runtime_evidence') {
          recommended_action = 'submit_runtime_evidence';
          reason = 'Missing runtime evidence. Submit evidence or grant waiver.';
          required_inputs.push({
            key: 'runtime_log',
            label: 'Runtime Log Evidence',
            type: 'markdown',
            required: false,
          });
          required_inputs.push({
            key: 'waiver_reason',
            label: 'Waiver Comment',
            type: 'text',
            required: false,
          });
        } else if (adu.gate_type === 'dependency_delivery_missing') {
          recommended_action = null;
          reason = 'Dependency deliverables missing or drifted. Resolve the file mismatch or merge the required commit.';
        } else {
          recommended_action = null;
          reason = `Human intervention required: ${adu.gate_type || 'Unknown Block'}.`;
        }
        break;

      case 'failed':
        recommended_action = 'request_rework';
        priority = 'required';
        reason = 'ADU failed quality gates or review limits. Rework or cancellation recommended.';
        estimated_risk = 'high';
        required_inputs.push({
          key: 'comment',
          label: 'Rework details/instructions',
          type: 'text',
          required: true,
        });
        break;

      default:
        recommended_action = null;
        priority = 'optional';
        reason = `Unknown or unmapped state: ${state}.`;
        break;
    }

    if (adu.paused) {
      priority = 'blocked';
      blocking_reasons.push('ADU execution is paused.');
    }

    return {
      target,
      state,
      recommended_action,
      priority,
      reason,
      blocking_reasons,
      required_inputs,
      safe_to_auto_continue,
      estimated_risk,
    };
  }

  async getNextActionForEpic(epic: AgentFactoryEpicView): Promise<OperatorNextAction> {
    const target = { type: 'epic' as const, id: epic.id, project_id: epic.project_id };
    const state = epic.state;
    let recommended_action: OperatorActionType | null = null;
    let priority: OperatorActionPriority = 'optional';
    let reason = '';
    const blocking_reasons: string[] = [];
    const required_inputs: OperatorNextAction['required_inputs'] = [];
    let safe_to_auto_continue = false;
    let estimated_risk: 'low' | 'medium' | 'high' = 'low';

    switch (state) {
      case 'created':
        recommended_action = 'start';
        priority = 'required';
        reason = 'Epic is created. Start system-flow-designer.';
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'flow_designed':
      case 'split_decision':
      case 'single_adu_selected':
        recommended_action = 'continue_auto';
        priority = 'recommended';
        reason = `Flow design complete (state: ${state}). Run adu-splitter.`;
        safe_to_auto_continue = true;
        estimated_risk = 'low';
        break;

      case 'split_required':
      case 'epic_planned':
        recommended_action = 'materialize_child_adus';
        priority = 'required';
        reason = 'Child ADU splits planned. Materialize child ADUs to continue.';
        estimated_risk = 'medium';
        break;

      case 'child_adus_created':
        recommended_action = 'continue_auto';
        priority = 'recommended';
        reason = 'Child ADUs materialized. Begin scheduling execution.';
        safe_to_auto_continue = true;
        estimated_risk = 'medium';
        break;

      case 'child_adus_running':
        recommended_action = 'step';
        priority = 'optional';
        reason = 'Child ADUs are currently running.';
        break;

      case 'child_adus_blocked':
        recommended_action = 'open_child_adu';
        priority = 'required';
        reason = 'One or more child ADUs are blocked (human gate or failure).';
        estimated_risk = 'medium';
        break;

      case 'child_adus_evidenced':
        recommended_action = 'continue_auto';
        priority = 'recommended';
        reason = 'All child ADUs completed. Run Epic acceptance reviewer.';
        safe_to_auto_continue = true;
        estimated_risk = 'medium';
        break;

      case 'epic_acceptance':
        recommended_action = 'approve_review';
        priority = 'required';
        reason = 'Epic level acceptance review pending human approval.';
        estimated_risk = 'medium';
        required_inputs.push({
          key: 'comment',
          label: 'Approval/Rework Comment',
          type: 'text',
          required: false,
        });
        break;

      case 'epic_evidenced':
        recommended_action = null;
        priority = 'optional';
        reason = 'Epic successfully completed and evidenced.';
        break;

      case 'epic_failed':
        recommended_action = 'request_rework';
        priority = 'required';
        reason = 'Epic acceptance failed. Rework plan or cancellation required.';
        estimated_risk = 'high';
        required_inputs.push({
          key: 'comment',
          label: 'Rework details/instructions',
          type: 'text',
          required: true,
        });
        break;

      case 'canceled':
        recommended_action = null;
        priority = 'optional';
        reason = 'Epic has been canceled.';
        break;

      default:
        recommended_action = null;
        priority = 'optional';
        reason = `Unknown or unmapped Epic state: ${state}.`;
        break;
    }

    return {
      target,
      state,
      recommended_action,
      priority,
      reason,
      blocking_reasons,
      required_inputs,
      safe_to_auto_continue,
      estimated_risk,
    };
  }
}
