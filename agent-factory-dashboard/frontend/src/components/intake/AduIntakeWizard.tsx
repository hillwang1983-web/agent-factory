import React, { useState } from 'react';
import { RequirementSourceStep } from './RequirementSourceStep';
import { DraftReviewStep } from './DraftReviewStep';
import { generateIntakeDraft, getIntakeDraft } from '../../api/agentFactory';

export const AduIntakeWizard: React.FC<{ projectId: string, onClose: () => void }> = ({ projectId, onClose }) => {
    const [step, setStep] = useState(1);
    const [draftId, setDraftId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const triggerGenerate = async (id: string) => {
        setError(null);
        setStep(2);
        try {
            await generateIntakeDraft(id);
            // Backend spawn is fire-and-forget — poll until draft is ready or failed
            // Allow up to 3 minutes (90 × 2s) since Hermes may retry on API errors
            let attempts = 0;
            while (attempts < 90) {
                await new Promise(r => setTimeout(r, 2000));
                const data = await getIntakeDraft(id);
                const status = data.meta?.status;
                if (status === 'draft_ready') {
                    setStep(3);
                    return;
                }
                if (status === 'generation_failed') {
                    const reason = data.meta?.error;
                    const rateLimited = reason && (reason.includes('429') || reason.includes('RESOURCE_EXHAUSTED'));
                    setError(rateLimited
                        ? `API 配额暂时耗尽（Rate Limit），请等待约 1 分钟后点击"重新生成"。`
                        : `草案生成失败${reason ? `：${reason}` : ''}，请重试。`);
                    return;
                }
                attempts++;
            }
            // Timed out — do one final check in case the process just finished
            await new Promise(r => setTimeout(r, 3000));
            try {
                const finalData = await getIntakeDraft(id);
                const finalStatus = finalData.meta?.status;
                if (finalStatus === 'draft_ready') { setStep(3); return; }
                if (finalStatus === 'generation_failed') {
                    const reason = finalData.meta?.error;
                    setError(`草案生成失败${reason ? `：${reason}` : ''}，请重试。`);
                    return;
                }
            } catch { /* ignore final check error */ }
            setError('生成超时（3 分钟），请检查服务状态后重试。');
        } catch (e: any) {
            setError(`生成失败：${e?.message || String(e)}`);
        }
    };

    const handleDraftCreated = async (id: string) => {
        setDraftId(id);
        await triggerGenerate(id);
    };

    return (
        <div>
            {step === 1 && <RequirementSourceStep projectId={projectId} onDraftCreated={handleDraftCreated} />}
            {step === 2 && (
                <div className="space-y-3 p-4">
                    {!error && <div className="text-sm text-gray-400">草案生成中，请稍候…</div>}
                    {error && (
                        <div className="space-y-2">
                            <div className="text-sm text-red-400 p-2 bg-red-500/10 rounded">{error}</div>
                            {draftId && (
                                <button
                                    onClick={() => triggerGenerate(draftId)}
                                    className="text-xs px-3 py-1.5 border border-gray-600 rounded hover:bg-gray-700"
                                >
                                    重新生成
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
            {step === 3 && draftId && <DraftReviewStep draftId={draftId} onRegistered={onClose} />}
        </div>
    );
};
