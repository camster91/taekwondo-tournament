/**
 * Tournament Rules Editor
 *
 * Lets a tournament director configure the rules that drive division
 * categorization and bracket generation. The rules JSON is stored on
 * Tournament.settings.rules and consumed by the categorization engine.
 *
 * Real-world workflow this matches:
 *   - Newton's 2025 used CB/BB tiers, 8 age bands, 3-4 weight classes
 *   - 1-person divisions get merged into the next age band up
 *   - Same-school matchups in round 1 are avoided where possible
 *   - Black Belt patterns is split by DAN rank (1st/2nd/3rd...)
 *   - Colored belt patterns is grouped 3 belts per division
 */

import { useState, useEffect, useMemo } from 'react';
import {
  DEFAULT_TOURNAMENT_RULES,
  type TournamentRules,
  type BeltGroup,
  type AgeBandConfig,
  type DivisionRules,
  type BracketRules,
  type WeightClassRuleConfig,
  type EventRules,
} from '../../shared/constants/tournament-rules';
import { DEFAULT_AGE_GROUPS, BB_AGE_GROUPS, type AgeGroup } from '../../shared/constants/age-groups';
import { DEFAULT_WEIGHT_CLASSES, type WeightClassConfig } from '../../shared/constants/weight-classes';

interface RulesEditorProps {
  rules: TournamentRules;
  onChange: (rules: TournamentRules) => void;
  onReset: () => void;
}

const BELT_COLOR_OPTIONS = [
  'White',
  'White / Single Yellow Stripe', 'White / Double Yellow Stripe',
  'Yellow',
  'Yellow / Single Green Stripe', 'Yellow / Double Green Stripe',
  'Green',
  'Green / Single Blue Stripe', 'Green / Double Blue Stripe',
  'Blue',
  'Blue / Single Red Stripe', 'Blue / Double Red Stripe',
  'Red',
  'Red / Single Black Stripe', 'Red / Double Black Stripe',
  'Black',
];

const BELT_PRESETS: Record<string, BeltGroup[]> = {
  '2-tier (CB/BB)': [
    { id: 'CB', label: 'Colored Belt', belts: BELT_COLOR_OPTIONS.filter(b => b !== 'Black') },
    { id: 'BB', label: 'Black Belt', belts: ['Black'], danMin: 1, danMax: 6 },
  ],
  '3-tier (CB / Poom / BB)': [
    { id: 'CB', label: 'Colored Belt', belts: BELT_COLOR_OPTIONS.filter(b => b !== 'Black') },
    { id: 'POOM', label: 'Poom Belt (Junior Black)', belts: ['Black'], danMin: 1, danMax: 3, maxAge: 15 },
    { id: 'BB', label: 'Senior Black Belt', belts: ['Black'], danMin: 1, danMax: 9, minAge: 16 },
  ],
  '4-tier (Beginner CB / Adv CB / Poom / BB)': [
    { id: 'CB-Beginner', label: 'Beginner Colored (White-Yellow)', belts: ['White', 'White / Single Yellow Stripe', 'White / Double Yellow Stripe', 'Yellow'] },
    { id: 'CB-Advanced', label: 'Advanced Colored (Green-Red)', belts: ['Yellow / Single Green Stripe','Yellow / Double Green Stripe','Green','Green / Single Blue Stripe','Green / Double Blue Stripe','Blue','Blue / Single Red Stripe','Blue / Double Red Stripe','Red','Red / Single Black Stripe','Red / Double Black Stripe'] },
    { id: 'POOM', label: 'Poom Belt', belts: ['Black'], danMin: 1, danMax: 3, maxAge: 15 },
    { id: 'BB', label: 'Senior Black Belt', belts: ['Black'], danMin: 1, danMax: 9, minAge: 16 },
  ],
};

