import { useState, useEffect } from 'react';
import { agentFactoryApi } from '../../api/agentFactory';
import type { AgentFactoryAduView, AgentFactoryOperatorOverride } from '../../types/agent-factory';
import { CheckCircle2, AlertTriangle, Loader2, FileCode } from 'lucide-react';

interface Props {
  adu: AgentFactoryAduView | null;
  latestRun: any | null;
  onApplied: () => void;
}

const REASON_OPTIONS: { value: AgentFactoryOperatorOverride['reason_code']; label: string }[] = [
  { value: 'agent_declaration_mismatch', label: 'Agent 声明与事实不符' },
  { value: 'validator_false_negative', label: 'Validator 误判' },
  { value: 'environment_verified', label: '环境已验证' },
  { value: 'manual_evidence_accepted', label: '人工确认证据有效' },
];

const AGENT_STATE_MAP: Record<string, string> = {
  'developer': 'implemented',
  'code-reviewer': 'code_reviewed',
  'buildfix-debugger': 'debugged',
  'acceptance-reviewer': 'acceptance_reviewed',
  'evidence': 'evidenced',
};

export function OperatorOverridePanel({ adu, latestRun, onApplied }: Props) {
  const [existingOverride, setExistingOverride] = useState<AgentFactoryOperatorOverride | null>(null);
  const [comment, setComment] = useState('');
  const [reasonCode, setReasonCode] = useState<AgentFactoryOperatorOverride['reason_code']>('agent_declaration_mismatch');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [deltaFiles, setDeltaFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  const agent = latestRun?.agent || '';
  const isAmendMode = agent === 'developer' && latestRun?.parsed_result?.error_code === 'declared_changes_unverified';
  const eligible = latestRun && latestRun.result !== 'success' && (
    (AGENT_STATE_MAP[agent] && agent !== 'developer') ||
    isAmendMode
  );

  useEffect(() => {
    if (adu?.id) {
      agentFactoryApi.getRunOverrides(adu.id).then(res => {
        const ov = (res.overrides || []).find(o => o.run_timestamp === latestRun?.timestamp);
        if (ov) setExistingOverride(ov);
      }).catch(() => {});
    }
  }, [adu?.id, latestRun?.timestamp]);

  useEffect(() => {
    if (adu?.id && isAmendMode && latestRun?.run_dir) {
      const deltaPath = `${latestRun.run_dir}/file-delta.json`;
      agentFactoryApi.fetchAgentFactoryArtifact(deltaPath, 200000, adu.id).then(res => {
        try {
          const data = JSON.parse(res.content);
          const created = data.created || [];
          const modified = data.modified || [];
          const deleted = data.deleted || [];
          const allChanged = Array.from(new Set<string>([...created, ...modified, ...deleted]));
          setDeltaFiles(allChanged);

          // Auto-select files that are allowed in ADU write paths as a convenience
          const allowed = adu.allowed_write_paths || [];
          const initialSelected = allChanged.filter(file => {
            const norm = file.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
            return allowed.some(allowedPath => {
              const allowedNorm = allowedPath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
              if (allowedNorm.endsWith('/')) {
                return norm.startsWith(allowedNorm);
              } else {
                return norm === allowedNorm;
              }
            });
          });
          setSelectedFiles(initialSelected);
        } catch (e) {
          console.error('Failed to parse file-delta.json', e);
        }
      }).catch(err => {
        console.error('Failed to fetch file-delta.json', err);
      });
    }
  }, [adu?.id, latestRun?.timestamp, isAmendMode, latestRun?.run_dir, adu?.allowed_write_paths]);

  if (!eligible && !existingOverride) return null;

  const isFileAllowed = (file: string) => {
    const norm = file.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    const allowed = adu?.allowed_write_paths || [];
    return allowed.some(allowedPath => {
      const allowedNorm = allowedPath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
      if (allowedNorm.endsWith('/')) {
        return norm.startsWith(allowedNorm);
      } else {
        return norm === allowedNorm;
      }
    });
  };

  const handleSubmit = async () => {
    setError('');
    if (comment.length < 10) { setError('说明至少 10 个字符'); return; }
    setLoading(true);
    try {
      if (isAmendMode) {
        if (selectedFiles.length === 0) {
          setError('请选择至少一个要声明的修改文件');
          setLoading(false);
          return;
        }
        await agentFactoryApi.applyRunOverride(adu!.id, latestRun.timestamp, {
          operation: 'amend_file_declaration',
          changed_files: selectedFiles,
          comment,
        });
      } else {
        await agentFactoryApi.applyRunOverride(adu!.id, latestRun.timestamp, {
          operation: 'accept_validator_result',
          to_result: 'success',
          to_state: AGENT_STATE_MAP[agent],
          reason_code: reasonCode,
          comment,
        });
      }
      setSuccess(true);
      onApplied();
    } catch (e: any) {
      setError(e.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  if (existingOverride) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <span className="text-xs font-semibold text-green-400">已存在 Operator Override</span>
        </div>
        <div className="text-xs text-slate-400 space-y-1">
          <div><span className="text-slate-500">ID: </span>{existingOverride.override_id}</div>
          <div><span className="text-slate-500">操作类型: </span>{existingOverride.operation === 'amend_file_declaration' ? '修正文件声明' : '接受校验结果'}</div>
          <div><span className="text-slate-500">原结果: </span>{existingOverride.from_result} → {existingOverride.to_result}</div>
          {existingOverride.reason_code && <div><span className="text-slate-500">原因: </span>{existingOverride.reason_code}</div>}
          {existingOverride.amended_changed_files && (
            <div>
              <span className="text-slate-500">修正声明文件: </span>
              <div className="font-mono bg-slate-950 p-1 rounded mt-0.5 max-h-20 overflow-y-auto">
                {existingOverride.amended_changed_files.map(f => <div key={f}>{f}</div>)}
              </div>
            </div>
          )}
          <div><span className="text-slate-500">说明: </span>{existingOverride.comment}</div>
        </div>
      </div>
    );
  }

  if (isAmendMode) {
    return (
      <div className="bg-slate-900 border border-amber-800/50 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileCode className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold text-amber-400">安全修正声明 (Amend File Declarations)</span>
          <span className="text-[10px] text-slate-500 ml-auto">{agent} / {latestRun?.result}</span>
        </div>

        {error && <div className="text-[10px] text-red-400 mb-2">{error}</div>}
        {success && <div className="text-[10px] text-green-400 mb-2">修正声明已提交</div>}

        <div className="flex flex-col gap-2 text-xs">
          <div>
            <label className="text-slate-500">选择本轮实际修改的文件 (可多选)</label>
            <div className="border border-slate-800 rounded p-2 bg-slate-950 max-h-40 overflow-y-auto space-y-1.5 mt-1">
              {deltaFiles.length === 0 ? (
                <div className="text-slate-500 text-[11px] py-1">未检测到任何实际变更的文件 (file-delta.json 为空)</div>
              ) : (
                deltaFiles.map(file => {
                  const allowed = isFileAllowed(file);
                  const checked = selectedFiles.includes(file);
                  return (
                    <label key={file} className={`flex items-start gap-2 text-[11px] p-1 rounded cursor-pointer ${allowed ? 'hover:bg-slate-900 text-slate-300' : 'opacity-50 text-red-400 cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        disabled={!allowed}
                        checked={checked && allowed}
                        onChange={(e) => {
                          if (!allowed) return;
                          if (e.target.checked) {
                            setSelectedFiles([...selectedFiles, file]);
                          } else {
                            setSelectedFiles(selectedFiles.filter(f => f !== file));
                          }
                        }}
                        className="mt-0.5 rounded border-slate-700 bg-slate-800 text-amber-600 focus:ring-0 focus:ring-offset-0"
                      />
                      <div className="flex flex-col">
                        <span className="font-mono break-all">{file}</span>
                        {!allowed && <span className="text-[9px] text-red-500">越权: 不在 allowed_write_paths 范围内</span>}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <label className="text-slate-500">说明 (10-4000 字符)</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-0.5 resize-none"
              placeholder="请填写修正文件声明的原因..." />
          </div>

          <button onClick={handleSubmit} disabled={loading || comment.length < 10 || selectedFiles.length === 0}
            className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 mt-1">
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            确认修正声明并设为成功
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-amber-800/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold text-amber-400">Operator Override</span>
        <span className="text-[10px] text-slate-500 ml-auto">{agent} / {latestRun?.result}</span>
      </div>

      {error && <div className="text-[10px] text-red-400 mb-2">{error}</div>}
      {success && <div className="text-[10px] text-green-400 mb-2">Override 已提交</div>}

      <div className="flex flex-col gap-2 text-xs">
        <div>
          <label className="text-slate-500">原结果</label>
          <div className="text-slate-300 bg-slate-800 rounded px-2 py-1 mt-0.5">{latestRun?.result} (只读)</div>
        </div>

        <div>
          <label className="text-slate-500">将推进至</label>
          <div className="text-cyan-300 bg-slate-800 rounded px-2 py-1 mt-0.5">{AGENT_STATE_MAP[agent]} (自动)</div>
        </div>

        <div>
          <label className="text-slate-500">原因</label>
          <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as any)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-0.5">
            {REASON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-slate-500">说明 (10-4000 字符)</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-0.5 resize-none" />
        </div>

        <button onClick={handleSubmit} disabled={loading || comment.length < 10}
          className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 mt-1">
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          提交 Override
        </button>
      </div>
    </div>
  );
}
