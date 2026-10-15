import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserService } from './browser.service.js';
import { ApplicationDiscoveryService } from './application-discovery.service.js';
import { AutofillService } from './autofill.service.js';
import { config } from '../../config/env.js';
import type { ApplicationPageAnalysisDto } from './autofill.types.js';

describe('Controlled Browser Autofill Preview (Milestone 11 Service Tests)', () => {
  let localServer: http.Server;
  let serverPort: number;
  let testUrl: string;
  let browser: BrowserService;
  let discovery: ApplicationDiscoveryService;
  let autofill: AutofillService;
  let sessionId: string;
  let discoveryResult: ApplicationPageAnalysisDto;
  let dummyResumePath: string;

  let formSubmissionCount = 0;

  before(async () => {
    browser = new BrowserService({ enabled: true, headless: true });
    discovery = new ApplicationDiscoveryService(browser);
    autofill = new AutofillService(browser);

    // Create a dummy resume in configured uploadDir for file test
    await fs.mkdir(config.uploadDir, { recursive: true });
    dummyResumePath = path.resolve(config.uploadDir, 'test-candidate-resume.pdf');
    await fs.writeFile(dummyResumePath, '%PDF-1.4 dummy resume content for M11 tests');

    // Spin up local deterministic fixture HTTP server
    await new Promise<void>((resolve) => {
      localServer = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/submit') {
          formSubmissionCount++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ submitted: true, count: formSubmissionCount }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>M11 Controlled Autofill Test Fixture</title></head>
<body>
  <h1>Test Application Form</h1>
  <form id="app-form" action="/submit" method="POST">
    <label for="fullName">Full Name</label>
    <input type="text" id="fullName" name="fullName" required value="" />

    <label for="email">Email</label>
    <input type="email" id="email" name="email" required value="" />

    <label for="phone">Phone</label>
    <input type="tel" id="phone" name="phone" value="" />

    <label for="unapprovedField">Unapproved Field</label>
    <input type="text" id="unapprovedField" name="unapprovedField" value="initial_untouched" />

    <label for="workAuth">Work Authorization</label>
    <select id="workAuth" name="workAuthorization">
      <option value="">Select</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>

    <label for="agree">
      <input type="checkbox" id="agree" name="agree" value="true" />
      Agree to terms
    </label>

    <input type="radio" id="relocate-yes" name="relocate" value="yes" />
    <input type="radio" id="relocate-no" name="relocate" value="no" />

    <label for="coverLetter">Cover Letter</label>
    <textarea id="coverLetter" name="coverLetter"></textarea>

    <!-- Hidden and Password fields must never be autofilled -->
    <input type="hidden" id="csrfToken" name="csrfToken" value="secret_hidden_token" />
    <input type="password" id="password" name="password" value="secret_pwd" />

    <button type="submit" id="submit-btn">Submit Application</button>
  </form>
</body>
</html>`);
      });

      localServer.listen(0, '127.0.0.1', () => {
        const addr = localServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 3000;
        testUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });

    // Create browser session and navigate
    const sessionRes = await browser.createSession();
    sessionId = sessionRes.sessionId;
    await browser.navigate(sessionId, testUrl);
    discoveryResult = await discovery.analyzePage(sessionId);
  });

  after(async () => {
    if (dummyResumePath) {
      await fs.unlink(dummyResumePath).catch(() => {});
    }
    await browser.closeBrowser();
    await new Promise<void>((resolve) => localServer.close(() => resolve()));
  });

  test('createAutofillProposal generates proposal with unapproved fields', async () => {
    const proposal = await autofill.createAutofillProposal(sessionId, discoveryResult);

    assert.equal(proposal.sessionId, sessionId);
    assert.equal(proposal.state, 'WAITING_FOR_APPROVAL');
    assert.ok(proposal.proposals.length > 0);

    // CRITICAL: Every proposed field must start as approved = false
    for (const prop of proposal.proposals) {
      assert.equal(prop.approved, false, `Field ${prop.fieldId} must start unapproved`);
    }

    // Passwords, hidden, and unknown fields must be strictly excluded
    const passwordProposal = proposal.proposals.find((p) => p.fieldType === 'PASSWORD');
    assert.equal(passwordProposal, undefined, 'Password fields must never be included in proposal');

    const hiddenProposal = proposal.proposals.find((p) => p.fieldType === 'HIDDEN');
    assert.equal(hiddenProposal, undefined, 'Hidden fields must never be included in proposal');

    assert.ok(proposal.forbiddenFieldsCount >= 2, 'Should count password and hidden as forbidden');
  });

  test('no page mutation occurs before human approval', async () => {
    const page = browser.getPage(sessionId);
    const fullNameVal = await page.inputValue('#fullName');
    const emailVal = await page.inputValue('#email');

    assert.equal(fullNameVal, '', 'Full name must remain empty before approval');
    assert.equal(emailVal, '', 'Email must remain empty before approval');
  });

  test('approveAndAutofill populates ONLY explicitly approved fields', async () => {
    // Approve only fullName and email
    const result = await autofill.approveAndAutofill(sessionId, ['fullName', 'email']);

    assert.equal(result.sessionId, sessionId);
    assert.equal(result.applicationSubmitted, false, 'M11 must NEVER submit application');

    // Verify fullName was populated
    const nameResult = result.results.find((r) => r.fieldId === 'fullName');
    assert.ok(nameResult);
    assert.equal(nameResult.status, 'SUCCESS');
    assert.equal(nameResult.verified, true);

    // Verify email was populated
    const emailResult = result.results.find((r) => r.fieldId === 'email');
    assert.ok(emailResult);
    assert.equal(emailResult.status, 'SUCCESS');
    assert.equal(emailResult.verified, true);

    // Verify unapprovedField was skipped and untouched in DOM
    const unapprovedResult = result.results.find((r) => r.fieldId === 'unapprovedField');
    if (unapprovedResult) {
      assert.equal(unapprovedResult.status, 'SKIPPED');
    }

    const page = browser.getPage(sessionId);
    const untouchedVal = await page.inputValue('#unapprovedField');
    assert.equal(untouchedVal, 'initial_untouched', 'Unapproved field must remain unchanged');
  });

  test('password and hidden fields remain untouched and cannot be modified', async () => {
    const page = browser.getPage(sessionId);
    const csrfVal = await page.inputValue('#csrfToken');
    const pwdVal = await page.inputValue('#password');

    assert.equal(csrfVal, 'secret_hidden_token', 'Hidden field must never be modified');
    assert.equal(pwdVal, 'secret_pwd', 'Password field must never be modified');
  });

  test('attempting to approve password or hidden field returns FORBIDDEN', async () => {
    // Force approval of password in request
    const result = await autofill.approveAndAutofill(sessionId, ['password', 'fullName']);
    const pwdResult = result.results.find((r) => r.fieldId === 'password');

    // If password was in proposal (forbidden) or forced, it must report FORBIDDEN or be excluded
    if (pwdResult) {
      assert.equal(pwdResult.status, 'FORBIDDEN');
    }

    const page = browser.getPage(sessionId);
    const pwdVal = await page.inputValue('#password');
    assert.equal(pwdVal, 'secret_pwd', 'Password field must remain untouched');
  });

  test('CRITICAL SECURITY: application form was NEVER submitted', async () => {
    assert.equal(formSubmissionCount, 0, 'Form submission count must be strictly 0');
  });

  test('verifyAutofill re-checks DOM state without mutations', async () => {
    const verified = await autofill.verifyAutofill(sessionId);
    assert.ok(verified);
    assert.equal(verified.applicationSubmitted, false);
  });

  test('clearAutofill cleans up in-memory state', () => {
    autofill.clearAutofill(sessionId);
    assert.throws(() => {
      autofill.getProposal(sessionId);
    });
  });
});
