import React, { useState, useEffect, useRef } from 'react';
import type {
  ApplicationPageAnalysisDto,
  BrowserSessionDto,
  BrowserScreenshotDto,
  AutofillProposalDto,
  AutofillResultDto,
  NavigationState,
  MultiStepWorkflowState,
  WorkflowHistoryResponse,
  WorkflowRecoveryResult,
} from '@ai-job-agent/shared';
import {
  createBrowserSession,
  discoverApplicationPage,
  captureBrowserScreenshot,
  closeBrowserSession,
  createAutofillProposal,
  approveAutofill,
  verifyAutofill,
  discoverNavigation,
  approveNavigation,
  initMultiStepWorkflow,
  executeWorkflowStepFields,
  approveWorkflowStepNavigation,
  getWorkflowHistory,
  recoverWorkflow,
} from '../api/browser.js';
import { ApiError } from '../api/client.js';

interface BrowserDiscoveryProps {
  userProfileId?: string;
}

type DiscoveryStage =
  | 'idle'
  | 'creating_session'
  | 'loading_page'
  | 'inspecting_page'
  | 'detecting_form'
  | 'mapping_fields'
  | 'identifying_missing'
  | 'complete';

const STAGE_LABELS: Record<DiscoveryStage, string> = {
  idle: 'Ready to inspect',
  creating_session: '1. Creating isolated browser session...',
  loading_page: '2. Loading page...',
  inspecting_page: '3. Inspecting page elements...',
  detecting_form: '4. Detecting application form signals...',
  mapping_fields: '5. Mapping candidate fields...',
  identifying_missing: '6. Identifying missing candidate information...',
  complete: '7. Discovery complete',
};

