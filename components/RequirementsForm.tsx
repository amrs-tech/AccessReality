'use client';

import { type Feature, type Priority, type Requirements } from './ui-contracts';

const choices: { features: Feature[]; label: string; detail: string }[] = [
  { features: ['arrival_step_free'], label: 'Step-free arrival', detail: 'From parking or drop-off' },
  { features: ['entrance_step_free'], label: 'Step-free entrance', detail: 'Into this exact venue' },
  { features: ['interior_movement'], label: 'Wheelchair-usable movement', detail: 'Between the areas you need' },
  { features: ['accessible_seating'], label: 'Accessible seating', detail: 'Usable seating and table space' },
  { features: ['accessible_restroom'], label: 'Accessible restroom', detail: 'Customer access and usability' },
  { features: ['lift_present', 'lift_operational'], label: 'Lift access', detail: 'Only if you need an upper floor' },
  { features: ['accessible_parking'], label: 'Accessible parking', detail: 'A designated usable space' },
];

export function RequirementsForm({ value, onChange, disabled = false, id = 'requirements' }: { value: Requirements; onChange: (value: Requirements) => void; disabled?: boolean; id?: string }) {
  function update(features: Feature[], priority: Priority) {
    onChange([...value.filter(requirement => !features.includes(requirement.feature)), ...features.map(feature => ({ feature, priority, ...(value.find(requirement => requirement.feature === feature)?.scope ? { scope: value.find(requirement => requirement.feature === feature)?.scope } : {}) }))]);
  }
  return <fieldset className="requirements-fieldset" disabled={disabled}>
    <legend>Your visit requirements</legend>
    <p className="muted small requirements-intro">Choose what matters for this visit. No personal or medical details needed.</p>
    <div className="requirement-options">{choices.map(({ features, label, detail }) => {
      const priority = value.find(requirement => requirement.feature === features[0])?.priority ?? 'not_needed';
      const enabled = priority !== 'not_needed';
      return <div className={`requirement-option ${enabled ? 'selected' : ''}`} key={features[0]}>
        <label className="check-label" htmlFor={`${id}-${features[0]}`}>
          <input type="checkbox" id={`${id}-${features[0]}`} checked={enabled} onChange={event => update(features, event.target.checked ? 'must_have' : 'not_needed')} />
          <span><span className="option-title">{label}</span><span className="option-detail">{detail}</span></span>
        </label>
        {enabled && <select aria-label={`${label} priority`} value={priority} onChange={event => update(features, event.target.value as Priority)}>
          <option value="must_have">Must have</option><option value="preferred">Preferred</option>
        </select>}
        {enabled && features.length === 2 && <p className="lift-note">We assess lift presence and dated reports of operation separately. Current operation always needs confirmation.</p>}
      </div>;
    })}</div>
    <p className="small muted requirements-footnote">Unselected requirements are excluded from your fit assessment. They are not assumed to be available.</p>
  </fieldset>;
}
