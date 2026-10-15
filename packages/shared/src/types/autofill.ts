import type { DiscoveredFieldType } from './application-discovery.js';

export type AutofillState =
  | 'PROPOSED'
  | 'WAITING_FOR_APPROVAL'
  | 'APPROVED'
  | 'FILLING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED';

export type AutofillFieldStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'MISSING'
  | 'FORBIDDEN';

export interface AutofillFieldProposalDto {
  fieldId: string;
  fieldName: string | null;
  fieldType: DiscoveredFieldType;
  tag: 'input' | 'select' | 'textarea';
  label: string | null;
  candidateSource: string;
  proposedValue: string | number | boolean;
  displayValue: string;
  confidence: number;
  approved: boolean;
  reason: string;
  resumeId?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface AutofillProposalDto {
  sessionId: string;
  state: AutofillState;
  createdAt: string;
  proposals: AutofillFieldProposalDto[];
  totalFieldsCount: number;
  mappableFieldsCount: number;
  missingFieldsCount: number;
  forbiddenFieldsCount: number;
}

export interface ApproveAutofillRequest {
  fieldIds: string[];
}

export interface AutofillFieldResultDto {
  fieldId: string;
  fieldName: string | null;
  fieldType: DiscoveredFieldType;
  status: AutofillFieldStatus;
  reason: string;
  verified: boolean;
  verifiedValue?: string | number | boolean;
}

export interface AutofillValidationErrorDto {
  fieldId: string;
  message: string;
}

export interface AutofillValidationResultDto {
  valid: boolean;
  errors: AutofillValidationErrorDto[];
}

export interface AutofillResultDto {
  sessionId: string;
  state: AutofillState;
  completedAt: string;
  results: AutofillFieldResultDto[];
  validation: AutofillValidationResultDto;
  applicationSubmitted: false; // Deterministically false: M11 NEVER submits
}
