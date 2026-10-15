export * from '@ai-job-agent/shared';

export interface StepAutofillRecord {
  stepId?: string;
  proposal: import('@ai-job-agent/shared').AutofillProposalDto | null;
  result: import('@ai-job-agent/shared').AutofillResultDto | null;
  savedAt: string;
}

export interface InternalAutofillSessionState {
  sessionId: string;
  userProfileId?: string;
  state: import('@ai-job-agent/shared').AutofillState;
  createdAt: Date;
  updatedAt: Date;
  proposal: import('@ai-job-agent/shared').AutofillProposalDto | null;
  lastResult: import('@ai-job-agent/shared').AutofillResultDto | null;
  stepHistory?: StepAutofillRecord[];
}
