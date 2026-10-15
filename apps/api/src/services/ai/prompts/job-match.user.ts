export interface CandidateProfileInput {
  professionalSummary?: string | null;
  currentTitle?: string | null;
  yearsOfExperience?: number | null;
  skills?: Array<{ name: string; category?: string | null; proficiency?: string | null }>;
  experience?: Array<{
    jobTitle: string;
    company: string;
    startDate?: string | null;
    endDate?: string | null;
    isCurrent?: boolean;
    description?: string | null;
  }>;
  education?: Array<{
    institution: string;
    degree?: string | null;
    fieldOfStudy?: string | null;
  }>;
  preferences?: {
    preferredRoles?: string[];
    preferredLocations?: string[];
    workModes?: string[];
    preferredIndustries?: string[];
    minimumSalary?: number | null;
    currency?: string | null;
  } | null;
}

export interface JobInput {
  title: string;
  company: string;
  description: string;
  location?: string | null;
  workMode?: string | null;
  employmentType?: string | null;
  experienceLevel?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  publishedAt?: string | Date | null;
}

export function buildJobMatchUserPrompt(candidate: CandidateProfileInput, job: JobInput): string {
  // Format skills
  const skillsStr =
    candidate.skills && candidate.skills.length > 0
      ? candidate.skills.map((s) => s.name).join(', ')
      : 'None listed';

  // Format experience
  const expStr =
    candidate.experience && candidate.experience.length > 0
      ? candidate.experience
          .map(
            (e) =>
              `- ${e.jobTitle} at ${e.company}${e.isCurrent ? ' (Current)' : ''}${
                e.description ? `\n  Responsibilities: ${e.description.slice(0, 300)}` : ''
              }`
          )
          .join('\n')
      : 'None listed';

  // Format education
  const eduStr =
    candidate.education && candidate.education.length > 0
      ? candidate.education
          .map((ed) => `- ${ed.degree || 'Degree'} in ${ed.fieldOfStudy || 'Field'} from ${ed.institution}`)
          .join('\n')
      : 'None listed';

  // Format preferences
  const prefStr = candidate.preferences
    ? `Preferred Roles: ${candidate.preferences.preferredRoles?.join(', ') || 'Any'}
Preferred Locations: ${candidate.preferences.preferredLocations?.join(', ') || 'Any'}
Work Modes: ${candidate.preferences.workModes?.join(', ') || 'Any'}
Preferred Industries: ${candidate.preferences.preferredIndustries?.join(', ') || 'Any'}`
    : 'None specified';

  // Format salary
  const salaryStr =
    job.salaryMin || job.salaryMax
      ? `${job.salaryCurrency || 'USD'} ${job.salaryMin ?? 0} - ${job.salaryMax ?? 'open'}`
      : 'Not disclosed';

  return `Please analyze how well this candidate fits the target job posting.

<CANDIDATE_PROFILE>
Title: ${candidate.currentTitle || 'Not specified'}
Experience: ${candidate.yearsOfExperience != null ? `${candidate.yearsOfExperience} years` : 'Not specified'}
Summary: ${candidate.professionalSummary || 'None provided'}
Skills: ${skillsStr}

Work History:
${expStr}

Education:
${eduStr}

Preferences:
${prefStr}
</CANDIDATE_PROFILE>

<JOB_DESCRIPTION>
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}
Work Mode: ${job.workMode || 'Not specified'}
Employment Type: ${job.employmentType || 'Full-time'}
Experience Level: ${job.experienceLevel || 'Not specified'}
Compensation: ${salaryStr}

Job Description & Requirements:
${job.description.slice(0, 4000)}
</JOB_DESCRIPTION>

Respond ONLY with a JSON object adhering to the schema:
{
  "semanticSkillScore": <number 0-100>,
  "roleAlignmentScore": <number 0-100>,
  "responsibilityAlignmentScore": <number 0-100>,
  "strengths": [<string>, ...],
  "gaps": [<string>, ...],
  "explanation": "<concise summary>"
}`;
}
