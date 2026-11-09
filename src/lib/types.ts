// The vault: one JSON object saved in the browser.

export type SourceKind =
  | 'manual'
  | 'paste'
  | 'linkedin'
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'github'
  | 'devpost'
  | 'resume'
  | 'email'
  | 'certificate'
  | 'form'
  | 'page';

export interface SourceRef {
  kind: SourceKind;
  /** Short human label, e.g. "LinkedIn post, 12 Mar 2025" */
  label?: string;
  url?: string;
  at: string; // ISO date the source was read
}

export interface EntryBase {
  id: string;
  updatedAt: string;
  sources: SourceRef[];
}

export interface Profile {
  name?: string;
  email?: string;
  phone?: string;
  cnic?: string;
  university?: string;
  degree?: string;
  rollNo?: string;
  cgpa?: string;
  graduationYear?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  city?: string;
  country?: string;
  /** Anything else: "T-shirt size" → "M" */
  extra?: Record<string, string>;
}

export interface Project extends EntryBase {
  title: string;
  startDate?: string;
  endDate?: string;
  role?: string;
  tech: string[];
  problem?: string;
  built?: string;
  result?: string;
  links: string[];
  summary?: string;
  description?: string;
}

export interface Hackathon extends EntryBase {
  name: string;
  organiser?: string;
  date?: string;
  team: string[];
  projectId?: string;
  /** Project name as found in the source; resolved to projectId when that project is in the vault */
  projectTitle?: string;
  result?: string;
  postUrl?: string;
}

export interface Experience extends EntryBase {
  organisation: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface Achievement extends EntryBase {
  title: string;
  date?: string;
  issuer?: string;
  link?: string;
  description?: string;
}

export interface Skills {
  languages: string[];
  frameworks: string[];
  tools: string[];
}

export interface AnswerMemory {
  id: string;
  question: string;
  site: string;
  wordLimit?: number;
  text: string;
  usedEntryIds: string[];
  /** 0 = accepted as drafted, 1 = fully rewritten */
  editRatio: number;
  createdAt: string;
  embedding?: number[];
}

export interface StyleRule {
  id: string;
  rule: string;
  createdAt: string;
}

export type SectionKey = 'projects' | 'hackathons' | 'experience' | 'achievements';
export type EntryOf<K extends SectionKey> = Vault[K][number];
export type AnyEntry = Project | Hackathon | Experience | Achievement;

export interface InboxItem {
  id: string;
  createdAt: string;
  /** new = add an entry; update = patch an existing one */
  op: 'new' | 'update';
  section: SectionKey | 'profile' | 'skills';
  /** for op=update on a list section */
  targetId?: string;
  /** fields for the new entry, or the changed fields for an update */
  data: Record<string, unknown>;
  /** for updates: the old values of changed fields, to show "3.4 → 3.5" */
  before?: Record<string, unknown>;
  sources: SourceRef[];
}

export interface Vault {
  version: 1;
  profile: Profile;
  projects: Project[];
  hackathons: Hackathon[];
  experience: Experience[];
  achievements: Achievement[];
  skills: Skills;
  answers: AnswerMemory[];
  style: StyleRule[];
  inbox: InboxItem[];
  stats: { draftsShown: number; draftsAcceptedUnedited: number };
}

export const emptyVault = (): Vault => ({
  version: 1,
  profile: {},
  projects: [],
  hackathons: [],
  experience: [],
  achievements: [],
  skills: { languages: [], frameworks: [], tools: [] },
  answers: [],
  style: [],
  inbox: [],
  stats: { draftsShown: 0, draftsAcceptedUnedited: 0 },
});

export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'builtin';

export interface Settings {
  provider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  /** Model per provider; empty = auto-pick */
  models: Partial<Record<ProviderId, string>>;
  githubUser?: string;
  githubToken?: string;
  devpostUser?: string;
  resumeDocUrl?: string;
  resumeDocHash?: string;
  lastSync?: { github?: string; devpost?: string; resumeDoc?: string };
  driveClientId?: string;
  driveConnected?: boolean;
  driveLastSync?: string;
  chipsEnabled: boolean;
  onboarded: boolean;
}

export const defaultSettings = (): Settings => ({
  provider: 'gemini',
  keys: {},
  models: {},
  chipsEnabled: true,
  onboarded: false,
});
