import { Button } from '../ui';
import { buildScheduleRecommendationReview, type ScheduleRecommendationRecord } from '../../utils/schedule-recommendation';

interface Props {
  recommendation: ScheduleRecommendationRecord;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onApply: () => void;
  onUndo?: () => void;
}

export default function ScheduleOptimizationReview({ recommendation, busy, onApprove, onReject, onApply, onUndo }: Props) {
  const review = buildScheduleRecommendationReview(recommendation);
  const evidence = recommendation.inputSnapshot.evidence;
  return (
    <div className="space-y-5">
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{recommendation.explanation}</p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Deterministic means reproducible, not automatically correct. Review every move before approval.</p>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300"><p className="font-medium">Evidence coverage</p><ul className="list-disc pl-5">{review.coverage.map((item) => <li key={item.label}>{item.label}: {item.known}/{item.total}</li>)}</ul></div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Snapshot {new Date(evidence.capturedAt).toLocaleString()} · Status: {recommendation.status}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left font-semibold text-gray-900 dark:text-white">Safety and timing evidence</caption>
          <thead><tr><th scope="col" className="py-2">Metric</th><th scope="col">Before</th><th scope="col">Proposed</th><th scope="col">Change</th></tr></thead>
          <tbody>{review.metrics.map((metric) => (
            <tr key={metric.label} className="border-t border-gray-200 dark:border-gray-700">
              <th scope="row" className="py-2 font-medium">{metric.label}</th><td>{metric.before}</td><td>{metric.after}</td><td>{metric.change}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left font-semibold text-gray-900 dark:text-white">Proposed schedule moves</caption>
          <thead><tr><th scope="col" className="py-2">Division</th><th scope="col">Before</th><th scope="col">Proposed</th><th scope="col">Why</th></tr></thead>
          <tbody>{review.moved.map((move) => (
            <tr key={move.divisionId} className="border-t border-gray-200 dark:border-gray-700"><th scope="row" className="py-2 font-medium">{move.divisionName}</th><td>{move.before}</td><td>{move.after}</td><td>{move.reason}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <section aria-labelledby="optimization-constraints-heading" className="grid gap-4 lg:grid-cols-2">
        <div><h3 id="optimization-constraints-heading" className="font-semibold">Constraints and locks</h3>
          <p className="text-sm">Rest window: {recommendation.inputSnapshot.optimizerInput.restWindowMinutes} minutes. Blocked rings: {recommendation.inputSnapshot.optimizerInput.blockedRings.join(', ') || 'none'}.</p>
          <ul className="mt-1 list-disc pl-5 text-sm">{review.locked.map((item) => <li key={item.divisionId}>{item.divisionName} — {item.position} before and after; preserved exactly</li>)}</ul>
        </div>
        <div><h3 className="font-semibold">Live evidence</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {evidence.liveDelaySources.map((item) => <li key={item.ring}>Ring {item.ring}: {item.delayMinutes} min delay ({item.source})</li>)}
            {evidence.incidentSources.map((item) => <li key={item.incidentId}>{item.label}: Ring {item.ring} blocked</li>)}
            {!evidence.conflictGroupCoverage.coachDataAvailable && <li>Coach conflicts were not assessed; known school groups only.</li>}
          </ul>
        </div>
      </section>

      {recommendation.warnings.length > 0 && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"><ul className="list-disc pl-5">{recommendation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      <div className="flex flex-wrap gap-2">
        {recommendation.status === 'proposed' && <><Button variant="primary" disabled={busy} onClick={onApprove}>Approve proposal</Button><Button variant="secondary" disabled={busy} onClick={onReject}>Reject proposal</Button></>}
        {recommendation.status === 'approved' && <Button variant="primary" disabled={busy} onClick={onApply}>Apply approved schedule</Button>}
        {recommendation.status === 'applied' && recommendation.operationAudit?.canUndo && onUndo && <Button variant="secondary" disabled={busy} onClick={onUndo}>Undo applied optimization</Button>}
        {recommendation.status === 'applied' && recommendation.operationAudit && !recommendation.operationAudit.undoneAt && !recommendation.operationAudit.canUndo && <p className="text-sm text-gray-600 dark:text-gray-300">Undo is no longer available because the schedule changed after this optimization.</p>}
        {recommendation.status === 'applied' && recommendation.operationAudit?.undoneAt && <p className="text-sm text-gray-600 dark:text-gray-300">This optimization was undone. The current schedule is not the proposed after-state.</p>}
      </div>
    </div>
  );
}
