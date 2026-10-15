import React, { useState, useEffect, useCallback } from 'react';
import type {
  Job,
  JobDetailResponse,
  JobSearchParams,
  PaginationMetadata,
  DiscoveryRun,
  WorkMode,
  JobIngestionResult,
  JobMatchResponse,
  MatchRecommendation,
} from '@ai-job-agent/shared';
import {
  getJobs,
  getJobById,
  importJobs,
  getDiscoveryRuns,
  matchJob,
  getJobMatch,
} from '../api/jobs';

const SAMPLE_IMPORT_JSON = JSON.stringify(
  {
    source: {
      name: 'Manual Import',
      type: 'MANUAL',
      baseUrl: null,
    },
    jobs: [
      {
        externalId: 'manual-001',
        title: 'Product Owner',
        companyName: 'Example Technologies',
        description:
          'We are looking for a Product Owner to lead cross-functional agile squads, define product roadmaps, and work closely with stakeholders and engineering teams.',
        location: 'Coimbatore, Tamil Nadu',
        locations: ['Coimbatore, Tamil Nadu'],
        workMode: 'HYBRID',
        employmentType: 'FULL_TIME',
        experienceLevel: 'MID',
        salaryMin: 800000,
        salaryMax: 1200000,
        salaryCurrency: 'INR',
        applicationUrl: 'https://example.com/jobs/123',
        publishedAt: '2026-10-05T00:00:00.000Z',
      },
      {
        externalId: 'manual-002',
        title: 'Senior Full Stack Engineer',
        companyName: 'Acme Cloud Solutions',
        description:
          'Seeking an experienced engineer proficient in React, TypeScript, Fastify, Docker, and PostgreSQL to build high-scale web platforms.',
        location: 'Bengaluru, Karnataka',
        locations: ['Bengaluru, Karnataka', 'Remote'],
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'SENIOR',
        salaryMin: 1800000,
        salaryMax: 2600000,
        salaryCurrency: 'INR',
        applicationUrl: 'https://example.com/careers/senior-fullstack',
        publishedAt: '2026-10-05T00:00:00.000Z',
      },
    ],
  },
  null,
  2
);

interface JobDiscoveryProps {
  onStartApplication?: (jobId: string) => void;
}

