import React, { useState } from 'react';
import { createIntakeDraft } from '../../api/agentFactory';

type RequirementType = 'feature' | 'bugfix' | 'test' | 'docs' | 'refactor' | 'unknown';

const REQUIREMENT_TYPE_LABELS: Record<RequirementType, string> = {
    feature: '新功能',
    bugfix: '缺陷修复',
    test: '测试',
    docs: '文档',
    refactor: '重构',
    unknown: '未知',
};

export const RequirementSourceStep: React.FC<{ projectId: string, onDraftCreated: (draftId: string) => void }> = ({ projectId, onDraftCreated }) => {
    const [rawText, setRawText] = useState('');
    const [files, setFiles] = useState<FileList | null>(null);
    const [requirementType, setRequirementType] = useState<RequirementType>('feature');
    const [userHints, setUserHints] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        const hasText = rawText.trim().length > 0;
        const hasFiles = files && files.length > 0;
        if (!hasText && !hasFiles) {
            setError('请输入需求文本或上传需求文件（两者至少需要一项）。');
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('rawText', rawText);
            formData.append('userHints', userHints);
            formData.append('requirementType', requirementType);
            if (files) {
                for (let i = 0; i < files.length; i++) {
                    formData.append('files', files[i]);
                }
            }
            const result = await createIntakeDraft(projectId, formData);
            onDraftCreated(result.draft.draft_id);
        } catch (e: any) {
            setError(`创建草案失败：${e?.message || String(e)}`);
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-4 p-4">
            <h2 className="text-base font-medium">原始需求输入</h2>

            {error && <div className="text-xs text-red-400 p-2 bg-red-500/10 border border-red-500/20 rounded">{error}</div>}

            <div className="space-y-1">
                <label className="text-xs text-gray-400">需求类型</label>
                <select
                    className="w-full bg-transparent border border-gray-700 rounded px-2 py-1 text-sm"
                    value={requirementType}
                    onChange={e => setRequirementType(e.target.value as RequirementType)}
                >
                    {(Object.keys(REQUIREMENT_TYPE_LABELS) as RequirementType[]).map(t => (
                        <option key={t} value={t}>{REQUIREMENT_TYPE_LABELS[t]}</option>
                    ))}
                </select>
            </div>

            <div className="space-y-1">
                <label className="text-xs text-gray-400">需求文本</label>
                <textarea
                    className="w-full bg-transparent border border-gray-700 rounded px-2 py-1 text-sm"
                    rows={5}
                    placeholder="描述你的需求……"
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                />
            </div>

            <div className="space-y-1">
                <label className="text-xs text-gray-400">上传需求文件（.txt / .md / .json，每个最大 200 KB，总计最大 1 MB）</label>
                <input
                    type="file"
                    multiple
                    accept=".txt,.md,.json"
                    onChange={e => setFiles(e.target.files)}
                    className="text-sm"
                />
            </div>

            <div className="space-y-1">
                <label className="text-xs text-gray-400">补充提示（可选）</label>
                <textarea
                    className="w-full bg-transparent border border-gray-700 rounded px-2 py-1 text-sm"
                    rows={2}
                    placeholder="例如：优先考虑性能，不修改现有 API……"
                    value={userHints}
                    onChange={e => setUserHints(e.target.value)}
                />
            </div>

            <button
                disabled={submitting}
                onClick={handleSubmit}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded"
            >
                {submitting ? '创建中…' : '生成草案'}
            </button>
        </div>
    );
};
