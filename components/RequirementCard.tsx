import type { RequirementAssessment } from '../lib/contracts';
import { featureLabels } from './ui-contracts';

export const statusLabels = { supported: 'Reported accessible', barrier_reported: 'Barrier reported', conflicting: 'Conflicting evidence', insufficient: 'Needs confirmation', historical_only: 'Historical evidence only' };
const statusIcons = { supported: '✓', barrier_reported: '!', conflicting: '↔', insufficient: '?', historical_only: '◷' };

export function RequirementCard({ requirement }: { requirement: RequirementAssessment }) {
  return <article className={`requirement-card state-${requirement.status}`}>
    <div className="requirement-card-top"><h3>{featureLabels[requirement.feature]}</h3><span className="priority-label">{requirement.priority === 'must_have' ? 'Must have' : 'Preferred'}</span></div>
    <p className={`requirement-state state-${requirement.status}`}><span aria-hidden="true">{statusIcons[requirement.status]}</span>{statusLabels[requirement.status]}</p>
    <p className="requirement-explanation">{requirement.explanation}</p>
    {requirement.scope && Object.values(requirement.scope).some(Boolean) && <p className="small muted">Selected scope: {Object.values(requirement.scope).filter(Boolean).join(' · ')}</p>}
    {requirement.barrierToConfirm && <p className="barrier-note">A reported barrier needs specific confirmation.</p>}
    {requirement.conditions.length > 0 && <ul className="condition-list" aria-label="Access conditions">{requirement.conditions.map(condition => <li key={condition}>{condition}</li>)}</ul>}
    {requirement.feature === 'lift_operational' && <p className="small muted">A dated report cannot establish whether the lift is operating now. Confirm before arrival.</p>}
    {requirement.sourceIds.length > 0 ? <div className="card-source-links">{requirement.sourceIds.map((source, index) => <a key={source} href={`#source-${source}`}>Evidence {index + 1} <span aria-hidden="true">↗</span></a>)}</div> : <p className="small muted">No usable supporting observation was retrieved.</p>}
  </article>;
}
