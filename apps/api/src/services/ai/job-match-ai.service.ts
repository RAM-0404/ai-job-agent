import { ollamaService, OllamaService } from './ollama.service.js';
import { JOB_MATCH_SYSTEM_PROMPT } from './prompts/job-match.system.js';
import {
  buildJobMatchUserPrompt,
  type CandidateProfileInput,
  type JobInput,
} from './prompts/job-match.user.js';
import {
  JobMatchAISchema,
  JOB_MATCH_JSON_SCHEMA,
  type ValidatedJobMatchAI,
} from './schema/job-match-ai.schema.js';

export class AIOutputValidationError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'AIOutputValidationError';
  }
}

export class JobMatchAIService {
  constructor(private readonly ollama: OllamaService = ollamaService) {}

  /**
   * Run semantic analysis comparing a candidate profile against a job description.
   * Untrusted input is delimited and prompt safety instructions prevent instruction overriding.
   */
  async analyzeMatch(
    candidate: CandidateProfileInput,
    job: JobInput
  ): Promise<ValidatedJobMatchAI> {
    const userPrompt = buildJobMatchUserPrompt(candidate, job);

    // Call Ollama for structured JSON output
    const rawResult = await this.ollama.generateStructured<unknown>(
      JOB_MATCH_SYSTEM_PROMPT,
      userPrompt,
      JOB_MATCH_JSON_SCHEMA,
      {
        temperature: 0.1,
      }
    );

    // Strictly validate against Zod schema
    const parseResult = JobMatchAISchema.safeParse(rawResult);

    if (!parseResult.success) {
      throw new AIOutputValidationError(
        'AI output did not match expected job match schema: ' +
          parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        parseResult.error.format()
      );
    }

    return parseResult.data;
  }
}

export const jobMatchAIService = new JobMatchAIService();
