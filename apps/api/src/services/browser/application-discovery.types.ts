export * from '@ai-job-agent/shared';

export interface RawDomForm {
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

export interface RawDomField {
  index: number;
  formIndex: number | null;
  tag: 'input' | 'select' | 'textarea';
  rawType: string;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  autocomplete: string | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  required: boolean;
  ariaRequired: boolean;
  disabled: boolean;
  readOnly: boolean;
  hasValue: boolean;
  labelForText: string | null;
  wrappingLabelText: string | null;
  nearbyText: string | null;
  helpText: string | null;
  options?: Array<{ value: string; label: string }>;
  accept?: string | null;
  multiple?: boolean;
}

export interface RawDomButton {
  text: string;
  type: string;
  formIndex: number | null;
  disabled: boolean;
}

export interface RawDomLink {
  text: string;
  href: string;
}

export interface RawDomInspection {
  title: string;
  url: string;
  headings: string[];
  forms: RawDomForm[];
  fields: RawDomField[];
  buttons: RawDomButton[];
  links: RawDomLink[];
}