export default function TournamentRulesEditor({ rules, onChange, onReset }: RulesEditorProps) {
  // Local edit buffer so changes feel instant
  const [local, setLocal] = useState<TournamentRules>(rules);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => { setLocal(rules); }, [rules]);

  const update = <K extends keyof TournamentRules>(key: K, value: TournamentRules[K]) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    onChange(next);
  };

  const applyPreset = (preset: string) => {
    const groups = BELT_PRESETS[preset];
    if (groups) update('beltGroups', groups);
  };

  const stats = useMemo(() => {
    const tiers = local.beltGroups.length;
    const bands = local.ageBands.strategy === 'byYear'
      ? DEFAULT_AGE_GROUPS.reduce((s, g) => s + (g.max - g.min + 1), 0)
      : (local.ageBands.customBands ?? (local.ageBands.preset === 'blackBelt' ? BB_AGE_GROUPS : DEFAULT_AGE_GROUPS)).length;
    return { tiers, bands };
  }, [local]);

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex flex-wrap items-center gap-4 text-sm">
        <div className="font-medium text-blue-900">Current configuration:</div>
        <Badge color="blue">{stats.tiers} tier{stats.tiers !== 1 ? 's' : ''}</Badge>
        <Badge color="green">{stats.bands} age band{stats.bands !== 1 ? 's' : ''}</Badge>
        <Badge color="purple">{local.weights.strategy} weight strategy</Badge>
        <Badge color="amber">min division size {local.divisions.minDivisionSize}</Badge>
        {local.brackets.avoidSameSchoolRound1 && <Badge color="pink">no same-school R1</Badge>}
        <button
          type="button"
          onClick={() => { onReset(); setSavedAt(new Date()); }}
          className="ml-auto text-xs text-gray-600 hover:text-gray-900 underline"
        >
          Reset to defaults
        </button>
        {savedAt && <span className="text-xs text-green-700">Saved {savedAt.toLocaleTimeString()}</span>}
      </div>

      {/* Belt tier preset */}
      <Section title="Belt Tiers" subtitle="How belt colors are grouped into CB/BB (or more) for division purposes.">
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.keys(BELT_PRESETS).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-300"
            >
              Use {p}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {local.beltGroups.map((g, i) => (
            <BeltGroupEditor
              key={g.id || i}
              group={g}
              onChange={(next) => {
                const updated = [...local.beltGroups];
                updated[i] = next;
                update('beltGroups', updated);
              }}
              onRemove={() => update('beltGroups', local.beltGroups.filter((_, j) => j !== i))}
            />
          ))}
          <button
            type="button"
            onClick={() => update('beltGroups', [...local.beltGroups, { id: 'NEW', label: 'New Group', belts: [] }])}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            + Add tier
          </button>
        </div>
      </Section>

      {/* Age bands */}
      <Section title="Age Bands" subtitle="How competitor ages are grouped into divisions.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Radio
            label="By multi-year band"
            sub="Newton's default (4-5, 6-7, 8-9, ...)"
            checked={local.ageBands.strategy === 'byBand'}
            onChange={() => update('ageBands', { ...local.ageBands, strategy: 'byBand' })}
          />
          <Radio
            label="By single year"
            sub="Each age is its own band (smaller divisions, more brackets)"
            checked={local.ageBands.strategy === 'byYear'}
            onChange={() => update('ageBands', { ...local.ageBands, strategy: 'byYear' })}
          />
          <Radio
            label="Custom"
            sub="Define exact age ranges"
            checked={local.ageBands.strategy === 'custom'}
            onChange={() => update('ageBands', { ...local.ageBands, strategy: 'custom' })}
          />
        </div>
        {local.ageBands.strategy === 'byBand' && (
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => update('ageBands', { ...local.ageBands, preset: 'standard' })}
              className={`px-3 py-1.5 text-sm rounded border ${local.ageBands.preset !== 'blackBelt' ? 'bg-blue-100 border-blue-400' : 'bg-gray-100 border-gray-300'}`}
            >
              Standard 8-band (4-5, 6-7, 8-9, 10-11, 12-14, 15-17, 18-35, 36+)
            </button>
            <button
              type="button"
              onClick={() => update('ageBands', { ...local.ageBands, preset: 'blackBelt' })}
              className={`px-3 py-1.5 text-sm rounded border ${local.ageBands.preset === 'blackBelt' ? 'bg-blue-100 border-blue-400' : 'bg-gray-100 border-gray-300'}`}
            >
              Black Belt 6-band (11-, 12-13, 14-15, 16-17, 18-35, 36+)
            </button>
          </div>
        )}
        {local.ageBands.strategy === 'custom' && (
          <CustomAgeBands
            value={local.ageBands.customBands ?? DEFAULT_AGE_GROUPS}
            onChange={(bands) => update('ageBands', { ...local.ageBands, customBands: bands })}
          />
        )}
        <div className="mt-3 flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Min competitors in same age (by-year mode):</label>
          <input
            type="number"
            min={1}
            max={10}
            value={local.ageBands.yearMinDivisionSize ?? 2}
            onChange={(e) => update('ageBands', { ...local.ageBands, yearMinDivisionSize: parseInt(e.target.value) || 2 })}
            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <span className="text-xs text-gray-600">Under this, they merge with adjacent age</span>
        </div>
      </Section>

      {/* Weight classes */}
      <Section title="Weight Classes (Sparring)" subtitle="How sparring competitors are split by weight within an age band.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Radio
            label="Standard"
            sub={`Use 3 (Light/Middle/Heavy) or 4 (Feather/Light/Middle/Heavy) class split per age band`}
            checked={local.weights.strategy === 'standard'}
            onChange={() => update('weights', { ...local.weights, strategy: 'standard' })}
          />
          <Radio
            label="Auto"
            sub="Compute classes from competitor count, target N per class"
            checked={local.weights.strategy === 'auto'}
            onChange={() => update('weights', { ...local.weights, strategy: 'auto' })}
          />
          <Radio
            label="Custom"
            sub="Define each weight class explicitly per age/gender"
            checked={local.weights.strategy === 'custom'}
            onChange={() => update('weights', { ...local.weights, strategy: 'custom' })}
          />
        </div>
        {local.weights.strategy === 'standard' && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Number of classes:</label>
            <select
              value={local.weights.classes ?? 3}
              onChange={(e) => update('weights', { ...local.weights, classes: parseInt(e.target.value) as 3 | 4 })}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="3">3 (Light / Middle / Heavy)</option>
              <option value="4">4 (Feather / Light / Middle / Heavy)</option>
            </select>
          </div>
        )}
        {local.weights.strategy === 'auto' && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Target competitors per class:</label>
            <input
              type="number"
              min={2}
              max={20}
              value={local.weights.targetClassSize ?? 4}
              onChange={(e) => update('weights', { ...local.weights, targetClassSize: parseInt(e.target.value) || 4 })}
              className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </div>
        )}
        <div className="mt-3 flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Skip weight classing if division has &lt;</label>
          <input
            type="number"
            min={2}
            max={20}
            value={local.weights.skipIfDivisionSmallerThan ?? 4}
            onChange={(e) => update('weights', { ...local.weights, skipIfDivisionSmallerThan: parseInt(e.target.value) || 4 })}
            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <span className="text-xs text-gray-600">competitors (saves you from 1-person weight divisions)</span>
        </div>
      </Section>

      {/* Division rules */}
      <Section title="Division Split & Merge" subtitle="How to handle too-small and too-large divisions.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            label="Min competitors per division"
            help="Smaller divisions get merged with the next adjacent one"
            value={local.divisions.minDivisionSize}
            min={1}
            max={10}
            onChange={(v) => update('divisions', { ...local.divisions, minDivisionSize: v })}
          />
          <NumberField
            label="Max competitors per division"
            help="Larger divisions are split"
            value={local.divisions.maxDivisionSize}
            min={4}
            max={64}
            onChange={(v) => update('divisions', { ...local.divisions, maxDivisionSize: v })}
          />
          <SelectField
            label="Merge small divisions into"
            help="When a division is too small, where to look for a partner"
            value={local.divisions.mergeDirection}
            options={[
              { value: 'ageUp', label: 'Next age band up' },
              { value: 'ageDown', label: 'Next age band down' },
              { value: 'weightAdj', label: 'Adjacent weight class (same age)' },
              { value: 'beltAdj', label: 'Adjacent belt (same age)' },
            ]}
            onChange={(v) => update('divisions', { ...local.divisions, mergeDirection: v as DivisionRules['mergeDirection'] })}
          />
          <SelectField
            label="Split large divisions by"
            value={local.divisions.splitBy}
            options={[
              { value: 'weight', label: 'Weight (sparring: typical)' },
              { value: 'age', label: 'Age (one year per division)' },
              { value: 'belt', label: 'Belt (group by belt rank)' },
              { value: 'school', label: 'School (avoid same-school in R1)' },
            ]}
            onChange={(v) => update('divisions', { ...local.divisions, splitBy: v as DivisionRules['splitBy'] })}
          />
          <NumberField
            label="Age boundary flexibility (months)"
            help="A competitor within N months of the next band can compete up (when 'Compete with older' is checked)"
            value={local.divisions.ageFlexMonths}
            min={0}
            max={24}
            onChange={(v) => update('divisions', { ...local.divisions, ageFlexMonths: v })}
          />
          <Checkbox
            label="Allow cross-tier merge (e.g. CB merging into BB)"
            help="For very small tournaments only. Off by default."
            checked={local.divisions.allowCrossTierMerge}
            onChange={(v) => update('divisions', { ...local.divisions, allowCrossTierMerge: v })}
          />
        </div>
      </Section>

      {/* Bracket rules */}
      <Section title="Bracket Generation" subtitle="How competitors are seeded and paired in brackets.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Checkbox
            label="Avoid same-school matchups in Round 1"
            help="Where bracket size allows. Skipped for divisions with <4 competitors."
            checked={local.brackets.avoidSameSchoolRound1}
            onChange={(v) => update('brackets', { ...local.brackets, avoidSameSchoolRound1: v })}
          />
          <SelectField
            label="Seed competitors by"
            value={local.brackets.seedingStrategy}
            options={[
              { value: 'rating', label: 'ELO rating (skill)' },
              { value: 'experience', label: 'Years of training' },
              { value: 'belt', label: 'Belt rank' },
              { value: 'random', label: 'Random (no seeding)' },
            ]}
            onChange={(v) => update('brackets', { ...local.brackets, seedingStrategy: v as BracketRules['seedingStrategy'] })}
          />
          <SelectField
            label="Round 1 pairing"
            help="adjacent=strong vs strong early; balanced=strong vs weak early; split=alternate"
            value={local.brackets.round1Pairing}
            options={[
              { value: 'split', label: 'Split (recommended)' },
              { value: 'balanced', label: 'Balanced (top vs bottom)' },
              { value: 'adjacent', label: 'Adjacent (1v2, 3v4...)' },
            ]}
            onChange={(v) => update('brackets', { ...local.brackets, round1Pairing: v as BracketRules['round1Pairing'] })}
          />
          <SelectField
            label="Bye placement (when bracket isn't power-of-2)"
            value={local.brackets.byePlacement}
            options={[
              { value: 'rating', label: 'Top seeds get byes' },
              { value: 'top', label: 'First slots get byes' },
              { value: 'random', label: 'Random' },
            ]}
            onChange={(v) => update('brackets', { ...local.brackets, byePlacement: v as BracketRules['byePlacement'] })}
          />
          <SelectField
            label="Consolation rounds"
            value={String(local.brackets.consolationRounds)}
            options={[
              { value: '1', label: '1 round (standard)' },
              { value: '2', label: '2 rounds (more play for losers)' },
              { value: '3', label: '3 rounds (full consolation)' },
            ]}
            onChange={(v) => update('brackets', { ...local.brackets, consolationRounds: parseInt(v) as 1 | 2 | 3 })}
          />
        </div>
      </Section>

      {/* Event rules */}
      <Section title="Event-Specific Rules" subtitle="Patterns and Sparring use different grouping strategies.">
        <EventRuleEditor
          title="Patterns"
          rule={local.events.patterns}
          onChange={(next) => update('events', { ...local.events, patterns: next })}
        />
        <EventRuleEditor
          title="Sparring"
          rule={local.events.sparring}
          onChange={(next) => update('events', { ...local.events, sparring: next })}
        />
      </Section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-600 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: 'blue'|'green'|'purple'|'amber'|'pink' }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    purple: 'bg-purple-100 text-purple-800 border-purple-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    pink: 'bg-pink-100 text-pink-800 border-pink-200',
  };
  return <span className={`text-xs px-2 py-1 rounded border ${colors[color]}`}>{children}</span>;
}

