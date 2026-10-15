import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  JobMatchAIService,
  AIOutputValidationError,
} from './job-match-ai.service.js';
import {
  OllamaService,
  OllamaTimeoutError,
  OllamaConnectionError,
} from './ollama.service.js';

describe('JobMatchAIService - Ollama Semantic Analysis (F)', () => {
  const dummyCandidate = {
    currentTitle: 'Senior Full Stack Developer',
    yearsOfExperience: 6,
    skills: [{ name: 'TypeScript' }, { name: 'Node.js' }],
  };

  const dummyJob = {
    title: 'Senior Software Engineer',
    company: 'Acme Corp',
    description: 'Looking for a senior engineer with Node.js and cloud experience.',
  };

  test('successfully parses and validates conforming AI output', async () => {
    const mockOllama = {
      generateStructured: async () => ({
        semanticSkillScore: 88,
        roleAlignmentScore: 90,
        responsibilityAlignmentScore: 85,
        strengths: ['Strong production Node.js experience', 'Deep TypeScript expertise'],
        gaps: ['No direct AWS cloud experience mentioned'],
        explanation: 'Candidate is an excellent technical and role match with strong foundational skills.',
      }),
    } as unknown as OllamaService;

    const service = new JobMatchAIService(mockOllama);
    const result = await service.analyzeMatch(dummyCandidate, dummyJob);

    assert.equal(result.semanticSkillScore, 88);
    assert.equal(result.roleAlignmentScore, 90);
    assert.equal(result.responsibilityAlignmentScore, 85);
    assert.equal(result.strengths.length, 2);
    assert.equal(result.gaps.length, 1);
    assert.ok(result.explanation.includes('excellent technical'));
  });

  test('throws AIOutputValidationError when AI response contains invalid score out of bounds', async () => {
    const mockOllama = {
      generateStructured: async () => ({
        semanticSkillScore: 150, // Invalid: exceeds 100
        roleAlignmentScore: 80,
        responsibilityAlignmentScore: 80,
        strengths: ['Great skills'],
        gaps: [],
        explanation: 'Fit is okay.',
      }),
    } as unknown as OllamaService;

    const service = new JobMatchAIService(mockOllama);

    await assert.rejects(
      async () => {
        await service.analyzeMatch(dummyCandidate, dummyJob);
      },
      (err: unknown) => {
        assert.ok(err instanceof AIOutputValidationError);
        assert.ok(err.message.includes('semanticSkillScore'));
        return true;
      }
    );
  });

  test('throws AIOutputValidationError when AI response misses required fields', async () => {
    const mockOllama = {
      generateStructured: async () => ({
        semanticSkillScore: 75,
        // Missing roleAlignmentScore, responsibilityAlignmentScore, explanation
      }),
    } as unknown as OllamaService;

    const service = new JobMatchAIService(mockOllama);

    await assert.rejects(
      async () => {
        await service.analyzeMatch(dummyCandidate, dummyJob);
      },
      (err: unknown) => {
        assert.ok(err instanceof AIOutputValidationError);
        return true;
      }
    );
  });

  test('propagates OllamaTimeoutError when generation exceeds timeout threshold', async () => {
    const mockOllama = {
      generateStructured: async () => {
        throw new OllamaTimeoutError('Generation timed out after 60000ms');
      },
    } as unknown as OllamaService;

    const service = new JobMatchAIService(mockOllama);

    await assert.rejects(
      async () => {
        await service.analyzeMatch(dummyCandidate, dummyJob);
      },
      (err: unknown) => {
        assert.ok(err instanceof OllamaTimeoutError);
        assert.equal(err.statusCode, 504);
        return true;
      }
    );
  });

  test('propagates OllamaConnectionError when local Ollama is unreachable', async () => {
    const mockOllama = {
      generateStructured: async () => {
        throw new OllamaConnectionError('Cannot reach Ollama at http://127.0.0.1:11434');
      },
    } as unknown as OllamaService;

    const service = new JobMatchAIService(mockOllama);

    await assert.rejects(
      async () => {
        await service.analyzeMatch(dummyCandidate, dummyJob);
      },
      (err: unknown) => {
        assert.ok(err instanceof OllamaConnectionError);
        assert.equal(err.statusCode, 503);
        return true;
      }
    );
  });
});
