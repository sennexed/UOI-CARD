import { ROLE_HIERARCHY, DEFAULT_RANK } from '../types';
import { Award, Shield } from 'lucide-react';

interface HierarchyReferenceProps {
  selectedRoleIds: string[];
  onToggleRole: (id: string) => void;
}

export function HierarchyReference({ selectedRoleIds, onToggleRole }: HierarchyReferenceProps) {
  return (
    <div id="hierarchy-panel" className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
            Discord Role Hierarchy & Mapping Engine
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-400">Precedence: Top &gt; Bottom</span>
      </div>

      <div className="flex flex-col gap-2">
        {ROLE_HIERARCHY.map((role) => {
          const isSelected = selectedRoleIds.includes(role.id);
          return (
            <div
              key={role.id}
              id={`role-item-${role.id}`}
              onClick={() => onToggleRole(role.id)}
              className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                isSelected
                  ? 'bg-slate-800 border-amber-500/60 shadow-sm'
                  : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px]"
                  style={{
                    backgroundColor: isSelected ? role.badgeBorder : 'rgba(100,116,139,0.2)',
                    color: isSelected ? '#000' : '#94A3B8',
                  }}
                >
                  {role.tierLevel}
                </span>
                <div>
                  <div className="font-semibold text-slate-200">{role.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono">ID: {role.id}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-medium uppercase font-mono"
                  style={{
                    backgroundColor: role.badgeBg,
                    color: role.badgeText,
                    border: `1px solid ${role.badgeBorder}40`,
                  }}
                >
                  {role.name}
                </span>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}} // handled by parent div click
                  className="rounded border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
              </div>
            </div>
          );
        })}

        {/* Default fallback rank card */}
        <div className="flex items-center justify-between p-2.5 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <Shield className="w-4 h-4 text-slate-500" />
            <div>
              <span className="font-semibold text-slate-300">{DEFAULT_RANK}</span>
              <p className="text-[10px] text-slate-500">Default fallback tier when no administrative roles match</p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono">
            DEFAULT
          </span>
        </div>
      </div>
    </div>
  );
}
