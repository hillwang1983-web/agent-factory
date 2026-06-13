interface SettingsSectionHeaderProps {
  title: string;
  description: string;
}

export function SettingsSectionHeader({ title, description }: SettingsSectionHeaderProps): JSX.Element {
  return (
    <div className="mb-6 border-b border-slate-800/60 pb-4">
      <h2 className="text-lg font-bold text-white tracking-tight">{title}</h2>
      <p className="text-xs text-nms-text-dim mt-1">{description}</p>
    </div>
  );
}
