import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchScoreService } from './match-score.service.js';

describe('MatchScoreService - Score Calculation & Weighting (E)', () => {
  test('calculates exact weighted score for benchmark test case', () => {
    // Exact scenario from prompt:
    // skill = 90
    // experience = 80
    // role = 85
    // preference = 70
    // location = 100
    //
    // Deterministic + AI combination inputs that produce these exact dimension scores:
    // skill: 90 (e.g. deterministic: 90, semantic: 90 => 90*0.6 + 90*0.4 = 90)
    // role: 85 (deterministic: 85, ai: 85 => 85*0.5 + 85*0.5 = 85)
    // experience: 80
    // preference: 70
    // location: 100

    const result = matchScoreService.calculateScores({
      deterministicSkillScore: 90,
      semanticSkillScore: 90,
      deterministicExperienceScore: 80,
      deterministicRoleScore: 85,
      roleAlignmentScore: 85,
      deterministicPreferenceScore: 70,
      deterministicLocationScore: 100,
    });

    // 90*0.35 (31.5) + 80*0.25 (20) + 85*0.20 (17) + 70*0.10 (7) + 100*0.10 (10)
    // = 85.5 -> rounds to 86
    assert.equal(result.scores.skill, 90);
    assert.equal(result.scores.experience, 80);
    assert.equal(result.scores.role, 85);
    assert.equal(result.scores.preference, 70);
    assert.equal(result.scores.location, 100);
    assert.equal(result.overallScore, 86);
    assert.equal(result.recommendation, 'APPLY');
  });

  test('blends deterministic and AI scores according to specified weights', () => {
    // skillScore = deterministic * 0.60 + semantic * 0.40
    // 100 * 0.60 + 50 * 0.40 = 60 + 20 = 80
    // roleScore = deterministic * 0.50 + ai * 0.50
    // 80 * 0.50 + 60 * 0.50 = 40 + 30 = 70
    const result = matchScoreService.calculateScores({
      deterministicSkillScore: 100,
      semanticSkillScore: 50,
      deterministicExperienceScore: 60,
      deterministicRoleScore: 80,
      roleAlignmentScore: 60,
      deterministicPreferenceScore: 60,
      deterministicLocationScore: 60,
    });

    assert.equal(result.scores.skill, 80);
    assert.equal(result.scores.role, 70);
  });

  test('verifies recommendation thresholds accurately', () => {
    assert.equal(matchScoreService.calculateRecommendation(95), 'APPLY');
    assert.equal(matchScoreService.calculateRecommendation(80), 'APPLY');
    assert.equal(matchScoreService.calculateRecommendation(79), 'CONSIDER');
    assert.equal(matchScoreService.calculateRecommendation(70), 'CONSIDER');
    assert.equal(matchScoreService.calculateRecommendation(69), 'LOW_PRIORITY');
    assert.equal(matchScoreService.calculateRecommendation(60), 'LOW_PRIORITY');
    assert.equal(matchScoreService.calculateRecommendation(59), 'DO_NOT_APPLY');
    assert.equal(matchScoreService.calculateRecommendation(0), 'DO_NOT_APPLY');
  });

  test('merges and deduplicates deterministic and AI strengths and gaps', () => {
    const { strengths, gaps } = matchScoreService.mergeStrengthsAndGaps(
      ['Matched skills: TypeScript, Node.js', 'Compatible work mode'],
      ['Matched skills: TypeScript, Node.js', 'Strong cloud architectural experience'],
      ['Missing skills: Kubernetes'],
      ['Missing skills: Kubernetes', 'Years of experience below target']
    );

    assert.equal(strengths.length, 3);
    assert.ok(strengths.includes('Matched skills: TypeScript, Node.js'));
    assert.ok(strengths.includes('Strong cloud architectural experience'));

    assert.equal(gaps.length, 2);
    assert.ok(gaps.includes('Missing skills: Kubernetes'));
    assert.ok(gaps.includes('Years of experience below target'));
  });
});
