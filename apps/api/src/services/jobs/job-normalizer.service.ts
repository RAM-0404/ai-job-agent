import type {
  WorkMode,
  EmploymentType,
  ExperienceLevel,
  RawJobInput,
} from '@ai-job-agent/shared';

export interface NormalizedJobData {
  externalId: string | null;
  title: string;
  companyName: string;
  description: string;
  location: string | null;
  locations: string[];
  workMode: WorkMode;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  applicationUrl: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  rawPayload: any;
}

export class JobNormalizerService {
  /**
   * Normalizes work mode from arbitrary string inputs
   */
  static normalizeWorkMode(value: string | WorkMode | null | undefined): WorkMode {
    if (!value || typeof value !== 'string') return 'UNKNOWN';

    const normalized = value.trim().toLowerCase();

    // Check HYBRID first to avoid matching phrases like "Hybrid (2 days remote)"
    if (
      normalized === 'hybrid' ||
      normalized.includes('hybrid') ||
      normalized === 'partially remote'
    ) {
      return 'HYBRID';
    }

    if (
      normalized === 'remote' ||
      normalized === 'fully remote' ||
      normalized === 'work from home' ||
      normalized === 'wfh' ||
      /\bremote\b/.test(normalized)
    ) {
      return 'REMOTE';
    }

    if (
      normalized === 'onsite' ||
      normalized === 'on-site' ||
      normalized === 'office' ||
      normalized === 'in office' ||
      normalized === 'in-office' ||
      normalized === 'in-person' ||
      /\b(onsite|on-site)\b/.test(normalized)
    ) {
      return 'ONSITE';
    }

    return 'UNKNOWN';
  }

  /**
   * Normalizes employment type from arbitrary string inputs
   */
  static normalizeEmploymentType(value: string | EmploymentType | null | undefined): EmploymentType {
    if (!value || typeof value !== 'string') return 'UNKNOWN';

    const normalized = value.trim().toLowerCase();

    if (
      normalized === 'full_time' ||
      normalized === 'full-time' ||
      normalized === 'fulltime' ||
      normalized === 'full time' ||
      normalized === 'permanent' ||
      normalized === 'regular' ||
      normalized === 'direct hire'
    ) {
      return 'FULL_TIME';
    }

    if (
      normalized === 'part_time' ||
      normalized === 'part-time' ||
      normalized === 'parttime' ||
      normalized === 'part time'
    ) {
      return 'PART_TIME';
    }

    if (
      normalized === 'contract' ||
      normalized === 'contractor' ||
      normalized === 'freelance' ||
      normalized === 'c2c' ||
      normalized === 'c2h' ||
      normalized === '1099'
    ) {
      return 'CONTRACT';
    }

    if (
      normalized === 'internship' ||
      normalized === 'intern' ||
      normalized === 'trainee' ||
      normalized === 'co-op'
    ) {
      return 'INTERNSHIP';
    }

    if (
      normalized === 'temporary' ||
      normalized === 'temp' ||
      normalized === 'seasonal'
    ) {
      return 'TEMPORARY';
    }

    return 'UNKNOWN';
  }

  /**
   * Normalizes experience level from arbitrary string inputs
   */
  static normalizeExperienceLevel(value: string | ExperienceLevel | null | undefined): ExperienceLevel {
    if (!value || typeof value !== 'string') return 'UNKNOWN';

    const normalized = value.trim().toLowerCase();

    if (
      normalized === 'entry' ||
      normalized === 'entry-level' ||
      normalized === 'entry level' ||
      normalized === 'fresher' ||
      normalized === 'graduate' ||
      /^0\s*-\s*[12]\s*years?$/.test(normalized)
    ) {
      return 'ENTRY';
    }

    if (
      normalized === 'junior' ||
      normalized === 'associate' ||
      /^1\s*-\s*[23]\s*years?$/.test(normalized)
    ) {
      return 'JUNIOR';
    }

    if (
      normalized === 'mid' ||
      normalized === 'mid-level' ||
      normalized === 'intermediate' ||
      /^[23]\s*-\s*[45]\s*years?$/.test(normalized)
    ) {
      return 'MID';
    }

    if (
      normalized === 'senior' ||
      normalized === 'sr' ||
      normalized === 'sr.' ||
      /^[56789]\+?\s*(?:-\s*\d+)?\s*years?$/.test(normalized) ||
      /\b5\+\s*years?\b/.test(normalized)
    ) {
      return 'SENIOR';
    }

    if (
      normalized === 'lead' ||
      normalized === 'tech lead' ||
      normalized === 'team lead' ||
      normalized === 'principal' ||
      normalized === 'staff' ||
      normalized === 'architect' ||
      normalized.includes('principal') ||
      normalized.includes('staff') ||
      normalized.includes('tech lead')
    ) {
      return 'LEAD';
    }

    if (
      normalized === 'manager' ||
      normalized === 'engineering manager' ||
      normalized === 'em' ||
      normalized.includes('manager')
    ) {
      return 'MANAGER';
    }

    if (
      normalized === 'director' ||
      normalized === 'vp' ||
      normalized === 'vice president' ||
      normalized === 'head' ||
      normalized.includes('director') ||
      normalized.includes('head of') ||
      normalized.includes('vp')
    ) {
      return 'DIRECTOR';
    }

    return 'UNKNOWN';
  }

