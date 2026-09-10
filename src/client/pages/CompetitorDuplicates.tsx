import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { UserPlus, ArrowLeft, AlertTriangle, Users, Trash2 } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import { Card, CardHeader, CardBody } from '../components/ui';
import { PageHeader } from '../components/ui';
import { Button } from '../components/ui';
import { Input } from '../components/ui';
import { Label } from '../components/ui';
import { Modal } from '../components/ui';

interface Competitor {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  belt: string;
  beltStripe: string | null;
  danRank: number | null;
  heightInches: number | null;
  weightLbs: number | null;
  schoolDojang: string | null;
  specialNeeds: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    registrations: number;
  };
}

interface MatchScore {
  overallScore: number;
  nameScore: number;
  dobMatch: boolean;
  details: {
    firstNameSimilarity: number;
    lastNameSimilarity: number;
    dobDaysDiff: number;
  };
}

interface PotentialDuplicate {
  competitor1: Competitor;
  competitor2: Competitor;
  matchScore: MatchScore;
}

interface DuplicatesResponse {
  duplicates: PotentialDuplicate[];
  count: number;
}

export default function CompetitorDuplicates() {
  const { success: showSuccess, error: showError } = useToast();
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState(0.75);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [selectedDuplicate, setSelectedDuplicate] = useState<PotentialDuplicate | null>(null);
  const [primaryId, setPrimaryId] = useState<string>('');
  const [mergeOptions, setMergeOptions] = useState({
    takeSecondaryBelt: false,
    takeSecondaryWeight: false,
    takeSecondaryHeight: false,
    takeSecondarySchool: false,
  });

  const { data, isLoading, refetch } = useQuery<DuplicatesResponse>({
    queryKey: ['competitor-duplicates', threshold],
    queryFn: async () => {
      const res = await fetch(`/api/competitors/duplicates?threshold=${threshold}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch duplicates');
      return res.json();
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async (payload: { primaryId: string; secondaryId: string; mergeOptions: typeof mergeOptions }) => {
      const res = await fetch('/api/competitors/merge', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to merge competitors');
      }
      return res.json();
    },
    onSuccess: (result) => {
      showSuccess(`Successfully merged competitors. Transferred ${result.result.transferredRegistrations} registrations.`);
      queryClient.invalidateQueries({ queryKey: ['competitor-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['competitors'] });
      setMergeModalOpen(false);
      setSelectedDuplicate(null);
      setPrimaryId('');
      setMergeOptions({
        takeSecondaryBelt: false,
        takeSecondaryWeight: false,
        takeSecondaryHeight: false,
        takeSecondarySchool: false,
      });
    },
    onError: (error: Error) => {
      showError(error.message);
    },
  });

  const openMergeModal = (duplicate: PotentialDuplicate) => {
    setSelectedDuplicate(duplicate);
    // Default to keeping the competitor with more registrations
    const c1Count = duplicate.competitor1._count?.registrations || 0;
    const c2Count = duplicate.competitor2._count?.registrations || 0;
    setPrimaryId(c1Count >= c2Count ? duplicate.competitor1.id : duplicate.competitor2.id);
    setMergeModalOpen(true);
  };

  const handleMerge = () => {
    if (!selectedDuplicate || !primaryId) return;
    
    const secondaryId = primaryId === selectedDuplicate.competitor1.id
      ? selectedDuplicate.competitor2.id
      : selectedDuplicate.competitor1.id;

    mergeMutation.mutate({ primaryId, secondaryId, mergeOptions });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getMatchScoreColor = (score: number) => {
    if (score >= 0.9) return 'text-red-600 dark:text-red-400';
    if (score >= 0.8) return 'text-orange-600 dark:text-orange-400';
    return 'text-yellow-600 dark:text-yellow-400';
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <PageHeader
        title="Competitor Duplicates"
        description="Review and merge potential duplicate competitor records"
        actions={
          <Link to="/competitors">
            <Button variant="secondary">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Competitors
            </Button>
          </Link>
        }
      />

      <div className="mb-6">
        <Card>
          <CardBody>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="threshold">Match Threshold</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="threshold"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value) || 0.75)}
                    className="w-32"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    (0.75 = 75% match or higher)
                  </span>
                </div>
              </div>
              <div className="pt-6">
                <Button onClick={() => refetch()}>Refresh</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {!isLoading && data && data.count === 0 && (
        <EmptyState
          icon={Users}
          title="No duplicates found"
          description={`No potential duplicates found at ${(threshold * 100).toFixed(0)}% match threshold.`}
        />
      )}

      {!isLoading && data && data.count > 0 && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Found {data.count} potential duplicate{data.count !== 1 ? 's' : ''}
          </div>

          {data.duplicates.map((duplicate, idx) => {
            const { competitor1, competitor2, matchScore } = duplicate;
            return (
              <Card key={idx}>
                <CardBody>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">
                            {competitor1.firstName} {competitor1.lastName}
                          </h3>
                          {competitor1._count && competitor1._count.registrations > 0 && (
                            <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded">
                              {competitor1._count.registrations} registrations
                            </span>
                          )}
                        </div>
                        <div className="text-sm space-y-1">
                          <div><span className="text-gray-600 dark:text-gray-400">DOB:</span> {formatDate(competitor1.dateOfBirth)}</div>
                          <div><span className="text-gray-600 dark:text-gray-400">Gender:</span> {competitor1.gender}</div>
                          <div><span className="text-gray-600 dark:text-gray-400">Belt:</span> {competitor1.belt}{competitor1.danRank ? ` (${competitor1.danRank} Dan)` : ''}</div>
                          {competitor1.schoolDojang && (
                            <div><span className="text-gray-600 dark:text-gray-400">School:</span> {competitor1.schoolDojang}</div>
                          )}
                          {competitor1.weightLbs && (
                            <div><span className="text-gray-600 dark:text-gray-400">Weight:</span> {competitor1.weightLbs} lbs</div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">
                            {competitor2.firstName} {competitor2.lastName}
                          </h3>
                          {competitor2._count && competitor2._count.registrations > 0 && (
                            <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded">
                              {competitor2._count.registrations} registrations
                            </span>
                          )}
                        </div>
                        <div className="text-sm space-y-1">
                          <div><span className="text-gray-600 dark:text-gray-400">DOB:</span> {formatDate(competitor2.dateOfBirth)}</div>
                          <div><span className="text-gray-600 dark:text-gray-400">Gender:</span> {competitor2.gender}</div>
                          <div><span className="text-gray-600 dark:text-gray-400">Belt:</span> {competitor2.belt}{competitor2.danRank ? ` (${competitor2.danRank} Dan)` : ''}</div>
                          {competitor2.schoolDojang && (
                            <div><span className="text-gray-600 dark:text-gray-400">School:</span> {competitor2.schoolDojang}</div>
                          )}
                          {competitor2.weightLbs && (
                            <div><span className="text-gray-600 dark:text-gray-400">Weight:</span> {competitor2.weightLbs} lbs</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="ml-6 text-right">
                      <div className={`text-2xl font-bold ${getMatchScoreColor(matchScore.overallScore)}`}>
                        {(matchScore.overallScore * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1 mt-2">
                        <div>Name: {(matchScore.nameScore * 100).toFixed(0)}%</div>
                        <div>DOB: {matchScore.dobMatch ? '✓ Match' : `${matchScore.details.dobDaysDiff.toFixed(0)} days`}</div>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => openMergeModal(duplicate)}
                        className="mt-4"
                      >
                        <UserPlus className="w-4 h-4 mr-1" />
                        Merge
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Merge Modal */}
      <Modal
        isOpen={mergeModalOpen}
        onClose={() => setMergeModalOpen(false)}
        title="Merge Competitors"
      >
        {selectedDuplicate && (
          <div className="space-y-4">
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-yellow-800 dark:text-yellow-200">
                  <p className="font-semibold mb-1">This action cannot be undone</p>
                  <p>The secondary competitor will be soft-deleted and all their registrations, history, and ratings will be transferred to the primary competitor.</p>
                </div>
              </div>
            </div>

            <div>
              <Label>Select Primary Competitor (to keep)</Label>
              <div className="space-y-2 mt-2">
                <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input
                    type="radio"
                    name="primary"
                    value={selectedDuplicate.competitor1.id}
                    checked={primaryId === selectedDuplicate.competitor1.id}
                    onChange={(e) => setPrimaryId(e.target.value)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-semibold">
                      {selectedDuplicate.competitor1.firstName} {selectedDuplicate.competitor1.lastName}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {formatDate(selectedDuplicate.competitor1.dateOfBirth)} • {selectedDuplicate.competitor1.belt}
                      {selectedDuplicate.competitor1._count && ` • ${selectedDuplicate.competitor1._count.registrations} registrations`}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input
                    type="radio"
                    name="primary"
                    value={selectedDuplicate.competitor2.id}
                    checked={primaryId === selectedDuplicate.competitor2.id}
                    onChange={(e) => setPrimaryId(e.target.value)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-semibold">
                      {selectedDuplicate.competitor2.firstName} {selectedDuplicate.competitor2.lastName}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {formatDate(selectedDuplicate.competitor2.dateOfBirth)} • {selectedDuplicate.competitor2.belt}
                      {selectedDuplicate.competitor2._count && ` • ${selectedDuplicate.competitor2._count.registrations} registrations`}
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div>
              <Label>Merge Options (optional)</Label>
              <div className="space-y-2 mt-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={mergeOptions.takeSecondaryBelt}
                    onChange={(e) => setMergeOptions(prev => ({ ...prev, takeSecondaryBelt: e.target.checked }))}
                  />
                  <span className="text-sm">Use secondary competitor's belt information</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={mergeOptions.takeSecondaryWeight}
                    onChange={(e) => setMergeOptions(prev => ({ ...prev, takeSecondaryWeight: e.target.checked }))}
                  />
                  <span className="text-sm">Use secondary competitor's weight</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={mergeOptions.takeSecondaryHeight}
                    onChange={(e) => setMergeOptions(prev => ({ ...prev, takeSecondaryHeight: e.target.checked }))}
                  />
                  <span className="text-sm">Use secondary competitor's height</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={mergeOptions.takeSecondarySchool}
                    onChange={(e) => setMergeOptions(prev => ({ ...prev, takeSecondarySchool: e.target.checked }))}
                  />
                  <span className="text-sm">Use secondary competitor's school</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="secondary" onClick={() => setMergeModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleMerge}
                disabled={!primaryId || mergeMutation.isPending}
              >
                {mergeMutation.isPending ? (
                  <>
                    <Spinner className="w-4 h-4 mr-2" />
                    Merging...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Merge Competitors
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
