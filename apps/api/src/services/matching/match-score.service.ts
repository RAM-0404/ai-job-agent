import type { MatchRecommendation, JobMatchScoreBreakdown } from '@ai-job-agent/shared';

export interface ScoreWeights {
  skill: number;
  experience: number;
  role: number;
  preference: number;
  location: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  skill: 0.35,
  experience: 0.25,
  role: 0.20,
  preference: 0.10,
  location: 0.10,
};

export interface CombinedScores {
  overallScore: number;
  scores: JobMatchScoreBreakdown;
  recommendation: MatchRecommendation;
}

export class MatchScoreService {
  /**
   * Determine recommendation tier strictly from application rules (not LLM).
   *
   * Thresholds:
   *  80 - 100 => APPLY
   *  70 - 79  => CONSIDER
   *  60 - 69  => LOW_PRIORITY
   *   0 - 59  => DO_NOT_APPLY
   */
  calculateRecommendation(overallScore: number): MatchRecommendation {
    if (overallScore >= 80) {
      return 'APPLY';
    }
    if (overallScore >= 70) {
      return 'CONSIDER';
    }
    if (overallScore >= 60) {
      return 'LOW_PRIORITY';
    }
    return 'DO_NOT_APPLY';
  }

  /**
   * Blend deterministic scores with AI semantic scores.
   *
   * Weights:
   *  skill: 60% deterministic overlap + 40% semantic skill alignment
   *  role:  50% deterministic role family + 50% AI role alignment
   *  experience: 100% deterministic (grounded in actual years)
   *  preference: 100% deterministic (salary, industry, etc.)
   *  location: 100% deterministic (city, work mode)
   */
  calculateScores(params: {
    deterministicSkillScore: number;
    semanticSkillScore: number;
    deterministicExperienceScore: number;
    deterministicRoleScore: number;
    roleAlignmentScore: number;
    deterministicPreferenceScore: number;
    deterministicLocationScore: number;
  }): CombinedScores {
    // 1. Skill score combination (60% deterministic / 40% semantic)
    const skillScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          params.deterministicSkillScore * 0.60 + params.semanticSkillScore * 0.40
        )
      )
    );

    // 2. Role score combination (50% deterministic / 50% AI)
    const roleScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          params.deterministicRoleScore * 0.50 + params.roleAlignmentScore * 0.50
        )
      )
    );

    // 3. Experience score (primarily deterministic grounded in actual years)
    const experienceScore = Math.max(
      0,
      Math.min(100, Math.round(params.deterministicExperienceScore))
    );

    // 4. Preference score
    const preferenceScore = Math.max(
      0,
      Math.min(100, Math.round(params.deterministicPreferenceScore))
    );

    // 5. Location/work mode score
    const locationScore = Math.max(
      0,
      Math.min(100, Math.round(params.deterministicLocationScore))
    );

    // 6. Overall weighted score
    // (skill * 0.35) + (exp * 0.25) + (role * 0.20) + (pref * 0.10) + (loc * 0.10)
    const rawOverall =
      skillScore * DEFAULT_WEIGHTS.skill +
      experienceScore * DEFAULT_WEIGHTS.experience +
      roleScore * DEFAULT_WEIGHTS.role +
      preferenceScore * DEFAULT_WEIGHTS.preference +
      locationScore * DEFAULT_WEIGHTS.location;

    const overallScore = Math.max(0, Math.min(100, Math.round(rawOverall)));
    const recommendation = this.calculateRecommendation(overallScore);

    return {
      overallScore,
      scores: {
        skill: skillScore,
        experience: experienceScore,
        role: roleScore,
        preference: preferenceScore,
        location: locationScore,
      },
      recommendation,
    };
  }

  /**
   * Deduplicate and combine deterministic and AI strengths/gaps
   */
  mergeStrengthsAndGaps(
    deterministicStrengths: string[],
    aiStrengths: string[],
    deterministicGaps: string[],
    aiGaps: string[]
  ): { strengths: string[]; gaps: string[] } {
    const combinedStrengths = Array.from(
      new Set([...deterministicStrengths, ...aiStrengths].map((s) => s.trim()).filter(Boolean))
    );

    const combinedGaps = Array.from(
      new Set([...deterministicGaps, ...aiGaps].map((g) => g.trim()).filter(Boolean))
    );

    return {
      strengths: combinedStrengths.slice(0, 6),
      gaps: combinedGaps.slice(0, 5),
    };
  }
}

export const matchScoreService = new MatchScoreService();
