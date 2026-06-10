import React, { useState } from 'react';
import { RequirementSourceStep } from './RequirementSourceStep';
import { DraftReviewStep } from './DraftReviewStep';
import { generateIntakeDraft } from '../../api/agentFactory';

export const AduIntakeWizard: React.FC<{ projectId: string, onClose: () => void }> = ({ projectId, onClose }) => {
    const [step, setStep] = useState(1);
    const [draftId, setDraftId] = useState<string | null>(null);

    const handleDraftCreated = async (id: string) => {
        setDraftId(id);
        setStep(2);
        await generateIntakeDraft(id);
        setStep(3);
    };

    return (
        <div>
            {step === 1 && <RequirementSourceStep projectId={projectId} onDraftCreated={handleDraftCreated} />}
            {step === 2 && <div>Generating draft...</div>}
            {step === 3 && draftId && <DraftReviewStep draftId={draftId} onRegistered={onClose} />}
        </div>
    );
};