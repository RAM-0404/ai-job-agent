import type {
  Job,
  WorkMode,
  ExperienceLevel,
} from '@ai-job-agent/shared';

export type RoleFamily =
  | 'PRODUCT'
  | 'ENGINEERING'
  | 'PROJECT_MANAGEMENT'
  | 'DATA'
  | 'DEVOPS'
  | 'QA'
  | 'DESIGN'
  | 'OTHER';

export interface CandidateProfileData {
  id: string;
  fullName: string;
  currentTitle: string | null;
  yearsOfExperience: number | null;
  skills: { name: string; category?: string | null; proficiency?: string | null }[];
  experiences: {
    company: string;
    jobTitle: string;
    description?: string | null;
  }[];
  jobPreferences?: {
    preferredRoles: string[];
    preferredLocations: string[];
    workModes: string[];
    preferredIndustries: string[];
    minimumSalary: number | null;
    salaryCurrency: string | null;
  } | null;
}

export interface DeterministicMatchResult {
  deterministicSkillScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  deterministicExperienceScore: number;
  deterministicRoleScore: number;
  candidateRoleFamily: RoleFamily;
  jobRoleFamily: RoleFamily;
  deterministicPreferenceScore: number;
  deterministicLocationScore: number;
}

export class DeterministicMatchService {
  /**
   * Curated canonical technology synonym mappings.
   * Maps common variations to canonical lowercase identifiers.
   */
  private static readonly TECH_SYNONYMS: Record<string, string> = {
    // Node
    nodejs: 'nodejs',
    'node.js': 'nodejs',
    node: 'nodejs',

    // PostgreSQL
    postgres: 'postgresql',
    postgresql: 'postgresql',
    'postgres sql': 'postgresql',

    // JavaScript
    javascript: 'javascript',
    js: 'javascript',
    'es6+': 'javascript',

    // TypeScript
    typescript: 'typescript',
    ts: 'typescript',

    // React
    react: 'react',
    reactjs: 'react',
    'react.js': 'react',

    // Vue
    vue: 'vue',
    vuejs: 'vue',
    'vue.js': 'vue',

    // Angular
    angular: 'angular',
    angularjs: 'angular',
    'angular.js': 'angular',

    // Go
    golang: 'go',
    go: 'go',

    // Kubernetes
    k8s: 'kubernetes',
    kubernetes: 'kubernetes',

    // Cloud Providers
    aws: 'aws',
    'amazon web services': 'aws',
    gcp: 'gcp',
    'google cloud': 'gcp',
    'google cloud platform': 'gcp',
    azure: 'azure',
    'microsoft azure': 'azure',

    // Databases
    mongo: 'mongodb',
    mongodb: 'mongodb',
    redis: 'redis',
    mysql: 'mysql',
    sqlite: 'sqlite',

    // Backend Frameworks
    express: 'express',
    expressjs: 'express',
    'express.js': 'express',
    fastify: 'fastify',
    nest: 'nestjs',
    nestjs: 'nestjs',
    'nest.js': 'nestjs',
    django: 'django',
    flask: 'flask',
    spring: 'spring',
    'spring boot': 'spring',

    // DevOps / Tools
    docker: 'docker',
    git: 'git',
    graphql: 'graphql',
    gql: 'graphql',
    rest: 'rest',
    'rest api': 'rest',
    'restful api': 'rest',
    ci: 'ci/cd',
    cd: 'ci/cd',
    'ci/cd': 'ci/cd',

    // Web Standards
    html: 'html',
    html5: 'html',
    css: 'css',
    css3: 'css',
    tailwind: 'tailwindcss',
    tailwindcss: 'tailwindcss',
    sass: 'sass',
    scss: 'sass',
  };

  /**
   * Normalizes a technology or skill name to its canonical form
   */
  static normalizeSkill(skill: string): string {
    const clean = skill.trim().toLowerCase();
    return this.TECH_SYNONYMS[clean] || clean;
  }

