import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getIntakeDraft, updateIntakeDraft, registerIntakeDraft } from '../../api/agentFactory';
import { AgentFactoryAduDraft } from '../../types/agent-factory';
import { QuestionAnswerPanel } from './QuestionAnswerPanel';

export const DraftReviewStep: React.FC<{ draftId: string, onRegistered: (aduId: string) => void }> = ({ draftId, onRegistered }) => {
    const [draft, setDraft] = useState<AgentFactoryAduDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [registering, setRegistering] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmLow, setConfirmLow] = useState(false);

    // Ref holds latest draft so the debounce callback reads current state without stale closure
    const draftRef = useRef<AgentFactoryAduDraft | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        getIntakeDraft(draftId).then(data => {
            draftRef.current = data.draft;
            setDraft(data.draft);
        }).catch(e => setError(`加载草案失败: ${String(e)}`));
    }, [draftId]);

    const scheduleSave = useCallback(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            if (!draftRef.current) return;
            setSaving(true);
            try {
                const result = await updateIntakeDraft(draftId, draftRef.current);
                // Fix: response is { success, draft } — extract draft, don't replace state with wrapper
                draftRef.current = result.draft;
                setDraft(result.draft);
            } catch (e: any) {
                setError(`自动保存失败: ${e?.message || String(e)}`);
            } finally {
                setSaving(false);
            }
        }, 600);
    }, [draftId]);

    const handleChange = (updates: Partial<AgentFactoryAduDraft>) => {
        setDraft(prev => {
            const next = prev ? { ...prev, ...updates } : null;
            draftRef.current = next;
            return next;
        });
        scheduleSave();
    };

    const handleRegister = async () => {
        if (!draft || registering) return;

        if (draft.confidence === 'low' && !confirmLow) {
            setError('草案置信度为低，请勾选下方确认项后再注册。');
            return;
        }

        // Client side validation
        const unresolved = draft.question_answers?.filter(a => 
          a.status === 'unanswered' || (a.status === 'answered' && !a.answer.trim())
        ) || [];
        
        if (unresolved.length > 0) {
            setError(`仍有 ${unresolved.length} 个问题未处理或未填写答案，请完善。`);
            return;
        }

        setRegistering(true);
        setError(null);
        try {
            const confirmed = confirmLow;
            const result = await registerIntakeDraft(draftId, confirmed);
            onRegistered(result.adu.id);
        } catch (e: any) {
            setError(`注册失败: ${e?.message || String(e)}`);
            setRegistering(false);
        }
    };

    if (!draft) return <div className="p-4 text-sm text-gray-400">加载草案中…</div>;

    return (
        <div className="space-y-4 p-4">
            <h2 className="text-base font-medium">审核并注册 ADU 草案</h2>

            {saving && <div className="text-xs text-gray-500">保存中…</div>}
            {error && <div className="text-xs text-red-400 p-2 bg-red-500/10 border border-red-500/20 rounded">{error}</div>}

            {draft.confidence === 'low' && (
                <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-300 space-y-1">
                    <div>⚠ 置信度为低，建议补充更多需求信息后重新生成草案。</div>
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={confirmLow} onChange={e => setConfirmLow(e.target.checked)} />
                        我已了解风险，仍要注册
                    </label>
                </div>
            )}



            <div className="space-y-1">
                <label className="text-xs text-gray-400">标题</label>
                <input
                    className="w-full bg-transparent border border-gray-700 rounded px-2 py-1 text-sm"
                    value={draft.title}
                    onChange={e => handleChange({ title: e.target.value })}
                />
            </div>

            <div className="space-y-1">
                <label className="text-xs text-gray-400">目标</label>
                <textarea
                    className="w-full bg-transparent border border-gray-700 rounded px-2 py-1 text-sm"
                    rows={3}
                    value={draft.goal}
                    onChange={e => handleChange({ goal: e.target.value })}
                />
            </div>

            <div className="flex gap-4 items-center">
                <div className="space-y-1">
                    <label className="text-xs text-gray-400">风险</label>
                    <select
                        className="bg-transparent border border-gray-700 rounded px-2 py-1 text-sm"
                        value={draft.risk}
                        onChange={e => handleChange({ risk: e.target.value as AgentFactoryAduDraft['risk'] })}
                    >
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                    </select>
                </div>

                <div className="space-y-1">
                    <label className="text-xs text-gray-400">目标等级</label>
                    <select
                        className="bg-transparent border border-gray-700 rounded px-2 py-1 text-sm"
                        value={draft.targetLevel}
                        onChange={e => handleChange({ targetLevel: e.target.value as AgentFactoryAduDraft['targetLevel'] })}
                    >
                        <option value="mvp">MVP</option>
                        <option value="production">Production</option>
                    </select>
                </div>
            </div>

            <div className="flex gap-4 text-xs text-gray-400">
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={draft.analysisReviewRequired}
                        onChange={e => handleChange({ analysisReviewRequired: e.target.checked })} />
                    需求分析人工审核
                </label>
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={draft.designReviewRequired}
                        onChange={e => handleChange({ designReviewRequired: e.target.checked })} />
                    详细设计人工审核
                </label>
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={draft.manualEvidenceMode}
                        onChange={e => handleChange({ manualEvidenceMode: e.target.checked })} />
                    人工证据模式
                </label>
            </div>

            <div className="space-y-1">
                <label className="text-xs text-gray-400">写路径（JSON 数组）</label>
                <textarea
                    className="w-full bg-transparent border border-gray-700 rounded px-2 py-1 text-xs font-mono"
                    rows={2}
                    defaultValue={JSON.stringify(draft.preferredWritePaths, null, 2)}
                    onBlur={e => {
                        try { handleChange({ preferredWritePaths: JSON.parse(e.target.value) }); } catch {}
                    }}
                />
            </div>

            <div className="space-y-1">
                <label className="text-xs text-gray-400">验证命令（JSON 数组）</label>
                <textarea
                    className="w-full bg-transparent border border-gray-700 rounded px-2 py-1 text-xs font-mono"
                    rows={2}
                    defaultValue={JSON.stringify(draft.requiredCommands, null, 2)}
                    onBlur={e => {
                        try { handleChange({ requiredCommands: JSON.parse(e.target.value) }); } catch {}
                    }}
                />
            </div>

            {draft.question_answers && draft.question_answers.length > 0 && (
                <QuestionAnswerPanel 
                    answers={draft.question_answers} 
                    onChange={(newAnswers) => handleChange({ question_answers: newAnswers })}
                />
            )}

            <button
                disabled={registering}
                onClick={handleRegister}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded"
            >
                {registering ? '注册中…' : '注册 ADU'}
            </button>
        </div>
    );
};
