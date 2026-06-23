import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { CardSkeleton } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { getAuthHeaders } from '../context/AuthContext';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { DataTable, TableHead, TableBody } from '../components/ui';

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
  const navigate = useNavigate();
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
      const res = await fetch(`/api/tournaments/${id}/schedule`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch schedule');
      return res.json();
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tournaments/${id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error('Failed to regenerate schedule');
      return res.json();
    },
    onSuccess: () => {
      refetch();
    },
  });

  // Live region announcement for schedule regeneration success/failure.
  const [scheduleAnnounce, setScheduleAnnounce] = useState('');
  useEffect(() => {
    if (regenerateMutation.isSuccess) {
      setScheduleAnnounce('Schedule regenerated.');
    }
  }, [regenerateMutation.isSuccess]);
  useEffect(() => {
    if (regenerateMutation.isError) {
      setScheduleAnnounce(
        `Failed to regenerate schedule: ${(regenerateMutation.error as Error)?.message ?? 'Unknown error'}`
      );
    }
  }, [regenerateMutation.isError]);

  const exportPDF = () => {
    if (!schedule) return;

    const doc = new jsPDF('portrait', 'pt', 'letter');
    const pageWidth = doc.internal.pageSize.getWidth();

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

    const byRing: Record<number, ScheduledDivision[]> = {};
    schedule.schedule.forEach((div) => {
      if (!byRing[div.ring]) byRing[div.ring] = [];
      byRing[div.ring].push(div);
    });

    let y = 100;
    const leftMargin = 50;
    const colWidths = [60, 200, 80, 60, 60];

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
      { light: 'bg-blue-100 border-blue-300', dark: 'dark:bg-blue-900/30 dark:border-blue-700', text: 'text-blue-900 dark:text-blue-200' },
      { light: 'bg-green-100 border-green-300', dark: 'dark:bg-green-900/30 dark:border-green-700', text: 'text-green-900 dark:text-green-200' },
      { light: 'bg-yellow-100 border-yellow-300', dark: 'dark:bg-yellow-900/30 dark:border-yellow-700', text: 'text-yellow-900 dark:text-yellow-200' },
      { light: 'bg-purple-100 border-purple-300', dark: 'dark:bg-purple-900/30 dark:border-purple-700', text: 'text-purple-900 dark:text-purple-200' },
      { light: 'bg-pink-100 border-pink-300', dark: 'dark:bg-pink-900/30 dark:border-pink-700', text: 'text-pink-900 dark:text-pink-200' },
      { light: 'bg-orange-100 border-orange-300', dark: 'dark:bg-orange-900/30 dark:border-orange-700', text: 'text-orange-900 dark:text-orange-200' },
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
      {/* Page Header */}
      <PageHeader
        title={`Schedule - ${schedule?.tournamentName || ''}`}
        description={`${schedule?.schedule.length || 0} divisions scheduled`}
        actions={
          <div className="flex gap-2 sm:gap-3">
            <Button
              variant="secondary"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
              aria-label="Regenerate schedule"
            >
              {regenerateMutation.isPending ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />}
              <span className="hidden sm:inline">{regenerateMutation.isPending ? 'Generating...' : 'Regenerate'}</span>
            </Button>
            <Button
              variant="primary"
              onClick={exportPDF}
              disabled={!schedule?.schedule.length}
              aria-label="Export schedule as PDF"
            >
              <Download className="h-4 w-4 mr-2" aria-hidden="true" />
              <span className="hidden sm:inline">Export PDF</span>
            </Button>
          </div>
        }
      >
        <Link
          to={`/tournaments/${id}`}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center mb-2"
          aria-label="Back to Tournament"
        >
          <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />
          Back to Tournament
        </Link>
      </PageHeader>

      {/* Configuration */}
      <Card className="mb-6">
        <CardHeader title="Schedule Configuration" as="h2" />
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="schedule-start-time">Start Time</Label>
              <Input
                id="schedule-start-time"
                type="time"
                value={config.startTime}
                onChange={(e) =>
                  setConfig({ ...config, startTime: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="schedule-end-time">End Time</Label>
              <Input
                id="schedule-end-time"
                type="time"
                value={config.endTime}
                onChange={(e) =>
                  setConfig({ ...config, endTime: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="schedule-ring-count">Number of Rings</Label>
              <Input
                id="schedule-ring-count"
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                value={config.ringCount}
                onChange={(e) =>
                  setConfig({ ...config, ringCount: parseInt(e.target.value) || 4 })
                }
              />
            </div>
            <div>
              <Label htmlFor="schedule-break">Break Between (min)</Label>
              <Input
                id="schedule-break"
                type="number"
                inputMode="numeric"
                min={0}
                max={30}
                value={config.breakBetweenDivisions}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    breakBetweenDivisions: parseInt(e.target.value) || 5,
                  })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <Label htmlFor="schedule-patterns-duration">Patterns Match Duration (min)</Label>
              <Input
                id="schedule-patterns-duration"
                type="number"
                inputMode="numeric"
                min={1}
                max={15}
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
              />
            </div>
            <div>
              <Label htmlFor="schedule-sparring-duration">Sparring Match Duration (min)</Label>
              <Input
                id="schedule-sparring-duration"
                type="number"
                inputMode="numeric"
                min={1}
                max={15}
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
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Warnings — time conflicts and end-time overruns. role="alert" so SR
          users hear about the conflict without having to spot the yellow box. */}
      {schedule?.warnings && schedule.warnings.length > 0 && (
        <div
          role="alert"
          className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6"
        >
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h3 className="font-medium text-yellow-800 dark:text-yellow-200">Schedule Warnings</h3>
              <ul className="mt-1 text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : schedule?.schedule && schedule.schedule.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.keys(scheduleByRing)
            .sort((a, b) => Number(a) - Number(b))
            .map((ring) => {
              const color = getRingColor(Number(ring));
              return (
                <Card key={ring} className="overflow-hidden">
                  <div className={`card-header ${color.light} ${color.dark} ${color.text} border-b-2`}>
                    <h3 className="font-semibold">Ring {ring}</h3>
                    <p className="text-sm opacity-75">
                      {scheduleByRing[Number(ring)].length} divisions
                    </p>
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {scheduleByRing[Number(ring)].map((div) => (
                      <div key={div.divisionId} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            {div.startTime} - {div.endTime}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              div.eventType === 'patterns'
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {div.eventType === 'patterns' ? 'Patterns' : 'Sparring'}
                          </span>
                        </div>
                        <p className="font-medium text-gray-900 dark:text-white text-sm">
                          {div.divisionName}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          {div.competitorCount} competitors •{' '}
                          {div.estimatedDurationMinutes} min
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
        </div>
      ) : (
        <Card>
          <CardBody className="p-0">
            <EmptyState
              icon={Calendar}
              title="No schedule generated"
              description="Generate divisions first, then create a schedule."
              action={{
                label: 'Generate Schedule',
                onClick: () => regenerateMutation.mutate(),
              }}
              secondaryAction={{
                label: 'Manage Divisions',
                onClick: () => navigate(`/tournaments/${id}/divisions`),
              }}
            />
          </CardBody>
        </Card>
      )}

      {/* Timeline View */}
      {schedule?.schedule && schedule.schedule.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Timeline View" as="h2" />
          <CardBody className="p-0 overflow-x-auto">
            <DataTable>
              <TableHead>
                <th scope="col">Time</th>
                <th scope="col">Ring</th>
                <th scope="col">Division</th>
                <th scope="col">Event</th>
                <th scope="col">Competitors</th>
                <th scope="col">Duration</th>
              </TableHead>
              <TableBody>
                {schedule.schedule.map((div) => (
                  <tr key={div.divisionId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="font-medium text-gray-900 dark:text-white">
                      {div.startTime} - {div.endTime}
                    </td>
                    <td>
                      <span className={`inline-flex px-2 py-1 rounded text-sm font-medium ${getRingColor(div.ring)}`}>
                        Ring {div.ring}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/tournaments/${id}/divisions/${div.divisionId}/bracket`}
                        className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        aria-label={`Open ${div.divisionName} bracket`}
                      >
                        {div.divisionName}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          div.eventType === 'patterns'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                        }`}
                      >
                        {div.eventType === 'patterns' ? 'Patterns' : 'Sparring'}
                      </span>
                    </td>
                    <td className="text-gray-600 dark:text-gray-400">
                      {(() => {
                        const names = div.competitorNames ?? [];
                        if (names.length === 0) return '—';
                        const fullTitle = names.join(', ');
                        const display =
                          names.length <= 3
                            ? names.join(', ')
                            : `${names.slice(0, 3).join(', ')}, +${names.length - 3} more`;
                        return (
                          <span title={fullTitle} aria-label={fullTitle}>
                            {display}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="text-gray-600 dark:text-gray-400">{div.estimatedDurationMinutes} min</td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          </CardBody>
        </Card>
      )}

      {/* Live region for schedule regeneration announcements. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {scheduleAnnounce}
      </div>
    </div>
  );
}
