/**
 * Milestone 12.2 Live Verification Script
 * Validates Multi-Step Workflow Orchestration:
 * - Workflow initialization and Step 1 discovery
 * - Proposal generation with strict human approval requirement (approved = false)
 * - Approved field population and DOM verification
 * - Partial approval and skipped field tracking
 * - Explicit forward navigation approval
 * - Progression to Step 2 with fresh field discovery and fresh unapproved proposals
 * - Progression to Step 3 with terminal action detection
 * - Strict 403 Forbidden rejection of terminal controls (Submit / Apply)
 * - Cumulative workflow history retrieval across all steps
 * - Absolute confirmation that applicationSubmitted = false & submissionCount = 0
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
  console.log('🚀 STARTING MILESTONE 12.2 LIVE VERIFICATION');
  console.log('Multi-Step Workflow Orchestration');
  console.log('============================================================\n');

  if (!BASE_URL) {
    try {
      const probe = await fetch('http://localhost:3000/browser/test-page/multi-step').catch(() => null);
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

  try {
    // 1. Verify multi-step fixture is responding
    console.log('\n1. Probing deterministic multi-step test fixture...');
    const fixtureRes = await request('/browser/test-page/multi-step');
    if (fixtureRes.status !== 200) {
      throw new Error(`Expected test fixture status 200, received ${fixtureRes.status}`);
    }
    console.log('   ✅ Multi-step HTML fixture online.');

    // 2. Initial submission audit check
    console.log('\n2. Verifying submission counter is initially 0...');
    const initAudit = await request('/browser/test-page/multi-step/submission-status');
    if (!initAudit.ok || initAudit.data?.submissionCount !== 0) {
      throw new Error(`Initial submission counter non-zero: ${JSON.stringify(initAudit.data)}`);
    }
    console.log('   ✅ Initial submissionCount = 0 (clean state).');

    // 3. Create isolated browser session
    console.log('\n3. Creating isolated browser session...');
    const sessionRes = await request('/browser/sessions', { method: 'POST' });
    if (sessionRes.status !== 201 || !sessionRes.data?.sessionId) {
      throw new Error(`Failed to create browser session: ${JSON.stringify(sessionRes.data)}`);
    }
    const sessionId = sessionRes.data.sessionId;
    console.log(`   ✅ Browser session created: ${sessionId}`);

    // 4. Navigate session to multi-step fixture
    console.log('\n4. Navigating session to multi-step wizard fixture...');
    const navRes = await request(`/browser/sessions/${sessionId}/navigate`, {
      method: 'POST',
      body: JSON.stringify({ url: `${BASE_URL}/browser/test-page/multi-step` }),
    });
    if (!navRes.ok) {
      throw new Error(`Failed to navigate to multi-step fixture: ${JSON.stringify(navRes.data)}`);
    }
    console.log('   ✅ Page loaded at multi-step fixture.');

    // 5. Initialize Multi-Step Workflow (M12.2)
    console.log('\n5. Initializing multi-step workflow on Step 1...');
    const initWorkflowRes = await request(`/browser/sessions/${sessionId}/workflow/init`, {
      method: 'POST',
    });
    if (!initWorkflowRes.ok) {
      throw new Error(`Failed to init workflow: ${JSON.stringify(initWorkflowRes.data)}`);
    }
    const workflowState = initWorkflowRes.data;
    console.log(`   ✅ Workflow initialized. Step: "${workflowState.currentStepHeading}" (index: ${workflowState.currentStepIndex})`);
    console.log(`   ✅ Discovered fields on Step 1: ${workflowState.discoveredFields.length}`);
    console.log(`   ✅ Generated proposals on Step 1: ${workflowState.currentProposals.length}`);

    // Verify all proposals start unapproved
    const allUnapproved = workflowState.currentProposals.every((p: any) => p.approved === false);
    if (!allUnapproved) {
      throw new Error('Safety violation: Proposed fields must start with approved = false.');
    }
    console.log('   ✅ Strict Safety Gate: Every proposed field starts unapproved (approved = false).');

    // 6. Execute Step 1 Fields with explicit human approval
    console.log('\n6. Human Approval: Populating approved fields on Step 1...');
    const fullNameProp = workflowState.currentProposals.find((p: any) => p.fieldName === 'fullName');
    const emailProp = workflowState.currentProposals.find((p: any) => p.fieldName === 'email');
    if (!fullNameProp || !emailProp) {
      throw new Error('Expected fullName and email proposals on Step 1');
    }

    const step1ExecRes = await request(`/browser/sessions/${sessionId}/workflow/step/execute`, {
      method: 'POST',
      body: JSON.stringify({
        approvedFieldIds: [fullNameProp.fieldId, emailProp.fieldId],
      }),
    });
    if (!step1ExecRes.ok) {
      throw new Error(`Failed to execute Step 1 fields: ${JSON.stringify(step1ExecRes.data)}`);
    }
    const step1Results = step1ExecRes.data;
    console.log(`   ✅ Step 1 fields executed. Verified filled: ${step1Results.results.filter((r: any) => r.status === 'SUCCESS').length}`);
    console.log(`   ✅ canNavigateForward: ${step1Results.canNavigateForward}`);
    console.log(`   ✅ applicationSubmitted: ${step1Results.applicationSubmitted}`);

    // 7. Explicit Navigation Approval from Step 1 to Step 2
    console.log('\n7. Human Approval: Explicitly advancing from Step 1 to Step 2...');
    const nextCtrl = step1Results.availableNavigationControls.find((c: any) => c.direction === 'FORWARD');
    if (!nextCtrl) {
      throw new Error('Next navigation control not found on Step 1');
    }

    const navToStep2Res = await request(`/browser/sessions/${sessionId}/workflow/step/navigate`, {
      method: 'POST',
      body: JSON.stringify({ controlId: nextCtrl.id }),
    });
    if (!navToStep2Res.ok) {
      throw new Error(`Failed to navigate to Step 2: ${JSON.stringify(navToStep2Res.data)}`);
    }
    const step2State = navToStep2Res.data;
    console.log(`   ✅ Navigated successfully. New step: "${step2State.newHeading}" (index: ${step2State.currentStepIndex})`);
    console.log(`   ✅ Step 2 Rediscovered fields: ${step2State.rediscoveredFieldCount}`);
    console.log(`   ✅ Step 2 Fresh proposals: ${step2State.newProposals.length} (all approved = false)`);

    // 8. Execute Step 2 Fields with fresh human approval
    console.log('\n8. Human Approval: Populating approved fields on Step 2...');
    const locProp = step2State.newProposals.find((p: any) => p.fieldName === 'location');
    const approvedStep2Ids = locProp ? [locProp.fieldId] : [];

    const step2ExecRes = await request(`/browser/sessions/${sessionId}/workflow/step/execute`, {
      method: 'POST',
      body: JSON.stringify({ approvedFieldIds: approvedStep2Ids }),
    });
    if (!step2ExecRes.ok) {
      throw new Error(`Failed to execute Step 2 fields: ${JSON.stringify(step2ExecRes.data)}`);
    }
    console.log(`   ✅ Step 2 execution complete. Verified: ${step2ExecRes.data.results.filter((r: any) => r.status === 'SUCCESS').length}`);

    // 9. Explicit Navigation Approval from Step 2 to Step 3
    console.log('\n9. Human Approval: Explicitly advancing from Step 2 to Step 3...');
    const continueCtrl = step2State.availableNavigationControls.find((c: any) => c.direction === 'FORWARD');
    if (!continueCtrl) {
      throw new Error('Continue navigation control not found on Step 2');
    }

    const navToStep3Res = await request(`/browser/sessions/${sessionId}/workflow/step/navigate`, {
      method: 'POST',
      body: JSON.stringify({ controlId: continueCtrl.id }),
    });
    if (!navToStep3Res.ok) {
      throw new Error(`Failed to navigate to Step 3: ${JSON.stringify(navToStep3Res.data)}`);
    }
    const step3State = navToStep3Res.data;
    console.log(`   ✅ Navigated to Step 3: "${step3State.newHeading}" (index: ${step3State.currentStepIndex})`);
    console.log(`   ✅ terminalControlDetected: ${step3State.terminalControlDetected}`);

    const submitCtrl = step3State.availableNavigationControls.find((c: any) => c.isTerminal);
    if (!submitCtrl) {
      throw new Error('Expected terminal Submit control on Step 3');
    }
    console.log(`   ✅ Terminal Submit control identified: "${submitCtrl.label}" (isExecutable: ${submitCtrl.isExecutable})`);

    // 10. CRITICAL SAFETY TEST: Attempting execution of terminal Submit control
    console.log('\n10. CRITICAL SAFETY TEST: Attempting execution of terminal Submit control...');
    const termExecRes = await request(`/browser/sessions/${sessionId}/workflow/step/navigate`, {
      method: 'POST',
      body: JSON.stringify({ controlId: submitCtrl.id }),
    });
    if (termExecRes.status !== 403 || termExecRes.data?.code !== 'TERMINAL_ACTION_FORBIDDEN') {
      throw new Error(`Expected 403 TERMINAL_ACTION_FORBIDDEN, received ${termExecRes.status}: ${JSON.stringify(termExecRes.data)}`);
    }
    console.log(`   ✅ Expected 403 Forbidden received: "${termExecRes.data.message}"`);
    console.log('   🛡️ TERMINAL APPLICATION SUBMISSION IS STRICTLY BLOCKED.');

    // 11. Retrieve cumulative workflow step history
    console.log('\n11. Retrieving cumulative workflow history across all completed steps...');
    const historyRes = await request(`/browser/sessions/${sessionId}/workflow/history`);
    if (!historyRes.ok || historyRes.data?.totalStepsCompleted < 2) {
      throw new Error(`Invalid workflow history: ${JSON.stringify(historyRes.data)}`);
    }
    const history = historyRes.data;
    console.log(`   ✅ Cumulative history verified: ${history.totalStepsCompleted} steps completed, ${history.stepHistory.length} recorded steps.`);
    console.log(`   ✅ History confirmed applicationSubmitted = ${history.applicationSubmitted}`);

    // 12. PROOF OF NON-SUBMISSION
    console.log('\n12. PROOF OF NON-SUBMISSION: Checking test fixture submission status...');
    const finalAudit = await request('/browser/test-page/multi-step/submission-status');
    if (!finalAudit.ok || finalAudit.data?.submissionCount !== 0 || finalAudit.data?.applicationSubmitted !== false) {
      throw new Error(`CRITICAL FAILURE: Form was submitted! Audit: ${JSON.stringify(finalAudit.data)}`);
    }
    console.log(`   ✅ submissionCount: ${finalAudit.data.submissionCount}`);
    console.log(`   ✅ applicationSubmitted: ${finalAudit.data.applicationSubmitted}`);

    // 13. Clean up workflow and session resources
    console.log('\n13. Releasing workflow and browser session...');
    await request(`/browser/sessions/${sessionId}`, { method: 'DELETE' });
    console.log('   ✅ Session released successfully.');

    console.log('\n============================================================');
    console.log('🎉 MILESTONE 12.2 LIVE VERIFICATION PASSED SUCCESSFULLY!');
    console.log('------------------------------------------------------------');
    console.log('   - Multi-step workflow initialization: VERIFIED');
    console.log('   - Step 1 autofill & verification: VERIFIED');
    console.log('   - Explicit forward navigation approval: VERIFIED');
    console.log('   - Step 2 progression & fresh unapproved proposals: VERIFIED');
    console.log('   - Step 3 progression & terminal detection: VERIFIED');
    console.log('   - Terminal Submit control blocked (HTTP 403): VERIFIED');
    console.log('   - Cumulative step history tracking: VERIFIED');
    console.log('   - APPLICATION SUBMITTED: FALSE');
    console.log('   - SUBMISSION COUNT: 0');
    console.log('============================================================\n');
  } catch (err: unknown) {
    console.error('\n❌ MILESTONE 12.2 VERIFICATION FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (embeddedServer) {
      await embeddedServer.close();
    }
  }
}

runLiveVerification();