  /**
   * Determines the RoleFamily for a job title
   */
  static getRoleFamily(title: string | null | undefined): RoleFamily {
    if (!title || !title.trim()) return 'OTHER';
    const t = title.toLowerCase();

    // 1. PRODUCT
    if (
      t.includes('product owner') ||
      t.includes('product manager') ||
      t.includes('technical product') ||
      t.includes('group product') ||
      t.includes('director of product') ||
      t.includes('head of product') ||
      t.includes('vp of product') ||
      /\bpo\b/.test(t) ||
      /\bpm\b/.test(t)
    ) {
      return 'PRODUCT';
    }

    // 2. DATA / AI / ML
    if (
      t.includes('data scientist') ||
      t.includes('data engineer') ||
      t.includes('machine learning') ||
      t.includes('ml engineer') ||
      t.includes('ai engineer') ||
      t.includes('bi analyst') ||
      t.includes('analytics')
    ) {
      return 'DATA';
    }

    // 3. DEVOPS / CLOUD / SRE
    if (
      t.includes('devops') ||
      t.includes('site reliability') ||
      t.includes('sre') ||
      t.includes('cloud engineer') ||
      t.includes('platform engineer') ||
      t.includes('infrastructure') ||
      t.includes('systems engineer')
    ) {
      return 'DEVOPS';
    }

    // 4. QA / TEST
    if (
      t.includes('qa') ||
      t.includes('quality assurance') ||
      t.includes('test engineer') ||
      t.includes('sdet') ||
      t.includes('automation engineer')
    ) {
      return 'QA';
    }

    // 5. PROJECT / AGILE / SCRUM
    if (
      t.includes('project manager') ||
      t.includes('scrum master') ||
      t.includes('program manager') ||
      t.includes('agile coach') ||
      t.includes('delivery manager')
    ) {
      return 'PROJECT_MANAGEMENT';
    }

    // 6. DESIGN
    if (
      t.includes('designer') ||
      t.includes('ui/ux') ||
      t.includes('ux researcher') ||
      t.includes('product design')
    ) {
      return 'DESIGN';
    }

    // 7. SOFTWARE ENGINEERING (broad developer/architect roles)
    if (
      t.includes('engineer') ||
      t.includes('developer') ||
      t.includes('architect') ||
      t.includes('programmer') ||
      t.includes('frontend') ||
      t.includes('backend') ||
      t.includes('full stack') ||
      t.includes('fullstack') ||
      t.includes('software')
    ) {
      return 'ENGINEERING';
    }

    return 'OTHER';
  }

