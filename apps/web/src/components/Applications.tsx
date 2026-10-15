import { useState, useEffect, useCallback } from 'react';
import type {
  ApplicationListItem,
  ApplicationWorkspace,
  ApplicationStatus,
  ApplicationDocumentType,
  PaginationMetadata,
} from '@ai-job-agent/shared';
import {
  createOrGetApplication,
  getApplications,
  getApplicationWorkspace,
  generateApplication,
  generateAnswers,
  updateApplication,
  reviewApplication,
  approveApplication,
  rejectApplication,
  exportApplication,
} from '../api/applications.js';

interface ApplicationsProps {
  initialJobId?: string | null;
  onClearInitialJobId?: () => void;
  initialApplicationId?: string | null;
  onClearInitialApplicationId?: () => void;
}

export function Applications({
  initialJobId,
  onClearInitialJobId,
  initialApplicationId,
  onClearInitialApplicationId,
}: ApplicationsProps) {
  // Application List State
  const [applications, setApplications] = useState<ApplicationListItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMetadata>({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  });
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [minScoreFilter, setMinScoreFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  // Active Workspace State
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<ApplicationWorkspace | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<
    'cover_letter' | 'resume_bullets' | 'summary' | 'qa'
  >('cover_letter');

  // Operation States
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [factWarnings, setFactWarnings] = useState<string[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Human Edit Drafts in Workspace
  const [coverLetterDraft, setCoverLetterDraft] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [bulletsDraft, setBulletsDraft] = useState<string[]>([]);
  const [newBulletInput, setNewBulletInput] = useState('');

  // Q&A State
  const [qaQuestions, setQaQuestions] = useState<string[]>([
    'Why are you interested in this position and company?',
    'Describe a complex technical challenge you solved recently.',
  ]);
  const [newQuestionInput, setNewQuestionInput] = useState('');
  const [isGeneratingAnswers, setIsGeneratingAnswers] = useState(false);

  // Reject Modal State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('Qualifications or requirements not fully aligned.');

  // Export Result State
  const [exportDetails, setExportDetails] = useState<any | null>(null);

  // Fetch applications list
  const fetchApplicationsList = useCallback(async () => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const res = await getApplications({
        page,
        pageSize: 10,
        status: statusFilter ? (statusFilter as ApplicationStatus) : undefined,
        minimumScore: minScoreFilter ? parseInt(minScoreFilter, 10) : undefined,
        search: searchFilter || undefined,
      });
      setApplications(res.applications);
      setPagination(res.pagination);
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      setIsLoadingList(false);
    }
  }, [page, statusFilter, minScoreFilter, searchFilter]);

  useEffect(() => {
    fetchApplicationsList();
  }, [fetchApplicationsList]);

  // Load specific application workspace
  const loadWorkspace = useCallback(async (appId: string) => {
    setIsLoadingWorkspace(true);
    setWorkspaceError(null);
    setActionMessage(null);
    try {
      const ws = await getApplicationWorkspace(appId);
      setWorkspace(ws);
      setSelectedApplicationId(appId);

      // Populate draft buffers
      setCoverLetterDraft(ws.documents.COVER_LETTER?.content || '');
      setSummaryDraft(ws.documents.APPLICATION_SUMMARY?.content || '');
      if (ws.documents.RESUME_BULLETS?.content) {
        const bullets = ws.documents.RESUME_BULLETS.content
          .split('\n')
          .map((b) => b.replace(/^[-*•]\s*/, '').trim())
          .filter(Boolean);
        setBulletsDraft(bullets);
      } else {
        setBulletsDraft([]);
      }
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to load application workspace');
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, []);

  // Handle initialJobId passed from Job Discovery or Matches
  useEffect(() => {
    if (initialJobId) {
      createOrGetApplication(initialJobId)
        .then((ws) => {
          loadWorkspace(ws.application.id);
          if (onClearInitialJobId) onClearInitialJobId();
        })
        .catch((err) => {
          setListError(`Failed to open application: ${err.message}`);
        });
    }
  }, [initialJobId, loadWorkspace, onClearInitialJobId]);

  // Handle initialApplicationId passed from Agent Run
  useEffect(() => {
    if (initialApplicationId) {
      loadWorkspace(initialApplicationId);
      if (onClearInitialApplicationId) onClearInitialApplicationId();
    }
  }, [initialApplicationId, loadWorkspace, onClearInitialApplicationId]);

  // Generate Application with AI
  const handleGenerateAi = async () => {
    if (!workspace) return;
    setIsGenerating(true);
    setActionMessage(null);
    try {
      const result = await generateApplication(workspace.application.id);
      setCoverLetterDraft(result.data.coverLetter);
      setSummaryDraft(result.data.applicationSummary);
      setBulletsDraft(result.data.resumeBullets);

      if (result.validation?.suspiciousClaims && result.validation.suspiciousClaims.length > 0) {
        setFactWarnings(result.validation.suspiciousClaims);
      } else {
        setFactWarnings([]);
      }

      // Reload fresh workspace from server
      await loadWorkspace(workspace.application.id);
      setActionMessage({
        type: 'success',
        text: 'Tailored application materials successfully generated with local AI.',
      });
    } catch (err: unknown) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Generation failed.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Save manual edits to documents
  const handleSaveEdits = async () => {
    if (!workspace) return;
    setIsSaving(true);
    setActionMessage(null);
    try {
      const documentsPayload: Array<{ type: ApplicationDocumentType; content: string }> = [
        { type: 'COVER_LETTER', content: coverLetterDraft },
        { type: 'APPLICATION_SUMMARY', content: summaryDraft },
        {
          type: 'RESUME_BULLETS',
          content: bulletsDraft.map((b) => `• ${b}`).join('\n'),
        },
      ];

      await updateApplication(workspace.application.id, {
        documents: documentsPayload,
      });

      await loadWorkspace(workspace.application.id);
      setActionMessage({ type: 'success', text: 'Changes saved successfully.' });
    } catch (err: unknown) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save changes.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Generate Answers for Custom Q&A
  const handleGenerateAnswers = async () => {
    if (!workspace || qaQuestions.length === 0) return;
    setIsGeneratingAnswers(true);
    setActionMessage(null);
    try {
      await generateAnswers(workspace.application.id, qaQuestions);
      await loadWorkspace(workspace.application.id);
      setActionMessage({ type: 'success', text: 'Custom application questions answered by AI.' });
    } catch (err: unknown) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to generate answers.',
      });
    } finally {
      setIsGeneratingAnswers(false);
    }
  };

  // State Transition Handlers (Human-in-the-Loop)
  const handleReview = async () => {
    if (!workspace) return;
    try {
      await reviewApplication(workspace.application.id);
      await loadWorkspace(workspace.application.id);
      fetchApplicationsList();
      setActionMessage({
        type: 'success',
        text: 'Application moved to IN_REVIEW. Review all materials before approving.',
      });
    } catch (err: unknown) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to change state.',
      });
    }
  };

  const handleApprove = async () => {
    if (!workspace) return;
    try {
      await approveApplication(workspace.application.id);
      await loadWorkspace(workspace.application.id);
      fetchApplicationsList();
      setActionMessage({
        type: 'success',
        text: 'Application APPROVED by candidate. Ready for local export.',
      });
    } catch (err: unknown) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to approve application.',
      });
    }
  };

  const handleReject = async () => {
    if (!workspace) return;
    try {
      await rejectApplication(workspace.application.id, rejectionReason);
      setShowRejectModal(false);
      await loadWorkspace(workspace.application.id);
      fetchApplicationsList();
      setActionMessage({ type: 'success', text: 'Application marked as REJECTED.' });
    } catch (err: unknown) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to reject application.',
      });
    }
  };

  const handleExport = async () => {
    if (!workspace) return;
    try {
      const res = await exportApplication(workspace.application.id);
      setExportDetails(res);
      await loadWorkspace(workspace.application.id);
      fetchApplicationsList();
      setActionMessage({
        type: 'success',
        text: `Application successfully exported locally to ${res.exportDirectory}!`,
      });
    } catch (err: unknown) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to export application.',
      });
    }
  };

  // Clipboard copy helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`${label} copied to clipboard!`);
    setTimeout(() => setCopyFeedback(null), 3000);
  };

  // Status badge styling
  const getStatusBadge = (status: ApplicationStatus) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-slate-800 text-slate-300 border-slate-700';
      case 'IN_REVIEW':
        return 'bg-amber-950/80 text-amber-300 border-amber-700/70 animate-pulse';
      case 'APPROVED':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-600/80 font-bold';
      case 'REJECTED':
        return 'bg-rose-950/80 text-rose-300 border-rose-700/70';
      case 'EXPORTED':
        return 'bg-indigo-950/80 text-indigo-300 border-indigo-600/80 font-bold';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  // Metrics counts
  const totalCount = pagination.total;
  const draftCount = applications.filter((a) => a.status === 'DRAFT').length;
  const reviewCount = applications.filter((a) => a.status === 'IN_REVIEW').length;
  const approvedCount = applications.filter((a) => a.status === 'APPROVED').length;
  const exportedCount = applications.filter((a) => a.status === 'EXPORTED').length;

  return (
    <div className="space-y-6">
      {/* Top Header & Milestone Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white tracking-tight">Application Workspace</h2>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Milestone 8 · Human-in-the-Loop
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Privacy-preserving AI tailoring, anti-hallucination fact checking, candidate review, and offline export package generation.
          </p>
        </div>

        {/* Global Copy Banner */}
        {copyFeedback && (
          <div className="px-4 py-2 rounded-xl bg-emerald-900/90 text-emerald-200 border border-emerald-700 text-xs font-semibold shadow-lg transition-all animate-bounce">
            &check; {copyFeedback}
          </div>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Total Applications</span>
          <span className="text-2xl font-black text-white">{totalCount}</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Draft</span>
          <span className="text-2xl font-black text-slate-300">{draftCount}</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 border border-amber-900/40 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 block">In Review</span>
          <span className="text-2xl font-black text-amber-400">{reviewCount}</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 border border-emerald-900/40 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 block">Approved</span>
          <span className="text-2xl font-black text-emerald-400">{approvedCount}</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 border border-indigo-900/40 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 block">Exported</span>
          <span className="text-2xl font-black text-indigo-400">{exportedCount}</span>
        </div>
      </div>

      {/* Main Content: If Workspace is Selected, Show Workspace; Else Show Applications Table */}
      {selectedApplicationId ? (
        isLoadingWorkspace ? (
          <div className="text-center py-20 text-xs text-slate-400">Loading workspace...</div>
        ) : workspaceError ? (
          <div className="space-y-4">
            <button
              onClick={() => {
                setSelectedApplicationId(null);
                setWorkspace(null);
              }}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
            >
              &larr; Back to Applications
            </button>
            <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-xs text-rose-300">
              {workspaceError}
            </div>
          </div>
        ) : workspace ? (
          /* =================== APPLICATION WORKSPACE VIEW =================== */
          <div className="space-y-6">
          {/* Back & Breadcrumb Bar */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setSelectedApplicationId(null);
                setWorkspace(null);
                fetchApplicationsList();
              }}
              className="flex items-center gap-2 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              &larr; Back to Applications List
            </button>

            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 text-xs font-bold rounded-full border ${getStatusBadge(workspace.application.status)}`}>
                {workspace.application.status}
              </span>
              {workspace.job.applicationUrl && (
                <a
                  href={workspace.job.applicationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                >
                  Open External Job URL &#x2197;
                </a>
              )}
            </div>
          </div>

          {/* Action Notification Banner */}
          {actionMessage && (
            <div
              className={`p-4 rounded-xl border text-xs font-medium ${
                actionMessage.type === 'success'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                  : 'bg-rose-950/80 text-rose-300 border-rose-700/80'
              }`}
            >
              {actionMessage.text}
            </div>
          )}

          {/* Job Overview Card */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">{workspace.job.title}</h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                  <span className="font-semibold text-indigo-400">{workspace.job.companyName}</span>
                  <span>•</span>
                  <span>{workspace.job.location || 'Location Not Specified'}</span>
                  <span>•</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 text-[11px]">
                    {workspace.job.workMode}
                  </span>
                  {workspace.job.salaryMin && (
                    <>
                      <span>•</span>
                      <span className="text-emerald-400 font-medium">
                        {workspace.job.salaryCurrency} {workspace.job.salaryMin.toLocaleString()} - {workspace.job.salaryMax?.toLocaleString()}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Match Score Badge if exists */}
              {workspace.match && (
                <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 shrink-0">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Match Score</span>
                    <span className="text-xl font-black text-indigo-400">{workspace.match.overallScore}%</span>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-semibold">
                    {workspace.match.recommendation}
                  </span>
                </div>
              )}
            </div>

            {/* Fact-Checking & Anti-Hallucination Status */}
            {factWarnings.length > 0 ? (
              <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-800/80 text-xs space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <span>&#9888; Anti-Hallucination Fact Verification Notice:</span>
                </div>
                <p className="text-amber-200/90 text-[11px]">
                  The following claims in the AI generated output could not be strictly verified from candidate profile:
                </p>
                <ul className="list-disc pl-5 text-amber-300 space-y-1 text-[11px]">
                  {factWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400">
                <span className="text-emerald-400 font-bold">&check; Grounded Fact Verification:</span>
                <span>All claims strictly aligned with verified candidate experience, skills, and education.</span>
              </div>
            )}

            {/* Human-in-the-Loop Action Controls */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              {/* Left: AI Generation & Save */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateAi}
                  disabled={isGenerating}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md transition-colors flex items-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <span className="animate-spin text-sm">&#9696;</span>
                      <span>Generating with Ollama...</span>
                    </>
                  ) : (
                    <>
                      <span>&#10024;</span>
                      <span>Generate Materials with AI</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleSaveEdits}
                  disabled={isSaving}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save Draft Edits'}
                </button>
              </div>

              {/* Right: Human Workflow State Machine Actions */}
              <div className="flex items-center gap-2">
                {workspace.application.status === 'DRAFT' && (
                  <button
                    onClick={handleReview}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition-colors"
                  >
                    Submit to Review &rarr;
                  </button>
                )}

                {workspace.application.status === 'IN_REVIEW' && (
                  <>
                    <button
                      onClick={() => setShowRejectModal(true)}
                      className="px-3.5 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-medium transition-colors"
                    >
                      Reject Application
                    </button>
                    <button
                      onClick={handleApprove}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-colors"
                    >
                      &check; Approve Application
                    </button>
                  </>
                )}

                {workspace.application.status === 'APPROVED' && (
                  <button
                    onClick={handleExport}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors flex items-center gap-2"
                  >
                    <span>&#128190;</span>
                    <span>Export Package Locally</span>
                  </button>
                )}

                {workspace.application.status === 'EXPORTED' && (
                  <button
                    onClick={handleExport}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                  >
                    Re-Export Package
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Export Details Card (if exported) */}
          {exportDetails && (
            <div className="p-5 rounded-2xl bg-indigo-950/40 border border-indigo-800/80 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-300 text-sm">&#128193; Local Export Package Ready</span>
                <span className="text-indigo-400 font-mono text-[11px]">{exportDetails.exportedAt}</span>
              </div>
              <p className="text-slate-300">
                Application materials successfully bundled and saved to local disk:
                <br />
                <code className="text-indigo-300 bg-slate-950 px-2 py-1 rounded mt-1 inline-block font-mono text-[11px]">
                  {exportDetails.exportDirectory}
                </code>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {exportDetails.files.map((f: any, idx: number) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                    <span className="font-semibold text-slate-200 block truncate">{f.name}</span>
                    <span className="text-slate-500 text-[10px]">{(f.sizeBytes / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Workspace Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
            <button
              onClick={() => setActiveWorkspaceTab('cover_letter')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeWorkspaceTab === 'cover_letter'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              Cover Letter
            </button>
            <button
              onClick={() => setActiveWorkspaceTab('resume_bullets')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeWorkspaceTab === 'resume_bullets'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              Tailored Bullets ({bulletsDraft.length})
            </button>
            <button
              onClick={() => setActiveWorkspaceTab('summary')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeWorkspaceTab === 'summary'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              Application Pitch
            </button>
            <button
              onClick={() => setActiveWorkspaceTab('qa')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeWorkspaceTab === 'qa'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              Custom Q&A ({workspace.answers.length})
            </button>
          </div>

          {/* Tab 1: Cover Letter */}
          {activeWorkspaceTab === 'cover_letter' && (
            <div className="space-y-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-200">Cover Letter Document</span>
                  {workspace.documents.COVER_LETTER && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                      Source: {workspace.documents.COVER_LETTER.source}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span>Words: {coverLetterDraft.trim() ? coverLetterDraft.trim().split(/\s+/).length : 0}</span>
                  <button
                    onClick={() => copyToClipboard(coverLetterDraft, 'Cover letter')}
                    className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                  >
                    Copy to Clipboard
                  </button>
                </div>
              </div>

              <textarea
                value={coverLetterDraft}
                onChange={(e) => setCoverLetterDraft(e.target.value)}
                rows={16}
                placeholder="Click 'Generate Materials with AI' above or compose your tailored cover letter here..."
                className="w-full p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs leading-relaxed focus:outline-none focus:border-indigo-500 font-mono resize-y"
              />
            </div>
          )}

          {/* Tab 2: Tailored Resume Bullets */}
          {activeWorkspaceTab === 'resume_bullets' && (
            <div className="space-y-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-200">Achievement Bullets Aligned to Job</span>
                <button
                  onClick={() =>
                    copyToClipboard(bulletsDraft.map((b) => `• ${b}`).join('\n'), 'Resume bullets')
                  }
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                >
                  Copy All Bullets
                </button>
              </div>

              {bulletsDraft.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-500">
                  No resume bullets generated yet. Click &quot;Generate Materials with AI&quot; to produce achievements aligned to this job description.
                </div>
              ) : (
                <div className="space-y-3">
                  {bulletsDraft.map((bullet, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3 text-xs"
                    >
                      <span className="text-indigo-400 mt-1 font-bold">•</span>
                      <textarea
                        value={bullet}
                        onChange={(e) => {
                          const updated = [...bulletsDraft];
                          updated[idx] = e.target.value;
                          setBulletsDraft(updated);
                        }}
                        rows={2}
                        className="flex-1 bg-transparent text-slate-200 focus:outline-none focus:border-b focus:border-indigo-500 resize-none font-sans text-xs leading-relaxed"
                      />
                      <button
                        onClick={() => copyToClipboard(bullet, 'Bullet')}
                        className="text-slate-500 hover:text-slate-300 text-xs px-2 py-1"
                        title="Copy Bullet"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => {
                          const updated = bulletsDraft.filter((_, i) => i !== idx);
                          setBulletsDraft(updated);
                        }}
                        className="text-rose-500 hover:text-rose-400 text-xs px-2 py-1"
                        title="Delete Bullet"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Custom Bullet */}
              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  value={newBulletInput}
                  onChange={(e) => setNewBulletInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newBulletInput.trim()) {
                      setBulletsDraft([...bulletsDraft, newBulletInput.trim()]);
                      setNewBulletInput('');
                    }
                  }}
                  placeholder="Type an additional tailored achievement bullet and press enter..."
                  className="flex-1 px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => {
                    if (newBulletInput.trim()) {
                      setBulletsDraft([...bulletsDraft, newBulletInput.trim()]);
                      setNewBulletInput('');
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                >
                  Add Bullet
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Application Summary / Pitch */}
          {activeWorkspaceTab === 'summary' && (
            <div className="space-y-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-200">Elevator Pitch & Application Summary</span>
                <button
                  onClick={() => copyToClipboard(summaryDraft, 'Pitch summary')}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                >
                  Copy to Clipboard
                </button>
              </div>

              <textarea
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                rows={8}
                placeholder="Executive summary or tailored elevator pitch for this role..."
                className="w-full p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs leading-relaxed focus:outline-none focus:border-indigo-500 font-sans resize-y"
              />
            </div>
          )}

          {/* Tab 4: Custom Q&A Generator */}
          {activeWorkspaceTab === 'qa' && (
            <div className="space-y-5 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <h4 className="font-bold text-slate-200">Application Form Q&A Generator</h4>
                  <p className="text-slate-400 text-[11px]">
                    Paste employer questions from Greenhouse, Lever, or Workday. AI will answer them strictly based on your verified experience.
                  </p>
                </div>
                <button
                  onClick={handleGenerateAnswers}
                  disabled={isGeneratingAnswers || qaQuestions.length === 0}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold shadow-md transition-colors"
                >
                  {isGeneratingAnswers ? 'Generating Answers...' : 'Generate AI Answers'}
                </button>
              </div>

              {/* Add Question Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newQuestionInput}
                  onChange={(e) => setNewQuestionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newQuestionInput.trim()) {
                      setQaQuestions([...qaQuestions, newQuestionInput.trim()]);
                      setNewQuestionInput('');
                    }
                  }}
                  placeholder="Enter a new question from the job application form..."
                  className="flex-1 px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => {
                    if (newQuestionInput.trim()) {
                      setQaQuestions([...qaQuestions, newQuestionInput.trim()]);
                      setNewQuestionInput('');
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                >
                  Add Question
                </button>
              </div>

              {/* List of Questions and Answers */}
              <div className="space-y-4 pt-2">
                {qaQuestions.map((q, idx) => {
                  const existingAnswer = workspace.answers.find((a) => a.question === q);
                  return (
                    <div key={idx} className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-bold text-xs text-indigo-300">Q: {q}</span>
                        <div className="flex items-center gap-2">
                          {existingAnswer && (
                            <button
                              onClick={() => copyToClipboard(existingAnswer.answer, 'Answer')}
                              className="text-slate-400 hover:text-slate-200 text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
                            >
                              Copy
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const updated = qaQuestions.filter((_, i) => i !== idx);
                              setQaQuestions(updated);
                            }}
                            className="text-rose-400 hover:text-rose-300 text-xs px-1"
                          >
                            &times;
                          </button>
                        </div>
                      </div>

                      {existingAnswer ? (
                        <div className="text-xs text-slate-300 bg-slate-900/60 p-3 rounded-lg border border-slate-800 leading-relaxed">
                          {existingAnswer.answer}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 italic">
                          Click &quot;Generate AI Answers&quot; above to answer this question.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rejection Modal */}
          {showRejectModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
                <h4 className="text-base font-bold text-white">Reject Application</h4>
                <p className="text-xs text-slate-400">
                  Please provide a brief reason for rejecting this job application during review:
                </p>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-rose-500"
                />
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowRejectModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                  >
                    Confirm Rejection
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        ) : null
      ) : (
        /* =================== APPLICATIONS LIST TABLE VIEW =================== */
        <div className="space-y-4">
          {/* Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 rounded-xl bg-slate-900 border border-slate-800">
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search by job title or company..."
              className="flex-1 px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="IN_REVIEW">In Review</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="EXPORTED">Exported</option>
            </select>

            <select
              value={minScoreFilter}
              onChange={(e) => setMinScoreFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Match Scores</option>
              <option value="80">&ge; 80% Match</option>
              <option value="70">&ge; 70% Match</option>
              <option value="60">&ge; 60% Match</option>
            </select>
          </div>

          {/* List Content */}
          {isLoadingList ? (
            <div className="text-center py-16 text-xs text-slate-400">Loading applications...</div>
          ) : listError ? (
            <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-xs text-rose-300">
              {listError}
            </div>
          ) : applications.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-xs space-y-2 border border-slate-800/80 rounded-2xl p-8 bg-slate-900/40">
              <p className="font-semibold text-slate-400">No applications found.</p>
              <p>
                Browse jobs in the <strong>Job Discovery</strong> or <strong>AI Job Matches</strong> tab and click &quot;Start Application&quot; to initialize a workspace.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {applications.map((app) => (
                <div
                  key={app.id}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800/80 hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-white">{app.job.title}</h4>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${getStatusBadge(app.status)}`}>
                        {app.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="text-indigo-400 font-semibold">{app.job.companyName}</span>
                      <span>•</span>
                      <span>{app.job.location || 'Remote'}</span>
                      {app.matchScore !== undefined && app.matchScore !== null && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-400 font-semibold">{app.matchScore}% Match</span>
                        </>
                      )}
                      <span>•</span>
                      <span className="text-[11px] text-slate-500">
                        Updated {new Date(app.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => loadWorkspace(app.id)}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors"
                    >
                      Open Workspace &rarr;
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
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
