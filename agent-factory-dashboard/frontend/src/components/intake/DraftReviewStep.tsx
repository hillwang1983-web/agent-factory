import React, { useState, useEffect } from 'react';
import { getIntakeDraft, updateIntakeDraft, registerIntakeDraft } from '../../api/agentFactory';
import { AgentFactoryAduDraft } from '../../types/agent-factory';

export const DraftReviewStep: React.FC<{ draftId: string, onRegistered: (aduId: string) => void }> = ({ draftId, onRegistered }) => {
    const [draft, setDraft] = useState<AgentFactoryAduDraft | null>(null);

    useEffect(() => {
        getIntakeDraft(draftId).then(data => setDraft(data.draft));
    }, [draftId]);

    const handleUpdate = async (updates: Partial<AgentFactoryAduDraft>) => {
        if (!draft) return;
        const updated = await updateIntakeDraft(draftId, updates);
        setDraft(updated);
    };

    const handleRegister = async () => {
        const result = await registerIntakeDraft(draftId);
        onRegistered(result.adu.id);
    };

    if (!draft) return <div>Loading...</div>;

    return (
        <div className=\"space-y-4\">
            <h2 className=\"text-lg font-bold\">Review Draft</h2>
            {/* Existing fields */}
            <input value={draft.title} onChange={(e) => handleUpdate({ title: e.target.value })} />
            <textarea value={draft.goal} onChange={(e) => handleUpdate({ goal: e.target.value })} />

            {/* New fields */}
            <select value={draft.risk} onChange={(e) => handleUpdate({ risk: e.target.value as any })}>
                <option value=\"low\">Low</option>
                <option value=\"medium\">Medium</option>
                <option value=\"high\">High</option>
            </select>
            
            <input type=\"checkbox\" checked={draft.analysisReviewRequired} onChange={(e) => handleUpdate({ analysisReviewRequired: e.target.checked })} /> Analysis Review Required
            
            {/* Fragile JSON fields, consider better UI for production */}
            <textarea value={JSON.stringify(draft.preferredWritePaths)} onChange={(e) => {
                try { handleUpdate({ preferredWritePaths: JSON.parse(e.target.value) }); } catch {}
            }} />
            
            <button className=\"bg-blue-500 text-white p-2\" onClick={handleRegister}>Register ADU</button>
        </div>
    );
};