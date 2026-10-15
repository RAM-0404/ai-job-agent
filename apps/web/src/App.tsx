import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  HealthCheckResponse,
  UserProfileResponse,
  UpdateProfileRequest,
  ResumeResponse,
  ResumeListResponse,
  ResumeAnalysisResponse,
} from '@ai-job-agent/shared';
import { getProfile, updateProfile } from './api/profile';
import { uploadResume, getResumes, getResumeText, analyzeResume } from './api/resume';
import { JobDiscovery } from './components/JobDiscovery';
import { JobMatches } from './components/JobMatches';
import { Applications } from './components/Applications';
import { BrowserDiscovery } from './pages/BrowserDiscovery';

type ApiStatus = 'checking' | 'connected' | 'disconnected';
type ActiveTab = 'jobs' | 'matches' | 'applications' | 'discovery' | 'profile';

export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<ActiveTab>('jobs');
  const [selectedJobForApplication, setSelectedJobForApplication] = useState<string | null>(null);
  const [selectedApplicationForWorkspace, setSelectedApplicationForWorkspace] = useState<string | null>(null);

  const handleStartApplication = (jobId: string) => {
    setSelectedJobForApplication(jobId);
    setActiveTab('applications');
  };

  const handleOpenApplication = (applicationId: string) => {
    setSelectedApplicationForWorkspace(applicationId);
    setActiveTab('applications');
  };

  // System Health State
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Profile State
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [profileForm, setProfileForm] = useState<UpdateProfileRequest>({
    fullName: '',
    email: '',
    phone: '',
    currentTitle: '',
    yearsOfExperience: 0,
    professionalSummary: '',
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Resume State
  const [resumes, setResumes] = useState<ResumeResponse[]>([]);
  const [latestResume, setLatestResume] = useState<ResumeResponse | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewingText, setViewingText] = useState<{ fileName: string; version: number; text: string } | null>(null);
  const [isLoadingText, setIsLoadingText] = useState(false);

  // AI Analysis State (Milestone 5)
  const [analyzingResumeId, setAnalyzingResumeId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<ResumeAnalysisResponse | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // 1. Check System Health
  const checkHealth = useCallback(async () => {
    setApiStatus('checking');
    setErrorMessage(null);

    try {
      const response = await fetch(`${apiUrl}/health`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      const data: HealthCheckResponse = await response.json();
      if (data && (data.status === 'ok' || data.status === 'degraded')) {
        setHealthData(data);
        setApiStatus('connected');
      } else {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
    } catch (error) {
      setHealthData(null);
      setApiStatus('disconnected');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to reach API server');
    } finally {
      setLastChecked(new Date().toLocaleTimeString());
    }
  }, [apiUrl]);

  // 2. Fetch User Profile
  const fetchProfile = useCallback(async () => {
    try {
      const data = await getProfile();
      if (data) {
        setProfile(data);
        setProfileForm({
          fullName: data.fullName || '',
          email: data.email || '',
          phone: data.phone || '',
          currentTitle: data.currentTitle || '',
          yearsOfExperience: data.yearsOfExperience || 0,
          professionalSummary: data.professionalSummary || '',
        });
      }
    } catch (err: unknown) {
      console.error('Failed to fetch profile', err);
    }
  }, []);

  // 3. Fetch Resume History
  const fetchResumes = useCallback(async () => {
    try {
      const data: ResumeListResponse = await getResumes();
      setResumes(data.resumes || []);
      setLatestResume(data.latestResume || null);
    } catch (err: unknown) {
      console.error('Failed to fetch resumes', err);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    fetchProfile();
    fetchResumes();
  }, [checkHealth, fetchProfile, fetchResumes]);

  // Handle Profile Save
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileMessage(null);

    try {
      const updated = await updateProfile(profileForm);
      setProfile(updated);
      setProfileMessage({ type: 'success', text: 'Profile saved successfully!' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save profile';
      setProfileMessage({ type: 'error', text: msg });
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Handle File Upload
  const handleFileSelect = async (file: File) => {
    const extension = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'docx'].includes(extension)) {
      setResumeMessage({
        type: 'error',
        text: `Invalid file format: ".${extension}". Only PDF and DOCX files are allowed.`,
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setResumeMessage({
        type: 'error',
        text: `File too large (${(file.size / (1024 * 1024)).toFixed(2)} MB). Maximum allowed size is 10 MB.`,
      });
      return;
    }

    setIsUploadingResume(true);
    setResumeMessage(null);

    try {
      const uploaded = await uploadResume(file);
      setResumeMessage({
        type: 'success',
        text: `Resume "${uploaded.fileName}" uploaded successfully as Version ${uploaded.version}!`,
      });
      await fetchResumes();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setResumeMessage({ type: 'error', text: msg });
    } finally {
      setIsUploadingResume(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // View Extracted Text
  const handleViewText = async (resume: ResumeResponse) => {
    setIsLoadingText(true);
    try {
      const res = await getResumeText(resume.id);
      setViewingText({
        fileName: res.fileName,
        version: res.version,
        text: res.rawText || 'No text extracted from document.',
      });
    } catch (err) {
      console.error('Failed to view resume text', err);
    } finally {
      setIsLoadingText(false);
    }
  };

  // AI Resume Analysis Handler (Milestone 5)
  const handleAnalyzeResume = async (resumeId: string) => {
    if (analyzingResumeId) return;

    setAnalyzingResumeId(resumeId);
    setAnalysisMessage(null);

    try {
      const res = await analyzeResume(resumeId);
      setAnalysisResult(res);
      setAnalysisMessage({
        type: 'success',
        text: `Resume analyzed successfully! Extracted ${res.counts.skills} skills, ${res.counts.experience} experiences, and ${res.counts.education} education records. Profile updated.`,
      });
      // Refresh profile data to reflect AI-extracted summary and title
      await fetchProfile();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI analysis failed';
      setAnalysisMessage({
        type: 'error',
        text: `Analysis failed: ${msg}`,
      });
    } finally {
      setAnalyzingResumeId(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-6 selection:bg-indigo-500 selection:text-white">
      {/* Background ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/3 -translate-y-1/2 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      <main className={`relative z-10 w-full ${activeTab === 'profile' ? 'max-w-4xl' : 'max-w-6xl'} mx-auto flex flex-col items-center transition-all duration-200`}>
        {/* App Header */}
        <header className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 mb-3 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Milestone 10.3 · Browser Discovery UI (Read-Only)
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-2">
            AI Job Agent
          </h1>
          <p className="text-base text-slate-400 font-normal">
            Local-first AI-powered job discovery, matching, and human-in-the-loop application assistant.
          </p>
        </header>

        {/* Navigation Tabs */}
        <div className="w-full flex items-center justify-center gap-3 mb-6 p-1.5 bg-slate-900/80 border border-slate-800 rounded-2xl backdrop-blur-xl shadow-lg">
          <button
            type="button"
            onClick={() => setActiveTab('jobs')}
            className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
              activeTab === 'jobs'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <span className="text-base">💼</span>
            <span>Job Discovery</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('matches')}
            className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
              activeTab === 'matches'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <span className="text-base">🎯</span>
            <span>AI Matches</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('applications')}
            className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
              activeTab === 'applications'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <span className="text-base">📝</span>
            <span>Applications</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('discovery')}
            className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
              activeTab === 'discovery'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <span className="text-base">🌐</span>
            <span>Browser Discovery</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`flex-1 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
              activeTab === 'profile'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <span className="text-base">👤</span>
            <span>Profile &amp; Resumes</span>
          </button>
        </div>

        {/* 1. System Status Section */}
        <section
          aria-label="System Status"
          className="w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl mb-8"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
            <h2 className="text-lg font-bold tracking-tight text-slate-100">
              System Status
            </h2>
            <button
              onClick={() => {
                checkHealth();
                fetchProfile();
                fetchResumes();
              }}
              disabled={apiStatus === 'checking'}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700"
            >
              {apiStatus === 'checking' ? 'Checking...' : 'Refresh Status'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Frontend */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-sm font-semibold text-slate-200">Frontend</span>
              </div>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                Active
              </span>
            </div>

            {/* API */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      apiStatus === 'connected'
                        ? 'bg-emerald-500'
                        : apiStatus === 'checking'
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                  ></span>
                </span>
                <span className="text-sm font-semibold text-slate-200">API Server</span>
              </div>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                  apiStatus === 'connected'
                    ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60'
                    : apiStatus === 'checking'
                    ? 'text-amber-400 bg-amber-950/60 border-amber-800/60'
                    : 'text-rose-400 bg-rose-950/60 border-rose-800/60'
                }`}
              >
                {apiStatus === 'connected' ? '200 OK' : apiStatus === 'checking' ? 'Polling' : 'Offline'}
              </span>
            </div>

            {/* Database */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      healthData?.database === 'connected' ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  ></span>
                </span>
                <span className="text-sm font-semibold text-slate-200">Database</span>
              </div>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                  healthData?.database === 'connected'
                    ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60'
                    : 'text-rose-400 bg-rose-950/60 border-rose-800/60'
                }`}
              >
                {healthData?.database === 'connected' ? 'PostgreSQL' : 'Down'}
              </span>
            </div>

            {/* Ollama AI */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      healthData?.ollama === 'connected' ? 'bg-indigo-500' : 'bg-amber-500'
                    }`}
                  ></span>
                </span>
                <span className="text-sm font-semibold text-slate-200">AI Engine</span>
              </div>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                  healthData?.ollama === 'connected'
                    ? 'text-indigo-400 bg-indigo-950/60 border-indigo-800/60'
                    : 'text-amber-400 bg-amber-950/60 border-amber-800/60'
                }`}
              >
                {healthData?.ollama === 'connected'
                  ? healthData.ollamaModel || 'Ollama'
                  : 'Ollama Offline'}
              </span>
            </div>
          </div>

          {(lastChecked || errorMessage) && (
            <div className="mt-4 pt-3 border-t border-slate-800/60 text-xs text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              {errorMessage ? (
                <span className="text-rose-400 font-mono">Error: {errorMessage}</span>
              ) : (
                <span>
                  API Endpoint:{' '}
                  <code className="text-slate-300 font-mono bg-slate-950 px-1.5 py-0.5 rounded">
                    {apiUrl}/health
                  </code>
                </span>
              )}
              {lastChecked && (
                <span>
                  Last checked: <span className="text-slate-300">{lastChecked}</span>
                </span>
              )}
            </div>
          )}
        </section>

        {/* Tab 1: Job Discovery (Milestone 6) */}
        {activeTab === 'jobs' && <JobDiscovery onStartApplication={handleStartApplication} />}

        {/* Tab 2: AI Job Matches (Milestone 7) */}
        {activeTab === 'matches' && (
          <JobMatches
            onStartApplication={handleStartApplication}
            onOpenApplication={handleOpenApplication}
          />
        )}

        {/* Tab 3: Applications Workspace (Milestone 8) */}
        {activeTab === 'applications' && (
          <div className="w-full">
            <Applications
              initialJobId={selectedJobForApplication}
              onClearInitialJobId={() => setSelectedJobForApplication(null)}
              initialApplicationId={selectedApplicationForWorkspace}
              onClearInitialApplicationId={() => setSelectedApplicationForWorkspace(null)}
            />
          </div>
        )}

        {/* Tab 4: Browser Discovery (Milestone 10.3) */}
        {activeTab === 'discovery' && (
          <div className="w-full">
            <BrowserDiscovery userProfileId={profile?.id} />
          </div>
        )}

        {/* Tab 5: Profile & Resumes (Milestones 4 & 5) */}
        {activeTab === 'profile' && (
          <div className="w-full">
            {/* AI Analysis Status Banner */}
        {analysisMessage && (
          <div
            className={`w-full mb-6 p-4 rounded-xl text-xs font-medium border flex items-center justify-between ${
              analysisMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}
          >
            <span>{analysisMessage.text}</span>
            <button
              onClick={() => setAnalysisMessage(null)}
              className="ml-3 text-slate-400 hover:text-white"
            >
              &times;
            </button>
          </div>
        )}

        {/* AI Extracted Profile Summary Card (Milestone 5) */}
        {analysisResult && (
          <section
            aria-label="AI Extracted Profile Summary"
            className="w-full bg-slate-900/90 backdrop-blur-xl border border-indigo-500/40 rounded-2xl p-6 shadow-2xl mb-8 relative overflow-hidden text-left"
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-950 border border-indigo-800/80 flex items-center justify-center text-indigo-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">AI Extracted Summary</h2>
                  <p className="text-xs text-slate-400">Structured resume understanding normalized and synced</p>
                </div>
              </div>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2.5 py-1 rounded-full">
                Status: Analyzed
              </span>
            </div>

            {/* Counts Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
                <span className="block text-2xl font-extrabold text-indigo-400">
                  {analysisResult.counts.skills}
                </span>
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Skills</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
                <span className="block text-2xl font-extrabold text-emerald-400">
                  {analysisResult.counts.experience}
                </span>
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Experience</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
                <span className="block text-2xl font-extrabold text-amber-400">
                  {analysisResult.counts.education}
                </span>
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Education</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
                <span className="block text-2xl font-extrabold text-sky-400">
                  {analysisResult.counts.projects}
                </span>
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Projects</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
                <span className="block text-2xl font-extrabold text-purple-400">
                  {analysisResult.counts.certifications}
                </span>
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Certs</span>
              </div>
            </div>

            {/* Structured details */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/70">
                  <span className="text-xs font-semibold text-slate-400 block mb-1">Current Title</span>
                  <span className="text-sm font-medium text-slate-200">
                    {analysisResult.profile.currentTitle || 'Not specified in resume'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/70">
                  <span className="text-xs font-semibold text-slate-400 block mb-1">Years of Experience</span>
                  <span className="text-sm font-medium text-slate-200">
                    {analysisResult.profile.yearsOfExperience !== null
                      ? `${analysisResult.profile.yearsOfExperience} years`
                      : 'Not specified in resume'}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/70">
                <span className="text-xs font-semibold text-slate-400 block mb-1">Professional Summary</span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {analysisResult.profile.professionalSummary || 'No summary extracted.'}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 2. Main Workspace: Two-column grid (Profile & Resume) */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* User Profile Section */}
          <section className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-5">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Professional Profile</h2>
                  <p className="text-xs text-slate-400">Manage your personal and career details</p>
                </div>
                {profile && (
                  <span className="text-[11px] font-mono text-indigo-400 bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-0.5 rounded-full">
                    Saved
                  </span>
                )}
              </div>

              {profileMessage && (
                <div
                  className={`mb-4 p-3 rounded-xl text-xs font-medium border ${
                    profileMessage.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  }`}
                >
                  {profileMessage.text}
                </div>
              )}

              <form onSubmit={handleSaveProfile} className="space-y-4 text-left">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Full Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Jane Doe"
                      value={profileForm.fullName}
                      onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Email Address <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="jane@example.com"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={profileForm.phone || ''}
                      onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Current Title
                    </label>
                    <input
                      type="text"
                      placeholder="Senior Full Stack Engineer"
                      value={profileForm.currentTitle || ''}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, currentTitle: e.target.value })
                      }
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Years of Experience
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={profileForm.yearsOfExperience ?? 0}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, yearsOfExperience: Number(e.target.value) })
                    }
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Professional Summary
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Briefly describe your career background, core competencies, and career goals..."
                    value={profileForm.professionalSummary || ''}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, professionalSummary: e.target.value })
                    }
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all resize-none"
                  ></textarea>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all duration-150 shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingProfile ? 'Saving Profile...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            </div>
          </section>

          {/* Resume Upload & Management Section */}
          <section className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-5">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Resume Management</h2>
                  <p className="text-xs text-slate-400">Upload your latest resume (PDF, DOCX)</p>
                </div>
                {latestResume && (
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-0.5 rounded-full">
                    v{latestResume.version} Active
                  </span>
                )}
              </div>

              {resumeMessage && (
                <div
                  className={`mb-4 p-3 rounded-xl text-xs font-medium border ${
                    resumeMessage.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  }`}
                >
                  {resumeMessage.text}
                </div>
              )}

              {/* Drag and Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-150 ${
                  isDragging
                    ? 'border-indigo-400 bg-indigo-950/30'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-950/40 hover:bg-slate-950/60'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                />

                <div className="w-12 h-12 mx-auto rounded-full bg-indigo-950/80 border border-indigo-800/60 flex items-center justify-center text-indigo-400 mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>

                <p className="text-sm font-semibold text-slate-200 mb-1">
                  {isUploadingResume ? 'Processing & Extracting Text...' : 'Click or drag resume file here'}
                </p>
                <p className="text-xs text-slate-400 mb-3">
                  Accepted formats: <span className="text-slate-300 font-medium">PDF, DOCX</span> · Maximum:{' '}
                  <span className="text-slate-300 font-medium">10 MB</span>
                </p>

                <button
                  type="button"
                  disabled={isUploadingResume}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
                >
                  Choose File
                </button>
              </div>

              {/* Latest Resume Details Card */}
              {latestResume && (
                <div className="mt-5 p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 text-left">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm text-slate-100">{latestResume.fileName}</span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                          Version {latestResume.version}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        {formatFileSize(latestResume.fileSize)} · Uploaded on{' '}
                        {new Date(latestResume.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                          latestResume.textExtracted
                            ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60'
                            : 'text-amber-400 bg-amber-950/60 border-amber-800/60'
                        }`}
                      >
                        {latestResume.textExtracted ? 'Text Extracted' : 'No Text'}
                      </span>
                      <button
                        onClick={() => handleViewText(latestResume)}
                        disabled={isLoadingText}
                        className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                      >
                        View Raw Text
                      </button>
                    </div>
                  </div>

                  {/* AI Analysis Action Button */}
                  <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      AI profile understanding with Ollama:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAnalyzeResume(latestResume.id)}
                      disabled={analyzingResumeId !== null || !latestResume.textExtracted}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {analyzingResumeId === latestResume.id ? (
                        <>
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Analyzing with AI...
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
                          Analyze with AI
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Resume History List */}
              {resumes.length > 1 && (
                <div className="mt-5 text-left">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Resume History ({resumes.length})
                  </h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {resumes.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 text-xs"
                      >
                        <div>
                          <span className="font-medium text-slate-200">{r.fileName}</span>
                          <span className="text-slate-400 ml-2">· v{r.version}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleAnalyzeResume(r.id)}
                            disabled={analyzingResumeId !== null || !r.textExtracted}
                            className="text-violet-400 hover:text-violet-300 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                          >
                            {analyzingResumeId === r.id ? 'Analyzing...' : 'Analyze with AI'}
                          </button>
                          <span className="text-slate-400">
                            {new Date(r.createdAt).toLocaleDateString()}
                          </span>
                          <button
                            onClick={() => handleViewText(r)}
                            className="text-indigo-400 hover:text-indigo-300"
                          >
                            Inspect
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
          </div>
        )}

        {/* 3. Text Extraction Preview Modal */}
        {viewingText && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white">{viewingText.fileName}</h3>
                  <p className="text-xs text-slate-400">Extracted Plain Text (Version {viewingText.version})</p>
                </div>
                <button
                  onClick={() => setViewingText(null)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                >
                  Close
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1 text-left">
                <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-words bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                  {viewingText.text}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="text-xs text-slate-500 mb-6">
          AI Job Agent Monorepo &middot; React + Vite + Fastify + PostgreSQL + Prisma + Ollama
        </footer>
      </main>
    </div>
  );
}