  /**
   * Deterministic Skill Matching
   * Compares candidate skills with tech keywords mentioned in the job title and description
   */
  static matchSkills(
    candidateSkills: { name: string }[],
    job: Job
  ): {
    score: number;
    matchedSkills: string[];
    missingSkills: string[];
  } {
    if (!candidateSkills || candidateSkills.length === 0) {
      return { score: 40, matchedSkills: [], missingSkills: [] };
    }

    // Build set of canonical candidate skills
    const candidateSkillMap = new Map<string, string>(); // canonical -> original
    for (const s of candidateSkills) {
      if (s.name && s.name.trim()) {
        const canonical = this.normalizeSkill(s.name);
        candidateSkillMap.set(canonical, s.name.trim());
      }
    }

    // Extract detected skills from Job (scan job title and description for tech keywords)
    const textToScan = `${job.title} ${job.description}`.toLowerCase();
    const detectedJobSkills = new Set<string>();

    // 1. Scan for any candidate skills directly mentioned in the job text
    for (const [canonical, original] of candidateSkillMap.entries()) {
      const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|[^a-zA-Z0-9#+])${escaped}(?:$|[^a-zA-Z0-9#+])`, 'i');
      if (pattern.test(textToScan)) {
        detectedJobSkills.add(canonical);
      }
    }

    // 2. Scan for other common standard technologies mentioned in the job
    for (const syn in this.TECH_SYNONYMS) {
      const canonical = this.TECH_SYNONYMS[syn];
      const escaped = syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|[^a-zA-Z0-9#+])${escaped}(?:$|[^a-zA-Z0-9#+])`, 'i');
      if (pattern.test(textToScan)) {
        detectedJobSkills.add(canonical);
      }
    }

    // If job does not mention detectable technical keywords, return a neutral score
    if (detectedJobSkills.size === 0) {
      return { score: 75, matchedSkills: [], missingSkills: [] };
    }

    const matched: string[] = [];
    const missing: string[] = [];

    for (const jobSkill of detectedJobSkills) {
      if (candidateSkillMap.has(jobSkill)) {
        matched.push(candidateSkillMap.get(jobSkill) || jobSkill);
      } else {
        missing.push(jobSkill);
      }
    }

    const ratio = matched.length / detectedJobSkills.size;
    let score = Math.round(ratio * 100);

    // Give a small baseline boost if at least 1 key skill matched
    if (matched.length > 0 && score < 50) {
      score = 50;
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      matchedSkills: matched,
      missingSkills: missing,
    };
  }

  /**
   * Deterministic Experience Matching
   * Compares candidate yearsOfExperience with job experienceLevel and description requirements
   */
  static matchExperience(
    candidateYears: number | null | undefined,
    job: Job
  ): number {
    if (candidateYears === null || candidateYears === undefined) {
      return 65; // Neutral baseline for missing candidate experience
    }

    const candidateExp = candidateYears;

    // 1. Try to extract explicit experience requirement from text (e.g. "3-5 years", "5+ years", "8 years")
    const text = `${job.title} ${job.description}`.toLowerCase();
    const rangeMatch = /(\d+)\s*[-–—to]+\s*(\d+)\s*years?/i.exec(text);
    const plusMatch = /(\d+)\s*\+\s*years?/i.exec(text);
    const singleMatch = /(\d+)\s*years?\s*(?:of\s*)?experience/i.exec(text);

    let minYears = 0;
    let maxYears: number | null = null;

    if (rangeMatch) {
      minYears = parseInt(rangeMatch[1], 10);
      maxYears = parseInt(rangeMatch[2], 10);
    } else if (plusMatch) {
      minYears = parseInt(plusMatch[1], 10);
    } else if (singleMatch) {
      minYears = parseInt(singleMatch[1], 10);
    } else {
      // Map from Job.experienceLevel enum
      switch (job.experienceLevel as string) {
        case 'ENTRY':
          minYears = 0;
          maxYears = 2;
          break;
        case 'JUNIOR':
          minYears = 1;
          maxYears = 3;
          break;
        case 'MID':
        case 'MID_LEVEL':
          minYears = 2;
          maxYears = 5;
          break;
        case 'SENIOR':
          minYears = 5;
          maxYears = 8;
          break;
        case 'LEAD':
          minYears = 7;
          maxYears = 10;
          break;
        case 'MANAGER':
          minYears = 6;
          maxYears = 10;
          break;
        case 'DIRECTOR':
          minYears = 10;
          maxYears = null;
          break;
        default:
          // UNKNOWN
          return 75; // Neutral
      }
    }

    // Evaluate candidate experience against minYears & maxYears
    if (maxYears !== null && candidateExp >= minYears && candidateExp <= maxYears) {
      return 100; // Perfect range fit
    }

    if (maxYears === null && candidateExp >= minYears) {
      return 100; // Met or exceeded open-ended requirement
    }

    // Exceeding the maximum: DO NOT PENALIZE HEAVILY.
    // Exceeding experience is positive; slight discount from 100 down to 88-95.
    if (maxYears !== null && candidateExp > maxYears) {
      const overBy = candidateExp - maxYears;
      return Math.max(88, 95 - overBy);
    }

    // Below the minimum requirement: graduated score
    if (candidateExp < minYears) {
      const gap = minYears - candidateExp;
      if (gap <= 1) return 75;
      if (gap <= 2) return 60;
      if (gap <= 3) return 45;
      return 30;
    }

    return 80;
  }

  /**
   * Deterministic Role Matching
   * Compares candidate currentTitle / preferredRoles with Job.title and role family
   */
  static matchRole(candidate: CandidateProfileData, job: Job): {
    score: number;
    candidateFamily: RoleFamily;
    jobFamily: RoleFamily;
  } {
    const jobFamily = this.getRoleFamily(job.title);
    const candidateFamily = this.getRoleFamily(candidate.currentTitle);

    const jobTitleClean = job.title.trim().toLowerCase();
    const candidateTitleClean = (candidate.currentTitle || '').trim().toLowerCase();

    // 1. Exact or near-exact title match
    if (candidateTitleClean && (jobTitleClean === candidateTitleClean || jobTitleClean.includes(candidateTitleClean) || candidateTitleClean.includes(jobTitleClean))) {
      return { score: 95, candidateFamily, jobFamily };
    }

    // 2. Check candidate preferred roles
    if (candidate.jobPreferences?.preferredRoles && candidate.jobPreferences.preferredRoles.length > 0) {
      for (const prefRole of candidate.jobPreferences.preferredRoles) {
        const prefClean = prefRole.trim().toLowerCase();
        if (jobTitleClean === prefClean || jobTitleClean.includes(prefClean) || prefClean.includes(jobTitleClean)) {
          return { score: 95, candidateFamily, jobFamily };
        }
        if (this.getRoleFamily(prefRole) === jobFamily) {
          return { score: 85, candidateFamily, jobFamily };
        }
      }
    }

    // 3. Same Role Family (e.g. Product Owner vs Technical Product Manager)
    if (candidateFamily !== 'OTHER' && candidateFamily === jobFamily) {
      return { score: 80, candidateFamily, jobFamily };
    }

    // 4. Adjacent Role Families
    const isAdjacent =
      (candidateFamily === 'PRODUCT' && jobFamily === 'PROJECT_MANAGEMENT') ||
      (candidateFamily === 'PROJECT_MANAGEMENT' && jobFamily === 'PRODUCT') ||
      (candidateFamily === 'ENGINEERING' && jobFamily === 'DEVOPS') ||
      (candidateFamily === 'DEVOPS' && jobFamily === 'ENGINEERING') ||
      (candidateFamily === 'ENGINEERING' && jobFamily === 'QA') ||
      (candidateFamily === 'QA' && jobFamily === 'ENGINEERING') ||
      (candidateFamily === 'ENGINEERING' && jobFamily === 'DATA') ||
      (candidateFamily === 'DATA' && jobFamily === 'ENGINEERING');

    if (isAdjacent) {
      return { score: 65, candidateFamily, jobFamily };
    }

    // 5. Unrelated Role Families
    if (candidateFamily !== 'OTHER' && jobFamily !== 'OTHER') {
      return { score: 35, candidateFamily, jobFamily };
    }

    return { score: 70, candidateFamily, jobFamily };
  }

  /**
   * Deterministic Preference Matching (Salary, Industry)
   */
  static matchPreferences(candidate: CandidateProfileData, job: Job): number {
    const prefs = candidate.jobPreferences;
    if (!prefs) {
      return 70; // Neutral default when no preferences defined
    }

    let subScores: number[] = [];

    // Salary comparison
    if (
      prefs.minimumSalary &&
      (job.salaryMax !== null || job.salaryMin !== null) &&
      prefs.salaryCurrency &&
      job.salaryCurrency &&
      prefs.salaryCurrency.toUpperCase() === job.salaryCurrency.toUpperCase()
    ) {
      const offeredSalary = job.salaryMax ?? job.salaryMin ?? 0;
      if (offeredSalary >= prefs.minimumSalary) {
        subScores.push(100);
      } else {
        const ratio = offeredSalary / prefs.minimumSalary;
        subScores.push(Math.round(Math.max(20, ratio * 70)));
      }
    }

    // Industry comparison
    if (prefs.preferredIndustries && prefs.preferredIndustries.length > 0) {
      const jobDesc = `${job.companyName} ${job.description}`.toLowerCase();
      const matchedIndustry = prefs.preferredIndustries.some((ind) =>
        jobDesc.includes(ind.toLowerCase().trim())
      );
      subScores.push(matchedIndustry ? 95 : 65);
    }

    if (subScores.length === 0) {
      return 70; // Neutral
    }

    const avg = subScores.reduce((a, b) => a + b, 0) / subScores.length;
    return Math.round(avg);
  }

  /**
   * Deterministic Location & Work Mode Matching
   */
  static matchLocationAndWorkMode(candidate: CandidateProfileData, job: Job): number {
    const prefs = candidate.jobPreferences;

    // 1. Work Mode Matching
    let workModeScore = 75; // Neutral default
    if (prefs?.workModes && prefs.workModes.length > 0) {
      const candModes = prefs.workModes.map((m) => m.toUpperCase().trim());
      const jobMode = job.workMode.toUpperCase();

      if (candModes.includes(jobMode)) {
        workModeScore = 100;
      } else if (candModes.includes('REMOTE') && jobMode === 'HYBRID') {
        workModeScore = 65;
      } else if (candModes.includes('HYBRID') && jobMode === 'REMOTE') {
        workModeScore = 95;
      } else if (candModes.includes('REMOTE') && jobMode === 'ONSITE') {
        workModeScore = 30;
      } else {
        workModeScore = 50;
      }
    } else if (job.workMode === 'REMOTE') {
      workModeScore = 90;
    }

    // 2. Location Matching
    let locationScore = 75; // Neutral default
    if (job.workMode === 'REMOTE') {
      locationScore = 100; // Remote jobs are universally accessible
    } else if (prefs?.preferredLocations && prefs.preferredLocations.length > 0) {
      const jobLocations = [job.location, ...job.locations]
        .filter(Boolean)
        .map((loc) => loc!.toLowerCase());

      let isLocationMatch = false;
      for (const prefLoc of prefs.preferredLocations) {
        const cleanPref = prefLoc.toLowerCase().trim().replace(/,/g, '');
        // Extract primary city e.g. "coimbatore tamil nadu" -> "coimbatore"
        const prefTokens = cleanPref.split(/\s+/);
        const primaryCity = prefTokens[0];

        for (const jLoc of jobLocations) {
          const cleanJLoc = jLoc.replace(/,/g, '');
          if (cleanJLoc.includes(primaryCity) || primaryCity.includes(cleanJLoc)) {
            isLocationMatch = true;
            break;
          }
        }
        if (isLocationMatch) break;
      }

      locationScore = isLocationMatch ? 100 : 35;
    }

    // Equal weighting: 50% location + 50% work mode
    return Math.round(locationScore * 0.5 + workModeScore * 0.5);
  }

  /**
   * Complete deterministic calculation
   */
  static evaluate(candidate: CandidateProfileData, job: Job): DeterministicMatchResult {
    const { score: skillScore, matchedSkills, missingSkills } = this.matchSkills(
      candidate.skills,
      job
    );
    const experienceScore = this.matchExperience(candidate.yearsOfExperience, job);
    const { score: roleScore, candidateFamily, jobFamily } = this.matchRole(candidate, job);
    const preferenceScore = this.matchPreferences(candidate, job);
    const locationScore = this.matchLocationAndWorkMode(candidate, job);

    return {
      deterministicSkillScore: skillScore,
      matchedSkills,
      missingSkills,
      deterministicExperienceScore: experienceScore,
      deterministicRoleScore: roleScore,
      candidateRoleFamily: candidateFamily,
      jobRoleFamily: jobFamily,
      deterministicPreferenceScore: preferenceScore,
      deterministicLocationScore: locationScore,
    };
  }
}
