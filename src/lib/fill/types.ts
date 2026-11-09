export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'checkbox-single'
  | 'contenteditable'
  | 'file';

export interface ScannedField {
  /** unique within a frame */
  id: string;
  frameId: number;
  kind: FieldKind;
  question: string;
  description?: string;
  options?: string[];
  required: boolean;
  wordLimit?: number;
  charLimit?: number;
  currentValue?: string | string[];
  /** e.g. autocomplete="email", input name — used for instant profile matching */
  hint?: string;
}

export interface ScanResult {
  url: string;
  title: string;
  fields: ScannedField[];
  isGoogleForm: boolean;
}

export interface FillCommand {
  id: string;
  value: string | string[];
}

export interface FillOutcome {
  id: string;
  ok: boolean;
  reason?: string;
}
