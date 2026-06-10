// RequirementSourceStep component content here
import React, { useState } from 'react';
import { createIntakeDraft } from '../../api/agentFactory';

export const RequirementSourceStep: React.FC<{ projectId: string, onDraftCreated: (draftId: string) => void }> = ({ projectId, onDraftCreated }) => {
    const [rawText, setRawText] = useState('');
    const [files, setFiles] = useState<FileList | null>(null);

    const handleSubmit = async () => {
        const formData = new FormData();
        formData.append('rawText', rawText);
        if (files) {
            for (let i = 0; i < files.length; i++) {
                formData.append('files', files[i]);
            }
        }
        const result = await createIntakeDraft(projectId, formData);
        onDraftCreated(result.draft.draft_id);
    };

    return (
        <div>
            <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder=\"Requirement text...\" />
            <input type=\"file\" multiple onChange={(e) => setFiles(e.target.files)} />
            <button onClick={handleSubmit}>Generate Draft</button>
        </div>
    );
};