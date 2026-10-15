import type { VerifiedCandidateProfileInput, TargetJobInput } from '../ai/prompts/application-generation.user.js';

export interface FactValidationResult {
  isValid: boolean;
  warnings: string[];
  suspiciousClaims: string[];
}

export class UnsupportedClaimError extends Error {
  constructor(message: string, public readonly suspiciousClaims: string[]) {
    super(message);
    this.name = 'UnsupportedClaimError';
  }
}

// Well-known industry certifications to monitor
const KNOWN_CERTIFICATIONS = [
  'AWS Certified Solutions Architect',
  'AWS Certified Developer',
  'AWS Certified DevOps',
  'AWS Certified',
  'Google Cloud Professional',
  'GCP Certified',
  'Azure Solutions Architect',
  'Azure Administrator',
  'CISSP',
  'CISM',
  'PMP',
  'Project Management Professional',
  'Certified ScrumMaster',
  'Certified Scrum Master',
  'CSM',
  'CKA',
  'Certified Kubernetes Administrator',
  'CKAD',
  'Six Sigma Black Belt',
];

export class ApplicationValidationService {
  /**
   * Validate generated application content against verified candidate profile facts.
   */
  validateContent(
    candidate: VerifiedCandidateProfileInput,
    targetJob: TargetJobInput,
    content: string,
    options: { strict?: boolean } = {}
  ): FactValidationResult {
    const warnings: string[] = [];
    const suspiciousClaims: string[] = [];

    const safeContent = content || '';
    const lowerContent = safeContent.toLowerCase();

    // 1. Check Years of Experience Exaggeration
    const candidateYears = candidate.yearsOfExperience ?? 0;
    const yearMatches = content.matchAll(/(?:over|more than|\b)\s*(\d{1,2})\+?\s*years(?:\s*of)?\s*(?:experience|working|in\b)/gi);
    for (const match of yearMatches) {
      const claimedYears = parseInt(match[1], 10);
      if (!isNaN(claimedYears) && claimedYears > candidateYears + 1 && candidateYears > 0) {
        suspiciousClaims.push(
          `Claimed ${claimedYears}+ years of experience, but verified profile only supports ${candidateYears} years.`
        );
      }
    }

    // 2. Check Unsupported Company Employment Claims
    const verifiedCompanyNames = (candidate.experience || []).map((e) => e.company.toLowerCase().trim());
    const targetCompanyName = (targetJob.company || '').toLowerCase().trim();

    // Look for phrases like "At [Company]", "While at [Company]", "During my time at [Company]", "My tenure at [Company]"
    const companyPhrases = content.matchAll(/(?:at|while at|during my time at|my tenure at|working at)\s+([A-Z][A-Za-z0-9&.\s]{2,25}?)(?:,|\.|\s+as|\s+I|\s+where|\s+for|\s+on|\s+in|\s+leading|\s+to|\s+building|\s+and|\b)/g);
    for (const m of companyPhrases) {
      const claimedCompany = m[1].trim();
      const claimedLower = claimedCompany.toLowerCase();
      // Ignore common English words, target job company, or verified past employers
      const commonWords = ['scale', 'present', 'once', 'large', 'first', 'home', 'times', 'length', 'most', 'all', 'high', 'peak'];
      if (
        claimedCompany.length >= 3 &&
        !commonWords.includes(claimedLower) &&
        claimedLower !== targetCompanyName &&
        !targetCompanyName.includes(claimedLower) &&
        !verifiedCompanyNames.some((c) => c.includes(claimedLower) || claimedLower.includes(c))
      ) {
        // Also check if it's not a common technology (e.g. "at Docker", "at React")
        const verifiedSkills = (candidate.skills || []).map((s) => s.name.toLowerCase());
        if (!verifiedSkills.includes(claimedLower)) {
          suspiciousClaims.push(
            `Claims past employment at "${claimedCompany}", which is not present in verified profile companies.`
          );
        }
      }
    }

    // 3. Check Unsupported Certifications
    for (const cert of KNOWN_CERTIFICATIONS) {
      if (lowerContent.includes(cert.toLowerCase())) {
        const verifiedSkillsAndSummary = [
          ...(candidate.skills || []).map((s) => s.name.toLowerCase()),
          (candidate.professionalSummary || '').toLowerCase(),
          ...(candidate.education || []).map((e) => `${e.institution} ${e.degree || ''}`.toLowerCase()),
        ].join(' ');

        if (!verifiedSkillsAndSummary.includes(cert.toLowerCase())) {
          suspiciousClaims.push(
            `Claims certification "${cert}", which is not listed in the verified candidate profile.`
          );
        }
      }
    }

    // 4. Check Unsupported Management / Team Leadership Claims
    const hasLeadershipBackground =
      (candidate.currentTitle || '').toLowerCase().includes('lead') ||
      (candidate.currentTitle || '').toLowerCase().includes('manager') ||
      (candidate.currentTitle || '').toLowerCase().includes('director') ||
      (candidate.currentTitle || '').toLowerCase().includes('head') ||
      (candidate.experience || []).some((e) => {
        const text = `${e.jobTitle} ${e.description || ''}`.toLowerCase();
        return (
          text.includes('managed') ||
          text.includes('lead') ||
          text.includes('direct reports') ||
          text.includes('mentored') ||
          text.includes('supervis')
        );
      });

    if (!hasLeadershipBackground) {
      const leadershipClaims = [
        'managed a team of',
        'directed a team of',
        'direct reports',
        'led an engineering department',
        'managed 10+',
        'managed 15+',
        'managed 20+',
      ];
      for (const phrase of leadershipClaims) {
        if (lowerContent.includes(phrase)) {
          suspiciousClaims.push(
            `Claims team management ("${phrase}"), but verified profile contains no management or leadership history.`
          );
        }
      }
    }

    // 5. Check Fabricated High-Specificity Numeric Metrics (e.g. reduced by X%, saved $Y)
    const hasMetricsInProfile = (candidate.experience || []).some((e) =>
      /%|\$|€|£/.test(e.description || '')
    );
    if (!hasMetricsInProfile) {
      const metricMatches = content.matchAll(/(?:reduced|increased|improved|saved|boosted|grew)\s+[A-Za-z\s]{0,25}?(?:by\s+)?(\d{1,3}%|\$\d+[\d,]*|\€\d+[\d,]*)/gi);
      for (const m of metricMatches) {
        warnings.push(
          `Contains specific quantitative metric "${m[0]}" which was not explicitly found in verified profile descriptions.`
        );
      }
    }

    const isValid = suspiciousClaims.length === 0;

    if (!isValid && options.strict) {
      throw new UnsupportedClaimError(
        `AI generated content contains unsupported claims not backed by verified candidate profile: ${suspiciousClaims.join('; ')}`,
        suspiciousClaims
      );
    }

    return {
      isValid,
      warnings,
      suspiciousClaims,
    };
  }

