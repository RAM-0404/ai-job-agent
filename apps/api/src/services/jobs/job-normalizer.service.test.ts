import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JobNormalizerService } from './job-normalizer.service.js';

describe('JobNormalizerService', () => {
  describe('Work Mode Normalization', () => {
    test('normalizes remote variations to REMOTE', () => {
      assert.equal(JobNormalizerService.normalizeWorkMode('remote'), 'REMOTE');
      assert.equal(JobNormalizerService.normalizeWorkMode('fully remote'), 'REMOTE');
      assert.equal(JobNormalizerService.normalizeWorkMode('work from home'), 'REMOTE');
      assert.equal(JobNormalizerService.normalizeWorkMode('WFH'), 'REMOTE');
      assert.equal(JobNormalizerService.normalizeWorkMode('Remote - Global'), 'REMOTE');
    });

    test('normalizes hybrid variations to HYBRID', () => {
      assert.equal(JobNormalizerService.normalizeWorkMode('hybrid'), 'HYBRID');
      assert.equal(JobNormalizerService.normalizeWorkMode('Hybrid (2 days remote)'), 'HYBRID');
    });

    test('normalizes onsite variations to ONSITE', () => {
      assert.equal(JobNormalizerService.normalizeWorkMode('onsite'), 'ONSITE');
      assert.equal(JobNormalizerService.normalizeWorkMode('on-site'), 'ONSITE');
      assert.equal(JobNormalizerService.normalizeWorkMode('office'), 'ONSITE');
      assert.equal(JobNormalizerService.normalizeWorkMode('in office'), 'ONSITE');
      assert.equal(JobNormalizerService.normalizeWorkMode('in-person'), 'ONSITE');
    });

    test('returns UNKNOWN for unrecognizable or absent work mode', () => {
      assert.equal(JobNormalizerService.normalizeWorkMode(null), 'UNKNOWN');
      assert.equal(JobNormalizerService.normalizeWorkMode(undefined), 'UNKNOWN');
      assert.equal(JobNormalizerService.normalizeWorkMode('flexible/travel'), 'UNKNOWN');
      assert.equal(JobNormalizerService.normalizeWorkMode(''), 'UNKNOWN');
    });
  });

  describe('Employment Type Normalization', () => {
    test('normalizes full-time variations to FULL_TIME', () => {
      assert.equal(JobNormalizerService.normalizeEmploymentType('full time'), 'FULL_TIME');
      assert.equal(JobNormalizerService.normalizeEmploymentType('full-time'), 'FULL_TIME');
      assert.equal(JobNormalizerService.normalizeEmploymentType('permanent'), 'FULL_TIME');
      assert.equal(JobNormalizerService.normalizeEmploymentType('direct hire'), 'FULL_TIME');
    });

    test('normalizes part-time variations to PART_TIME', () => {
      assert.equal(JobNormalizerService.normalizeEmploymentType('part-time'), 'PART_TIME');
      assert.equal(JobNormalizerService.normalizeEmploymentType('part time'), 'PART_TIME');
    });

    test('normalizes contract variations to CONTRACT', () => {
      assert.equal(JobNormalizerService.normalizeEmploymentType('contract'), 'CONTRACT');
      assert.equal(JobNormalizerService.normalizeEmploymentType('contractor'), 'CONTRACT');
      assert.equal(JobNormalizerService.normalizeEmploymentType('freelance'), 'CONTRACT');
      assert.equal(JobNormalizerService.normalizeEmploymentType('1099'), 'CONTRACT');
    });

    test('normalizes internship variations to INTERNSHIP', () => {
      assert.equal(JobNormalizerService.normalizeEmploymentType('internship'), 'INTERNSHIP');
      assert.equal(JobNormalizerService.normalizeEmploymentType('intern'), 'INTERNSHIP');
      assert.equal(JobNormalizerService.normalizeEmploymentType('co-op'), 'INTERNSHIP');
    });

    test('normalizes temporary variations to TEMPORARY', () => {
      assert.equal(JobNormalizerService.normalizeEmploymentType('temporary'), 'TEMPORARY');
      assert.equal(JobNormalizerService.normalizeEmploymentType('temp'), 'TEMPORARY');
      assert.equal(JobNormalizerService.normalizeEmploymentType('seasonal'), 'TEMPORARY');
    });

    test('returns UNKNOWN for ambiguous or empty employment types', () => {
      assert.equal(JobNormalizerService.normalizeEmploymentType(null), 'UNKNOWN');
      assert.equal(JobNormalizerService.normalizeEmploymentType(undefined), 'UNKNOWN');
      assert.equal(JobNormalizerService.normalizeEmploymentType('volunteer'), 'UNKNOWN');
    });
  });

  describe('Experience Level Normalization', () => {
    test('normalizes entry level keywords and years', () => {
      assert.equal(JobNormalizerService.normalizeExperienceLevel('entry'), 'ENTRY');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('entry level'), 'ENTRY');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('0-1 years'), 'ENTRY');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('0-2 years'), 'ENTRY');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('graduate'), 'ENTRY');
    });

    test('normalizes junior level', () => {
      assert.equal(JobNormalizerService.normalizeExperienceLevel('junior'), 'JUNIOR');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('associate'), 'JUNIOR');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('1-3 years'), 'JUNIOR');
    });

    test('normalizes mid level', () => {
      assert.equal(JobNormalizerService.normalizeExperienceLevel('mid'), 'MID');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('mid-level'), 'MID');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('2-5 years'), 'MID');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('3-5 years'), 'MID');
    });

    test('normalizes senior level', () => {
      assert.equal(JobNormalizerService.normalizeExperienceLevel('senior'), 'SENIOR');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('sr.'), 'SENIOR');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('5+ years'), 'SENIOR');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('5-8 years'), 'SENIOR');
    });

    test('normalizes lead and management levels', () => {
      assert.equal(JobNormalizerService.normalizeExperienceLevel('lead'), 'LEAD');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('tech lead'), 'LEAD');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('staff engineer'), 'LEAD');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('principal engineer'), 'LEAD');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('engineering manager'), 'MANAGER');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('director of engineering'), 'DIRECTOR');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('vp of engineering'), 'DIRECTOR');
    });

    test('returns UNKNOWN for unrecognizable or unspecified experience level', () => {
      assert.equal(JobNormalizerService.normalizeExperienceLevel(null), 'UNKNOWN');
      assert.equal(JobNormalizerService.normalizeExperienceLevel(undefined), 'UNKNOWN');
      assert.equal(JobNormalizerService.normalizeExperienceLevel('experienced professional'), 'UNKNOWN');
    });
  });

  describe('Salary Normalization', () => {
    test('normalizes Indian Rupee LPA format (e.g. ₹8 LPA - ₹12 LPA)', () => {
      const res = JobNormalizerService.normalizeSalary({ salaryRaw: '₹8 LPA - ₹12 LPA' });
      assert.equal(res.salaryMin, 800000);
      assert.equal(res.salaryMax, 1200000);
      assert.equal(res.salaryCurrency, 'INR');
    });

    test('normalizes single LPA format (e.g. 15 LPA)', () => {
      const res = JobNormalizerService.normalizeSalary({ salaryRaw: '15 LPA' });
      assert.equal(res.salaryMin, 1500000);
      assert.equal(res.salaryMax, 1500000);
      assert.equal(res.salaryCurrency, 'INR');
    });

    test('normalizes US Dollar K format (e.g. $80k-$100k)', () => {
      const res = JobNormalizerService.normalizeSalary({ salaryRaw: '$80k-$100k' });
      assert.equal(res.salaryMin, 80000);
      assert.equal(res.salaryMax, 100000);
      assert.equal(res.salaryCurrency, 'USD');
    });

    test('normalizes comma-separated full currency ranges (e.g. $120,000 - $150,000)', () => {
      const res = JobNormalizerService.normalizeSalary({ salaryRaw: '$120,000 - $150,000' });
      assert.equal(res.salaryMin, 120000);
      assert.equal(res.salaryMax, 150000);
      assert.equal(res.salaryCurrency, 'USD');
    });

    test('normalizes Euro and GBP currencies', () => {
      const euroRes = JobNormalizerService.normalizeSalary({ salaryRaw: '€50,000 - €70,000' });
      assert.equal(euroRes.salaryMin, 50000);
      assert.equal(euroRes.salaryMax, 70000);
      assert.equal(euroRes.salaryCurrency, 'EUR');

      const gbpRes = JobNormalizerService.normalizeSalary({ salaryRaw: '£60,000 - £80,000' });
      assert.equal(gbpRes.salaryMin, 60000);
      assert.equal(gbpRes.salaryMax, 80000);
      assert.equal(gbpRes.salaryCurrency, 'GBP');
    });

    test('preserves explicit numeric salary inputs', () => {
      const res = JobNormalizerService.normalizeSalary({
        salaryMin: 500000,
        salaryMax: 900000,
        salaryCurrency: 'INR',
      });
      assert.equal(res.salaryMin, 500000);
      assert.equal(res.salaryMax, 900000);
      assert.equal(res.salaryCurrency, 'INR');
    });

    test('returns null fields when salary is unspecified or non-numeric', () => {
      const res1 = JobNormalizerService.normalizeSalary({});
      assert.equal(res1.salaryMin, null);
      assert.equal(res1.salaryMax, null);
      assert.equal(res1.salaryCurrency, null);

      const res2 = JobNormalizerService.normalizeSalary({ salaryRaw: 'Competitive, depending on experience' });
      assert.equal(res2.salaryMin, null);
      assert.equal(res2.salaryMax, null);
      assert.equal(res2.salaryCurrency, null);
    });
  });

  describe('Application URL Sanitization', () => {
    test('accepts valid http and https URLs', () => {
      assert.equal(
        JobNormalizerService.sanitizeApplicationUrl('https://example.com/apply/123'),
        'https://example.com/apply/123'
      );
      assert.equal(
        JobNormalizerService.sanitizeApplicationUrl('http://jobs.org/apply'),
        'http://jobs.org/apply'
      );
    });

    test('rejects unsafe protocols (javascript, data, file)', () => {
      assert.equal(JobNormalizerService.sanitizeApplicationUrl('javascript:alert(document.cookie)'), null);
      assert.equal(JobNormalizerService.sanitizeApplicationUrl('data:text/html,<script>alert(1)</script>'), null);
      assert.equal(JobNormalizerService.sanitizeApplicationUrl('file:///etc/passwd'), null);
      assert.equal(JobNormalizerService.sanitizeApplicationUrl('ftp://example.com/job'), null);
    });

    test('rejects malformed or empty URLs', () => {
      assert.equal(JobNormalizerService.sanitizeApplicationUrl('not-a-valid-url'), null);
      assert.equal(JobNormalizerService.sanitizeApplicationUrl(''), null);
      assert.equal(JobNormalizerService.sanitizeApplicationUrl(null), null);
      assert.equal(JobNormalizerService.sanitizeApplicationUrl(undefined), null);
    });
  });

  describe('Full Job Input Normalization', () => {
    test('normalizes a complete input record correctly', () => {
      const normalized = JobNormalizerService.normalizeJob({
        externalId: 'ext-999',
        title: ' Senior Full Stack Engineer ',
        companyName: ' Tech Solutions Inc ',
        description: 'Great opportunity for a senior developer.',
        location: 'Coimbatore, Tamil Nadu',
        locations: ['Coimbatore', 'Chennai'],
        workMode: 'fully remote',
        employmentType: 'full-time',
        experienceLevel: '5+ years',
        salary: '₹12 LPA - ₹18 LPA',
        applicationUrl: 'https://techsolutions.com/careers/999',
        publishedAt: '2026-10-01T00:00:00.000Z',
      });

      assert.equal(normalized.externalId, 'ext-999');
      assert.equal(normalized.title, 'Senior Full Stack Engineer');
      assert.equal(normalized.companyName, 'Tech Solutions Inc');
      assert.equal(normalized.location, 'Coimbatore, Tamil Nadu');
      assert.deepEqual(normalized.locations, ['Coimbatore, Tamil Nadu', 'Coimbatore', 'Chennai']);
      assert.equal(normalized.workMode, 'REMOTE');
      assert.equal(normalized.employmentType, 'FULL_TIME');
      assert.equal(normalized.experienceLevel, 'SENIOR');
      assert.equal(normalized.salaryMin, 1200000);
      assert.equal(normalized.salaryMax, 1800000);
      assert.equal(normalized.salaryCurrency, 'INR');
      assert.equal(normalized.applicationUrl, 'https://techsolutions.com/careers/999');
      assert.ok(normalized.publishedAt instanceof Date);
    });
  });
});