export function BrowserDiscovery({ userProfileId }: BrowserDiscoveryProps) {
  const [url, setUrl] = useState('http://127.0.0.1:3000/browser/test-page/application');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<BrowserSessionDto['status'] | 'IDLE' | 'CLOSED'>('IDLE');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStage, setCurrentStage] = useState<DiscoveryStage>('idle');
  const [analysisResult, setAnalysisResult] = useState<ApplicationPageAnalysisDto | null>(null);
  const [screenshotResult, setScreenshotResult] = useState<BrowserScreenshotDto | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [activeFormIndex, setActiveFormIndex] = useState<number | null>(null);

  // M11 Controlled Autofill State
  const [autofillProposal, setAutofillProposal] = useState<AutofillProposalDto | null>(null);
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
  const [isPopulating, setIsPopulating] = useState(false);
  const [autofillResult, setAutofillResult] = useState<AutofillResultDto | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // M12.1 Multi-Step Navigation State
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isDiscoveringNav, setIsDiscoveringNav] = useState(false);

  // M12.2 Multi-Step Workflow Orchestration State
  const [workflowState, setWorkflowState] = useState<MultiStepWorkflowState | null>(null);
  const [workflowSelectedFieldIds, setWorkflowSelectedFieldIds] = useState<Set<string>>(new Set());
  const [isInitWorkflow, setIsInitWorkflow] = useState(false);
  const [isExecutingWorkflowStep, setIsExecutingWorkflowStep] = useState(false);
  const [isAdvancingWorkflowStep, setIsAdvancingWorkflowStep] = useState(false);
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowHistoryResponse | null>(null);
  const [showHistoryTab, setShowHistoryTab] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<WorkflowRecoveryResult | null>(null);

  const activeSessionRef = useRef<string | null>(null);

  // Keep ref in sync for cleanup
  useEffect(() => {
    activeSessionRef.current = currentSessionId;
  }, [currentSessionId]);

  // Cleanup session on unmount
  useEffect(() => {
    return () => {
      if (activeSessionRef.current) {
        closeBrowserSession(activeSessionRef.current).catch(() => {
          // Ignore unmount close errors
        });
      }
    };
  }, []);

  const formatErrorMessage = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.status === 400) {
        return err.message || 'Invalid URL. Only HTTP and HTTPS URLs are permitted.';
      }
      if (err.status === 403) {
        return 'Browser automation is currently disabled in system configuration.';
      }
      if (err.status === 404) {
        return 'Browser session not found or expired.';
      }
      if (err.status === 429) {
        return 'Browser capacity is currently full. Please try again shortly.';
      }
      if (err.status === 504) {
        return 'Unable to load the page within the configured timeout.';
      }
      return err.message || 'Browser automation encountered an unexpected error.';
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'An unexpected error occurred during browser discovery.';
  };

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setErrorMessage('Please enter an application or job URL.');
      return;
    }

    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setErrorMessage('Invalid URL scheme. Only HTTP and HTTPS navigation is permitted.');
      return;
    }

    setErrorMessage(null);
    setSuccessNotice(null);
    setScreenshotResult(null);
    setIsAnalyzing(true);

    let sessionIdToUse = currentSessionId;

    try {
      // Step 1: Create session if none exists or previous was closed
      if (!sessionIdToUse || sessionState === 'CLOSED') {
        setCurrentStage('creating_session');
        const sessionRes = await createBrowserSession();
        sessionIdToUse = sessionRes.sessionId;
        setCurrentSessionId(sessionIdToUse);
        setSessionState('ACTIVE');
      }

      // Step 2-6: Run application discovery with simulated progressive stage labels
      setCurrentStage('loading_page');
      await new Promise((r) => setTimeout(r, 200));

      setCurrentStage('inspecting_page');
      await new Promise((r) => setTimeout(r, 150));

      setCurrentStage('detecting_form');
      const result = await discoverApplicationPage(sessionIdToUse, {
        url: trimmedUrl,
        userProfileId,
      });

      setCurrentStage('mapping_fields');
      await new Promise((r) => setTimeout(r, 100));

      setCurrentStage('identifying_missing');
      await new Promise((r) => setTimeout(r, 100));

      setAnalysisResult(result);
      setCurrentStage('complete');
      setSuccessNotice(`Page analyzed successfully: ${result.page.title || result.page.url}`);

      // Reset previous autofill state on new analysis
      setAutofillProposal(null);
      setAutofillResult(null);
      setSelectedFieldIds(new Set());
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
      setCurrentStage('idle');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateProposal = async () => {
    if (!currentSessionId) {
      setErrorMessage('No active browser session available.');
      return;
    }

    setIsGeneratingProposal(true);
    setErrorMessage(null);
    try {
      const proposal = await createAutofillProposal(currentSessionId, userProfileId);
      setAutofillProposal(proposal);
      setAutofillResult(null);
      setSelectedFieldIds(new Set()); // Require explicit human approval: start unselected
      setSuccessNotice(`Generated autofill proposal: ${proposal.proposals.length} fields mapped for review.`);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsGeneratingProposal(false);
    }
  };

  const handleToggleField = (fieldId: string) => {
    setSelectedFieldIds((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(fieldId)) {
        next.delete(fieldId);
      } else {
        next.add(fieldId);
      }
      return next;
    });
  };

  const handleApproveAndAutofill = async () => {
    if (!currentSessionId) return;

    if (selectedFieldIds.size === 0) {
      setErrorMessage('Please select at least one field to approve for controlled autofill.');
      return;
    }

    setIsPopulating(true);
    setErrorMessage(null);
    try {
      const result = await approveAutofill(currentSessionId, Array.from(selectedFieldIds));
      setAutofillResult(result);
      setSuccessNotice(`Populated ${result.results.filter((r) => r.status === 'SUCCESS').length} approved fields. Form submission was not performed.`);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsPopulating(false);
    }
  };

  const handleReverify = async () => {
    if (!currentSessionId) return;

    setIsVerifying(true);
    setErrorMessage(null);
    try {
      const result = await verifyAutofill(currentSessionId);
      setAutofillResult(result);
      setSuccessNotice('Page fields and validation state re-verified.');
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCaptureScreenshot = async () => {
    if (!currentSessionId) {
      setErrorMessage('No active browser session to screenshot.');
      return;
    }

    setIsCapturingScreenshot(true);
    setErrorMessage(null);
    try {
      const screenshot = await captureBrowserScreenshot(currentSessionId);
      setScreenshotResult(screenshot);
      setSuccessNotice(`Screenshot captured: ${screenshot.path}`);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  const handleCloseSession = async () => {
    if (!currentSessionId) return;

    try {
      await closeBrowserSession(currentSessionId);
      setSessionState('CLOSED');
      setSuccessNotice('Browser session closed and isolated context released.');
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setCurrentSessionId(null);
    }
  };

  const handleSelectPreset = (presetUrl: string) => {
    setUrl(presetUrl);
    setErrorMessage(null);
  };

  const handleDiscoverNavigation = async () => {
    if (!currentSessionId) return;
    try {
      setIsDiscoveringNav(true);
      setErrorMessage(null);
      const nav = await discoverNavigation(currentSessionId);
      setNavigationState(nav);
      setSuccessNotice(`Discovered multi-step state: ${nav.currentStep?.heading || 'Step ' + nav.currentStep?.stepIndex}`);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsDiscoveringNav(false);
    }
  };

  const handleApproveNavigation = async (controlId: string) => {
    if (!currentSessionId) return;
    try {
      setIsNavigating(true);
      setErrorMessage(null);
      const res = await approveNavigation(currentSessionId, controlId);
      setNavigationState(res.navigationState);
      setSuccessNotice(`Successfully navigated to: ${res.currentStep.heading || 'Step ' + res.currentStep.stepIndex}`);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsNavigating(false);
    }
  };

  const handleInitWorkflow = async () => {
    if (!currentSessionId) return;
    try {
      setIsInitWorkflow(true);
      setErrorMessage(null);
      const state = await initMultiStepWorkflow(currentSessionId, userProfileId);
      setWorkflowState(state);
      setWorkflowSelectedFieldIds(new Set()); // All start strictly unapproved
      setSuccessNotice(`Multi-step workflow initialized: ${state.currentStepHeading || 'Step ' + state.currentStepIndex}`);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsInitWorkflow(false);
    }
  };

  const handleToggleWorkflowField = (fieldId: string) => {
    setWorkflowSelectedFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) {
        next.delete(fieldId);
      } else {
        next.add(fieldId);
      }
      return next;
    });
  };

  const handleSelectAllWorkflowFields = () => {
    if (!workflowState) return;
    if (workflowSelectedFieldIds.size === workflowState.currentProposals.length) {
      setWorkflowSelectedFieldIds(new Set());
    } else {
      setWorkflowSelectedFieldIds(new Set(workflowState.currentProposals.map((p) => p.fieldId)));
    }
  };

  const handleExecuteWorkflowStep = async () => {
    if (!currentSessionId || !workflowState) return;
    try {
      setIsExecutingWorkflowStep(true);
      setErrorMessage(null);
      const res = await executeWorkflowStepFields(currentSessionId, {
        approvedFieldIds: Array.from(workflowSelectedFieldIds),
        userProfileId,
      });
      setWorkflowState(res.workflowState);
      setSuccessNotice(`Step ${res.stepIndex} fields populated and verified.`);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsExecutingWorkflowStep(false);
    }
  };

  const handleApproveWorkflowNavigation = async (controlId: string) => {
    if (!currentSessionId || !workflowState) return;
    try {
      setIsAdvancingWorkflowStep(true);
      setErrorMessage(null);
      const res = await approveWorkflowStepNavigation(currentSessionId, controlId, userProfileId);
      setWorkflowState(res.workflowState);
      setWorkflowSelectedFieldIds(new Set()); // New step proposals all start unapproved!
      setSuccessNotice(`Advanced to Step ${res.currentStepIndex}: ${res.newHeading || 'Step ' + res.currentStepIndex}`);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsAdvancingWorkflowStep(false);
    }
  };

  const handleFetchWorkflowHistory = async () => {
    if (!currentSessionId) return;
    try {
      setErrorMessage(null);
      const res = await getWorkflowHistory(currentSessionId);
      setWorkflowHistory(res);
      setShowHistoryTab((prev) => !prev);
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    }
  };

  const handleRecoverWorkflow = async () => {
    if (!currentSessionId) return;
    try {
      setIsRecovering(true);
      setErrorMessage(null);
      const res = await recoverWorkflow(currentSessionId);
      setRecoveryResult(res);
      if (res.workflowState) {
        setWorkflowState(res.workflowState);
      }
      if (res.success) {
        setSuccessNotice(`Workflow recovered successfully: ${res.message}`);
      } else {
        setErrorMessage(`Recovery Alert (${res.reason}): ${res.message}${res.actionRequired ? ' Action: ' + res.actionRequired : ''}`);
      }
    } catch (err: unknown) {
      setErrorMessage(formatErrorMessage(err));
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6">
      {/* 🛡️ Strict Read-Only Safety Banner */}
      <div className="w-full p-4 rounded-2xl bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg backdrop-blur-md">
        <span className="text-xl leading-none select-none">🛡️</span>
        <div className="flex-1">
          <p className="font-semibold text-amber-100">
            Read-only discovery mode. No form fields are filled and no application is submitted.
          </p>
          <p className="text-amber-300/80 mt-1 text-xs">
            This module provides observational DOM inspection and candidate mapping diagnostics.
            Submission buttons, credential storage, file uploads, and auto-apply interactions are strictly prohibited.
          </p>
        </div>
      </div>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950/80 border border-indigo-800/60 text-indigo-300 mb-2">
            <span>🌐</span>
            <span>Milestone 10.3 · Browser Discovery</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Browser Discovery
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Inspect an application page before any browser interaction is performed.
          </p>
        </div>

        {/* Session Status Pill */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                sessionState === 'ACTIVE'
                  ? 'bg-emerald-400 animate-pulse'
                  : sessionState === 'CLOSED'
                  ? 'bg-slate-500'
                  : 'bg-amber-400'
              }`}
            />
            <span className="font-mono text-slate-300 font-medium">
              Session: {sessionState}
            </span>
          </div>

          {currentSessionId && (
            <button
              type="button"
              onClick={handleCloseSession}
              disabled={isAnalyzing}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-800/60 border border-slate-700 text-slate-300 transition-colors disabled:opacity-50"
              title="Close browser session and release context"
            >
              Close Session
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-200 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-slate-400 hover:text-white text-lg leading-none"
          >
            &times;
          </button>
        </div>
      )}

      {successNotice && (
        <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{successNotice}</span>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-slate-400 hover:text-white leading-none"
          >
            &times;
          </button>
        </div>
      )}

      {/* URL Input & Presets Section */}
      <section className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl">
        <form onSubmit={handleAnalyze} className="flex flex-col gap-4">
          <div>
            <label htmlFor="target-url-input" className="block text-sm font-semibold text-slate-200 mb-2">
              Application / Job URL
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                id="target-url-input"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/jobs/apply or http://127.0.0.1:3000/browser/test-page/application"
                disabled={isAnalyzing}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 transition"
              />
              <button
                type="submit"
                disabled={isAnalyzing || !url.trim()}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold shadow-lg shadow-indigo-600/30 transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {isAnalyzing ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    <span>Analyze Page</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Local Deterministic Fixture Presets */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
            <span className="text-xs text-slate-400 font-medium mr-1">Offline Test Fixtures:</span>
            <button
              type="button"
              onClick={() => handleSelectPreset('http://127.0.0.1:3000/browser/test-page/multi-step')}
              className="text-xs px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 hover:text-white border border-emerald-800 transition font-semibold"
            >
              Multi-Step Wizard (M12.1)
            </button>
            <button
              type="button"
              onClick={() => handleSelectPreset('http://127.0.0.1:3000/browser/test-page/autofill')}
              className="text-xs px-2.5 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 hover:text-white border border-indigo-800 transition font-semibold"
            >
              Controlled Autofill (M11)
            </button>
            <button
              type="button"
              onClick={() => handleSelectPreset('http://127.0.0.1:3000/browser/test-page/application')}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
            >
              Application Form (M10.2)
            </button>
            <button
              type="button"
              onClick={() => handleSelectPreset('http://127.0.0.1:3000/browser/test-page/job-description')}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
            >
              Job Posting with Links
            </button>
            <button
              type="button"
              onClick={() => handleSelectPreset('http://127.0.0.1:3000/browser/test-page/aria-labels')}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
            >
              ARIA Form Fixture
            </button>
            <button
              type="button"
              onClick={() => handleSelectPreset('http://127.0.0.1:3000/browser/test-page/non-application')}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
            >
              Non-Application Article
            </button>
          </div>
        </form>
      </section>

      {/* Progress / Loading Stage Indicator */}
      {isAnalyzing && (
        <section className="bg-slate-900/90 border border-indigo-900/60 rounded-2xl p-6 shadow-xl flex flex-col gap-3 animate-fadeIn">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
              </span>
              Analyzing application page...
            </h3>
            <span className="text-xs text-indigo-400 font-mono">
              {STAGE_LABELS[currentStage]}
            </span>
          </div>
          <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
              style={{
                width:
                  currentStage === 'creating_session'
                    ? '15%'
                    : currentStage === 'loading_page'
                    ? '30%'
                    : currentStage === 'inspecting_page'
                    ? '50%'
                    : currentStage === 'detecting_form'
                    ? '70%'
                    : currentStage === 'mapping_fields'
                    ? '85%'
                    : currentStage === 'identifying_missing'
                    ? '95%'
                    : '100%',
              }}
            />
          </div>
          <p className="text-xs text-slate-400 italic">
            Observing and parsing DOM structure only. No fields are filled.
          </p>
        </section>
      )}

      {/* Session Diagnostics Metadata Bar */}
      {analysisResult && (
        <section className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-slate-500">Session ID:</span>{' '}
              <span className="font-mono text-slate-300">{analysisResult.sessionId.slice(0, 8)}...</span>
            </div>
            <div>
              <span className="text-slate-500">Page Title:</span>{' '}
              <span className="font-medium text-slate-200">{analysisResult.page.title || '(No title)'}</span>
            </div>
            <div>
              <span className="text-slate-500">Status:</span>{' '}
              <span className="font-mono text-emerald-400">{analysisResult.page.status || 200} OK</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCaptureScreenshot}
              disabled={isCapturingScreenshot || isAnalyzing}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {isCapturingScreenshot ? (
                <span>Capturing...</span>
              ) : (
                <>
                  <span>📸</span>
                  <span>Capture Screenshot</span>
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {/* Screenshot Result Card (M10.1 Diagnostic) */}
      {screenshotResult && (
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
              <span>✓</span> Screenshot Saved (Playwright M10.1)
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {new Date(screenshotResult.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-slate-300 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Stored Path:</span>
              <span className="text-indigo-300">{screenshotResult.path}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Screenshot ID:</span>
              <span className="text-slate-400">{screenshotResult.screenshotId}</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Stored securely on server disk at controlled path. No public URL exposed.
          </p>
        </div>
      )}

      {/* Discovery Analysis Results */}
      {analysisResult && (
        <div className="flex flex-col gap-6">
          {/* Top Row: Application Detection Card & Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Step 6: Application Page YES/NO Card */}
            <div className="md:col-span-2 bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                    Application Page Detection
                  </h3>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide border ${
                      analysisResult.application.isApplicationPage
                        ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    {analysisResult.application.isApplicationPage ? 'YES — APPLICATION PAGE' : 'NO — GENERAL PAGE'}
                  </span>
                </div>

                <div className="flex items-baseline gap-3 mb-4">
                  <span className="text-4xl font-extrabold text-white">
                    {Math.round(analysisResult.application.confidence * 100)}%
                  </span>
                  <span className="text-sm text-slate-400">detection confidence</span>
                </div>

                {/* Signals detected */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-slate-400">Detection Signals:</span>
                  {analysisResult.application.signals.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {analysisResult.application.signals.map((sig, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-emerald-300/90 text-xs flex items-center gap-1.5"
                        >
                          <span className="text-emerald-400">✓</span>
                          <span>{sig}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 italic">No application signals detected.</span>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-800/60 text-xs text-slate-500">
                Confidence heuristic evaluates form actions, input roles (resume/email/phone), and page keywords.
              </div>
            </div>

            {/* Quick Metrics Card */}
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">
                Discovered Structure
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                  <span className="text-2xl font-bold text-white block">
                    {analysisResult.forms.length}
                  </span>
                  <span className="text-xs text-slate-400">Forms</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                  <span className="text-2xl font-bold text-white block">
                    {analysisResult.fields.length}
                  </span>
                  <span className="text-xs text-slate-400">Fields</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                  <span className="text-2xl font-bold text-indigo-400 block">
                    {analysisResult.candidateMappings.length}
                  </span>
                  <span className="text-xs text-slate-400">Candidate Mappings</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                  <span
                    className={`text-2xl font-bold block ${
                      analysisResult.missingInformation.length > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {analysisResult.missingInformation.length}
                  </span>
                  <span className="text-xs text-slate-400">Missing Required</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/60 text-xs text-slate-500">
                Buttons discovered: {analysisResult.buttons.length} | Links: {analysisResult.targets.length}
              </div>
            </div>
          </div>

          {/* ============================================================== */}
          {/* MILESTONE 11: CONTROLLED AUTOFILL PREVIEW & HUMAN APPROVAL      */}
          {/* ============================================================== */}
          <section className="bg-slate-900/90 backdrop-blur-xl border border-indigo-900/60 rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-indigo-950">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-950 border border-indigo-800 text-indigo-300 mb-1">
                  <span>⚡</span>
                  <span>Milestone 11 · Controlled Autofill Preview</span>
                </div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Candidate Autofill Proposal &amp; Human Approval
                </h3>
                <p className="text-xs text-slate-400">
                  Select candidate fields you authorize to be populated. The browser stops after filling — submission is NEVER performed.
                </p>
              </div>

              {!autofillProposal && (
                <button
                  type="button"
                  onClick={handleGenerateProposal}
                  disabled={isGeneratingProposal || isAnalyzing}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition disabled:opacity-50 flex items-center gap-2 whitespace-nowrap self-start sm:self-center"
                >
                  {isGeneratingProposal ? (
                    <span>Generating Preview...</span>
                  ) : (
                    <>
                      <span>✨</span>
                      <span>Generate Autofill Proposal</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Proposal Fields List & Checkboxes */}
            {autofillProposal && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="font-semibold text-slate-200">
                    Proposed Fields ({autofillProposal.proposals.length} available for approval):
                  </span>
                  <span className="text-indigo-400 font-mono">
                    {selectedFieldIds.size} of {autofillProposal.proposals.length} selected
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {autofillProposal.proposals.map((prop) => {
                    const isSelected = selectedFieldIds.has(prop.fieldId);

                    return (
                      <label
                        key={prop.fieldId}
                        className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition select-none ${
                          isSelected
                            ? 'bg-indigo-950/40 border-indigo-600 shadow-sm'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleField(prop.fieldId)}
                          disabled={isPopulating}
                          className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div className="flex-1 text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-slate-200 text-sm">
                              {prop.label || prop.fieldName || prop.fieldId}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                              {prop.fieldType}
                            </span>
                          </div>

                          <div className="text-slate-400 flex items-center gap-1.5 mb-1.5">
                            <span className="text-slate-500">Source:</span>
                            <span className="font-mono text-indigo-300">{prop.candidateSource}</span>
                          </div>

                          <div className="p-2 rounded bg-slate-900/90 border border-slate-800/80 font-mono text-[11px] text-slate-300 truncate">
                            <span className="text-slate-500 mr-1.5">Value:</span>
                            <span className="text-emerald-300">{prop.displayValue}</span>
                          </div>

                          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                            <span>Confidence: {Math.round(prop.confidence * 100)}%</span>
                            <span className="font-mono">ID: {prop.fieldId}</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Approval Trigger Action Bar */}
                <div className="mt-2 pt-4 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">
                    Only checked fields will be populated into the browser.
                  </p>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleGenerateProposal}
                      disabled={isPopulating}
                      className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                    >
                      Refresh Proposal
                    </button>
                    <button
                      type="button"
                      onClick={handleApproveAndAutofill}
                      disabled={isPopulating || selectedFieldIds.size === 0}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                    >
                      {isPopulating ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>Populating {selectedFieldIds.size} Fields...</span>
                        </>
                      ) : (
                        <>
                          <span>✓</span>
                          <span>Approve {selectedFieldIds.size} Selected Fields</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* M11 Autofill Execution Results & Strict Stop Banner */}
            {autofillResult && (
              <div className="mt-4 pt-4 border-t border-indigo-950 flex flex-col gap-4 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${
                        autofillResult.state === 'COMPLETED'
                          ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                          : autofillResult.state === 'PARTIAL'
                          ? 'bg-amber-950 border-amber-800 text-amber-300'
                          : 'bg-rose-950 border-rose-800 text-rose-300'
                      }`}
                    >
                      AUTOFILL {autofillResult.state}
                    </span>
                    <span className="text-xs text-slate-400">
                      Completed at {new Date(autofillResult.completedAt).toLocaleTimeString()}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleReverify}
                    disabled={isVerifying}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5"
                  >
                    <span>🔄</span>
                    <span>Re-verify Fields</span>
                  </button>
                </div>

                {/* CRITICAL SAFETY BANNER (STEP 16) */}
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg">
                  <span className="text-2xl leading-none select-none">🛑</span>
                  <div>
                    <h4 className="font-bold text-rose-100 text-sm">
                      Autofill complete. No application was submitted.
                    </h4>
                    <p className="text-rose-300/90 mt-1 text-xs">
                      The browser page remains in the verified state. Submit, Apply, and Continue buttons are NEVER clicked by the agent.
                    </p>
                  </div>
                </div>

                {/* Per-Field Results Breakdown */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                        <th className="py-2 px-3">Field</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">Verified Value</th>
                        <th className="py-2 px-3">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {autofillResult.results.map((res) => (
                        <tr key={res.fieldId} className="hover:bg-slate-800/30 transition">
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-slate-200">{res.fieldName || res.fieldId}</span>
                            <span className="block text-[10px] text-slate-500 font-sans">{res.fieldType}</span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                res.status === 'SUCCESS'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  : res.status === 'SKIPPED'
                                  ? 'bg-slate-800 text-slate-400'
                                  : res.status === 'FORBIDDEN'
                                  ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                  : 'bg-amber-950 text-amber-300 border border-amber-800'
                              }`}
                            >
                              {res.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">
                            {res.verifiedValue !== undefined ? String(res.verifiedValue) : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-sans text-slate-400 text-xs">
                            {res.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Validation Diagnostics (Step 11) */}
                {autofillResult.validation.errors.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/60 text-xs">
                    <span className="font-bold text-amber-300 block mb-1">
                      Validation Diagnostics Detected:
                    </span>
                    <ul className="list-disc list-inside text-amber-200/90 space-y-0.5">
                      {autofillResult.validation.errors.map((err, i) => (
                        <li key={i}>
                          <strong className="font-mono">{err.fieldId}</strong>: {err.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Milestone 12.1: Multi-Step Navigation & Step Tracking */}
          <section className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 mb-1">
                  <span>🧭</span>
                  <span>Milestone 12.1 · Multi-Step Navigation Foundation</span>
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Application Step Navigation & Control Detection
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Controlled step progression with strict human approval. Final submission is strictly non-executable.
                </p>
              </div>

              <button
                type="button"
                onClick={handleDiscoverNavigation}
                disabled={isDiscoveringNav || isNavigating}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap self-start sm:self-auto"
              >
                {isDiscoveringNav ? (
                  <span>Discovering Steps...</span>
                ) : (
                  <>
                    <span>🧭</span>
                    <span>{navigationState ? 'Refresh Navigation State' : 'Discover Navigation Steps'}</span>
                  </>
                )}
              </button>
            </div>

            {navigationState && navigationState.currentStep && (
              <div className="flex flex-col gap-4">
                {/* Current Step Banner */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700/60 text-emerald-300 text-xs font-bold font-mono">
                        STEP {navigationState.currentStep.stepIndex}
                      </span>
                      <span className="text-xs text-slate-400">
                        Status: <span className="font-semibold text-slate-200">{navigationState.status}</span>
                      </span>
                    </div>
                    <h4 className="text-base font-bold text-white">
                      {navigationState.currentStep.heading || navigationState.currentStep.title}
                    </h4>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      URL: {navigationState.currentStep.url}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-medium text-slate-300">
                    <div>
                      <span className="text-slate-500">Interactive Fields:</span>{' '}
                      <span className="font-bold text-white">{navigationState.currentStep.discoveredFieldCount}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Required:</span>{' '}
                      <span className="font-bold text-amber-300">{navigationState.currentStep.requiredFieldCount}</span>
                    </div>
                  </div>
                </div>

                {/* Terminal Control Detected Banner */}
                {navigationState.terminalControlDetected && (
                  <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 text-amber-200 flex items-start gap-3 shadow-lg">
                    <span className="text-xl leading-none select-none">🛡️</span>
                    <div>
                      <h5 className="font-bold text-amber-100 text-xs sm:text-sm">
                        Sensitive Terminal Action Detected (Submit / Apply)
                      </h5>
                      <p className="text-amber-300/90 text-xs mt-1">
                        A final application submission button was detected on this page. By safety policy, terminal submission buttons are NEVER executable by M12.1.
                      </p>
                    </div>
                  </div>
                )}

                {/* Detected Controls & Explicit Human Approval */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-slate-300">
                    Detected Step Navigation Controls:
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {navigationState.currentStep.controls.map((ctrl) => (
                      <div
                        key={ctrl.id}
                        className={`p-3.5 rounded-xl border flex flex-col justify-between gap-3 ${
                          ctrl.isTerminal
                            ? 'bg-rose-950/20 border-rose-800/60'
                            : 'bg-slate-950 border-slate-800'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                ctrl.isTerminal
                                  ? 'bg-rose-900/60 text-rose-300 border border-rose-700/60'
                                  : ctrl.type === 'NEXT' || ctrl.type === 'CONTINUE'
                                  ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {ctrl.type}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">
                              {ctrl.direction}
                            </span>
                          </div>

                          <h5 className="text-sm font-bold text-white mb-0.5">
                            "{ctrl.label}"
                          </h5>
                          <span className="text-[11px] text-slate-400 font-mono">
                            ID: {ctrl.id}
                          </span>
                        </div>

                        {ctrl.isExecutable ? (
                          <button
                            type="button"
                            onClick={() => handleApproveNavigation(ctrl.id)}
                            disabled={isNavigating}
                            className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-md shadow-emerald-600/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                          >
                            {isNavigating ? (
                              <span>Navigating...</span>
                            ) : (
                              <>
                                <span>✓</span>
                                <span>Approve & Navigate</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <div className="py-2 px-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-500 text-center font-medium">
                            {ctrl.isTerminal ? 'Forbidden (Terminal Control)' : 'Non-Executable'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Visited Steps History Timeline */}
                {navigationState.visitedSteps.length > 0 && (
                  <div className="mt-2 pt-4 border-t border-slate-800 flex flex-col gap-2">
                    <span className="text-xs font-semibold text-slate-400">
                      Step Progression History ({navigationState.visitedSteps.length} previous steps):
                    </span>
                    <div className="space-y-2">
                      {navigationState.visitedSteps.map((step) => (
                        <div
                          key={step.stepId}
                          className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-emerald-400 font-bold">Step {step.stepIndex}</span>
                            <span className="text-slate-300">{step.heading || step.title}</span>
                          </div>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {step.completed ? 'Completed' : 'Visited'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Milestone 12.2 & 12.3: Multi-Step Workflow Orchestration & Durable Recovery */}
          <section className="bg-slate-900/90 backdrop-blur-xl border border-indigo-900/40 rounded-2xl p-6 shadow-xl flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-950/90 border border-indigo-700/80 text-indigo-300 mb-1">
                  <span>🔄</span>
                  <span>Milestones 12.2 & 12.3 · Multi-Step Workflow & Durable Recovery</span>
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Coordinated Multi-Step Form Autofill & Safe Recovery
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Safely orchestrate per-step autofill proposals, explicit human approvals, durable persistence, and API restart recovery.
                </p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                <button
                  type="button"
                  onClick={handleInitWorkflow}
                  disabled={isInitWorkflow || !currentSessionId}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isInitWorkflow ? (
                    <span>Initializing...</span>
                  ) : (
                    <>
                      <span>🚀</span>
                      <span>{workflowState ? 'Restart Workflow' : 'Initialize Workflow (M12.2)'}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleRecoverWorkflow}
                  disabled={isRecovering || !currentSessionId}
                  className="px-3.5 py-2 rounded-xl bg-amber-600/90 hover:bg-amber-500 text-white text-xs font-bold shadow-lg shadow-amber-600/20 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isRecovering ? (
                    <span>Reconciling...</span>
                  ) : (
                    <>
                      <span>🛡️</span>
                      <span>Safe Recovery (M12.3)</span>
                    </>
                  )}
                </button>

                {workflowState && (
                  <button
                    type="button"
                    onClick={handleFetchWorkflowHistory}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5"
                  >
                    <span>📜</span>
                    <span>{showHistoryTab ? 'Hide History' : 'Step History'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Recovery Diagnostics Alert Banner (M12.3) */}
            {recoveryResult && (
              <div
                className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-md ${
                  recoveryResult.success
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                    : recoveryResult.recoveryStatus === 'REQUIRES_INTERVENTION'
                    ? 'bg-rose-950/40 border-rose-800/80 text-rose-200'
                    : 'bg-amber-950/40 border-amber-800/80 text-amber-200'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-base leading-none">
                    {recoveryResult.success ? '🛡️' : '⚠️'}
                  </span>
                  <div>
                    <div className="font-bold">
                      Recovery Status: {recoveryResult.recoveryStatus} ({recoveryResult.reason})
                    </div>
                    <div className="text-[11px] opacity-90 mt-0.5">{recoveryResult.message}</div>
                    {recoveryResult.actionRequired && (
                      <div className="text-[11px] font-semibold mt-1 text-white">
                        Action Required: {recoveryResult.actionRequired}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      recoveryResult.canResume ? 'bg-emerald-900 text-emerald-300' : 'bg-rose-900 text-rose-300'
                    }`}
                  >
                    {recoveryResult.canResume ? 'Ready to Proceed' : 'Progression Blocked'}
                  </span>
                </div>
              </div>
            )}

            {workflowState && (
              <div className="flex flex-col gap-6">
                {/* Stepper Progress Bar */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-900/60 border border-indigo-700/60 text-indigo-300 text-xs font-bold font-mono">
                        STEP {workflowState.currentStepIndex}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300">
                        Status: <span className="text-indigo-300">{workflowState.status}</span>
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-400 bg-slate-900 border border-slate-800">
                        v{workflowState.version || 1}
                      </span>
                      {workflowState.recoveryStatus && (
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            workflowState.recoveryStatus === 'RECOVERED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}
                        >
                          {workflowState.recoveryStatus}
                        </span>
                      )}
                    </div>
                    <h4 className="text-base font-bold text-white">
                      {workflowState.currentStepHeading || `Step ${workflowState.currentStepIndex}`}
                    </h4>
                    <p className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-xl">
                      {workflowState.currentUrl}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-medium text-slate-300 flex-wrap">
                    <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-500">Step Fields:</span>{' '}
                      <span className="font-bold text-white">{workflowState.discoveredFields.length}</span>
                    </div>
                    <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-500">Verified Filled:</span>{' '}
                      <span className="font-bold text-emerald-400">{workflowState.progress.currentStepFilledCount}</span>
                    </div>
                    <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-500">Missing Required:</span>{' '}
                      <span className={`font-bold ${workflowState.progress.currentStepMissingRequiredCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {workflowState.progress.currentStepMissingRequiredCount}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Terminal Control Detected Banner */}
                {workflowState.terminalControlDetected && (
                  <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/80 text-rose-200 flex items-start gap-3 shadow-lg">
                    <span className="text-xl leading-none select-none">🛑</span>
                    <div>
                      <h5 className="font-bold text-rose-100 text-xs sm:text-sm">
                        Terminal Application Action Detected (Submit / Apply)
                      </h5>
                      <p className="text-rose-300/90 text-xs mt-1">
                        A final application submission button is present on this step. Terminal controls are strictly non-executable by AI Job Agent. The candidate must complete the final review and manual submission directly.
                      </p>
                    </div>
                  </div>
                )}

                {/* Step Field Proposals & Approval */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>📝</span>
                        <span>Current Step Proposed Fields ({workflowState.currentProposals.length})</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Select which candidate fields to populate for this step. Every field requires explicit human approval.
                      </p>
                    </div>

                    {workflowState.currentProposals.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSelectAllWorkflowFields}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                        >
                          {workflowSelectedFieldIds.size === workflowState.currentProposals.length ? 'Deselect All' : 'Select All'}
                        </button>
                        <button
                          type="button"
                          onClick={handleExecuteWorkflowStep}
                          disabled={isExecutingWorkflowStep || workflowSelectedFieldIds.size === 0}
                          className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-md shadow-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                          {isExecutingWorkflowStep ? (
                            <span>Populating & Verifying...</span>
                          ) : (
                            <>
                              <span>✓</span>
                              <span>Populate & Verify ({workflowSelectedFieldIds.size})</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {workflowState.currentProposals.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 font-semibold">
                            <th className="py-2.5 px-3 w-10 text-center">Approve</th>
                            <th className="py-2.5 px-3">Field</th>
                            <th className="py-2.5 px-3">Type</th>
                            <th className="py-2.5 px-3">Proposed Value</th>
                            <th className="py-2.5 px-3">Source</th>
                            <th className="py-2.5 px-3 text-right">Result</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {workflowState.currentProposals.map((prop) => {
                            const isSelected = workflowSelectedFieldIds.has(prop.fieldId);
                            const result = workflowState.lastExecutionResults.find((r) => r.fieldId === prop.fieldId);
                            return (
                              <tr
                                key={prop.fieldId}
                                className={`transition-colors hover:bg-slate-900/40 ${isSelected ? 'bg-indigo-950/20' : ''}`}
                              >
                                <td className="py-2.5 px-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleWorkflowField(prop.fieldId)}
                                    className="h-4 w-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900 cursor-pointer"
                                  />
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-200">{prop.label || prop.fieldName}</div>
                                  <div className="text-[10px] font-mono text-slate-500">id: {prop.fieldId}</div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-800 text-slate-300">
                                    {prop.fieldType}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-mono text-indigo-300 font-medium truncate max-w-xs">
                                    {prop.displayValue || String(prop.proposedValue)}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="text-slate-400 text-[11px]">{prop.candidateSource}</span>
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  {result ? (
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        result.status === 'SUCCESS'
                                          ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                                          : result.status === 'SKIPPED'
                                          ? 'bg-slate-800 text-slate-400'
                                          : 'bg-rose-950 border border-rose-800 text-rose-300'
                                      }`}
                                    >
                                      {result.status}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-600 font-mono">Unfilled</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400">
                      No mappable input fields detected on this step (e.g. confirmation, review summary, or document upload step).
                    </div>
                  )}
                </div>

                {/* Separate Step Navigation Controls */}
                <div className="flex flex-col gap-3 pt-4 border-t border-slate-800">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>🧭</span>
                      <span>Approved Step Navigation</span>
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Advance to the next step once you have reviewed the verified fields above.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {workflowState.availableNavigationControls.map((ctrl) => (
                      <div
                        key={ctrl.id}
                        className={`p-3.5 rounded-xl border flex flex-col justify-between gap-3 ${
                          ctrl.isTerminal
                            ? 'bg-rose-950/20 border-rose-800/60'
                            : 'bg-slate-950 border-slate-800'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                ctrl.isTerminal
                                  ? 'bg-rose-900/60 text-rose-300 border border-rose-700/60'
                                  : ctrl.type === 'NEXT' || ctrl.type === 'CONTINUE'
                                  ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {ctrl.type}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">{ctrl.direction}</span>
                          </div>
                          <h5 className="text-sm font-bold text-white mb-0.5">"{ctrl.label}"</h5>
                          <span className="text-[11px] text-slate-400 font-mono">ID: {ctrl.id}</span>
                        </div>

                        {ctrl.isExecutable ? (
                          <button
                            type="button"
                            onClick={() => handleApproveWorkflowNavigation(ctrl.id)}
                            disabled={isAdvancingWorkflowStep}
                            className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md shadow-indigo-600/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                          >
                            {isAdvancingWorkflowStep ? (
                              <span>Advancing Step...</span>
                            ) : (
                              <>
                                <span>➡️</span>
                                <span>Approve & Advance Step</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <div className="py-2 px-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-rose-400 text-center font-medium">
                            {ctrl.isTerminal ? 'Forbidden (Submit Control)' : 'Non-Executable'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cumulative Step History */}
                {showHistoryTab && workflowHistory && (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <span className="text-xs font-bold text-slate-200">
                        Cumulative Step Progression History ({workflowHistory.totalStepsCompleted} steps completed)
                      </span>
                      <span className="text-[11px] text-emerald-400 font-mono">applicationSubmitted = false</span>
                    </div>

                    <div className="space-y-3">
                      {workflowHistory.stepHistory.map((step) => (
                        <div
                          key={step.stepId}
                          className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col gap-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-mono font-bold">
                                STEP {step.stepIndex}
                              </span>
                              <span className="font-semibold text-white">{step.stepHeading || 'Step'}</span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {step.completed ? '✓ Completed' : 'Active'}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-400">
                            Filled: {step.executionResults.filter((r) => r.status === 'SUCCESS').length} fields | Discovered: {step.discoveredFieldCount} fields
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Step 10: Missing Candidate Information (High Prominence) */}
          <section className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>⚠️</span>
                <span>Information Required But Not Available</span>
              </h3>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {analysisResult.missingInformation.length} missing
              </span>
            </div>

            {analysisResult.missingInformation.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {analysisResult.missingInformation.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-800/50 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm text-amber-200">
                          {item.label || item.fieldName || item.fieldId}
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300">
                          REQUIRED
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{item.reason}</p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-amber-900/30 text-[11px] font-mono text-slate-500">
                      ID: {item.fieldId}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/50 text-emerald-300 text-sm flex items-center gap-2">
                <span>✓</span>
                <span>All detected required fields have candidate data available.</span>
              </div>
            )}
          </section>

          {/* Step 9: Candidate Field Mapping Visualization */}
          <section className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>🔄</span>
                  <span>Candidate Data Mappings</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Read-only candidate profile associations. No fields are filled.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {analysisResult.candidateMappings.length} mapped
              </span>
            </div>

            {analysisResult.candidateMappings.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysisResult.candidateMappings.map((map, idx) => {
                  const confPct = Math.round(map.confidence * 100);
                  const confBadgeClass =
                    confPct >= 80
                      ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
                      : confPct >= 50
                      ? 'bg-amber-950/60 border-amber-800/80 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400';

                  return (
                    <div
                      key={idx}
                      className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/60 text-indigo-300 font-mono text-xs font-semibold">
                            {map.candidateSource}
                          </span>
                          <span className="text-slate-500 text-xs">➔</span>
                          <span className="font-semibold text-sm text-slate-200">
                            {map.label || map.fieldName || map.fieldId}
                          </span>
                        </div>
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${confBadgeClass}`}>
                          {confPct}% confidence
                        </span>
                      </div>

                      <div className="text-xs text-slate-400 flex items-center justify-between">
                        <span>{map.reason}</span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          ID: {map.fieldId}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-2">
                No automatic candidate field mappings identified for this form.
              </p>
            )}
          </section>

          {/* Step 7: Discovered Forms */}
          <section className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>📋</span>
                  <span>Discovered Forms</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Structural form definitions. Action URLs shown for diagnostic purposes only.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {analysisResult.forms.length} forms
              </span>
            </div>

            {analysisResult.forms.length > 0 ? (
              <div className="flex flex-col gap-3">
                {analysisResult.forms.map((form) => {
                  const isExpanded = activeFormIndex === form.index;

                  return (
                    <div
                      key={form.index}
                      className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 transition"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-xs font-mono font-bold text-slate-200">
                            Form #{form.index + 1}
                          </span>
                          <span className="font-semibold text-sm text-slate-200">
                            {form.name || form.id || 'Unnamed Form'}
                          </span>
                          <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-indigo-400">
                            {form.method?.toUpperCase()}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span>
                            Fields: <strong className="text-white">{form.fieldCount}</strong> (
                            <strong className="text-amber-400">{form.requiredFieldCount}</strong> req)
                          </span>
                          <span>
                            Buttons: <strong className="text-white">{form.buttonCount}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveFormIndex(isExpanded ? null : form.index)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium ml-2"
                          >
                            {isExpanded ? 'Hide details' : 'Show details'}
                          </button>
                        </div>
                      </div>

                      {/* Expandable Form Diagnostic Details */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-400 flex flex-col gap-1.5 font-mono">
                          <div>
                            <span className="text-slate-500">ID:</span> {form.id || '(none)'}
                          </div>
                          <div>
                            <span className="text-slate-500">Action:</span>{' '}
                            <span className="text-slate-300">
                              {form.action || '(default)'} (Submission disabled)
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Aria Label:</span> {form.ariaLabel || '(none)'}
                          </div>
                          {form.surroundingHeading && (
                            <div>
                              <span className="text-slate-500">Surrounding Heading:</span>{' '}
                              <span className="text-slate-300">{form.surroundingHeading}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-2">
                No &lt;form&gt; elements detected on this page.
              </p>
            )}
          </section>

          {/* Step 8: Discovered Fields Table */}
          <section className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>🔤</span>
                  <span>Discovered Fields</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Only field metadata and resolved labels are displayed. Actual input values are never shown.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {analysisResult.fields.length} fields
              </span>
            </div>

            {analysisResult.fields.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                      <th className="py-2.5 px-3">Field</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Resolved Label</th>
                      <th className="py-2.5 px-3">Required</th>
                      <th className="py-2.5 px-3">Mapping</th>
                      <th className="py-2.5 px-3">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {analysisResult.fields.map((field) => {
                      const mapping = analysisResult.candidateMappings.find(
                        (m) => m.fieldId === field.id || (field.name && m.fieldName === field.name)
                      );
                      const isMissing = analysisResult.missingInformation.some(
                        (m) => m.fieldId === field.id || (field.name && m.fieldName === field.name)
                      );

                      return (
                        <tr key={field.index} className="hover:bg-slate-800/30 transition">
                          {/* Field identifier */}
                          <td className="py-3 px-3">
                            <span className="font-semibold text-slate-200">
                              {field.name || field.id || `field_${field.index}`}
                            </span>
                            <span className="block text-[11px] text-slate-500 font-sans">
                              &lt;{field.tag}&gt;
                            </span>
                          </td>

                          {/* Type */}
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] font-bold">
                              {field.type}
                            </span>
                            {field.type === 'FILE' && (
                              <span className="block text-[10px] text-amber-400/90 font-sans mt-0.5">
                                File input detected (Upload disabled)
                              </span>
                            )}
                          </td>

                          {/* Resolved Label */}
                          <td className="py-3 px-3 font-sans text-slate-300">
                            {field.label || (
                              <span className="text-slate-600 italic">(No label resolved)</span>
                            )}
                            {field.labelSource && (
                              <span className="block text-[10px] text-slate-500 font-mono mt-0.5">
                                Source: {field.labelSource}
                              </span>
                            )}
                          </td>

                          {/* Required */}
                          <td className="py-3 px-3">
                            {field.required ? (
                              <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-800 text-rose-300 text-[10px] font-bold">
                                YES
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-500 text-[10px]">
                                NO
                              </span>
                            )}
                          </td>

                          {/* Candidate Mapping */}
                          <td className="py-3 px-3">
                            {mapping ? (
                              <span className="px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/60 text-indigo-300 text-[11px] font-semibold">
                                {mapping.candidateSource}
                              </span>
                            ) : isMissing ? (
                              <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-300 text-[11px]">
                                Missing
                              </span>
                            ) : (
                              <span className="text-slate-600 text-[11px]">—</span>
                            )}
                          </td>

                          {/* Confidence */}
                          <td className="py-3 px-3">
                            {mapping ? (
                              <span className="text-emerald-400 font-bold">
                                {Math.round(mapping.confidence * 100)}%
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-2">
                No form fields detected on this page.
              </p>
            )}
          </section>

          {/* Step 11: Discovered Application Links */}
          <section className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>🔗</span>
                  <span>Discovered Application Links</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  External portal links or application CTAs identified on the page.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {analysisResult.targets.length} links
              </span>
            </div>

            {/* Safety notice for links */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 mb-4 flex items-center gap-2">
              <span className="text-slate-500">ℹ️</span>
              <span>Discovered links are shown for inspection only — not opened automatically.</span>
            </div>

            {analysisResult.targets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analysisResult.targets.map((tgt, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-slate-200">
                        "{tgt.text}"
                      </span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/60 text-indigo-300">
                        {Math.round(tgt.confidence * 100)}% match
                      </span>
                    </div>

                    <div className="font-mono text-xs text-slate-400 truncate">
                      {tgt.url}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px]">
                      <span className="text-slate-500">{tgt.type}</span>
                      <button
                        type="button"
                        onClick={() => handleSelectPreset(tgt.url)}
                        className="text-indigo-400 hover:text-indigo-300 font-semibold"
                      >
                        Inspect this target ➔
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-2">
                No external application links or portal buttons detected.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
export default BrowserDiscovery;
