import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { jsPDF } from 'jspdf';

interface ScheduledDivision {
  divisionId: string;
  divisionName: string;
  eventType: string;
  beltLevel: string;
  gender: string;
  competitorCount: number;
  ring: number;
  startTime: string;
  endTime: string;
  estimatedDurationMinutes: number;
}

interface ScheduleConfig {
  startTime: string;
  endTime: string;
  ringCount: number;
  matchDurationMinutes: {
    patterns: number;
    sparring: number;
  };
  breakBetweenDivisions: number;
}

interface TournamentSchedule {
  tournamentId: string;
  tournamentName: string;
  date: string;
  config: ScheduleConfig;
  schedule: ScheduledDivision[];
  warnings: string[];
}

export default function Schedule() {
  const { id } = useParams<{ id: string }>();
  const [config, setConfig] = useState<Partial<ScheduleConfig>>({
    startTime: '09:00',
    endTime: '17:00',
    ringCount: 4,
    matchDurationMinutes: {
      patterns: 3,
      sparring: 5,
    },
    breakBetweenDivisions: 5,
  });

  const { data: schedule, isLoading, refetch } = useQuery<TournamentSchedule>({
    queryKey: ['schedule', id],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/schedule`);
      return res.json();
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      return res.json();
    },
    onSuccess: () => {
      refetch();
    },
  });

  const exportPDF = () => {
    if (!schedule) return;

    const doc = new jsPDF('portrait', 'pt', 'letter');
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(18);
    doc.text(schedule.tournamentName, pageWidth / 2, 40, { align: 'center' });

    doc.setFontSize(12);
    doc.text('Tournament Schedule', pageWidth / 2, 60, { align: 'center' });

    doc.setFontSize(10);
    doc.text(
      `Date: ${new Date(schedule.date).toLocaleDateString()}`,
      pageWidth / 2,
      75,
      { align: 'center' }
    );

    // Group by ring
    const byRing: Record<number, ScheduledDivision[]> = {};
    schedule.schedule.forEach((div) => {
      if (!byRing[div.ring]) byRing[div.ring] = [];
      byRing[div.ring].push(div);
    });

    let y = 100;
    const leftMargin = 50;
    const colWidths = [60, 200, 80, 60, 60];

    // Table header
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Time', leftMargin, y);
    doc.text('Division', leftMargin + colWidths[0], y);
    doc.text('Event', leftMargin + colWidths[0] + colWidths[1], y);
    doc.text('Count', leftMargin + colWidths[0] + colWidths[1] + colWidths[2], y);
    doc.text(
      'Duration',
      leftMargin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
      y
    );
    y += 15;

    doc.setFont('helvetica', 'normal');

    Object.keys(byRing)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((ring) => {
        // Ring header
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(240, 240, 240);
        doc.rect(leftMargin - 5, y - 10, pageWidth - 2 * leftMargin + 10, 15, 'F');
        doc.text(`Ring ${ring}`, leftMargin, y);
        y += 20;

        doc.setFont('helvetica', 'normal');

        byRing[Number(ring)].forEach((div) => {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }

          doc.text(`${div.startTime}-${div.endTime}`, leftMargin, y);
          doc.text(div.divisionName.substring(0, 35), leftMargin + colWidths[0], y);
          doc.text(
            div.eventType === 'patterns' ? 'Patterns' : 'Sparring',
            leftMargin + colWidths[0] + colWidths[1],
            y
          );
          doc.text(
            String(div.competitorCount),
            leftMargin + colWidths[0] + colWidths[1] + colWidths[2],
            y
          );
          doc.text(
            `${div.estimatedDurationMinutes}m`,
            leftMargin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
            y
          );
          y += 12;
        });

        y += 10;
      });

    // Warnings
    if (schedule.warnings.length > 0) {
      y += 10;
      doc.setFont('helvetica', 'bold');
      doc.text('Notes:', leftMargin, y);
      y += 12;
      doc.setFont('helvetica', 'normal');
      schedule.warnings.forEach((warning) => {
        doc.text(`- ${warning}`, leftMargin, y);
        y += 12;
      });
    }

    const fileName = `${schedule.tournamentName.replace(/[^a-zA-Z0-9]/g, '_')}_Schedule.pdf`;
    doc.save(fileName);
  };

  const getRingColor = (ring: number) => {
    const colors = [
      'bg-blue-100 border-blue-300',
      'bg-green-100 border-green-300',
      'bg-yellow-100 border-yellow-300',
      'bg-purple-100 border-purple-300',
      'bg-pink-100 border-pink-300',
      'bg-orange-100 border-orange-300',
    ];
    return colors[(ring - 1) % colors.length];
  };

  // Group schedule by ring for display
  const scheduleByRing: Record<number, ScheduledDivision[]> = {};
  schedule?.schedule.forEach((div) => {
    if (!scheduleByRing[div.ring]) scheduleByRing[div.ring] = [];
    scheduleByRing[div.ring].push(div);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            to={`/tournaments/${id}`}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Tournament
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Schedule - {schedule?.tournamentName}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {schedule?.schedule.length || 0} divisions scheduled
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            className="btn btn-secondary"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {regenerateMutation.isPending ? 'Generating...' : 'Regenerate'}
          </button>
          <button
            onClick={exportPDF}
            disabled={!schedule?.schedule.length}
            className="btn btn-primary"
          >
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </button>
        </div>
      </div>

      {/* Configuration */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-lg font-medium flex items-center">
            <Clock className="h-5 w-5 mr-2" />
            Schedule Configuration
          </h2>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="form-label">Start Time</label>
              <input
                type="time"
                value={config.startTime}
                onChange={(e) =>
                  setConfig({ ...config, startTime: e.target.value })
                }
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label">End Time</label>
              <input
                type="time"
                value={config.endTime}
                onChange={(e) =>
                  setConfig({ ...config, endTime: e.target.value })
                }
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label">Number of Rings</label>
              <input
                type="number"
                min="1"
                max="10"
                value={config.ringCount}
                onChange={(e) =>
                  setConfig({ ...config, ringCount: parseInt(e.target.value) || 4 })
                }
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label">Break Between (min)</label>
              <input
                type="number"
                min="0"
                max="30"
                value={config.breakBetweenDivisions}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    breakBetweenDivisions: parseInt(e.target.value) || 5,
                  })
                }
                className="form-input"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="form-label">Patterns Match Duration (min)</label>
              <input
                type="number"
                min="1"
                max="15"
                value={config.matchDurationMinutes?.patterns}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    matchDurationMinutes: {
                      ...config.matchDurationMinutes!,
                      patterns: parseInt(e.target.value) || 3,
                    },
                  })
                }
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label">Sparring Match Duration (min)</label>
              <input
                type="number"
                min="1"
                max="15"
                value={config.matchDurationMinutes?.sparring}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    matchDurationMinutes: {
                      ...config.matchDurationMinutes!,
                      sparring: parseInt(e.target.value) || 5,
                    },
                  })
                }
                className="form-input"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {schedule?.warnings && schedule.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-800">Schedule Warnings</h3>
              <ul className="mt-1 text-sm text-yellow-700 list-disc list-inside">
                {schedule.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Display */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : schedule?.schedule && schedule.schedule.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.keys(scheduleByRing)
            .sort((a, b) => Number(a) - Number(b))
            .map((ring) => (
              <div key={ring} className="card">
                <div
                  className={`card-header ${getRingColor(Number(ring))} border-b-2`}
                >
                  <h3 className="font-semibold text-gray-900">Ring {ring}</h3>
                  <p className="text-sm text-gray-600">
                    {scheduleByRing[Number(ring)].length} divisions
                  </p>
                </div>
                <div className="divide-y divide-gray-100">
                  {scheduleByRing[Number(ring)].map((div) => (
                    <div key={div.divisionId} className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-500">
                          {div.startTime} - {div.endTime}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            div.eventType === 'patterns'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {div.eventType === 'patterns' ? 'Patterns' : 'Sparring'}
                        </span>
                      </div>
                      <p className="font-medium text-gray-900 text-sm">
                        {div.divisionName}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {div.competitorCount} competitors •{' '}
                        {div.estimatedDurationMinutes} min
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="card">
          <div className="card-body text-center py-12">
            <Calendar className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              No schedule generated
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Generate divisions first, then create a schedule.
            </p>
            <div className="mt-4 flex gap-3 justify-center">
              <Link to={`/tournaments/${id}/divisions`} className="btn btn-secondary">
                Manage Divisions
              </Link>
              <button
                onClick={() => regenerateMutation.mutate()}
                className="btn btn-primary"
              >
                Generate Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline View */}
      {schedule?.schedule && schedule.schedule.length > 0 && (
        <div className="card mt-6">
          <div className="card-header">
            <h2 className="text-lg font-medium">Timeline View</h2>
          </div>
          <div className="card-body overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Ring</th>
                  <th>Division</th>
                  <th>Event</th>
                  <th>Competitors</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {schedule.schedule.map((div) => (
                  <tr key={div.divisionId}>
                    <td className="font-medium">
                      {div.startTime} - {div.endTime}
                    </td>
                    <td>
                      <span
                        className={`inline-flex px-2 py-1 rounded text-sm font-medium ${getRingColor(
                          div.ring
                        )}`}
                      >
                        Ring {div.ring}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/tournaments/${id}/divisions/${div.divisionId}/bracket`}
                        className="text-primary-600 hover:text-primary-700"
                      >
                        {div.divisionName}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          div.eventType === 'patterns'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {div.eventType === 'patterns' ? 'Patterns' : 'Sparring'}
                      </span>
                    </td>
                    <td>{div.competitorCount}</td>
                    <td>{div.estimatedDurationMinutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
