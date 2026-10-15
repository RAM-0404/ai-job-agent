import { z } from 'zod';

export const JobMatchAISchema = z.object({
  semanticSkillScore: z
    .number()
    .min(0)
    .max(100)
    .transform((val) => Math.round(val)),
  roleAlignmentScore: z
    .number()
    .min(0)
    .max(100)
    .transform((val) => Math.round(val)),
  responsibilityAlignmentScore: z
    .number()
    .min(0)
    .max(100)
    .transform((val) => Math.round(val)),
  strengths: z
    .array(z.string().min(1).trim())
    .default([])
    .transform((list) => list.filter(Boolean)),
  gaps: z
    .array(z.string().min(1).trim())
    .default([])
    .transform((list) => list.filter(Boolean)),
  explanation: z.string().min(1, 'Explanation cannot be empty').trim(),
});

export type ValidatedJobMatchAI = z.infer<typeof JobMatchAISchema>;

export const JOB_MATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    semanticSkillScore: {
      type: 'integer',
      description: 'Score from 0 to 100 on how well candidate skills align semantically with job requirements, considering transferable skills and tech equivalence',
    },
    roleAlignmentScore: {
      type: 'integer',
      description: 'Score from 0 to 100 on how closely the candidate title and background match the job role family and level',
    },
    responsibilityAlignmentScore: {
      type: 'integer',
      description: 'Score from 0 to 100 on how well past candidate responsibilities prepare them for the job duties',
    },
    strengths: {
      type: 'array',
      items: { type: 'string' },
      description: '2 to 4 bullet points highlighting specific candidate strengths for this role',
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
      description: '1 to 3 bullet points highlighting missing skills, experience deficits, or qualifications',
    },
    explanation: {
      type: 'string',
      description: 'A 2 to 3 sentence objective summary explaining the fit and key trade-offs',
    },
  },
  required: [
    'semanticSkillScore',
    'roleAlignmentScore',
    'responsibilityAlignmentScore',
    'strengths',
    'gaps',
    'explanation',
  ],
};