  /**
   * Normalizes salary into min, max, and currency values
   */
  static normalizeSalary(input: Partial<RawJobInput> & { salaryRaw?: string }): {
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
  } {
    // 1. If explicit salaryMin/salaryMax are provided
    if (input.salaryMin !== undefined || input.salaryMax !== undefined) {
      return {
        salaryMin: typeof input.salaryMin === 'number' ? Math.round(input.salaryMin) : null,
        salaryMax: typeof input.salaryMax === 'number' ? Math.round(input.salaryMax) : null,
        salaryCurrency: input.salaryCurrency?.trim() || null,
      };
    }

    // 2. If object salary is provided
    if (input.salary && typeof input.salary === 'object') {
      const s = input.salary as { min?: number | null; max?: number | null; currency?: string | null };
      return {
        salaryMin: typeof s.min === 'number' ? Math.round(s.min) : null,
        salaryMax: typeof s.max === 'number' ? Math.round(s.max) : null,
        salaryCurrency: s.currency?.trim() || null,
      };
    }

    // 3. If single number is provided
    if (typeof input.salary === 'number') {
      return {
        salaryMin: Math.round(input.salary),
        salaryMax: Math.round(input.salary),
        salaryCurrency: input.salaryCurrency?.trim() || null,
      };
    }

    // 4. If string salary representation is provided
    const rawSalaryStr = typeof input.salary === 'string' ? input.salary : input.salaryRaw;
    if (typeof rawSalaryStr === 'string') {
      const str = rawSalaryStr.trim();
      if (!str) {
        return { salaryMin: null, salaryMax: null, salaryCurrency: null };
      }

      // Detect Currency
      let currency: string | null = null;
      if (str.includes('$') || /usd/i.test(str)) currency = 'USD';
      else if (str.includes('₹') || /lpa|inr|rs\.?/i.test(str)) currency = 'INR';
      else if (str.includes('€') || /eur/i.test(str)) currency = 'EUR';
      else if (str.includes('£') || /gbp/i.test(str)) currency = 'GBP';
      else if (/cad/i.test(str)) currency = 'CAD';
      else if (/aud/i.test(str)) currency = 'AUD';

      // Strip currency symbols to simplify numeric range parsing
      const cleanStr = str.replace(/[$₹€£]/g, ' ');

      // Case A: LPA (Lakhs Per Annum) e.g. "₹8 LPA - ₹12 LPA", "8-12 LPA", "8 LPA"
      const lpaRangeMatch = /(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l)?\s*[-–—to]+\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l)/i.exec(cleanStr);
      if (lpaRangeMatch) {
        const minLakhs = parseFloat(lpaRangeMatch[1]);
        const maxLakhs = parseFloat(lpaRangeMatch[2]);
        return {
          salaryMin: Math.round(minLakhs * 100000),
          salaryMax: Math.round(maxLakhs * 100000),
          salaryCurrency: currency || 'INR',
        };
      }

      const singleLpaMatch = /(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l)\b/i.exec(cleanStr);
      if (singleLpaMatch) {
        const lakhs = parseFloat(singleLpaMatch[1]);
        return {
          salaryMin: Math.round(lakhs * 100000),
          salaryMax: Math.round(lakhs * 100000),
          salaryCurrency: currency || 'INR',
        };
      }

      // Case B: K format (e.g. "$80k-$100k", "80k - 120k USD", "100k")
      const kRangeMatch = /(\d+(?:\.\d+)?)\s*k\s*[-–—to]+\s*(\d+(?:\.\d+)?)\s*k/i.exec(cleanStr);
      if (kRangeMatch) {
        const minK = parseFloat(kRangeMatch[1]);
        const maxK = parseFloat(kRangeMatch[2]);
        return {
          salaryMin: Math.round(minK * 1000),
          salaryMax: Math.round(maxK * 1000),
          salaryCurrency: currency || 'USD',
        };
      }

      const singleKMatch = /(\d+(?:\.\d+)?)\s*k\b/i.exec(cleanStr);
      if (singleKMatch) {
        const kVal = parseFloat(singleKMatch[1]);
        return {
          salaryMin: Math.round(kVal * 1000),
          salaryMax: Math.round(kVal * 1000),
          salaryCurrency: currency || 'USD',
        };
      }

      // Case C: Standard numeric range e.g. "$120,000 - $150,000" or "800000 - 1200000"
      const rangeMatch = /(\d[\d,]*)\s*[-–—to]+\s*(\d[\d,]*)/i.exec(cleanStr);
      if (rangeMatch) {
        const minNum = parseInt(rangeMatch[1].replace(/,/g, ''), 10);
        const maxNum = parseInt(rangeMatch[2].replace(/,/g, ''), 10);
        if (!Number.isNaN(minNum) && !Number.isNaN(maxNum)) {
          return {
            salaryMin: minNum,
            salaryMax: maxNum,
            salaryCurrency: currency,
          };
        }
      }

      // Case D: Single full number e.g. "$100,000"
      const singleNumMatch = /(\d[\d,]{4,})/i.exec(cleanStr);
      if (singleNumMatch) {
        const num = parseInt(singleNumMatch[1].replace(/,/g, ''), 10);
        if (!Number.isNaN(num)) {
          return {
            salaryMin: num,
            salaryMax: num,
            salaryCurrency: currency,
          };
        }
      }
    }

