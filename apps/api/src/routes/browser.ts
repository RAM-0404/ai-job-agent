import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { browserService as defaultBrowserService, BrowserService } from '../services/browser/browser.service.js';
import {
  applicationDiscoveryService as defaultDiscoveryService,
  ApplicationDiscoveryService,
} from '../services/browser/application-discovery.service.js';
import {
  autofillService as defaultAutofillService,
  AutofillService,
} from '../services/browser/autofill.service.js';
import {
  browserNavigationService as defaultNavigationService,
  BrowserNavigationService,
} from '../services/browser/browser-navigation.service.js';
import {
  multiStepWorkflowService as defaultWorkflowService,
  MultiStepWorkflowService,
} from '../services/browser/multi-step-workflow.service.js';
import {
  BrowserNotEnabledError,
  BrowserLaunchError,
  BrowserSessionNotFoundError,
  BrowserNavigationError,
  BrowserNavigationTimeoutError,
  InvalidBrowserUrlError,
  BrowserCapacityError,
  BrowserOperationError,
  TerminalActionForbiddenError,
  NavigationNotAllowedError,
  NavigationControlNotFoundError,
  NavigationStepChangedError,
  IdempotencyConflictError,
  OperationInProgressError,
  WorkflowReconciliationError,
} from '../services/browser/browser.errors.js';
import { workflowPersistenceService } from '../services/browser/workflow-persistence.service.js';

const NavigateBodySchema = z.object({
  url: z.string().min(1, 'URL cannot be empty'),
  timeoutMs: z.number().int().positive().optional(),
});

const DiscoveryBodySchema = z.object({
  url: z.string().min(1).optional(),
  userProfileId: z.string().uuid().optional(),
}).optional();

const AutofillProposalBodySchema = z.object({
  userProfileId: z.string().uuid().optional(),
}).optional();

const AutofillApproveBodySchema = z.object({
  fieldIds: z.array(z.string().min(1)).min(1, 'At least one fieldId must be specified for approval'),
});

const NavigationDiscoverBodySchema = z.object({
  targetUrl: z.string().min(1).optional(),
}).optional();

const NavigationApproveBodySchema = z.object({
  controlId: z.string().min(1, 'controlId is required for navigation approval'),
});

const WorkflowInitBodySchema = z.object({
  userProfileId: z.string().uuid().optional(),
}).optional();

const WorkflowStepExecuteBodySchema = z.object({
  approvedFieldIds: z.array(z.string()),
  userProfileId: z.string().uuid().optional(),
});

const WorkflowStepNavigateBodySchema = z.object({
  controlId: z.string().min(1, 'controlId is required for workflow navigation approval'),
  userProfileId: z.string().uuid().optional(),
});

export interface BrowserRouteOptions {
  service?: BrowserService;
  discoveryService?: ApplicationDiscoveryService;
  autofillService?: AutofillService;
  navigationService?: BrowserNavigationService;
  workflowService?: MultiStepWorkflowService;
}

