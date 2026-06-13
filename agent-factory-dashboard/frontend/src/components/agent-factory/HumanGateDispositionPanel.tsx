import { useState, useEffect, useRef } from 'react';
import type { AgentFactoryAduView } from '../../types/agent-factory';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { agentFactoryApi } from '../../api/agentFactory';
import { AlertTriangle, Check, Info } from 'lucide-react';

interface Props {
  adu: AgentFactoryAduView;
}

const DISPOSITION_OPTIONS = [
  { value: 'environment_waiver', label: '环境问题豁免 (Environment Waiver)', desc: '因 Docker 容器、测试环境或外部依赖缺失导致测试失败，且确信代码无误，予以记录豁免推进。' },
  { value: 'accept_risk', label: '接受风险强行推进 (Accept Risk)', desc: '已知晓当前失败或异常风险，选择强行绕过并保留历史审计记录。' },
  { value: 'request_rework', label: '要求整改返工 (Request Rework)', desc: '打回 rework_planned 状态并唤醒 developer，根据整改计划重新编写代码。' },
  { value: 'provide_missing_evidence', label: '已手工补充证据 (Provide Evidence)', desc: '已人工修改或补齐了缺失的文件/证据，退回原状态继续触发门禁判断。' },
  { value: 'external_dependency_block', label: '外部依赖挂起 (Dependency Block)', desc: '由于外部不可抗力因素无限期暂停，继续保持阻塞状态并补充标记理由。' },
  { value: 'cancel_adu', label: '取消 ADU 任务 (Cancel ADU)', desc: '直接终止并取消此 ADU 开发任务。' }
];