  /**
   * Validate entire application payload (summary, cover letter, resume bullets)
   */
  validateApplicationMaterials(
    candidate: VerifiedCandidateProfileInput,
    targetJob: TargetJobInput,
    materials: {
      summary?: string;
      coverLetter?: string;
      resumeBullets?: Array<{ bullet: string }>;
    },
    options: { strict?: boolean } = {}
  ): FactValidationResult {
    const allWarnings: string[] = [];
    const allSuspicious: string[] = [];

    const summaryText = materials.summary || (materials as any).applicationSummary;
    if (summaryText) {
      const res = this.validateContent(candidate, targetJob, summaryText, { strict: false });
      allWarnings.push(...res.warnings);
      allSuspicious.push(...res.suspiciousClaims);
    }

    if (materials.coverLetter) {
      const res = this.validateContent(candidate, targetJob, materials.coverLetter, { strict: false });
      allWarnings.push(...res.warnings);
      allSuspicious.push(...res.suspiciousClaims);
    }

    if (materials.resumeBullets) {
      for (const b of materials.resumeBullets) {
        const text = typeof b === 'string' ? b : (b as any)?.bullet || '';
        const res = this.validateContent(candidate, targetJob, text, { strict: false });
        allWarnings.push(...res.warnings);
        allSuspicious.push(...res.suspiciousClaims);
      }
    }

    // Deduplicate
    const uniqueWarnings = Array.from(new Set(allWarnings));
    const uniqueSuspicious = Array.from(new Set(allSuspicious));
    const isValid = uniqueSuspicious.length === 0;

    if (!isValid && options.strict) {
      throw new UnsupportedClaimError(
        `Generated application materials contain unsupported claims: ${uniqueSuspicious.join('; ')}`,
        uniqueSuspicious
      );
    }

    return {
      isValid,
      warnings: uniqueWarnings,
      suspiciousClaims: uniqueSuspicious,
    };
  }
}

export const applicationValidationService = new ApplicationValidationService();