export const browserRoutes: FastifyPluginAsync<BrowserRouteOptions> = async (fastify, opts) => {
  const service = opts.service || defaultBrowserService;
  const discovery = opts.discoveryService || defaultDiscoveryService;
  const autofill = opts.autofillService || defaultAutofillService;
  const navigation = opts.navigationService || defaultNavigationService;
  const workflow = opts.workflowService || defaultWorkflowService;

  // Track whether the test fixture forms were ever submitted
  let testFormSubmissionCount = 0;
  let testMultiStepSubmissionCount = 0;

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof TerminalActionForbiddenError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Forbidden',
        code: err.code,
        message: err.message,
      });
    }

    if (err instanceof NavigationNotAllowedError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Bad Request',
        code: err.code,
        message: err.message,
      });
    }

    if (err instanceof NavigationControlNotFoundError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Not Found',
        code: err.code,
        message: err.message,
      });
    }

    if (
      err instanceof IdempotencyConflictError ||
      err instanceof OperationInProgressError ||
      err instanceof WorkflowReconciliationError
    ) {
      return reply.status((err as any).statusCode || 409).send({
        statusCode: (err as any).statusCode || 409,
        error: 'Conflict',
        code: (err as any).code || 'CONFLICT',
        message: (err as any).message,
      });
    }

    if (err instanceof NavigationStepChangedError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Conflict',
        code: err.code,
        message: err.message,
      });
    }
    if (err instanceof BrowserNotEnabledError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Forbidden',
        message: err.message,
      });
    }

    if (err instanceof BrowserSessionNotFoundError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Not Found',
        message: err.message,
      });
    }

    if (err instanceof InvalidBrowserUrlError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Bad Request',
        message: err.message,
      });
    }

    if (err instanceof BrowserCapacityError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Too Many Requests',
        message: err.message,
      });
    }

    if (err instanceof BrowserNavigationTimeoutError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Gateway Timeout',
        message: err.message,
      });
    }

    if (
      err instanceof BrowserNavigationError ||
      err instanceof BrowserLaunchError ||
      err instanceof BrowserOperationError
    ) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: 'Internal Server Error',
        message: err.message,
      });
    }

    const message = err instanceof Error ? err.message : 'An unexpected browser error occurred.';
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message,
    });
  }

  // Deterministic local HTML fixture 1 (M10.1 compatible): General Browser Test Fixture
  fastify.get('/browser/test-page', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Browser Test Fixture</title>
</head>
<body>
  <h1>Deterministic Browser Fixture</h1>
  <p>Used for safe local Playwright testing without external internet dependencies.</p>
  <form id="sample-form" action="/submit" method="POST">
    <label for="name-input">Full Name:</label>
    <input type="text" id="name-input" name="fullName" value="Test Candidate" />
    <label for="email-input">Email:</label>
    <input type="email" id="email-input" name="email" value="candidate@example.local" />
    <button type="submit" id="submit-btn">Submit Information</button>
  </form>
  <div class="links">
    <a href="https://example.com/careers">Careers</a>
    <a href="https://example.com/about">About Us</a>
    <a href="https://example.com/contact">Contact</a>
  </div>
</body>
</html>`);
  });

  // Deterministic local HTML fixture 1B (M10.2): Comprehensive Job Application Form
  fastify.get('/browser/test-page/application', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Acme Corp - Software Engineer Application</title>
</head>
<body>
  <h1>Apply for Staff Software Engineer</h1>
  <h2>Candidate Information</h2>
  <form id="application-form" action="/apply" method="POST">
    <div class="field-group">
      <label for="fullName">Full Name *</label>
      <input type="text" id="fullName" name="fullName" required placeholder="Jane Doe" autocomplete="name" />
    </div>

    <div class="field-group">
      <label for="email">Email Address (required)</label>
      <input type="email" id="email" name="email" required placeholder="jane@example.com" autocomplete="email" />
    </div>

    <div class="field-group">
      <label for="phone">Phone Number</label>
      <input type="tel" id="phone" name="phone" placeholder="+1-555-0199" autocomplete="tel" />
    </div>

    <div class="field-group">
      <label for="resume">Resume / CV *</label>
      <input type="file" id="resume" name="resume" accept=".pdf,.docx" required />
    </div>

    <div class="field-group">
      <label for="coverLetter">Cover Letter</label>
      <textarea id="coverLetter" name="coverLetter" rows="4" placeholder="Tell us why you are a fit..."></textarea>
    </div>

    <div class="field-group">
      <label for="experienceYears">Years of Experience *</label>
      <input type="number" id="experienceYears" name="experienceYears" required min="0" />
    </div>

    <div class="field-group">
      <label for="currentTitle">Current Job Title</label>
      <input type="text" id="currentTitle" name="currentTitle" placeholder="Lead Architect" />
    </div>

    <div class="field-group">
      <label for="workAuth">Are you legally authorized to work in this location? *</label>
      <select id="workAuth" name="workAuthorization" required>
        <option value="">Select an option</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>

    <div class="buttons">
      <button type="submit" id="submit-application-btn">Submit Application</button>
      <button type="button" id="save-draft-btn">Save Draft</button>
    </div>
  </form>
</body>
</html>`);
  });

  // Deterministic local HTML fixture 2: Job description with external application target link
  fastify.get('/browser/test-page/job-description', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Principal Backend Engineer - Acme Tech Careers</title>
</head>
<body>
  <h1>Principal Backend Engineer</h1>
  <p class="company">Acme Tech Systems • Remote • Full Time</p>
  <div class="description">
    <p>We are seeking an experienced Principal Backend Engineer to lead cloud architecture.</p>
  </div>
  <div class="cta-section">
    <a href="https://careers.acme.example.com/apply/backend-engineer" class="btn apply-link">Apply Now</a>
    <a href="https://acme.example.com/careers/portal" class="btn external-link">Apply on Company Site</a>
  </div>
</body>
</html>`);
  });

  // Deterministic local HTML fixture 3: Plain non-application article page
  fastify.get('/browser/test-page/non-application', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Engineering Blog - Microservices at Scale</title>
</head>
<body>
  <h1>Scaling Distributed Queues in 2026</h1>
  <article>
    <p>This article discusses patterns in distributed messaging and eventual consistency.</p>
  </article>
  <footer>
    <a href="/terms">Terms of Service</a>
    <a href="/privacy">Privacy Policy</a>
  </footer>
</body>
</html>`);
  });

  // Deterministic local HTML fixture 4: Form with aria-label, aria-labelledby, hidden and password fields
  fastify.get('/browser/test-page/aria-labels', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Account Setup</title>
</head>
<body>
  <h2 id="section-heading">Candidate Account Information</h2>
  <form id="account-form">
    <input type="hidden" name="csrfToken" value="abc123hidden" />
    <label>
      Full Name:
      <input type="text" name="wrappedName" />
    </label>
    <input type="email" name="ariaEmail" aria-label="Candidate Email Address" aria-required="true" />
    <input type="password" name="password" placeholder="Create a password" />
    <button type="submit">Continue</button>
  </form>
</body>
</html>`);
  });

  // Deterministic local HTML fixture 5 (M11): Controlled Autofill Test Page
  fastify.get('/browser/test-page/autofill', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Engineering Role Application - Controlled Autofill</title>
</head>
<body>
  <h1>Senior Systems Engineer Application</h1>
  <form id="autofill-app-form" action="/browser/test-page/autofill/submit" method="POST">
    <!-- Visible text inputs -->
    <div class="field">
      <label for="fullName">Full Name *</label>
      <input type="text" id="fullName" name="fullName" required placeholder="Alex Doe" />
    </div>

    <div class="field">
      <label for="email">Email Address *</label>
      <input type="email" id="email" name="email" required placeholder="alex@example.local" />
    </div>

    <div class="field">
      <label for="phone">Phone Number</label>
      <input type="tel" id="phone" name="phone" placeholder="+1-555-0199" />
    </div>

    <div class="field">
      <label for="currentTitle">Current Job Title</label>
      <input type="text" id="currentTitle" name="currentTitle" placeholder="Systems Architect" />
    </div>

    <div class="field">
      <label for="experienceYears">Years of Experience *</label>
      <input type="number" id="experienceYears" name="experienceYears" required min="0" />
    </div>

    <!-- Select input -->
    <div class="field">
      <label for="workAuthorization">Are you authorized to work in this country? *</label>
      <select id="workAuthorization" name="workAuthorization" required>
        <option value="">-- Select an option --</option>
        <option value="yes">Yes, authorized</option>
        <option value="no">No, requires sponsorship</option>
      </select>
    </div>

    <!-- Checkbox input -->
    <div class="field">
      <label for="agreeTerms">
        <input type="checkbox" id="agreeTerms" name="agreeTerms" value="true" />
        I confirm my answers are accurate
      </label>
    </div>

    <!-- Radio inputs -->
    <div class="field">
      <span>Willing to relocate?</span>
      <label for="relocate-yes">
        <input type="radio" id="relocate-yes" name="relocate" value="yes" /> Yes
      </label>
      <label for="relocate-no">
        <input type="radio" id="relocate-no" name="relocate" value="no" /> No
      </label>
    </div>

    <!-- Textarea input -->
    <div class="field">
      <label for="coverLetter">Cover Letter Note</label>
      <textarea id="coverLetter" name="coverLetter" rows="3"></textarea>
    </div>

    <!-- File input (Resume) -->
    <div class="field">
      <label for="resume">Upload Resume / CV *</label>
      <input type="file" id="resume" name="resume" accept=".pdf,.docx" required />
    </div>

    <!-- Security protected inputs (M11 forbidden from autofill) -->
    <input type="hidden" id="csrfToken" name="csrfToken" value="initial_csrf_token_secret" />
    <input type="password" id="password" name="password" value="initial_pwd_secret" />

    <div class="actions">
      <button type="submit" id="submit-application-btn">Submit Application</button>
    </div>
  </form>
</body>
</html>`);
  });

  // Test fixture submission interceptor (Used to verify that submissions are NEVER executed by M11)
  fastify.post('/browser/test-page/autofill/submit', async (_request, reply) => {
    testFormSubmissionCount++;
    return reply.status(200).send({
      submitted: true,
      submissionCount: testFormSubmissionCount,
    });
  });

  // Test fixture submission status check
  fastify.get('/browser/test-page/autofill/submission-status', async (_request, reply) => {
    return reply.status(200).send({
      submissionCount: testFormSubmissionCount,
      applicationSubmitted: testFormSubmissionCount > 0,
    });
  });

  // Deterministic local HTML fixture 6 (M12.1): Multi-Step Job Application Wizard Fixture
  fastify.get('/browser/test-page/multi-step', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Global Tech Solutions - Multi-Step Application</title>
  <style>
    .step-section { display: none; }
    .step-section.active { display: block; }
    .stepper { display: flex; gap: 10px; margin-bottom: 20px; }
    .step-badge { padding: 6px 12px; background: #eee; border-radius: 4px; }
    .step-badge.active { background: #007bff; color: white; font-weight: bold; }
    .field-group { margin-bottom: 12px; }
    .buttons { margin-top: 16px; display: flex; gap: 8px; }
    #review-box { display: none; margin-top: 12px; padding: 10px; background: #f8f9fa; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>Senior Cloud Architect Application</h1>

  <div class="stepper">
    <div id="step-badge-1" class="step-badge active" aria-current="step">Step 1: Contact Information</div>
    <div id="step-badge-2" class="step-badge">Step 2: Experience & Work Mode</div>
    <div id="step-badge-3" class="step-badge">Step 3: Review & Submission</div>
  </div>

  <form id="multi-step-form" action="/browser/test-page/multi-step/submit" method="POST" onsubmit="event.preventDefault(); fetch('/browser/test-page/multi-step/submit', { method: 'POST' });">
    <!-- Step 1: Candidate Contact Info -->
    <div id="step-1" class="step-section active">
      <h2>Step 1: Candidate Contact Info</h2>
      <div class="field-group">
        <label for="fullName">Full Name *</label>
        <input type="text" id="fullName" name="fullName" required placeholder="Alex Morgan" />
      </div>
      <div class="field-group">
        <label for="email">Email Address *</label>
        <input type="email" id="email" name="email" required placeholder="alex.morgan@example.com" />
      </div>
      <div class="field-group">
        <label for="phone">Phone Number</label>
        <input type="tel" id="phone" name="phone" placeholder="+1-555-0199" />
      </div>
      <div class="buttons">
        <button type="button" id="next-btn-step1" class="btn btn-primary" onclick="goToStep(2)">Next</button>
      </div>
    </div>

    <!-- Step 2: Experience & Work Mode -->
    <div id="step-2" class="step-section">
      <h2>Step 2: Experience & Work Mode</h2>
      <div class="field-group">
        <label for="experienceYears">Years of Experience *</label>
        <input type="number" id="experienceYears" name="experienceYears" required min="0" value="8" />
      </div>
      <div class="field-group">
        <label for="location">Location</label>
        <input type="text" id="location" name="location" placeholder="San Francisco, CA" />
      </div>
      <div class="field-group">
        <label for="workMode">Preferred Work Mode</label>
        <select id="workMode" name="workMode">
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-site</option>
        </select>
      </div>
      <div class="buttons">
        <button type="button" id="back-btn-step2" class="btn btn-secondary" onclick="goToStep(1)">Back</button>
        <button type="button" id="continue-btn-step2" class="btn btn-primary" onclick="goToStep(3)">Continue</button>
      </div>
    </div>

    <!-- Step 3: Application Review & Submission -->
    <div id="step-3" class="step-section">
      <h2>Step 3: Application Review & Submission</h2>
      <div class="field-group">
        <label for="coverLetter">Cover Letter</label>
        <textarea id="coverLetter" name="coverLetter" rows="3" placeholder="Brief statement..."></textarea>
      </div>
      <div class="field-group">
        <label for="resume">Resume / CV *</label>
        <input type="file" id="resume" name="resume" accept=".pdf,.docx" required />
      </div>
      <div id="review-box">
        <h3>Application Summary</h3>
        <p id="review-text">Ready for final candidate review.</p>
      </div>
      <div class="buttons">
        <button type="button" id="back-btn-step3" class="btn btn-secondary" onclick="goToStep(2)">Back</button>
        <button type="button" id="review-btn-step3" class="btn btn-info" onclick="toggleReview()">Review Application</button>
        <button type="submit" id="submit-btn-step3" class="btn btn-danger">Submit Application</button>
      </div>
    </div>
  </form>

  <script>
    function goToStep(stepNum) {
      document.querySelectorAll('.step-section').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.step-badge').forEach((el, idx) => {
        if (idx + 1 === stepNum) {
          el.classList.add('active');
          el.setAttribute('aria-current', 'step');
        } else {
          el.classList.remove('active');
          el.removeAttribute('aria-current');
        }
      });
      const target = document.getElementById('step-' + stepNum);
      if (target) target.classList.add('active');
    }
    function toggleReview() {
      const box = document.getElementById('review-box');
      if (box) box.style.display = box.style.display === 'block' ? 'none' : 'block';
    }
    const urlParams = new URLSearchParams(window.location.search);
    const initialStep = parseInt(urlParams.get('step') || '1', 10);
    if (initialStep > 1 && initialStep <= 3) {
      goToStep(initialStep);
    }
  </script>
</body>
</html>`);
  });

  // Interceptor and status check for multi-step test fixture
  fastify.post('/browser/test-page/multi-step/submit', async (_request, reply) => {
    testMultiStepSubmissionCount++;
    return reply.status(200).send({
      submitted: true,
      submissionCount: testMultiStepSubmissionCount,
    });
  });

  fastify.get('/browser/test-page/multi-step/submission-status', async (_request, reply) => {
    return reply.status(200).send({
      submissionCount: testMultiStepSubmissionCount,
      applicationSubmitted: testMultiStepSubmissionCount > 0,
    });
  });

  // POST /browser/sessions - Create isolated browser session
  fastify.post('/browser/sessions', async (request, reply) => {
    try {
      const session = await service.createSession();
      return reply.status(201).send(session);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to create browser session');
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/navigate - Navigate page to an allowed URL
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/navigate', async (request, reply) => {
    const sessionId = request.params.id;
    const parseResult = NavigateBodySchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid navigation payload.',
        details: parseResult.error.format(),
      });
    }

    try {
      const result = await service.navigate(
        sessionId,
        parseResult.data.url,
        parseResult.data.timeoutMs
      );
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to navigate browser session');
      return handleError(err, reply);
    }
  });

  // GET /browser/sessions/:id - Retrieve session information
  fastify.get<{ Params: { id: string } }>('/browser/sessions/:id', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const session = service.getSession(sessionId);
      return reply.status(200).send(session);
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // GET /browser/sessions/:id/inspect - Inspect basic structural elements
  fastify.get<{ Params: { id: string } }>('/browser/sessions/:id/inspect', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const inspection = await service.inspectPage(sessionId);
      return reply.status(200).send(inspection);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to inspect page elements');
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/screenshot - Capture page screenshot
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/screenshot', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const screenshot = await service.takeScreenshot(sessionId);
      return reply.status(201).send(screenshot);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to capture screenshot');
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/application-discovery - Discover and inspect application structure (M10.2)
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/application-discovery', async (request, reply) => {
    const sessionId = request.params.id;
    const body = request.body ? DiscoveryBodySchema.safeParse(request.body) : { success: true, data: undefined };

    if (!body.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid application discovery payload.',
      });
    }

    try {
      const analysis = await discovery.analyzePage(
        sessionId,
        body.data?.url,
        body.data?.userProfileId
      );
      return reply.status(200).send(analysis);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to perform application page discovery');
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/autofill/proposal - Generate autofill proposal from discovered page structure
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/autofill/proposal', async (request, reply) => {
    const sessionId = request.params.id;
    const body = request.body ? AutofillProposalBodySchema.safeParse(request.body) : { success: true, data: undefined };

    if (!body.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid autofill proposal request payload.',
      });
    }

    try {
      // Discover current page structure
      const analysis = await discovery.analyzePage(sessionId, undefined, body.data?.userProfileId);
      const proposal = await autofill.createAutofillProposal(sessionId, analysis, body.data?.userProfileId);
      return reply.status(200).send(proposal);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to create autofill proposal');
      return handleError(err, reply);
    }
  });

  // GET /browser/sessions/:id/autofill/proposal - Get current proposal
  fastify.get<{ Params: { id: string } }>('/browser/sessions/:id/autofill/proposal', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const proposal = autofill.getProposal(sessionId);
      return reply.status(200).send(proposal);
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/autofill/approve - Explicitly approve listed field IDs and execute controlled autofill
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/autofill/approve', async (request, reply) => {
    const sessionId = request.params.id;
    const parseResult = AutofillApproveBodySchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid autofill approval payload. Explicit fieldIds array required.',
        details: parseResult.error.format(),
      });
    }

    try {
      const result = await autofill.approveAndAutofill(sessionId, parseResult.data.fieldIds);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to execute approved autofill');
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/autofill/verify - Re-verify populated field values and validation indicators
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/autofill/verify', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const result = await autofill.verifyAutofill(sessionId);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to verify autofill state');
      return handleError(err, reply);
    }
  });

  // DELETE /browser/sessions/:id/autofill - Clear in-memory autofill state
  fastify.delete<{ Params: { id: string } }>('/browser/sessions/:id/autofill', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      autofill.clearAutofill(sessionId);
      return reply.status(200).send({ success: true, sessionId });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/navigation/discover - Discover step and navigation controls (M12.1)
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/navigation/discover', async (request, reply) => {
    const sessionId = request.params.id;
    const body = request.body ? NavigationDiscoverBodySchema.safeParse(request.body) : { success: true, data: undefined };

    if (!body.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid navigation discovery payload.',
      });
    }

    try {
      const state = await navigation.discoverNavigation(sessionId, body.data?.targetUrl);
      return reply.status(200).send(state);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to perform navigation discovery');
      return handleError(err, reply);
    }
  });

  // GET /browser/sessions/:id/navigation - Retrieve current navigation state
  fastify.get<{ Params: { id: string } }>('/browser/sessions/:id/navigation', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const state = navigation.getNavigationState(sessionId);
      return reply.status(200).send(state);
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/navigation/approve - Explicitly approve navigation control execution
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/navigation/approve', async (request, reply) => {
    const sessionId = request.params.id;
    const parseResult = NavigationApproveBodySchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid navigation approval payload. Explicit controlId required.',
        details: parseResult.error.format(),
      });
    }

    try {
      const result = await navigation.approveAndNavigate(sessionId, parseResult.data.controlId);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to execute approved navigation');
      return handleError(err, reply);
    }
  });

  // DELETE /browser/sessions/:id/navigation - Clear navigation state
  fastify.delete<{ Params: { id: string } }>('/browser/sessions/:id/navigation', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      navigation.clearNavigation(sessionId);
      return reply.status(200).send({ success: true, sessionId });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/workflow/init - Initialize and discover multi-step workflow (M12.2 / M12.3)
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/workflow/init', async (request, reply) => {
    const sessionId = request.params.id;
    const idempotencyKey = (request.headers['x-idempotency-key'] as string | undefined) || undefined;
    const parseResult = request.body ? WorkflowInitBodySchema.safeParse(request.body) : { success: true, data: undefined };

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid workflow initialization payload.',
      });
    }

    try {
      const state = await workflow.initWorkflow(sessionId, parseResult.data?.userProfileId, idempotencyKey);
      return reply.status(200).send(state);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to initialize workflow');
      return handleError(err, reply);
    }
  });

  // GET /browser/sessions/:id/workflow/state - Retrieve active workflow state
  fastify.get<{ Params: { id: string } }>('/browser/sessions/:id/workflow/state', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const state = await workflow.getOrLoadWorkflowState(sessionId);
      return reply.status(200).send(state);
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/workflow/step/execute - Execute approved fields on current step
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/workflow/step/execute', async (request, reply) => {
    const sessionId = request.params.id;
    const idempotencyKey = (request.headers['x-idempotency-key'] as string | undefined) || undefined;
    const parseResult = WorkflowStepExecuteBodySchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid step execution payload. "approvedFieldIds" array is required.',
        details: parseResult.error.format(),
      });
    }

    try {
      const result = await workflow.executeStepFields(sessionId, parseResult.data, idempotencyKey);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to execute step fields');
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/workflow/step/navigate - Explicitly approve and advance navigation
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/workflow/step/navigate', async (request, reply) => {
    const sessionId = request.params.id;
    const idempotencyKey = (request.headers['x-idempotency-key'] as string | undefined) || undefined;
    const parseResult = WorkflowStepNavigateBodySchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid step navigation payload. Explicit "controlId" is required.',
        details: parseResult.error.format(),
      });
    }

    try {
      const result = await workflow.approveStepNavigation(
        sessionId,
        parseResult.data.controlId,
        parseResult.data.userProfileId,
        idempotencyKey
      );
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to approve step navigation');
      return handleError(err, reply);
    }
  });

  // POST /browser/sessions/:id/workflow/recover - Safe workflow recovery after restart / disruption (M12.3)
  fastify.post<{ Params: { id: string } }>('/browser/sessions/:id/workflow/recover', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const result = await workflow.recoverWorkflow(sessionId);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to recover workflow');
      return handleError(err, reply);
    }
  });

  // GET /browser/sessions/:id/workflow/operations/:key - Inspect specific operation status (M12.3)
  fastify.get<{ Params: { id: string; key: string } }>('/browser/sessions/:id/workflow/operations/:key', async (request, reply) => {
    const { id: sessionId, key } = request.params;

    try {
      const operation = await workflowPersistenceService.getOperation(sessionId, key);
      if (!operation) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Operation with idempotency key "${key}" not found.`,
        });
      }
      return reply.status(200).send(operation);
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // GET /browser/sessions/:id/workflow/operations - List operations for session (M12.3)
  fastify.get<{ Params: { id: string } }>('/browser/sessions/:id/workflow/operations', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const operations = await workflowPersistenceService.listOperationsForSession(sessionId);
      return reply.status(200).send({ sessionId, operations });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // GET /browser/sessions/:id/workflow/history - Retrieve cumulative workflow step history
  fastify.get<{ Params: { id: string } }>('/browser/sessions/:id/workflow/history', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      const history = await workflow.getWorkflowHistoryAsync(sessionId);
      return reply.status(200).send(history);
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // DELETE /browser/sessions/:id/workflow - Clear workflow state
  fastify.delete<{ Params: { id: string } }>('/browser/sessions/:id/workflow', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      await workflow.clearWorkflow(sessionId);
      return reply.status(200).send({ success: true, sessionId });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // DELETE /browser/sessions/:id - Close session and release resources
  fastify.delete<{ Params: { id: string } }>('/browser/sessions/:id', async (request, reply) => {
    const sessionId = request.params.id;

    try {
      workflow.clearWorkflow(sessionId);
      autofill.clearAutofill(sessionId);
      navigation.clearNavigation(sessionId);
      const result = await service.closeSession(sessionId);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });
};