export function JobDiscovery({ onStartApplication }: JobDiscoveryProps = {}) {
  // Job list & pagination state
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pagination, setPagination] = useState<PaginationMetadata>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  // Search & Filter state
  const [filters, setFilters] = useState<JobSearchParams>({
    search: '',
    location: '',
    workMode: undefined,
    employmentType: undefined,
    experienceLevel: undefined,
    page: 1,
    pageSize: 20,
  });

  // Selected job detail modal
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Manual import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState(SAMPLE_IMPORT_JSON);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<JobIngestionResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Discovery runs drawer state
  const [showRunsModal, setShowRunsModal] = useState(false);
  const [discoveryRuns, setDiscoveryRuns] = useState<DiscoveryRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);

  // Job Match State (Milestone 7)
  const [matchesMap, setMatchesMap] = useState<Record<string, JobMatchResponse>>({});
  const [isMatchingMap, setIsMatchingMap] = useState<Record<string, boolean>>({});
  const [matchErrorMap, setMatchErrorMap] = useState<Record<string, string | null>>({});

  const handleAnalyzeMatch = async (jobId: string) => {
    setIsMatchingMap((prev) => ({ ...prev, [jobId]: true }));
    setMatchErrorMap((prev) => ({ ...prev, [jobId]: null }));
    try {
      const match = await matchJob(jobId);
      setMatchesMap((prev) => ({ ...prev, [jobId]: match }));
    } catch (err: unknown) {
      setMatchErrorMap((prev) => ({
        ...prev,
        [jobId]: err instanceof Error ? err.message : 'Match analysis failed',
      }));
    } finally {
      setIsMatchingMap((prev) => ({ ...prev, [jobId]: false }));
    }
  };

  // Fetch Jobs
  const fetchJobList = useCallback(async (currentFilters: JobSearchParams) => {
    setIsLoadingJobs(true);
    setJobsError(null);
    try {
      const data = await getJobs(currentFilters);
      setJobs(data.jobs || []);
      setPagination(data.pagination);
    } catch (err: unknown) {
      setJobsError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    fetchJobList(filters);
  }, [fetchJobList, filters]);

  // Handle Search Input Change
  const handleFilterChange = (field: keyof JobSearchParams, value: any) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value || undefined,
      page: 1, // reset to page 1 on filter changes
    }));
  };

  const handleResetFilters = () => {
    setFilters({
      search: '',
      location: '',
      workMode: undefined,
      employmentType: undefined,
      experienceLevel: undefined,
      page: 1,
      pageSize: 20,
    });
  };

  // Open Job Detail
  const handleOpenDetail = async (id: string) => {
    setSelectedJobId(id);
    setIsLoadingDetail(true);
    try {
      const detail = await getJobById(id);
      setJobDetail(detail);

      if (!matchesMap[id]) {
        try {
          const match = await getJobMatch(id);
          setMatchesMap((prev) => ({ ...prev, [id]: match }));
        } catch {
          // No match stored yet; fine to ignore
        }
      }
    } catch (err) {
      console.error('Failed to load job details', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Open Discovery Runs
  const handleOpenRuns = async () => {
    setShowRunsModal(true);
    setIsLoadingRuns(true);
    try {
      const data = await getDiscoveryRuns();
      setDiscoveryRuns(data.runs || []);
    } catch (err) {
      console.error('Failed to fetch discovery runs', err);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  // Submit Manual Import
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);

    let parsed: any;
    try {
      parsed = JSON.parse(importJsonText);
    } catch (parseErr: any) {
      setImportError(`Invalid JSON format: ${parseErr.message}`);
      setIsImporting(false);
      return;
    }

    try {
      const res = await importJobs(parsed);
      setImportResult(res);
      // Refresh job list
      await fetchJobList(filters);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const formatSalary = (min: number | null, max: number | null, currency: string | null) => {
    if (!min && !max) return 'Salary Unspecified';
    const curr = currency || '';

    const formatNum = (num: number) => {
      if (curr === 'INR') {
        if (num >= 100000) {
          return `₹${(num / 100000).toFixed(num % 100000 === 0 ? 0 : 1)} LPA`;
        }
        return `₹${num.toLocaleString('en-IN')}`;
      }
      if (curr === 'USD') {
        return `$${num.toLocaleString('en-US')}`;
      }
      return `${num.toLocaleString()} ${curr}`;
    };

    if (min && max) {
      return min === max ? formatNum(min) : `${formatNum(min)} - ${formatNum(max)}`;
    }
    if (min) return `From ${formatNum(min)}`;
    if (max) return `Up to ${formatNum(max)}`;
    return 'Salary Unspecified';
  };

  const getWorkModeBadgeClass = (mode: WorkMode) => {
    switch (mode) {
      case 'REMOTE':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60';
      case 'HYBRID':
        return 'text-indigo-400 bg-indigo-950/60 border-indigo-800/60';
      case 'ONSITE':
        return 'text-amber-400 bg-amber-950/60 border-amber-800/60';
      default:
        return 'text-slate-400 bg-slate-900 border-slate-800';
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
    <div className="w-full text-slate-100">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Job Discovery Pipeline</span>
            <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
              {pagination.total} {pagination.total === 1 ? 'Job' : 'Jobs'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Browse discovered opportunities, filter criteria, and view detailed listings
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleOpenRuns}
            className="px-3.5 py-2 text-xs font-medium rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors"
          >
            Discovery Runs
          </button>
          <button
            onClick={() => {
              setShowImportModal(true);
              setImportResult(null);
              setImportError(null);
            }}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Development / Manual Import
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-5 mb-6 shadow-xl text-left">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
          {/* Keyword Search */}
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Search Keywords
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Title, company, or keywords..."
                value={filters.search || ''}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs text-slate-100 placeholder-slate-500 outline-none transition-all"
              />
              <svg
                className="w-4 h-4 text-slate-500 absolute left-3 top-2.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Location
            </label>
            <input
              type="text"
              placeholder="e.g. Coimbatore, Remote..."
              value={filters.location || ''}
              onChange={(e) => handleFilterChange('location', e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs text-slate-100 placeholder-slate-500 outline-none transition-all"
            />
          </div>

          {/* Work Mode */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Work Mode
            </label>
            <select
              value={filters.workMode || ''}
              onChange={(e) => handleFilterChange('workMode', e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs text-slate-100 outline-none transition-all"
            >
              <option value="">All Work Modes</option>
              <option value="REMOTE">Remote</option>
              <option value="HYBRID">Hybrid</option>
              <option value="ONSITE">On-site</option>
            </select>
          </div>
        </div>

        {/* Secondary Filters row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-3">
            {/* Employment Type */}
            <select
              value={filters.employmentType || ''}
              onChange={(e) => handleFilterChange('employmentType', e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-300 outline-none"
            >
              <option value="">All Employment Types</option>
              <option value="FULL_TIME">Full Time</option>
              <option value="PART_TIME">Part Time</option>
              <option value="CONTRACT">Contract</option>
              <option value="INTERNSHIP">Internship</option>
              <option value="TEMPORARY">Temporary</option>
            </select>

            {/* Experience Level */}
            <select
              value={filters.experienceLevel || ''}
              onChange={(e) => handleFilterChange('experienceLevel', e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-300 outline-none"
            >
              <option value="">All Experience Levels</option>
              <option value="ENTRY">Entry Level</option>
              <option value="JUNIOR">Junior</option>
              <option value="MID">Mid Level</option>
              <option value="SENIOR">Senior</option>
              <option value="LEAD">Lead / Staff</option>
              <option value="MANAGER">Manager</option>
              <option value="DIRECTOR">Director / Executive</option>
            </select>

            <button
              onClick={handleResetFilters}
              className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2 ml-1"
            >
              Reset Filters
            </button>
          </div>

          <div className="text-xs text-slate-400">
            Showing <span className="font-semibold text-slate-200">{jobs.length}</span> of{' '}
            <span className="font-semibold text-slate-200">{pagination.total}</span> jobs
          </div>
        </div>
      </div>

      {/* Jobs Listing */}
      {isLoadingJobs ? (
        <div className="py-20 text-center text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs">Loading discovered jobs...</p>
        </div>
      ) : jobsError ? (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs mb-6">
          {jobsError}
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center my-6">
          <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h3 className="text-base font-bold text-white mb-1">No Jobs Found</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
            No job records match the selected filters. Use the "Development / Manual Import" button above to ingest job postings.
          </p>
          <button
            onClick={() => {
              setShowImportModal(true);
              setImportResult(null);
              setImportError(null);
            }}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Import Sample Jobs
          </button>
        </div>
      ) : (
        <div className="space-y-3.5 mb-8 text-left">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="p-5 rounded-2xl bg-slate-900/80 backdrop-blur-xl border border-slate-800 hover:border-slate-700 transition-all duration-150 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-white tracking-tight">{job.title}</h3>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${getWorkModeBadgeClass(
                      job.workMode
                    )}`}
                  >
                    {job.workMode}
                  </span>
                  {job.employmentType !== 'UNKNOWN' && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-950 text-slate-400 border border-slate-800">
                      {job.employmentType.replace('_', ' ')}
                    </span>
                  )}
                  {job.experienceLevel !== 'UNKNOWN' && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-950 text-slate-400 border border-slate-800">
                      {job.experienceLevel}
                    </span>
                  )}
                  {matchesMap[job.id] && (
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${getRecommendationBadge(
                        matchesMap[job.id].recommendation
                      )}`}
                    >
                      {matchesMap[job.id].overallScore}% Match &bull;{' '}
                      {matchesMap[job.id].recommendation.replace('_', ' ')}
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-300 font-medium flex flex-wrap items-center gap-2">
                  <span className="text-indigo-400 font-semibold">{job.companyName}</span>
                  {job.location && (
                    <>
                      <span className="text-slate-600">&bull;</span>
                      <span className="text-slate-400">{job.location}</span>
                    </>
                  )}
                  <span className="text-slate-600">&bull;</span>
                  <span className="text-emerald-400">
                    {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)}
                  </span>
                </div>

                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                  {job.description}
                </p>

                {/* Match Highlights if analyzed */}
                {matchesMap[job.id] && (
                  <div className="space-y-1 pt-1">
                    {matchesMap[job.id].strengths.length > 0 && (
                      <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 truncate">
                        <span>&check;</span>
                        <span className="truncate">{matchesMap[job.id].strengths[0]}</span>
                      </div>
                    )}
                    {matchesMap[job.id].gaps.length > 0 && (
                      <div className="text-[11px] text-amber-400 flex items-center gap-1.5 truncate">
                        <span>&bull;</span>
                        <span className="truncate">{matchesMap[job.id].gaps[0]}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="text-[11px] text-slate-500 flex items-center gap-3 pt-1">
                  <span>Source: {job.jobSource?.name || 'Manual'}</span>
                  {job.publishedAt && (
                    <>
                      <span>&bull;</span>
                      <span>Published: {new Date(job.publishedAt).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex md:flex-col items-center md:items-end justify-end gap-2 shrink-0">
                {matchesMap[job.id] ? (
                  <button
                    onClick={() => handleAnalyzeMatch(job.id)}
                    disabled={isMatchingMap[job.id]}
                    className="px-3.5 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900/80 text-xs font-semibold text-indigo-300 border border-indigo-700/60 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isMatchingMap[job.id] ? (
                      <>
                        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                        <span>Re-analyzing...</span>
                      </>
                    ) : (
                      <>
                        <span>Re-analyze</span>
                        <span className={`font-mono font-bold ${getScoreColor(matchesMap[job.id].overallScore)}`}>
                          ({matchesMap[job.id].overallScore}%)
                        </span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => handleAnalyzeMatch(job.id)}
                    disabled={isMatchingMap[job.id]}
                    className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isMatchingMap[job.id] ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Analyzing Match...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                        <span>Analyze Match</span>
                      </>
                    )}
                  </button>
                )}

                {matchErrorMap[job.id] && (
                  <span className="text-[10px] text-rose-400 max-w-[200px] truncate">
                    {matchErrorMap[job.id]}
                  </span>
                )}

                <button
                  onClick={() => handleOpenDetail(job.id)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition-colors"
                >
                  View Details
                </button>
                {job.applicationUrl && (
                  <a
                    href={job.applicationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors flex items-center gap-1"
                  >
                    Open Application
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination Bar */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-400">
          <div>
            Page <span className="font-semibold text-slate-200">{pagination.page}</span> of{' '}
            <span className="font-semibold text-slate-200">{pagination.totalPages}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleFilterChange('page', pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => handleFilterChange('page', pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* 1. Job Detail Modal */}
      {selectedJobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl text-left overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">
                  {jobDetail?.title || 'Job Details'}
                </h3>
                <p className="text-xs text-indigo-400 font-medium">
                  {jobDetail?.companyName}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedJobId(null);
                  setJobDetail(null);
                }}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {isLoadingDetail ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  Loading complete job data...
                </div>
              ) : jobDetail ? (
                <>
                  {/* Badges Overview */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span
                      className={`font-mono px-2.5 py-1 rounded-full border ${getWorkModeBadgeClass(
                        jobDetail.workMode
                      )}`}
                    >
                      {jobDetail.workMode}
                    </span>
                    <span className="font-mono px-2.5 py-1 rounded-full bg-slate-950 text-slate-300 border border-slate-800">
                      {jobDetail.employmentType.replace('_', ' ')}
                    </span>
                    <span className="font-mono px-2.5 py-1 rounded-full bg-slate-950 text-slate-300 border border-slate-800">
                      {jobDetail.experienceLevel}
                    </span>
                    <span className="font-mono px-2.5 py-1 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                      {formatSalary(
                        jobDetail.salaryMin,
                        jobDetail.salaryMax,
                        jobDetail.salaryCurrency
                      )}
                    </span>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/60 p-4 rounded-xl border border-slate-800/70">
                    <div>
                      <span className="text-slate-400 block mb-0.5">Location</span>
                      <span className="text-slate-200 font-medium">
                        {jobDetail.location || 'Unspecified'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-0.5">Source</span>
                      <span className="text-slate-200 font-medium">
                        {jobDetail.jobSource?.name} ({jobDetail.jobSource?.type})
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-0.5">Published Date</span>
                      <span className="text-slate-200 font-medium">
                        {jobDetail.publishedAt
                          ? new Date(jobDetail.publishedAt).toLocaleDateString()
                          : 'Unspecified'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-0.5">External ID</span>
                      <span className="text-slate-200 font-mono">
                        {jobDetail.externalId || 'None'}
                      </span>
                    </div>
                  </div>

                  {/* AI Match Analysis Card */}
                  {matchesMap[selectedJobId] ? (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                            AI Match Score
                          </span>
                          <div className={`text-2xl font-black ${getScoreColor(matchesMap[selectedJobId].overallScore)}`}>
                            {matchesMap[selectedJobId].overallScore}%
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block mb-0.5">
                            Recommendation
                          </span>
                          <span
                            className={`text-xs font-bold px-2.5 py-1 rounded-full border ${getRecommendationBadge(
                              matchesMap[selectedJobId].recommendation
                            )}`}
                          >
                            {matchesMap[selectedJobId].recommendation.replace('_', ' ')}
                          </span>
                        </div>
                      </div>

                      {/* Sub-scores Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Skill Fit (35%)</span>
                          <span className="font-bold text-slate-200">{matchesMap[selectedJobId].scores.skill}%</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Experience (25%)</span>
                          <span className="font-bold text-slate-200">{matchesMap[selectedJobId].scores.experience}%</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Role Fit (20%)</span>
                          <span className="font-bold text-slate-200">{matchesMap[selectedJobId].scores.role}%</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Preferences (10%)</span>
                          <span className="font-bold text-slate-200">{matchesMap[selectedJobId].scores.preference}%</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Location/Work (10%)</span>
                          <span className="font-bold text-slate-200">{matchesMap[selectedJobId].scores.location}%</span>
                        </div>
                      </div>

                      {/* Strengths */}
                      {matchesMap[selectedJobId].strengths.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block">
                            Matching Strengths
                          </span>
                          <ul className="text-xs text-slate-300 space-y-1">
                            {matchesMap[selectedJobId].strengths.map((str, idx) => (
                              <li key={idx} className="flex items-start gap-1.5">
                                <span className="text-emerald-400">&check;</span>
                                <span>{str}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Gaps */}
                      {matchesMap[selectedJobId].gaps.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 block">
                            Identified Gaps
                          </span>
                          <ul className="text-xs text-slate-300 space-y-1">
                            {matchesMap[selectedJobId].gaps.map((gap, idx) => (
                              <li key={idx} className="flex items-start gap-1.5">
                                <span className="text-amber-400">&bull;</span>
                                <span>{gap}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* AI Explanation */}
                      {matchesMap[selectedJobId].explanation && (
                        <div className="space-y-1 pt-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 block">
                            AI Evaluation Explanation
                          </span>
                          <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                            {matchesMap[selectedJobId].explanation}
                          </p>
                        </div>
                      )}

                      <div className="pt-2">
                        <button
                          onClick={() => handleAnalyzeMatch(selectedJobId)}
                          disabled={isMatchingMap[selectedJobId]}
                          className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isMatchingMap[selectedJobId] ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Re-analyzing with Ollama...</span>
                            </>
                          ) : (
                            <>
                              <span>Re-analyze Match</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-white mb-0.5">Match Against Profile</h4>
                        <p className="text-xs text-slate-400">
                          Run local AI analysis comparing this job to your resume & preferences.
                        </p>
                      </div>
                      <button
                        onClick={() => handleAnalyzeMatch(selectedJobId)}
                        disabled={isMatchingMap[selectedJobId]}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {isMatchingMap[selectedJobId] ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Analyzing...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M13 10V3L4 14h7v7l9-11h-7z"
                              />
                            </svg>
                            <span>Analyze Match</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Job Description (rendered strictly as safe text) */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Job Description
                    </h4>
                    <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-950/60 p-4 rounded-xl border border-slate-800/70">
                      {jobDetail.description}
                    </div>
                  </div>

                  {/* Application Actions */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
                    {onStartApplication && selectedJobId && (
                      <button
                        onClick={() => {
                          const id = selectedJobId;
                          setSelectedJobId(null);
                          onStartApplication(id);
                        }}
                        className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition-colors"
                      >
                        <span>&#9997;</span>
                        <span>Start Tailored Application (Milestone 8)</span>
                      </button>
                    )}

                    {jobDetail.applicationUrl && (
                      <a
                        href={jobDetail.applicationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors"
                      >
                        Open Career Site &#x2197;
                      </a>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 2. Development Manual Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl text-left overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60">
                  Development Mode
                </span>
                <h3 className="text-base font-bold text-white mt-1">Manual Job Import</h3>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="p-6 overflow-y-auto flex-1 flex flex-col space-y-4">
              <p className="text-xs text-slate-400">
                Paste JSON containing a source specification and an array of jobs. The system will normalize work mode, employment type, experience level, salary, and deduplicate records.
              </p>

              {importResult && (
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>Import Status: {importResult.status}</span>
                  </div>
                  <div className="flex gap-4 pt-1 font-mono">
                    <span>Fetched: {importResult.jobsFetched}</span>
                    <span className="text-emerald-400">Created: {importResult.jobsCreated}</span>
                    <span className="text-indigo-400">Updated: {importResult.jobsUpdated}</span>
                    <span className="text-slate-400">Skipped: {importResult.jobsSkipped}</span>
                  </div>
                </div>
              )}

              {importError && (
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
                  {importError}
                </div>
              )}

              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">Job Payload (JSON)</label>
                  <button
                    type="button"
                    onClick={() => setImportJsonText(SAMPLE_IMPORT_JSON)}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    Reset to Sample JSON
                  </button>
                </div>
                <textarea
                  rows={12}
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  className="w-full p-3 font-mono text-xs text-slate-200 bg-slate-950 rounded-xl border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isImporting}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isImporting ? 'Ingesting Jobs...' : 'Ingest Jobs'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Discovery Runs Drawer Modal */}
      {showRunsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl text-left overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">Discovery Ingestion Runs</h3>
                <p className="text-xs text-slate-400">Audit log of recent job discovery executions</p>
              </div>
              <button
                onClick={() => setShowRunsModal(false)}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              {isLoadingRuns ? (
                <div className="py-12 text-center text-slate-400 text-xs">Loading discovery runs...</div>
              ) : discoveryRuns.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">No discovery runs logged yet.</div>
              ) : (
                discoveryRuns.map((run) => (
                  <div
                    key={run.id}
                    className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">
                        {run.jobSourceName || 'Source'}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          run.status === 'COMPLETED'
                            ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60'
                            : run.status === 'RUNNING'
                            ? 'text-amber-400 bg-amber-950/60 border-amber-800/60'
                            : 'text-rose-400 bg-rose-950/60 border-rose-800/60'
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-slate-400 font-mono text-[11px]">
                      <span>Fetched: {run.jobsFetched}</span>
                      <span className="text-emerald-400">Created: {run.jobsCreated}</span>
                      <span className="text-indigo-400">Updated: {run.jobsUpdated}</span>
                      <span className="text-slate-500">Skipped: {run.jobsSkipped}</span>
                    </div>

                    <div className="text-[10px] text-slate-500">
                      Started: {new Date(run.startedAt).toLocaleString()}
                      {run.completedAt && ` &bull; Completed: ${new Date(run.completedAt).toLocaleString()}`}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
