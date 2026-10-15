export interface VerifiedCandidateProfileInput {
  fullName?: string | null;
  currentTitle?: string | null;
  yearsOfExperience?: number | null;
  professionalSummary?: string | null;
  skills: Array<{ name: string; category?: string | null }>;
  experience: Array<{
    id?: string;
    company: string;
    jobTitle: string;
    startDate?: string | null;
    endDate?: string | null;
    isCurrent?: boolean;
    description?: string | null;
  }>;
  education: Array<{
    institution: string;
    degree?: string | null;
    fieldOfStudy?: string | null;
  }>;
}

export interface TargetJobInput {
  id?: string;
  title: string;
  company: string;
  description: string;
  location?: string | null;
  workMode?: string | null;
  employmentType?: string | null;
  experienceLevel?: string | null;
}

export interface ExistingJobMatchInput {
  overallScore?: number | null;
  strengths?: string[];
  gaps?: string[];
  explanation?: string | null;
}

export function buildApplicationGenerationUserPrompt(
  candidate: VerifiedCandidateProfileInput,
  job: TargetJobInput,
  match?: ExistingJobMatchInput | null
): string {
  const skillsList =
    candidate.skills && candidate.skills.length > 0
      ? candidate.skills.map((s) => s.name).join(', ')
      : 'None listed';

  const expList =
    candidate.experience && candidate.experience.length > 0
      ? candidate.experience
          .map(
            (e) =>
              `- [ID: ${e.id || 'N/A'}] ${e.jobTitle} at ${e.company}${
                e.isCurrent ? ' (Current)' : ''
              }${e.startDate ? ` (${e.startDate} - ${e.endDate || 'Present'})` : ''}${
                e.description ? `\n  Verified Details: ${e.description}` : ''
              }`
          )
          .join('\n')
      : 'None listed';

  const eduList =
    candidate.education && candidate.education.length > 0
      ? candidate.education
          .map((ed) => `- ${ed.degree || 'Degree'} in ${ed.fieldOfStudy || 'Field'} from ${ed.institution}`)
          .join('\n')
      : 'None listed';

  const matchSection = match
    ? `\nPrior Match Score: ${match.overallScore ?? 'N/A'}/100
Evaluated Strengths: ${match.strengths?.join('; ') || 'None'}
Evaluated Gaps: ${match.gaps?.join('; ') || 'None'}
Match Analysis Summary: ${match.explanation || 'None'}\n`
    : '';

  return `Generate tailored application materials for the target job based strictly on the verified candidate profile.

<VERIFIED_CANDIDATE_PROFILE>
Candidate: ${candidate.fullName || 'Candidate'}
Current Title: ${candidate.currentTitle || 'Not specified'}
Verified Total Experience: ${
    candidate.yearsOfExperience != null ? `${candidate.yearsOfExperience} years` : 'Not specified'
  }
Summary: ${candidate.professionalSummary || 'None provided'}
Verified Skills: ${skillsList}

Verified Work History:
${expList}

Verified Education:
${eduList}
</VERIFIED_CANDIDATE_PROFILE>

<JOB_DATA>
Role Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}
Work Mode: ${job.workMode || 'Not specified'}
Employment Type: ${job.employmentType || 'Not specified'}
Experience Level: ${job.experienceLevel || 'Not specified'}
${matchSection}
Job Description & Requirements:
${job.description.slice(0, 4000)}
</JOB_DATA>

Remember:
1. Ground every claim strictly in <VERIFIED_CANDIDATE_PROFILE>. Do NOT invent any tools, achievements, or titles.
2. In "resumeBullets", provide 2 to 4 bullet points where each bullet connects to an existing verified experience record (provide the matching experienceId and company).
3. Return ONLY valid JSON adhering to the specified schema.`;
}
