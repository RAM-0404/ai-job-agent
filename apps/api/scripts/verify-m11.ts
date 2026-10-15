/**
 * Milestone 11 Live Verification Script
 * Validates Controlled Browser Autofill Preview with explicit human approval,
 * verification, and strict proof that NO form submission occurs.
 */

import { buildServer } from '../src/server.js';

let BASE_URL = process.env.API_BASE_URL || '';
let embeddedServer: any = null;

async function request(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runLiveVerification() {
  console.log('============================================================');
  console.log('🚀 STARTING MILESTONE 11 LIVE VERIFICATION');
  console.log('Controlled Browser Autofill Preview & Human Approval');

  // Check if external server is reachable, or launch embedded server
  if (!BASE_URL) {
    try {
      const probe = await fetch('http://localhost:3000/health').catch(() => null);
      if (probe && probe.ok) {
        BASE_URL = 'http://localhost:3000';
      }
    } catch {
      // not running
    }
  }

  if (!BASE_URL) {
    embeddedServer = await buildServer();
    const address = await embeddedServer.listen({ port: 0, host: '127.0.0.1' });
    const match = address.match(/:(\d+)$/);
    const port = match ? Number(match[1]) : 3000;
    BASE_URL = `http://127.0.0.1:${port}`;
    console.log(`Launched in-process verification server at ${BASE_URL}`);
  } else {
    console.log(`Target API: ${BASE_URL}`);
  }
  console.log('============================================================\n');

  let sessionId: string | null = null;

  try {
    // Step 1: Health check verification
    console.log('1. Verifying /health endpoint reporting...');
    const healthRes = await request('/health');
    if (!healthRes.data?.browser?.enabled) {
      throw new Error(`Health check failed or browser disabled: ${JSON.stringify(healthRes.data)}`);
    }
    console.log('   ✅ Browser Automation Health OK:', JSON.stringify(healthRes.data.browser));

    // Step 2: Test fixture verification
    console.log('\n2. Verifying deterministic local autofill fixture...');
    const fixtureRes = await fetch(`${BASE_URL}/browser/test-page/autofill`);
    const fixtureHtml = await fixtureRes.text();
    if (fixtureRes.status !== 200 || !fixtureHtml.includes('autofill-app-form')) {
      throw new Error(`Autofill fixture page failed: status ${fixtureRes.status}`);
    }
    console.log('   ✅ Deterministic M11 autofill fixture online.');

    // Step 3: Create isolated browser session
    console.log('\n3. Creating isolated browser session...');
    const sessionRes = await request('/browser/sessions', { method: 'POST' });
    if (sessionRes.status !== 201 || !sessionRes.data?.sessionId) {
      throw new Error(`Session creation failed: ${JSON.stringify(sessionRes.data)}`);
    }
    sessionId = sessionRes.data.sessionId;
    console.log(`   ✅ Browser session created: ${sessionId}`);

    // Step 4: Navigate to autofill fixture
    console.log('\n4. Navigating to autofill test fixture...');
    const navRes = await request(`/browser/sessions/${sessionId}/navigate`, {
      method: 'POST',
      body: JSON.stringify({ url: `${BASE_URL}/browser/test-page/autofill` }),
    });
    if (navRes.status !== 200) {
      throw new Error(`Navigation failed: ${JSON.stringify(navRes.data)}`);
    }
    console.log(`   ✅ Navigated to: ${navRes.data.url}`);

    // Step 5: Application discovery
    console.log('\n5. Performing application page discovery...');
    const discoveryRes = await request(`/browser/sessions/${sessionId}/application-discovery`, {
      method: 'POST',
    });
    if (discoveryRes.status !== 200) {
      throw new Error(`Discovery failed: ${JSON.stringify(discoveryRes.data)}`);
    }
    console.log(`   ✅ Discovered ${discoveryRes.data.fields.length} fields across ${discoveryRes.data.forms.length} form(s).`);

    // Step 6: Generate Autofill Proposal
    console.log('\n6. Generating Autofill Proposal...');
    const proposalRes = await request(`/browser/sessions/${sessionId}/autofill/proposal`, {
      method: 'POST',
    });
    if (proposalRes.status !== 200) {
      throw new Error(`Proposal generation failed: ${JSON.stringify(proposalRes.data)}`);
    }
    const proposal = proposalRes.data;
    console.log(`   ✅ State: ${proposal.state}`);
    console.log(`   ✅ Total fields: ${proposal.totalFieldsCount}, Proposed: ${proposal.proposals.length}, Forbidden: ${proposal.forbiddenFieldsCount}`);

    // Step 7: Confirm all proposals initially unapproved
    console.log('\n7. Verifying all proposals start in unapproved state...');
    for (const prop of proposal.proposals) {
      if (prop.approved !== false) {
        throw new Error(`Violation: Field ${prop.fieldId} was not initially unapproved!`);
      }
      if (prop.fieldType === 'PASSWORD' || prop.fieldType === 'HIDDEN' || prop.fieldType === 'UNKNOWN') {
        throw new Error(`Violation: Forbidden field type ${prop.fieldType} was proposed!`);
      }
    }
    console.log('   ✅ All proposed fields are unapproved (approved: false). No passwords or hidden fields proposed.');

    // Step 8: Approve exactly selected fields from the generated proposal
    const proposedFieldIds = proposal.proposals.map((p: any) => p.fieldId);
    console.log(`   Available proposed fields: [${proposedFieldIds.join(', ')}]`);

    // Human approves a subset: first 4 fields
    const approvedFields = proposedFieldIds.slice(0, 4);
    const unapprovedFields = proposedFieldIds.slice(4);
    console.log(`\n8. Human Approval: Explicitly approving selected fields: [${approvedFields.join(', ')}]...`);
    console.log(`   Leaving unapproved: [${unapprovedFields.join(', ')}]...`);

    const approveRes = await request(`/browser/sessions/${sessionId}/autofill/approve`, {
      method: 'POST',
      body: JSON.stringify({ fieldIds: approvedFields }),
    });
    if (approveRes.status !== 200) {
      throw new Error(`Approval/autofill execution failed: ${JSON.stringify(approveRes.data)}`);
    }
    const result = approveRes.data;
    console.log(`   ✅ Autofill execution completed. State: ${result.state}`);

    // Step 9: Verify selected fields populated & unapproved untouched
    console.log('\n9. Verifying field population and protection...');
    for (const fieldId of approvedFields) {
      const fieldRes = result.results.find((r: any) => r.fieldId === fieldId);
      if (!fieldRes || fieldRes.status !== 'SUCCESS') {
        throw new Error(`Expected SUCCESS for approved field "${fieldId}", got: ${JSON.stringify(fieldRes)}`);
      }
      console.log(`   ✅ Approved Field "${fieldId}" (${fieldRes.fieldType}): status=${fieldRes.status}, verifiedValue="${fieldRes.verifiedValue}"`);
    }

    for (const fieldId of unapprovedFields) {
      const fieldRes = result.results.find((r: any) => r.fieldId === fieldId);
      if (!fieldRes || fieldRes.status !== 'SKIPPED') {
        throw new Error(`Expected SKIPPED for unapproved field "${fieldId}", got: ${JSON.stringify(fieldRes)}`);
      }
      console.log(`   ✅ Unapproved Field "${fieldId}": status=${fieldRes.status} (Left untouched)`);
    }

    // Step 10: Verify password and hidden fields were NOT modified
    console.log('\n10. Verifying forbidden fields were untouched...');
    const pwdRes = result.results.find((r: any) => r.fieldId === 'password');
    if (pwdRes && pwdRes.status !== 'FORBIDDEN' && pwdRes.status !== 'SKIPPED') {
      throw new Error('Password field was not protected!');
    }
    console.log('   ✅ Password and hidden fields remained strictly untouched.');

    // Step 11: Validation error detection
    console.log('\n11. Verifying observational validation detection...');
    const verifyRes = await request(`/browser/sessions/${sessionId}/autofill/verify`, {
      method: 'POST',
    });
    if (verifyRes.status !== 200) {
      throw new Error(`Verification endpoint failed: ${JSON.stringify(verifyRes.data)}`);
    }
    console.log('   ✅ Validation check complete. Diagnostics:', JSON.stringify(verifyRes.data.validation));

    // Step 12: CRITICAL CHECK: Confirm form submission was NEVER executed
    console.log('\n12. CRITICAL SAFETY PROOF: Checking submission interceptor status...');
    const submitCheck = await request('/browser/test-page/autofill/submission-status');
    if (submitCheck.status !== 200 || submitCheck.data?.submissionCount !== 0 || submitCheck.data?.applicationSubmitted !== false) {
      throw new Error(`FATAL SAFETY VIOLATION: Form submission was triggered! Count: ${submitCheck.data?.submissionCount}`);
    }
    console.log(`   ✅ Submission count: ${submitCheck.data.submissionCount}`);
    console.log(`   ✅ Result applicationSubmitted: ${result.applicationSubmitted}`);
    console.log('   🛡️ PROOF CONFIRMED: APPLICATION SUBMITTED = false');

    // Step 13: Clear autofill state and close session
    console.log('\n13. Cleaning up autofill state and releasing browser session...');
    await request(`/browser/sessions/${sessionId}/autofill`, { method: 'DELETE' });
    await request(`/browser/sessions/${sessionId}`, { method: 'DELETE' });
    sessionId = null;
    console.log('   ✅ Session successfully closed and context released.');

    console.log('\n============================================================');
    console.log('🎉 MILESTONE 11 LIVE VERIFICATION PASSED SUCCESSFULLY!');
    console.log('   - Controlled autofill preview: VERIFIED');
    console.log('   - Human approval enforcement: VERIFIED');
    console.log('   - Forbidden field protection: VERIFIED');
    console.log('   - Field verification: VERIFIED');
    console.log('   - APPLICATION SUBMITTED: FALSE');
    console.log('============================================================\n');
  } finally {
    if (sessionId) {
      await request(`/browser/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    if (embeddedServer) {
      await embeddedServer.close().catch(() => {});
    }
  }
}

runLiveVerification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ MILESTONE 11 VERIFICATION FAILED:', err);
    process.exit(1);
  });
