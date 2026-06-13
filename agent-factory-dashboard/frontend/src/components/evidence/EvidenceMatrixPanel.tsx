import { useEffect, useState } from 'react';
import { agentFactoryApi } from '../../api/agentFactory';
import { ShieldCheck, Loader2, AlertTriangle, FileText, CheckCircle } from 'lucide-react';

interface EvidenceMatrixPanelProps {
  aduId: string;
}

export function EvidenceMatrixPanel({ aduId }: EvidenceMatrixPanelProps) {
  const [matrix, setMatrix] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const loadMatrix = async () => {
      try {
        setLoading(true);
        const data = await agentFactoryApi.fetchEvidenceMatrix(aduId);
        if (active) {
          setMatrix(data);
        }
      } catch (_) {
      } finally {
        if (active) setLoading(false);
      }
    };

    loadMatrix();
  }, [aduId]);

  if (loading && !matrix) {
    return (
      <div className="flex items-center justify-center p-8 bg-slate-900 border border-slate-800 rounded-xl">
        <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!matrix) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-indigo-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">证据合规性矩阵 (Evidence Matrix)</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">总体合规状态:</span>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase ${
            matrix.overall_status === 'pass'
              ? 'bg-emerald-500/20 text-emerald-300'
              : matrix.overall_status === 'waived'
              ? 'bg-blue-500/20 text-blue-300'
              : matrix.overall_status === 'pending_environment_verification'
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-red-500/20 text-red-300'
          }`}>
            {matrix.overall_status === 'pass' ? '完全合规 (PASS)' :
             matrix.overall_status === 'waived' ? '人工豁免 (WAIVED)' :
             matrix.overall_status === 'pending_environment_verification' ? '待验证 (PENDING VERIFICATION)' : '不合规 (FAIL)'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800/80 text-slate-400 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4">断言编号</th>
              <th className="py-3 px-4">验证类型</th>
              <th className="py-3 px-4">合规状态</th>
              <th className="py-3 px-4">验证要求 (Evidence Required)</th>
              <th className="py-3 px-4">已提交凭证 (Submitted Evidence)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {matrix.assertion_evidence.map((ass: any) => (
              <tr key={ass.assertion_id} className="hover:bg-slate-950/20 transition-all">
                <td className="py-3.5 px-4 font-mono font-bold text-slate-200">{ass.assertion_id}</td>
                <td className="py-3.5 px-4">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                    ass.verification_type === 'runtime'
                      ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-400'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-400'
                  }`}>
                    {ass.verification_type}
                  </span>
                </td>
                <td className="py-3.5 px-4">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    ass.status === 'pass'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : ass.status === 'waived'
                      ? 'bg-blue-500/20 text-blue-400'
                      : ass.status === 'pending_environment_verification'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {ass.status}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-slate-400 max-w-[200px] truncate" title={ass.required_evidence}>
                  {ass.required_evidence}
                </td>
                <td className="py-3.5 px-4 text-slate-300">
                  <div className="space-y-1">
                    {ass.evidence_items.length === 0 ? (
                      <span className="text-slate-600 italic">无</span>
                    ) : (
                      ass.evidence_items.map((item: any, i: number) => (
                        <div key={i} className="flex items-center gap-1.5 bg-slate-950/40 p-1.5 rounded border border-slate-850">
                          {item.type === 'waiver' ? (
                            <AlertTriangle className="h-3 w-3 text-blue-400" />
                          ) : (
                            <FileText className="h-3 w-3 text-indigo-400" />
                          )}
                          <span className="font-mono text-[10px] text-slate-400 max-w-[150px] truncate" title={item.path || item.waiver_id}>
                            {item.path || item.waiver_id}
                          </span>
                          <CheckCircle className="h-3 w-3 text-emerald-500 ml-auto" />
                        </div>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