function Radio({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer ${checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-1" />
      <div>
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-600">{sub}</div>
      </div>
    </label>
  );
}

function Checkbox({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <div>
        <div className="text-sm font-medium text-gray-900">{label}</div>
        <div className="text-xs text-gray-600">{help}</div>
      </div>
    </label>
  );
}

function NumberField({ label, help, value, min, max, onChange }: { label: string; help: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || min)}
        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
      />
      <p className="text-xs text-gray-600 mt-1">{help}</p>
    </div>
  );
}

function SelectField({ label, help, value, options, onChange }: { label: string; help?: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <p className="text-xs text-gray-600 mt-1">{help}</p>}
    </div>
  );
}

function BeltGroupEditor({ group, onChange, onRemove }: { group: BeltGroup; onChange: (g: BeltGroup) => void; onRemove: () => void }) {
  const toggleBelt = (belt: string) => {
    const next = group.belts.includes(belt) ? group.belts.filter(b => b !== belt) : [...group.belts, belt];
    onChange({ ...group, belts: next });
  };
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={group.id}
          onChange={(e) => onChange({ ...group, id: e.target.value })}
          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
          placeholder="ID"
        />
        <input
          type="text"
          value={group.label}
          onChange={(e) => onChange({ ...group, label: e.target.value })}
          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
          placeholder="Display label"
        />
        <button type="button" onClick={onRemove} className="text-red-600 hover:text-red-800 text-sm">
          Remove
        </button>
      </div>
      {(group.danMin !== undefined || group.minAge !== undefined) && (
        <div className="flex gap-3 mb-2 text-xs">
          {group.danMin !== undefined && (
            <label className="flex items-center gap-1">
              DAN min: <input type="number" value={group.danMin} onChange={(e) => onChange({ ...group, danMin: parseInt(e.target.value) || 1 })} className="w-16 px-1 py-0.5 border rounded" />
            </label>
          )}
          {group.danMax !== undefined && (
            <label className="flex items-center gap-1">
              DAN max: <input type="number" value={group.danMax} onChange={(e) => onChange({ ...group, danMax: parseInt(e.target.value) || 9 })} className="w-16 px-1 py-0.5 border rounded" />
            </label>
          )}
          {group.minAge !== undefined && (
            <label className="flex items-center gap-1">
              Min age: <input type="number" value={group.minAge} onChange={(e) => onChange({ ...group, minAge: parseInt(e.target.value) || 0 })} className="w-16 px-1 py-0.5 border rounded" />
            </label>
          )}
          {group.maxAge !== undefined && (
            <label className="flex items-center gap-1">
              Max age: <input type="number" value={group.maxAge} onChange={(e) => onChange({ ...group, maxAge: parseInt(e.target.value) || 99 })} className="w-16 px-1 py-0.5 border rounded" />
            </label>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {BELT_COLOR_OPTIONS.map(belt => {
          const active = group.belts.includes(belt);
          return (
            <button
              key={belt}
              type="button"
              onClick={() => toggleBelt(belt)}
              className={`text-xs px-2 py-1 rounded border ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'}`}
            >
              {belt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CustomAgeBands({ value, onChange }: { value: AgeGroup[]; onChange: (v: AgeGroup[]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="number"
            value={b.min}
            onChange={(e) => { const next = [...value]; next[i] = { ...b, min: parseInt(e.target.value) || 0 }; onChange(next); }}
            className="w-16 px-2 py-1 border rounded text-sm"
            placeholder="min"
          />
          <span>to</span>
          <input
            type="number"
            value={b.max}
            onChange={(e) => { const next = [...value]; next[i] = { ...b, max: parseInt(e.target.value) || 0 }; onChange(next); }}
            className="w-16 px-2 py-1 border rounded text-sm"
            placeholder="max"
          />
          <input
            type="text"
            value={b.label}
            onChange={(e) => { const next = [...value]; next[i] = { ...b, label: e.target.value }; onChange(next); }}
            className="flex-1 px-2 py-1 border rounded text-sm"
            placeholder="Label (e.g. '4-5')"
          />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-red-600 text-sm">Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { min: 4, max: 5, label: '4-5' }])} className="text-sm text-blue-600">+ Add band</button>
    </div>
  );
}

function EventRuleEditor({ title, rule, onChange }: { title: string; rule: EventRules['patterns'] | EventRules['sparring']; onChange: (next: any) => void }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
        />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <div className="text-xs text-gray-600 mb-2">Group competitors by:</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {['tier','gender','age','weight','belt'].map(g => {
          const active = (rule.groupBy as string[]).includes(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => onChange({ ...rule, groupBy: active ? rule.groupBy.filter((x: string) => x !== g) : [...rule.groupBy, g] })}
              className={`text-xs px-2 py-1 rounded border ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300'}`}
            >
              {g}
            </button>
          );
        })}
      </div>
      {title === 'Patterns' && (
        <div className="flex items-center gap-2 text-xs">
          <label>Belts per division:</label>
          <input
            type="number"
            min={1}
            max={10}
            value={(rule as EventRules['patterns']).beltsPerDivision ?? 3}
            onChange={(e) => onChange({ ...rule, beltsPerDivision: parseInt(e.target.value) || 3 })}
            className="w-16 px-1 py-0.5 border rounded"
          />
        </div>
      )}
    </div>
  );
}