    return {
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
    };
  }

  /**
   * Safely normalizes and validates external application URLs (only http/https)
   */
  static sanitizeApplicationUrl(url: string | null | undefined): string | null {
    if (!url || typeof url !== 'string') return null;

    const trimmed = url.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parses arbitrary date string / Date into a safe Date object or null
   */
  static parseDate(date: string | Date | null | undefined): Date | null {
    if (!date) return null;
    if (date instanceof Date) {
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof date === 'string') {
      const parsed = new Date(date);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  /**
   * Complete deterministic normalization of raw job input
   */
  static normalizeJob(input: RawJobInput): NormalizedJobData {
    const title = input.title?.trim() || 'Untitled Position';
    const companyName = input.companyName?.trim() || 'Unknown Company';
    const description = input.description?.trim() || '';

    // Locations handling
    let locations: string[] = [];
    if (Array.isArray(input.locations)) {
      locations = input.locations.map((loc) => loc.trim()).filter(Boolean);
    }
    const location = input.location?.trim() || (locations.length > 0 ? locations[0] : null);
    if (location && !locations.includes(location)) {
      locations.unshift(location);
    }

    const workMode = JobNormalizerService.normalizeWorkMode(input.workMode);
    const employmentType = JobNormalizerService.normalizeEmploymentType(input.employmentType);
    const experienceLevel = JobNormalizerService.normalizeExperienceLevel(input.experienceLevel);
    const { salaryMin, salaryMax, salaryCurrency } = JobNormalizerService.normalizeSalary(input);
    const applicationUrl = JobNormalizerService.sanitizeApplicationUrl(input.applicationUrl);
    const publishedAt = JobNormalizerService.parseDate(input.publishedAt);
    const expiresAt = JobNormalizerService.parseDate(input.expiresAt);

    return {
      externalId: input.externalId?.trim() || null,
      title,
      companyName,
      description,
      location,
      locations,
      workMode,
      employmentType,
      experienceLevel,
      salaryMin,
      salaryMax,
      salaryCurrency,
      applicationUrl,
      publishedAt,
      expiresAt,
      rawPayload: input.rawPayload ?? input,
    };
  }

  // Instance methods delegating to static methods
  normalizeWorkMode = JobNormalizerService.normalizeWorkMode;
  normalizeEmploymentType = JobNormalizerService.normalizeEmploymentType;
  normalizeExperienceLevel = JobNormalizerService.normalizeExperienceLevel;
  normalizeSalary = JobNormalizerService.normalizeSalary;
  sanitizeApplicationUrl = JobNormalizerService.sanitizeApplicationUrl;
  parseDate = JobNormalizerService.parseDate;
  normalizeJob = JobNormalizerService.normalizeJob;
}

export const jobNormalizerService = new JobNormalizerService();
