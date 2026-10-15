import { z } from 'zod';

export const AISkillSchema = z.object({
  name: z.string().min(1, 'Skill name cannot be empty').trim(),
  category: z.string().nullable().optional().transform((val) => val?.trim() || null),
  proficiency: z.string().nullable().optional().transform((val) => val?.trim() || null),
});

export const AIExperienceSchema = z.object({
  company: z.string().min(1, 'Company cannot be empty').trim(),
  jobTitle: z.string().min(1, 'Job title cannot be empty').trim(),
  startDate: z.string().nullable().optional().transform((val) => val?.trim() || null),
  endDate: z.string().nullable().optional().transform((val) => val?.trim() || null),
  isCurrent: z.boolean().default(false),
  description: z.string().nullable().optional().transform((val) => val?.trim() || null),
});

export const AIEducationSchema = z.object({
  institution: z.string().min(1, 'Institution cannot be empty').trim(),
  degree: z.string().nullable().optional().transform((val) => val?.trim() || null),
  fieldOfStudy: z.string().nullable().optional().transform((val) => val?.trim() || null),
  startDate: z.string().nullable().optional().transform((val) => val?.trim() || null),
  endDate: z.string().nullable().optional().transform((val) => val?.trim() || null),
  description: z.string().nullable().optional().transform((val) => val?.trim() || null),
});

export const AIProjectSchema = z.object({
  name: z.string().min(1, 'Project name cannot be empty').trim(),
  description: z.string().nullable().optional().transform((val) => val?.trim() || null),
  technologies: z
    .array(z.string().trim())
    .default([])
    .transform((list) => list.filter(Boolean)),
});

export const AICertificationSchema = z.object({
  name: z.string().min(1, 'Certification name cannot be empty').trim(),
  issuer: z.string().nullable().optional().transform((val) => val?.trim() || null),
  year: z.number().int().min(1950).max(2100).nullable().optional().transform((val) => val ?? null),
});

export const ResumeAIProfileSchema = z.object({
  professionalSummary: z.string().nullable().optional().transform((val) => val?.trim() || null),
  currentTitle: z.string().nullable().optional().transform((val) => val?.trim() || null),
  yearsOfExperience: z
    .number()
    .int()
    .min(0)
    .max(80)
    .nullable()
    .optional()
    .transform((val) => val ?? null),
  skills: z.array(AISkillSchema).default([]),
  experience: z.array(AIExperienceSchema).default([]),
  education: z.array(AIEducationSchema).default([]),
  projects: z.array(AIProjectSchema).default([]),
  certifications: z.array(AICertificationSchema).default([]),
});

export type ValidatedResumeAIProfile = z.infer<typeof ResumeAIProfileSchema>;

export const RESUME_JSON_SCHEMA = {
  type: 'object',
  properties: {
    professionalSummary: { type: ['string', 'null'] },
    currentTitle: { type: ['string', 'null'] },
    yearsOfExperience: { type: ['integer', 'null'] },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: ['string', 'null'] },
          proficiency: { type: ['string', 'null'] },
        },
        required: ['name'],
      },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          jobTitle: { type: 'string' },
          startDate: { type: ['string', 'null'] },
          endDate: { type: ['string', 'null'] },
          isCurrent: { type: 'boolean' },
          description: { type: ['string', 'null'] },
        },
        required: ['company', 'jobTitle', 'isCurrent'],
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          institution: { type: 'string' },
          degree: { type: ['string', 'null'] },
          fieldOfStudy: { type: ['string', 'null'] },
          startDate: { type: ['string', 'null'] },
          endDate: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
        },
        required: ['institution'],
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: ['string', 'null'] },
          technologies: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['name', 'technologies'],
      },
    },
    certifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          issuer: { type: ['string', 'null'] },
          year: { type: ['integer', 'null'] },
        },
        required: ['name'],
      },
    },
  },
  required: [
    'professionalSummary',
    'currentTitle',
    'yearsOfExperience',
    'skills',
    'experience',
    'education',
    'projects',
    'certifications',
  ],
};
