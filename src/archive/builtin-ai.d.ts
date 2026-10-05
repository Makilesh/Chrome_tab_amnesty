/**
 * Minimal ambient types for Chrome's built-in AI (Prompt API and Summarizer API, stable for
 * extensions since Chrome 138). Only what Phase 1 calls. Both are `undefined` where unsupported;
 * every caller checks `availability()` first and falls back.
 */

type AIAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelPromptOptions {
  responseConstraint?: object;
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  destroy(): void;
}

/** What a session will be given or asked to produce. Chrome warns when no output language is named. */
interface LanguageModelExpected {
  type: 'text' | 'image' | 'audio';
  languages?: string[];
}

interface LanguageModelCreateOptions {
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

interface LanguageModelStatic {
  availability(options?: Pick<LanguageModelCreateOptions, 'expectedInputs' | 'expectedOutputs'>): Promise<AIAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

interface SummarizerCreateOptions {
  type?: 'key-points' | 'tl;dr' | 'teaser' | 'headline';
  format?: 'plain-text' | 'markdown';
  length?: 'short' | 'medium' | 'long';
  sharedContext?: string;
  expectedInputLanguages?: string[];
  expectedContextLanguages?: string[];
  outputLanguage?: string;
  signal?: AbortSignal;
}

interface SummarizerSession {
  summarize(input: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface SummarizerStatic {
  availability(options?: Omit<SummarizerCreateOptions, 'signal'>): Promise<AIAvailability>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerSession>;
}

declare const LanguageModel: LanguageModelStatic | undefined;
declare const Summarizer: SummarizerStatic | undefined;
