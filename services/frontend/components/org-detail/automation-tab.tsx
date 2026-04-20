import { Org, OrgPolicy } from '@/lib/api';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';

import { RulePill } from './shared';

interface OrgAutomationTabProps {
  org: Org;
  inputClassName: string;
  newPattern: string;
  onPatternChange: (value: string) => void;
  onAddPattern: () => void | Promise<void>;
  onRemovePattern: (pattern: string) => void | Promise<void>;
  onCreatePolicy: () => void;
  onEditPolicy: (policy: OrgPolicy) => void;
  onDeletePolicy: (policyId: string) => void | Promise<void>;
}

export function OrgAutomationTab({
  org,
  inputClassName,
  newPattern,
  onPatternChange,
  onAddPattern,
  onRemovePattern,
  onCreatePolicy,
  onEditPolicy,
  onDeletePolicy,
}: OrgAutomationTabProps) {
  return (
    <div className="space-y-6">
      <div className="glass-panel relative rounded-2xl p-5 space-y-3">
        <div
          className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.15),transparent)' }}
        />
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Auto-assign Patterns</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Scans matching these patterns are automatically assigned to this org. Use glob syntax: <code className="text-violet-500 dark:text-violet-400">nginx:*</code>, <code className="text-violet-500 dark:text-violet-400">docker.io/myapp:*</code>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(org.image_patterns ?? []).map((pattern, index) => (
            <span
              key={`${pattern}-${index}`}
              className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg text-zinc-700 dark:text-zinc-200"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >
              {pattern}
              <button onClick={() => void onRemovePattern(pattern)} className="text-zinc-400 hover:text-red-400 transition-colors ml-0.5" type="button">×</button>
            </span>
          ))}
          {(org.image_patterns ?? []).length === 0 && <p className="text-xs text-zinc-500">No patterns configured.</p>}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newPattern}
            onChange={(event) => onPatternChange(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void onAddPattern()}
            placeholder="nginx:* or docker.io/myapp:*"
            className={`${inputClassName} font-mono`}
          />
          <button onClick={() => void onAddPattern()} disabled={!newPattern.trim()} className="btn-primary" type="button">
            Add
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Policies</h2>
          <button onClick={onCreatePolicy} className="btn-primary inline-flex items-center gap-2" type="button">
            <PlusSignIcon size={14} />
            Add Policy
          </button>
        </div>

        {(org.policies ?? []).length === 0 ? (
          <div className="glass-panel rounded-2xl p-6 text-center text-sm text-zinc-500">
            No policies yet. Add one to start evaluating compliance.
          </div>
        ) : (
          <div className="space-y-2">
            {(org.policies ?? []).map((policy) => (
              <div key={policy.id} className="glass-panel rounded-2xl p-4 flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{policy.name}</p>
                  {policy.rules.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {policy.rules.map((rule, index) => (
                        <RulePill key={index} rule={rule} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => onEditPolicy(policy)} className="text-zinc-400 dark:text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors p-1" title="Edit policy" type="button">
                    <PencilEdit01Icon size={15} />
                  </button>
                  <button onClick={() => void onDeletePolicy(policy.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1" title="Delete policy" type="button">
                    <Delete01Icon size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}