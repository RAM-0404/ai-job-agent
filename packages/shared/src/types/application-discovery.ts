export type DiscoveredFieldType =
  | 'TEXT'
  | 'EMAIL'
  | 'TEL'
  | 'NUMBER'
  | 'URL'
  | 'DATE'
  | 'DATETIME'
  | 'SELECT'
  | 'TEXTAREA'
  | 'CHECKBOX'
  | 'RADIO'
  | 'FILE'
  | 'PASSWORD'
  | 'HIDDEN'
  | 'UNKNOWN';

export type ButtonClassification =
  | 'PRIMARY_APPLICATION_ACTION'
  | 'SECONDARY_ACTION'
  | 'NAVIGATION'
  | 'UNKNOWN';

export interface DiscoveredFieldOptionDto {
  value: string;
  label: string;
}

export interface DiscoveredFieldDto {
  index: number;
  formIndex: number | null;
  tag: 'input' | 'select' | 'textarea';
  type: DiscoveredFieldType;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  autocomplete: string | null;
  ariaLabel: string | null;
  required: boolean;
  requirementSource: string | null;
  disabled: boolean;
  readOnly: boolean;
  hasValue: boolean;
  label: string | null;
  labelSource: string | null;
  helpText: string | null;
  options?: DiscoveredFieldOptionDto[];
  fileConfig?: {
    accept: string | null;
    multiple: boolean;
  };
}

export interface DiscoveredFormDto {
  index: number;
  id: string | null;
  name: string | null;
  action: string | null;
  method: string | null;
  ariaLabel: string | null;
  surroundingHeading: string | null;
  fieldCount: number;
  requiredFieldCount: number;
  buttonCount: number;
}

export interface DiscoveredButtonDto {
  text: string;
  type: string;
  classification: ButtonClassification;
  formIndex: number | null;
  disabled: boolean;
}

export interface ApplicationTargetDto {
  url: string;
  text: string;
  type: 'APPLICATION_LINK' | 'EXTERNAL_PORTAL';
  confidence: number;
}

export interface CandidateFieldMappingDto {
  fieldId: string;
  fieldName: string | null;
  label: string | null;
  candidateSource: string;
  confidence: number;
  reason: string;
  available: boolean;
}

export interface MissingCandidateInformationDto {
  fieldId: string;
  fieldName: string | null;
  label: string;
  required: boolean;
  reason: string;
}

export interface ApplicationPageIndicatorDto {
  isApplicationPage: boolean;
  confidence: number;
  signals: string[];
}

export interface ApplicationPageAnalysisDto {
  sessionId: string;
  page: {
    url: string;
    title: string;
    status: number | null;
  };
  application: ApplicationPageIndicatorDto;
  targets: ApplicationTargetDto[];
  forms: DiscoveredFormDto[];
  fields: DiscoveredFieldDto[];
  buttons: DiscoveredButtonDto[];
  candidateMappings: CandidateFieldMappingDto[];
  missingInformation: MissingCandidateInformationDto[];
}

export interface DiscoverApplicationPageRequest {
  url?: string;
  userProfileId?: string;
}
