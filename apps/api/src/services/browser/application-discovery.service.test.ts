import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BrowserService } from './browser.service.js';
import { ApplicationDiscoveryService } from './application-discovery.service.js';
import { prisma } from '../../db/prisma.js';

describe('Application Discovery & Form Inspection (Milestone 10.2 Service)', () => {
  let localServer: http.Server;
  let baseUrl: string;
  let browser: BrowserService;
  let discovery: ApplicationDiscoveryService;
  let sessionId: string;
  let testProfileId: string;

  before(async () => {
    // 1. Seed test candidate profile in database to test candidate mapping & missing info detection
    const profile = await prisma.userProfile.create({
      data: {
        fullName: 'Alex Candidate',
        email: `alex.discovery-${Date.now()}@example.com`,
        phone: '+1 555-0144',
        currentTitle: 'Senior Cloud Engineer',
        yearsOfExperience: 6,
        professionalSummary: 'Specialist in cloud infra and distributed APIs.',
        skills: {
          create: [{ name: 'TypeScript', category: 'Language' }],
        },
      },
    });
    testProfileId = profile.id;

    // 2. Spin up local deterministic fixture HTTP server
    await new Promise<void>((resolve) => {
      localServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

        if (req.url === '/application') {
          // Standard application page
          res.end(`<!DOCTYPE html>
<html>
<head><title>Job Application - Cloud Engineer</title></head>
<body>
  <h1>Apply for Cloud Engineer</h1>
  <h2>Candidate Information</h2>
  <form id="app-form" action="/apply" method="POST">
    <label for="name">Full Name *</label>
    <input type="text" id="name" name="fullName" required placeholder="Alex Doe" />

    <label for="email">Email Address</label>
    <input type="email" id="email" name="email" aria-required="true" />

    <label for="phone">Phone Number</label>
    <input type="tel" id="phone" name="phone" />

    <label for="resume">Resume / CV (required)</label>
    <input type="file" id="resume" name="resume" accept=".pdf,.docx" required />

    <label for="coverLetter">Cover Letter</label>
    <textarea id="coverLetter" name="coverLetter"></textarea>

    <label for="experience">Years of Experience *</label>
    <input type="number" id="experience" name="yearsOfExperience" required />

    <label for="workAuth">Are you authorized to work in the US? *</label>
    <select id="workAuth" name="workAuth" required>
      <option value="">Select</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>

    <button type="submit" id="btn-submit">Submit Application</button>
    <button type="button" id="btn-save">Save Draft</button>
  </form>
</body>
</html>`);
        } else if (req.url === '/job-description') {
          // Job description page with Apply links
          res.end(`<!DOCTYPE html>
<html>
<head><title>Staff Engineer Job Listing</title></head>
<body>
  <h1>Staff Infrastructure Engineer</h1>
  <p>Leading distributed platforms team.</p>
  <a href="${baseUrl}/application" class="apply-btn">Apply Now</a>
  <a href="https://external.example.com/apply" class="apply-ext">Apply on Company Site</a>
</body>
</html>`);
        } else if (req.url === '/aria-form') {
          // Form with aria labels, hidden fields, password
          res.end(`<!DOCTYPE html>
<html>
<head><title>Account Verification</title></head>
<body>
  <form id="aria-form">
    <input type="hidden" name="csrf" value="secret123" />
    <label>
      Wrapped Full Name:
      <input type="text" name="wrappedName" />
    </label>
    <input type="email" name="ariaEmail" aria-label="Work Email Address" required />
    <input type="password" name="userPassword" placeholder="Enter password" />
    <button type="submit">Continue</button>
  </form>
</body>
</html>`);
        } else {
          // Plain non-application page
          res.end(`<!DOCTYPE html>
<html>
<head><title>About Acme Technologies</title></head>
<body>
  <h1>Our Mission and Values</h1>
  <p>Acme develops resilient infrastructure software for modern engineering teams.</p>
  <a href="/terms">Terms</a>
</body>
</html>`);
        }
      });

      localServer.listen(0, '127.0.0.1', () => {
        const addr = localServer.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    browser = new BrowserService({
      enabled: true,
      headless: true,
      maxContexts: 1,
    });
    discovery = new ApplicationDiscoveryService(browser);

    const session = await browser.createSession();
    sessionId = session.sessionId;
  });

  after(async () => {
    if (browser) {
      await browser.closeBrowser();
    }
    if (localServer) {
      await new Promise<void>((resolve) => localServer.close(() => resolve()));
    }
    if (testProfileId) {
      await prisma.skill.deleteMany({ where: { userProfileId: testProfileId } }).catch(() => {});
      await prisma.userProfile.deleteMany({ where: { id: testProfileId } }).catch(() => {});
    }
  });

  // A. Application Page Detection & Confidence
  describe('Application Page Detection', () => {
    test('detects application page with high confidence and multiple signals', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/application`, testProfileId);

      assert.equal(result.application.isApplicationPage, true);
      assert.ok(result.application.confidence >= 0.70);
      assert.ok(result.application.signals.includes('resume upload field detected'));
      assert.ok(result.application.signals.includes('submit application button detected'));
      assert.ok(result.application.signals.includes('candidate contact fields detected'));
    });

    test('classifies non-application page as false with low confidence', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/about`);

      assert.equal(result.application.isApplicationPage, false);
      assert.ok(result.application.confidence < 0.40);
      assert.equal(result.forms.length, 0);
    });
  });

  // B. Form & Field Discovery
  describe('Form & Field Structural Inspection', () => {
    test('discovers form attributes and counts accurately', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/application`);

      assert.equal(result.forms.length, 1);
      const form = result.forms[0];
      assert.equal(form.id, 'app-form');
      assert.equal(form.method, 'POST');
      assert.equal(form.surroundingHeading, 'Candidate Information');
      assert.equal(form.buttonCount, 2);
      assert.ok(form.fieldCount >= 6);
    });

    test('discovers fields, tags, and normalized types', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/application`);

      const emailField = result.fields.find((f) => f.name === 'email');
      assert.ok(emailField);
      assert.equal(emailField.type, 'EMAIL');
      assert.equal(emailField.tag, 'input');

      const resumeField = result.fields.find((f) => f.name === 'resume');
      assert.ok(resumeField);
      assert.equal(resumeField.type, 'FILE');
      assert.equal(resumeField.fileConfig?.accept, '.pdf,.docx');

      const coverLetter = result.fields.find((f) => f.name === 'coverLetter');
      assert.ok(coverLetter);
      assert.equal(coverLetter.type, 'TEXTAREA');
      assert.equal(coverLetter.tag, 'textarea');

      const selectField = result.fields.find((f) => f.name === 'workAuth');
      assert.ok(selectField);
      assert.equal(selectField.type, 'SELECT');
      assert.ok(selectField.options && selectField.options.length >= 2);
    });

    test('resolves field labels according to priority rules', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/application`);

      const nameField = result.fields.find((f) => f.name === 'fullName');
      assert.ok(nameField);
      assert.equal(nameField.label, 'Full Name');
      assert.equal(nameField.labelSource, 'label-for');

      const resumeField = result.fields.find((f) => f.name === 'resume');
      assert.ok(resumeField);
      assert.equal(resumeField.label, 'Resume / CV');
    });

    test('detects required fields via attribute, aria, and label markers', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/application`);

      const nameField = result.fields.find((f) => f.name === 'fullName');
      assert.equal(nameField?.required, true);
      assert.equal(nameField?.requirementSource, 'attribute');

      const emailField = result.fields.find((f) => f.name === 'email');
      assert.equal(emailField?.required, true);
      assert.equal(emailField?.requirementSource, 'aria-required');
    });

    test('classifies buttons accurately without clicking them', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/application`);

      const submitBtn = result.buttons.find((b) => b.text.includes('Submit Application'));
      assert.ok(submitBtn);
      assert.equal(submitBtn.classification, 'PRIMARY_APPLICATION_ACTION');

      const saveBtn = result.buttons.find((b) => b.text.includes('Save Draft'));
      assert.ok(saveBtn);
      assert.equal(saveBtn.classification, 'SECONDARY_ACTION');
    });
  });

  // C. Application Target Link Discovery
  describe('Application Target Link Discovery', () => {
    test('discovers application links on job description page without crawling', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/job-description`);

      assert.ok(result.targets.length >= 1);
      const applyNow = result.targets.find((t) => t.text === 'Apply Now');
      assert.ok(applyNow);
      assert.equal(applyNow.type, 'APPLICATION_LINK');
      assert.ok(applyNow.confidence >= 0.85);

      const externalApply = result.targets.find((t) => t.text.includes('Company Site'));
      assert.ok(externalApply);
      assert.equal(externalApply.type, 'EXTERNAL_PORTAL');
    });
  });

  // D. Candidate Field Mapping & Missing Information
  describe('Candidate Field Mapping & Missing Information', () => {
    test('generates candidate mappings for known fields', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/application`, testProfileId);

      const emailMapping = result.candidateMappings.find((m) => m.candidateSource === 'profile.email');
      assert.ok(emailMapping);
      assert.equal(emailMapping.available, true);
      assert.ok(emailMapping.confidence >= 0.90);

      const nameMapping = result.candidateMappings.find((m) => m.candidateSource === 'profile.fullName');
      assert.ok(nameMapping);
      assert.equal(nameMapping.available, true);
    });

    test('identifies missing information for required fields lacking candidate profile data', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/application`, testProfileId);

      // workAuth is required on the page, but no work authorization field exists in UserProfile
      const missingWorkAuth = result.missingInformation.find((m) => m.fieldId === 'workAuth');
      assert.ok(missingWorkAuth);
      assert.equal(missingWorkAuth.required, true);
      assert.ok(missingWorkAuth.reason.includes('candidate profile'));
    });
  });

  // E. Security & Non-Mutation Safeguards
  describe('Security & Observation-Only Safeguards', () => {
    test('never exposes field values or passwords', async () => {
      const result = await discovery.analyzePage(sessionId, `${baseUrl}/aria-form`);

      const passField = result.fields.find((f) => f.name === 'userPassword');
      assert.ok(passField);
      assert.equal(passField.type, 'PASSWORD');
      assert.equal((passField as any).value, undefined);

      const hiddenField = result.fields.find((f) => f.name === 'csrf');
      assert.ok(hiddenField);
      assert.equal(hiddenField.type, 'HIDDEN');
      assert.equal((hiddenField as any).value, undefined);
    });

    test('confirms no database records or mutations were created', async () => {
      const appCount = await prisma.application.count();
      const runCount = await prisma.agentRun.count();
      // Discovery must NOT create Application or AgentRun records
      assert.equal(appCount, 0);
      assert.equal(runCount, 0);
    });
  });
});