export function HumanGateDispositionPanel({ adu }: Props): JSX.Element {
  const { qualityReports, disposeHumanGate, controlEnabled } = useAgentFactoryStore();

  const [disposition, setDisposition] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [failedAssertions, setFailedAssertions] = useState<string[]>([]);
  const [selectedAssertions, setSelectedAssertions] = useState<string[]>([]);
  const assertionSelectionTouchedRef = useRef(false);

  const preGateState = adu.pre_gate_state || '';
  const isEnvWaiverApplicable = preGateState === 'code_reviewed' || preGateState === 'debugged';
  const acceptanceReviewPath = qualityReports?.acceptanceReview.path;
  const acceptanceReviewExists = qualityReports?.acceptanceReview.exists;

  useEffect(() => {
    // Set default selection
    if (isEnvWaiverApplicable) {
      setDisposition('environment_waiver');
    } else {
      setDisposition('request_rework');
    }
    setComment('');
    setSuccessMsg(null);
    setError(null);
  }, [adu.id, isEnvWaiverApplicable]);

  useEffect(() => {
    assertionSelectionTouchedRef.current = false;
    if (disposition === 'environment_waiver' && preGateState === 'debugged' && acceptanceReviewExists && acceptanceReviewPath) {
      const loadReport = async () => {
        try {
          const res = await agentFactoryApi.fetchAgentFactoryArtifact(acceptanceReviewPath, 100000, adu.id);
          const report = JSON.parse(res.content);
          const results = report.assertion_results || [];
          const failed = results
            .filter((item: any) => item.status !== 'pass')
            .map((item: any) => item.assertion_id)
            .filter(Boolean);
          setFailedAssertions(failed);
          if (!assertionSelectionTouchedRef.current) {
            setSelectedAssertions(failed); // Default select all until the user edits selection.
          }
        } catch (e) {
          console.error('Failed to load acceptance report assertions:', e);
        }
      };
      void loadReport();
    } else {
      assertionSelectionTouchedRef.current = false;
      setFailedAssertions([]);
      setSelectedAssertions([]);
    }
  }, [adu.id, disposition, preGateState, acceptanceReviewExists, acceptanceReviewPath]);

  const toggleAssertion = (assId: string) => {
    assertionSelectionTouchedRef.current = true;
    setSelectedAssertions((current) => (
      current.includes(assId)
        ? current.filter(id => id !== assId)
        : [...current, assId]
    ));
  };

  const handleSubmit = async () => {
    if (!controlEnabled) return;
    if (!disposition) {
      setError('请选择处置类型');
      return;
    }
    if (!comment.trim()) {
      setError('请填写处置原因与备注');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await disposeHumanGate(
        adu.id,
        disposition as any,
        comment.trim(),
        selectedAssertions
      );
      setSuccessMsg('人工处置已成功提交，状态已更新。');
      setComment('');
    } catch (e) {
      console.error(e);
      setError((e as Error).message ?? '处置提交失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-red-500/20 bg-red-950/5 rounded-md p-4 space-y-4 text-xs">
      <div className="flex items-center gap-2 text-red-400 font-semibold">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span>人工干预处置控制台 (Human Gate Disposition)</span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-slate-400 font-medium mb-1.5">选择处置方案:</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {DISPOSITION_OPTIONS.map((opt) => {
              const isEnvWaiver = opt.value === 'environment_waiver';
              const disabled = isEnvWaiver && !isEnvWaiverApplicable;
              return (
                <label
                  key={opt.value}
                  className={`flex flex-col p-2.5 rounded border text-left transition-colors cursor-pointer ${
                    disabled
                      ? 'border-slate-800/40 bg-slate-950/20 opacity-40 cursor-not-allowed'
                      : disposition === opt.value
                        ? 'border-red-500/50 bg-red-950/20 text-red-100'
                        : 'border-slate-800 bg-slate-900/40 text-slate-300 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <input
                      type="radio"
                      name="disposition-type"
                      value={opt.value}
                      checked={disposition === opt.value}
                      disabled={disabled}
                      onChange={(e) => setDisposition(e.target.value)}
                      className="text-red-500 focus:ring-red-500"
                    />
                    <span>{opt.label}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">{opt.desc}</span>
                  {isEnvWaiver && !isEnvWaiverApplicable && (
                    <span className="text-[9px] text-amber-500 font-medium mt-1">
                      (仅在前置状态为 code_reviewed 或 debugged 时可用)
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Affected Assertions checkboxes */}
        {disposition === 'environment_waiver' && failedAssertions.length > 0 && (
          <div className="bg-slate-950 border border-slate-800 rounded p-2.5 space-y-2">
            <div className="font-semibold text-slate-300 flex items-center gap-1">
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              <span>选择需要豁免的测试断言 (Waiver Assertions):</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {failedAssertions.map((assId) => (
                <button
                  type="button"
                  key={assId}
                  onClick={() => toggleAssertion(assId)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                    selectedAssertions.includes(assId)
                      ? 'border-red-500/40 bg-red-950/20 text-red-200 font-semibold'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  {selectedAssertions.includes(assId) && <Check className="w-3 h-3 text-red-400" />}
                  <span>{assId}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-slate-400 font-medium mb-1.5">处置原因与审计备注 (Comment):</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={loading}
            className="w-full h-20 bg-slate-950 text-slate-200 p-2.5 rounded border border-slate-800 focus:ring-1 focus:ring-red-500 focus:border-red-500 focus:outline-none resize-none placeholder-slate-600"
            placeholder="请填写详细原因。例如：本机 Docker 环境缺失，编译通过，该单测暂时环境豁免；或者打回 developer 进行修复。"
          />
        </div>

        {error && <div className="text-red-400 font-semibold">{error}</div>}
        {successMsg && <div className="text-green-400 font-semibold">{successMsg}</div>}

        <button
          onClick={() => void handleSubmit()}
          disabled={loading || !disposition || !comment.trim()}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-semibold rounded disabled:opacity-50 transition-colors"
        >
          {loading ? '提交中...' : '提交处置决策'}
        </button>
      </div>
    </div>
  );
}
