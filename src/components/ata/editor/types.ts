export interface AtaStudentContactOption {
  id: string;
  studentId: string;
  name: string;
  kinship: string;
  phone: string;
  isPrimary: boolean;
}

export interface AtaStudentOption {
  id: string;
  name: string;
  classGroupName?: string;
  cgm?: string | null;
  email?: string | null;
  phone?: string | null;
  guardianName?: string | null;
  isInactiveRecord?: boolean;
  contacts?: AtaStudentContactOption[];
}

export type ParticipantRowOriginState =
  | "AUTO_SUGGESTED"
  | "EXPLICIT_CANDIDATE"
  | "MANUAL_EDIT"
  | "PERSISTED";

export interface ParticipantSourceSnapshot {
  candidateKey?: string | null;
  sourceRole?: string | null;
  name?: string;
  phone?: string;
  documentType?: string | null;
  documentNumber?: string;
  expectedEmail?: string | null;
  kinship?: string;
}

export interface AtaParticipantDraft {
  id?: string;
  minuteId?: string;
  role: string;
  studentId?: string | null;
  name: string;
  kinship?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  documentVerifiedByStaff?: boolean;
  phone?: string | null;
  expectedEmail?: string | null;
  verifiedEmail?: string | null;
  verifiedGoogleSub?: string | null;
  verifiedGoogleName?: string | null;
  emailVerifiedAt?: string | Date | null;
  signatureMode: string;
  signatureData?: string | null;
  signedAt?: string | Date | null;
  signerIp?: string | null;
  signerUserAgent?: string | null;
  biometricStrokeData?: string | null;
  clientTimestampIso?: string | null;
  biometricVerified?: boolean;
  biometricDeviceType?: string | null;
  biometricAuthTime?: string | Date | null;
  hasSignature?: boolean;
  hasActiveSignLink?: boolean;
  clearSignature?: boolean;
  refusalReason?: string | null;
  witnessName?: string | null;
  // Metadados exclusivos de interface (removidos antes do envio à API)
  clientKey?: string;
  originState?: ParticipantRowOriginState;
  autoFilledCandidateKey?: string | null;
  autoOriginStudentId?: string | null;
  sourceSnapshot?: ParticipantSourceSnapshot | null;
  nonLegalContactNotice?: string | null;
}

export interface AtaActionItemDraft {
  id?: string;
  description: string;
  responsible: string;
  dueDate: string;
  status?: string;
}

export interface AtaActionItemRecord {
  id: string;
  description: string;
  responsible: string;
  dueDate?: string | Date | null;
  status: string;
}

export interface AtaAddendumRecord {
  id?: string;
  content: string;
  authorName: string;
  createdAt: string | Date;
  addendumHash?: string | null;
}

export interface SchoolHeaderConfig {
  id?: string;
  name?: string | null;
  inepCode?: string | null;
  municipality?: string | null;
  logoUrl?: string | null;
}

export interface AtaMinuteStudentSnapshot {
  id?: string;
  studentId: string;
  studentNameSnapshot: string;
  classNameSnapshot?: string | null;
  cgmSnapshot?: string | null;
}

export interface AtaMinuteRecord {
  id: string;
  schoolId?: string;
  ataNumber?: number | null;
  year?: number;
  status?: string;
  category?: string;
  isConfidential?: boolean;
  attendedAt: string | Date;
  finalizedAt?: string | Date | null;
  subject: string;
  rawNotes?: string | null;
  summary?: string | null;
  agreementsSummary?: string | null;
  verificationCode?: string | null;
  contentHash?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
  extemporaneousReason?: string | null;
  voidReason?: string | null;
  voidedAt?: string | Date | null;
  voidedByName?: string | null;
  physicalSignedScanData?: string | null;
  physicalScanStorageKey?: string | null;
  physicalScanUploadedAt?: string | Date | null;
  physicalScanUploadedBy?: string | null;
  hasPhysicalScan?: boolean;
  govBrVerified?: boolean;
  govBrProtocol?: string | null;
  school?: SchoolHeaderConfig | null;
  students?: AtaMinuteStudentSnapshot[];
  participants?: AtaParticipantDraft[];
  actionItems?: AtaActionItemRecord[];
  addendums?: AtaAddendumRecord[];
}

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

export interface SpeechRecognitionResultLike {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

export interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  start: () => void;
  stop?: () => void;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

export interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface AiSuggestedActionItem {
  description?: string;
  descricao?: string;
  acao?: string;
  item?: string;
  task?: string;
  texto?: string;
  responsible?: string;
  responsavel?: string;
  suggestedDaysToComplete?: number | string;
  prazoDias?: number | string;
  prazo?: number | string;
  days?: number | string;
}

export interface FormalizeAtaApiResponse {
  error?: string;
  usedFallback?: boolean;
  fallbackReason?: string;
  result?: {
    formalSubject?: string;
    formalSummary?: string;
    agreementsSummary?: string;
    actionItems?: Array<string | AiSuggestedActionItem>;
  };
}

export interface AtaStaffCandidateOption {
  id: string;
  name: string;
  email: string;
}

export interface AtaEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  availableStudents: AtaStudentOption[];
  preSelectedStudentId?: string;
  existingMinute?: AtaMinuteRecord | null;
  isAdmin?: boolean;
  activeSchoolId?: string | null;
}
