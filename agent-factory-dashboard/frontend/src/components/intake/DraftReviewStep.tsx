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
            <div className=\"space-y-2\">
                <label>Title</label>
                <input className=\"w-full p-2 border\" value={draft.title} onChange={(e) => handleUpdate({ title: e.target.value })} />
            </div>
            <div className=\"space-y-2\">
                <label>Goal</label>
                <textarea className=\"w-full p-2 border\" value={draft.goal} onChange={(e) => handleUpdate({ goal: e.target.value })} />
            </div>
            <div className=\"space-y-2\">
                <label>Write Paths (JSON format)</label>
                <textarea className=\"w-full p-2 border\" value={JSON.stringify(draft.preferredWritePaths)} onChange={(e) => handleUpdate({ preferredWritePaths: JSON.parse(e.target.value) })} />
            </div>
            <div className=\"space-y-2\">
                <label>Required Commands (JSON format)</label>
                <textarea className=\"w-full p-2 border\" value={JSON.stringify(draft.requiredCommands)} onChange={(e) => handleUpdate({ requiredCommands: JSON.parse(e.target.value) })} />
            </div>
            <button className=\"bg-blue-500 text-white p-2\" onClick={handleRegister}>Register ADU</button>
        </div>
    );
};