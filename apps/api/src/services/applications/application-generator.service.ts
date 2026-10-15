import { ollamaService, OllamaService } from '../ai/ollama.service.js';
import { APPLICATION_GENERATION_SYSTEM_PROMPT } from '../ai/prompts/application-generation.system.js';
import {
  buildApplicationGenerationUserPrompt,
  type VerifiedCandidateProfileInput,
  type TargetJobInput,
  type ExistingJobMatchInput,
} from '../ai/prompts/application-generation.user.js';
import {
  ApplicationGenerationAISchema,
  APPLICATION_GENERATION_JSON_SCHEMA,
  type ValidatedApplicationGenerationAI,
  AnswersGenerationAISchema,
  ANSWERS_GENERATION_JSON_SCHEMA,
  type ValidatedAnswersGenerationAI,
} from '../ai/schema/application-ai.schema.js';
import { ANSWERS_GENERATION_SYSTEM_PROMPT } from '../ai/prompts/answers-generation.system.js';
import { buildAnswersGenerationUserPrompt } from '../ai/prompts/answers-generation.user.js';
import {
  applicationValidationService,
  ApplicationValidationService,
  type FactValidationResult,
} from './application-validation.service.js';
import { AIOutputValidationError } from '../ai/job-match-ai.service.js';

export interface GeneratedApplicationResult {
  data: ValidatedApplicationGenerationAI;
  validation: FactValidationResult;
}

export interface GeneratedAnswersResult {
  data: ValidatedAnswersGenerationAI;
  validation: FactValidationResult;
}

export class ApplicationGeneratorService {
  constructor(
    private readonly ollama: OllamaService = ollamaService,
    private readonly validator: ApplicationValidationService = applicationValidationService
  ) {}

  /**
   * Generates tailored application materials (summary, cover letter, resume bullet suggestions)
   */
  async generateApplication(
    candidate: VerifiedCandidateProfileInput,
    job: TargetJobInput,
    match?: ExistingJobMatchInput | null
  ): Promise<GeneratedApplicationResult> {
    const userPrompt = buildApplicationGenerationUserPrompt(candidate, job, match);

    const rawResult = await this.ollama.generateStructured<unknown>(
      APPLICATION_GENERATION_SYSTEM_PROMPT,
      userPrompt,
      APPLICATION_GENERATION_JSON_SCHEMA,
      {
        temperature: 0.2,
      }
    );

    const parseResult = ApplicationGenerationAISchema.safeParse(rawResult);
    if (!parseResult.success) {
      throw new AIOutputValidationError(
        'AI output did not match expected application generation schema: ' +
          parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        parseResult.error.format()
      );
    }

    // Run fact validation
    const validation = this.validator.validateApplicationMaterials(
      candidate,
      job,
      parseResult.data
    );

    return {
      data: parseResult.data,
      validation,
    };
  }

  /**
   * Generates answers for arbitrary application questions based on verified candidate profile.
   */
  async generateAnswers(
    candidate: VerifiedCandidateProfileInput,
    job: TargetJobInput,
    questions: string[]
  ): Promise<GeneratedAnswersResult> {
    if (!questions || questions.length === 0) {
      return {
        data: { answers: [] },
        validation: { isValid: true, warnings: [], suspiciousClaims: [] },
      };
    }

    const userPrompt = buildAnswersGenerationUserPrompt(candidate, job, questions);

    const rawResult = await this.ollama.generateStructured<unknown>(
      ANSWERS_GENERATION_SYSTEM_PROMPT,
      userPrompt,
      ANSWERS_GENERATION_JSON_SCHEMA,
      {
        temperature: 0.2,
      }
    );

    const parseResult = AnswersGenerationAISchema.safeParse(rawResult);
    if (!parseResult.success) {
      throw new AIOutputValidationError(
        'AI output did not match expected answers schema: ' +
          parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        parseResult.error.format()
      );
    }

    // Validate each answer against candidate facts
    const allWarnings: string[] = [];
    const allSuspicious: string[] = [];
    for (const ans of parseResult.data.answers) {
      const res = this.validator.validateContent(candidate, job, ans.answer);
      allWarnings.push(...res.warnings);
      allSuspicious.push(...res.suspiciousClaims);
    }

    return {
      data: parseResult.data,
      validation: {
        isValid: allSuspicious.length === 0,
        warnings: Array.from(new Set(allWarnings)),
        suspiciousClaims: Array.from(new Set(allSuspicious)),
      },
    };
  }
}

export const applicationGeneratorService = new ApplicationGeneratorService();
