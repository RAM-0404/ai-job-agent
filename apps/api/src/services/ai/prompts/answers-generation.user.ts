import type {
  VerifiedCandidateProfileInput,
  TargetJobInput,
} from './application-generation.user.js';

export function buildAnswersGenerationUserPrompt(
  candidate: VerifiedCandidateProfileInput,
  job: TargetJobInput,
  questions: string[]
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
              `- ${e.jobTitle} at ${e.company}${e.isCurrent ? ' (Current)' : ''}${
                e.description ? `\n  Details: ${e.description}` : ''
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

  const questionsList = questions.map((q, idx) => `${idx + 1}. "${q}"`).join('\n');

  return `Draft answers to the following application questions based strictly on the verified candidate profile.

<VERIFIED_CANDIDATE_PROFILE>
Candidate: ${candidate.fullName || 'Candidate'}
Current Title: ${candidate.currentTitle || 'Not specified'}
Total Years Experience: ${candidate.yearsOfExperience != null ? candidate.yearsOfExperience : 'Not specified'}
Summary: ${candidate.professionalSummary || 'None'}
Verified Skills: ${skillsList}

Verified Work History:
${expList}

Verified Education:
${eduList}
</VERIFIED_CANDIDATE_PROFILE>

<JOB_DATA>
Target Role: ${job.title}
Target Company: ${job.company}
Job Description:
${job.description.slice(0, 2000)}
</JOB_DATA>

<APPLICATION_QUESTIONS>
${questionsList}
</APPLICATION_QUESTIONS>

Draft an authentic, professional response for EACH question listed above. Every claim must be grounded in the verified profile. If information is not available, state that clearly in the response. Return valid JSON only.`;
}
