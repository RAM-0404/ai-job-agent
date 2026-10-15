/**
 * Milestone 10.2 Live Verification Script
 * Validates Controlled Application Page Discovery & Form Inspection endpoints on running API container
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

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
  console.log('🚀 STARTING MILESTONE 10.2 LIVE VERIFICATION');
  console.log(`Target API: ${BASE_URL}`);
  console.log('============================================================\n');

  // Step 1: Health check verification
  console.log('1. Verifying /health endpoint reporting...');
  const healthRes = await request('/health');
  if (healthRes.status !== 200 || !healthRes.data?.browser?.enabled) {
    throw new Error(`Health check failed: ${JSON.stringify(healthRes.data)}`);
  }
  console.log('   ✅ Health OK:', JSON.stringify(healthRes.data));

  // Step 2: Test fixture pages verification
  console.log('\n2. Verifying deterministic local test fixtures...');
  const appFixtureRes = await fetch(`${BASE_URL}/browser/test-page/application`);
  const appFixtureHtml = await appFixtureRes.text();
  if (appFixtureRes.status !== 200 || !appFixtureHtml.includes('Software Engineer Application')) {
    throw new Error(`Application test fixture check failed: status ${appFixtureRes.status}`);
  }

  const jdFixtureRes = await fetch(`${BASE_URL}/browser/test-page/job-description`);
  const jdFixtureHtml = await jdFixtureRes.text();
  if (jdFixtureRes.status !== 200 || !jdFixtureHtml.includes('Principal Backend Engineer')) {
    throw new Error(`Job description fixture check failed: status ${jdFixtureRes.status}`);
  }

  const nonAppFixtureRes = await fetch(`${BASE_URL}/browser/test-page/non-application`);
  const nonAppFixtureHtml = await nonAppFixtureRes.text();
  if (nonAppFixtureRes.status !== 200 || !nonAppFixtureHtml.includes('Scaling Distributed Queues')) {
    throw new Error(`Non-application fixture check failed: status ${nonAppFixtureRes.status}`);
  }
  console.log('   ✅ All local HTML test fixtures served correctly (offline deterministic testing available)');

  // Step 3: Create browser session
  console.log('\n3. Creating isolated browser session...');
  let sessionId: string | null = null;
  try {
    const sessionRes = await request('/browser/sessions', { method: 'POST' });
    if (sessionRes.status !== 201 || !sessionRes.data?.sessionId) {
      throw new Error(`Session creation failed: ${JSON.stringify(sessionRes.data)}`);
    }
    sessionId = sessionRes.data.sessionId;
    console.log(`   ✅ Browser session created: ${sessionId}`);

    // Step 4: Perform Application Discovery on Application Page
    console.log('\n4. Executing Application Page Discovery on application fixture...');
    const appDiscoveryRes = await request(`/browser/sessions/${sessionId}/application-discovery`, {
      method: 'POST',
      body: JSON.stringify({ url: `${BASE_URL}/browser/test-page/application` }),
    });
    if (appDiscoveryRes.status !== 200) {
      throw new Error(`Application discovery failed: ${JSON.stringify(appDiscoveryRes.data)}`);
    }
    const appAnalysis = appDiscoveryRes.data;

    // Step 5: Verify Application Page Detection & Confidence
    console.log('\n5. Verifying application-page detection and signals...');
    if (!appAnalysis.application.isApplicationPage || appAnalysis.application.confidence < 0.6) {
      throw new Error(`Page was not recognized as application page: ${JSON.stringify(appAnalysis.application)}`);
    }
    console.log(`   ✅ Detected as Application Page: isApplicationPage=${appAnalysis.application.isApplicationPage}`);
    console.log(`   ✅ Confidence: ${appAnalysis.application.confidence}`);
    console.log(`   ✅ Detected Signals:`, appAnalysis.application.signals);

    // Step 6: Verify Form Discovery
    console.log('\n6. Verifying Form Discovery...');
    if (!appAnalysis.forms || appAnalysis.forms.length === 0) {
      throw new Error(`No forms discovered: ${JSON.stringify(appAnalysis.forms)}`);
    }
    const mainForm = appAnalysis.forms[0];
    console.log(`   ✅ Discovered form: id="${mainForm.id}", method="${mainForm.method}", fieldCount=${mainForm.fieldCount}, requiredCount=${mainForm.requiredFieldCount}`);

    // Step 7: Verify Field Discovery & Label Resolution
    console.log('\n7. Verifying Field Discovery & Label Resolution...');
    const emailField = appAnalysis.fields.find((f: any) => f.name === 'email' || f.id === 'email');
    if (!emailField || emailField.type !== 'EMAIL' || emailField.labelSource !== 'label-for') {
      throw new Error(`Email field label resolution failed: ${JSON.stringify(emailField)}`);
    }
    console.log(`   ✅ Email field discovered: id="${emailField.id}", type="${emailField.type}", label="${emailField.label}" (source: ${emailField.labelSource})`);

    const resumeField = appAnalysis.fields.find((f: any) => f.type === 'FILE');
    if (!resumeField || !resumeField.fileConfig?.accept) {
      throw new Error(`Resume file field discovery failed: ${JSON.stringify(resumeField)}`);
    }
    console.log(`   ✅ File input discovered: id="${resumeField.id}", type="${resumeField.type}", accept="${resumeField.fileConfig.accept}"`);

    // Step 8: Verify Required Field Detection
    console.log('\n8. Verifying Required Field Detection...');
    const requiredFields = appAnalysis.fields.filter((f: any) => f.required);
    if (requiredFields.length < 3) {
      throw new Error(`Expected at least 3 required fields, found: ${requiredFields.length}`);
    }
    console.log(`   ✅ Found ${requiredFields.length} required fields: ${requiredFields.map((f: any) => f.name).join(', ')}`);

    // Step 9: Verify Button Classification
    console.log('\n9. Verifying Button Classification...');
    const submitBtn = appAnalysis.buttons.find((b: any) => b.classification === 'PRIMARY_APPLICATION_ACTION');
    if (!submitBtn) {
      throw new Error(`Expected PRIMARY_APPLICATION_ACTION button, found: ${JSON.stringify(appAnalysis.buttons)}`);
    }
    console.log(`   ✅ Primary action button classified: text="${submitBtn.text}", classification="${submitBtn.classification}"`);

    // Step 10: Verify Candidate Field Mappings & Missing Information
    console.log('\n10. Verifying Candidate Field Mappings and Missing Information...');
    if (!appAnalysis.candidateMappings || appAnalysis.candidateMappings.length === 0) {
      throw new Error(`Expected candidate mappings, found 0`);
    }
    console.log(`   ✅ Discovered ${appAnalysis.candidateMappings.length} candidate mappings:`);
    for (const m of appAnalysis.candidateMappings) {
      console.log(`      - Field "${m.fieldName || m.fieldId}" -> ${m.candidateSource} (confidence: ${m.confidence})`);
    }

    console.log(`   ✅ Identified ${appAnalysis.missingInformation.length} missing information items:`);
    for (const miss of appAnalysis.missingInformation) {
      console.log(`      - Missing "${miss.label}" (${miss.fieldId}): ${miss.reason}`);
    }

    // Step 11: Application Target Discovery on Job Description Page
    console.log('\n11. Testing Application Target Link Discovery on Job Description page...');
    const jdDiscoveryRes = await request(`/browser/sessions/${sessionId}/application-discovery`, {
      method: 'POST',
      body: JSON.stringify({ url: `${BASE_URL}/browser/test-page/job-description` }),
    });
    if (jdDiscoveryRes.status !== 200) {
      throw new Error(`JD discovery failed: ${JSON.stringify(jdDiscoveryRes.data)}`);
    }
    const jdAnalysis = jdDiscoveryRes.data;
    const targets = jdAnalysis?.targets || jdAnalysis?.applicationTargets || [];
    const applyLink = targets.find((t: any) => t.type === 'APPLICATION_LINK');
    if (!applyLink) {
      throw new Error(`Expected APPLICATION_LINK target on JD page, found: ${JSON.stringify(targets)}`);
    }
    console.log(`   ✅ Discovered Application Target: text="${applyLink.text}", url="${applyLink.url}", type="${applyLink.type}"`);

    // Step 12: Discovery on Non-Application Page (Negative Test)
    console.log('\n12. Testing Discovery on Non-Application page (negative case)...');
    const nonAppDiscoveryRes = await request(`/browser/sessions/${sessionId}/application-discovery`, {
      method: 'POST',
      body: JSON.stringify({ url: `${BASE_URL}/browser/test-page/non-application` }),
    });
    if (nonAppDiscoveryRes.status !== 200) {
      throw new Error(`Non-app discovery failed: ${JSON.stringify(nonAppDiscoveryRes.data)}`);
    }
    if (nonAppDiscoveryRes.data.application.isApplicationPage) {
      throw new Error(`Non-application page was incorrectly flagged as application page`);
    }
    console.log(`   ✅ Correctly classified non-application page: isApplicationPage=false (confidence: ${nonAppDiscoveryRes.data.application.confidence})`);

    // Step 13: Verify Read-Only Safeguard (No Mutation on Fields)
    console.log('\n13. Verifying Read-Only Safeguard (Observation Only, No Form Mutation)...');
    const reInspectRes = await request(`/browser/sessions/${sessionId}/application-discovery`, {
      method: 'POST',
      body: JSON.stringify({ url: `${BASE_URL}/browser/test-page/application` }),
    });
    const reInspectFields = reInspectRes.data.fields;
    const anyFieldHasValue = reInspectFields.some((f: any) => f.hasValue);
    if (anyFieldHasValue) {
      throw new Error(`Read-only violation! Some fields have values unexpectedly: ${JSON.stringify(reInspectFields)}`);
    }
    console.log('   ✅ Read-only confirmed: 0 fields modified, all form fields untouched and empty.');
  } finally {
    if (sessionId) {
      console.log('\n14. Closing browser session and releasing resources...');
      const closeRes = await request(`/browser/sessions/${sessionId}`, { method: 'DELETE' });
      if (closeRes.status === 200) {
        console.log('   ✅ Session successfully closed.');
      } else {
        console.log('   ⚠️ Session close response:', closeRes.status);
      }
    }
  }

  console.log('\n============================================================');
  console.log('🎉 MILESTONE 10.2 LIVE VERIFICATION PASSED SUCCESSFULLY!');
  console.log('============================================================\n');
}

runLiveVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
