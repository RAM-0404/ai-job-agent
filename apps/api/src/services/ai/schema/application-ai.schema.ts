import { z } from 'zod';

export const ResumeBulletSuggestionSchema = z.object({
  experienceId: z.string().optional().default(''),
  company: z.string().optional().default(''),
  bullet: z.string().min(5, 'Bullet point cannot be empty'),
});

export const ApplicationGenerationAISchema = z.object({
  summary: z.string().min(10, 'Application summary cannot be empty'),
  coverLetter: z.string().min(50, 'Cover letter must be at least 50 characters'),
  resumeBullets: z
    .array(ResumeBulletSuggestionSchema)
    .min(1, 'At least one resume bullet suggestion is required'),
});

export type ValidatedApplicationGenerationAI = z.infer<typeof ApplicationGenerationAISchema>;

export const APPLICATION_GENERATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'A concise summary of why the candidate fits, strongest experience, gaps, and suggested positioning.',
    },
    coverLetter: {
      type: 'string',
      description: 'A professional cover letter tailored to the job, mentioning only verified experience and skills.',
    },
    resumeBullets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          experienceId: { type: 'string' },
          company: { type: 'string' },
          bullet: { type: 'string' },
        },
        required: ['bullet'],
      },
      description: 'Suggestions for tailoring resume bullet points grounded strictly in verified candidate work history.',
    },
  },
  required: ['summary', 'coverLetter', 'resumeBullets'],
};

export const AnswerItemAISchema = z.object({
  question: z.string().min(1, 'Question cannot be empty'),
  answer: z.string().min(1, 'Answer cannot be empty'),
});

export const AnswersGenerationAISchema = z.object({
  answers: z.array(AnswerItemAISchema).min(1, 'At least one question answer is required'),
});

export type ValidatedAnswersGenerationAI = z.infer<typeof AnswersGenerationAISchema>;

export const ANSWERS_GENERATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['question', 'answer'],
      },
    },
  },
  required: ['answers'],
};
