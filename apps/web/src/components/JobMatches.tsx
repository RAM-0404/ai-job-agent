import { useState, useEffect, useCallback } from 'react';
import type {
  JobMatch,
  Job,
  MatchRecommendation,
  JobMatchSearchParams,
  PaginationMetadata,
} from '@ai-job-agent/shared';
import { getMatches, matchJob } from '../api/jobs';

interface JobMatchesProps {
  onStartApplication?: (jobId: string) => void;
  onOpenApplication?: (applicationId: string) => void;
}

export function JobMatches({ onStartApplication, onOpenApplication }: JobMatchesProps = {}) {
  const [matches, setMatches] = useState<(JobMatch & { job: Job })[]>([]);
  const [pagination, setPagination] = useState<PaginationMetadata>({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [minimumScore, setMinimumScore] = useState<string>('');
  const [recommendation, setRecommendation] = useState<string>('');
  const [sort, setSort] = useState<'overallScore_desc' | 'overallScore_asc' | 'createdAt_desc' | 'createdAt_asc'>(
    'overallScore_desc'
  );
  const [page, setPage] = useState(1);

  // Selected match for detail modal
  const [selectedMatch, setSelectedMatch] = useState<(JobMatch & { job: Job }) | null>(null);
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  const fetchMatches = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params: JobMatchSearchParams = {
        page,
        pageSize: 10,
        sort,
      };
      if (minimumScore) {
        params.minimumScore = parseInt(minimumScore, 10);
      }
      if (recommendation) {
        params.recommendation = recommendation as MatchRecommendation;
      }

      const res = await getMatches(params);
      setMatches(res.matches);
      setPagination(res.pagination);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setIsLoading(false);
    }
  }, [page, minimumScore, recommendation, sort]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  const handleReanalyze = async (jobId: string) => {
    setIsReanalyzing(true);
    try {
      await matchJob(jobId);
      await fetchMatches();
      // Update selected match if open
      const res = await getMatches({ page: 1, pageSize: 50 });
      const updated = res.matches.find((m) => m.jobId === jobId);
      if (updated) setSelectedMatch(updated);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Re-analysis failed');
    } finally {
      setIsReanalyzing(false);
    }
  };

  const getRecommendationBadge = (rec: MatchRecommendation) => {
    switch (rec) {
      case 'APPLY':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60';
      case 'CONSIDER':
        return 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60';
      case 'LOW_PRIORITY':
        return 'bg-amber-950/80 text-amber-300 border-amber-700/60';
      case 'DO_NOT_APPLY':
        return 'bg-rose-950/80 text-rose-300 border-rose-700/60';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 70) return 'text-indigo-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-rose-400';
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header & Filter Controls */}
      <div className="p-6 rounded-2xl bg-slate-900/80 backdrop-blur-xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">AI Job Matches</h2>
            <p className="text-xs text-slate-400 mt-1">
              Deterministic + Local Ollama hybrid matching evaluations for your profile.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Minimum Score Filter */}
            <select
              value={minimumScore}
              onChange={(e) => {
                setMinimumScore(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-200 outline-none focus:border-indigo-500"
            >
              <option value="">All Scores</option>
              <option value="80">Score &ge; 80 (Apply)</option>
              <option value="70">Score &ge; 70 (Consider)</option>
              <option value="60">Score &ge; 60 (Low Priority)</option>
            </select>

            {/* Recommendation Filter */}
            <select
              value={recommendation}
              onChange={(e) => {
                setRecommendation(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-200 outline-none focus:border-indigo-500"
            >
              <option value="">All Recommendations</option>
              <option value="APPLY">APPLY</option>
              <option value="CONSIDER">CONSIDER</option>
              <option value="LOW_PRIORITY">LOW PRIORITY</option>
              <option value="DO_NOT_APPLY">DO NOT APPLY</option>
            </select>

            {/* Sort Filter */}
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as any);
                setPage(1);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-200 outline-none focus:border-indigo-500"
            >
              <option value="overallScore_desc">Highest Match</option>
              <option value="overallScore_asc">Lowest Match</option>
              <option value="createdAt_desc">Newest Analysis</option>
              <option value="createdAt_asc">Oldest Analysis</option>
            </select>
          </div>
        </div>
      </div>

      {/* Matches Content */}
      {isLoading ? (
        <div className="py-20 text-center text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs">Loading matching evaluations...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
          {error}
        </div>
      ) : matches.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-base font-bold text-white mb-1">No Matches Analyzed Yet</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
            Go to the Job Discovery tab and click "Analyze Match" on any job card to run hybrid scoring.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {matches.map((item) => (
            <div
              key={item.id}
              className="p-5 rounded-2xl bg-slate-900/80 backdrop-blur-xl border border-slate-800 hover:border-slate-700 transition-all duration-150 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 text-left"
            >
              <div className="space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-base font-bold text-white tracking-tight">{item.job.title}</h3>
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${getRecommendationBadge(
                      item.recommendation
                    )}`}
                  >
                    {item.recommendation.replace('_', ' ')}
                  </span>
                </div>

                <div className="text-xs text-slate-300 font-medium flex flex-wrap items-center gap-2">
                  <span className="text-indigo-400 font-semibold">{item.job.companyName}</span>
                  {item.job.location && (
                    <>
                      <span className="text-slate-600">&bull;</span>
                      <span className="text-slate-400">{item.job.location}</span>
                    </>
                  )}
                  <span className="text-slate-600">&bull;</span>
                  <span className="text-slate-400">{item.job.workMode}</span>
                </div>

                {/* Score Breakdown Pills */}
                <div className="flex flex-wrap items-center gap-2 text-[11px] pt-1">
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Skill: <strong className="text-slate-100">{item.skillScore}%</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Experience: <strong className="text-slate-100">{item.experienceScore}%</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Role: <strong className="text-slate-100">{item.roleScore}%</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Pref: <strong className="text-slate-100">{item.preferenceScore}%</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Loc: <strong className="text-slate-100">{item.locationScore}%</strong>
                  </span>
                </div>

                {/* AI Explanation Preview */}
                {item.aiAnalysis?.explanation && (
                  <p className="text-xs text-slate-400 italic line-clamp-2 pt-1">
                    "{item.aiAnalysis.explanation}"
                  </p>
                )}
              </div>

              {/* Overall Score Circle & Actions */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-center px-4 py-2 rounded-xl bg-slate-950 border border-slate-800/80">
                  <div className={`text-2xl font-black ${getScoreColor(item.overallScore)}`}>
                    {item.overallScore}%
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    Match
                  </div>
                </div>

                <button
                  onClick={() => setSelectedMatch(item)}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors"
                >
                  View Analysis
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-400">
          <div>
            Page <span className="font-semibold text-slate-200">{pagination.page}</span> of{' '}
            <span className="font-semibold text-slate-200">{pagination.totalPages}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Match Detail Modal */}
      {selectedMatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm text-left">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">{selectedMatch.job.title}</h3>
                <p className="text-xs text-indigo-400 font-medium">{selectedMatch.job.companyName}</p>
              </div>
              <button
                onClick={() => setSelectedMatch(null)}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {/* Overall Score & Recommendation Banner */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400 font-medium">Overall Match Score</div>
                  <div className={`text-3xl font-black ${getScoreColor(selectedMatch.overallScore)}`}>
                    {selectedMatch.overallScore}%
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-400 font-medium mb-1">Recommendation</div>
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-full border ${getRecommendationBadge(
                      selectedMatch.recommendation
                    )}`}
                  >
                    {selectedMatch.recommendation.replace('_', ' ')}
                  </span>
                </div>
              </div>

              {/* Dimension Breakdown */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Score Dimensions
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px]">Skill Fit (35%)</span>
                    <span className="font-bold text-slate-200 text-sm">{selectedMatch.skillScore}%</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px]">Experience Fit (25%)</span>
                    <span className="font-bold text-slate-200 text-sm">{selectedMatch.experienceScore}%</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px]">Role Fit (20%)</span>
                    <span className="font-bold text-slate-200 text-sm">{selectedMatch.roleScore}%</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px]">Preference Fit (10%)</span>
                    <span className="font-bold text-slate-200 text-sm">{selectedMatch.preferenceScore}%</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px]">Location Fit (10%)</span>
                    <span className="font-bold text-slate-200 text-sm">{selectedMatch.locationScore}%</span>
                  </div>
                </div>
              </div>

              {/* Strengths */}
              {selectedMatch.strengths && selectedMatch.strengths.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2">
                    Key Strengths
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {selectedMatch.strengths.map((str, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">&check;</span>
                        <span>{str}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Gaps */}
              {selectedMatch.gaps && selectedMatch.gaps.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">
                    Identified Gaps
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {selectedMatch.gaps.map((gap, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-amber-400 mt-0.5">&bull;</span>
                        <span>{gap}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* AI Explanation */}
              {selectedMatch.aiAnalysis?.explanation && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-2">
                    AI Evaluation Summary
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-4 rounded-xl border border-slate-800/70">
                    {selectedMatch.aiAnalysis.explanation}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-between border-t border-slate-800">
                <button
                  onClick={() => handleReanalyze(selectedMatch.jobId)}
                  disabled={isReanalyzing}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 disabled:opacity-50 transition-colors"
                >
                  {isReanalyzing ? 'Re-analyzing with Ollama...' : 'Re-analyze Match'}
                </button>

                <div className="flex items-center gap-2">
                  {onStartApplication && (
                    <button
                      onClick={() => {
                        const jobId = selectedMatch.jobId;
                        const existingAppId = (selectedMatch as any).applicationId;
                        setSelectedMatch(null);
                        if (existingAppId && onOpenApplication) {
                          onOpenApplication(existingAppId);
                        } else {
                          onStartApplication(jobId);
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-colors"
                    >
                      &#9997; Start Application Workspace
                    </button>
                  )}

                  {selectedMatch.job.applicationUrl && (
                    <a
                      href={selectedMatch.job.applicationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors"
                    >
                      Open Job URL &#x2197;
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
