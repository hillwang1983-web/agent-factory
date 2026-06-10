import React, { useState, useEffect } from 'react';
import { getIntakeDraft, updateIntakeDraft, registerIntakeDraft } from '../../api/agentFactory';
import { AgentFactoryAduDraft } from '../../types/agent-factory';

export const DraftReviewStep: React.FC<{ draftId: string, onRegistered: (aduId: string) => void }> = ({ draftId, onRegistered }) => {
    const [draft, setDraft] = useState<AgentFactoryAduDraft | null>(null);

    useEffect(() => {
        getIntakeDraft(draftId).then(data => setDraft(data.draft));
    }, [draftId]);

    const handleRegister = async () => {
        const result = await registerIntakeDraft(draftId);
        onRegistered(result.adu.id);
    };

    if (!draft) return <div>Loading...</div>;

    return (
        <div>
            <h2>Review Draft</h2>
            <input value={draft.title} onChange={(e) => setDraft({...draft, title: e.target.value})} />
            <textarea value={draft.goal} onChange={(e) => setDraft({...draft, goal: e.target.value})} />
            <button onClick={handleRegister}>Register ADU</button>
        </div>
    );
};