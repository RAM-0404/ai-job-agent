import type { Page } from 'playwright';
import { browserService, BrowserService } from './browser.service.js';
import {
  BrowserSessionNotFoundError,
  TerminalActionForbiddenError,
  NavigationNotAllowedError,
  NavigationControlNotFoundError,
  NavigationStepChangedError,
  BrowserOperationError,
} from './browser.errors.js';
import type {
  NavigationControl,
  NavigationControlType,
  NavigationDirection,
  NavigationStep,
  NavigationState,
  NavigationStatus,
  StepTransitionRecord,
  ApproveNavigationResponse,
  NavigationValidationStatusDto,
} from '@ai-job-agent/shared';
import { autofillService, AutofillService } from './autofill.service.js';

interface RawDomNavigationInspection {
  url: string;
  title: string;
  heading: string | null;
  stepIndicatorText: string | null;
  stepperIndex: number | null;
  discoveredFieldCount: number;
  requiredFieldCount: number;
  validationErrors: string[];
  rawControls: Array<{
    id: string | null;
    name: string | null;
    text: string;
    ariaLabel: string | null;
    role: string | null;
    tag: 'button' | 'a' | 'input';
    type: string | null;
    value: string | null;
    disabled: boolean;
    formIndex: number | null;
    suggestedSelector: string;
  }>;
}

export class BrowserNavigationService {
  private readonly states = new Map<string, NavigationState>();

  constructor(
    private readonly browser: BrowserService = browserService,
    private readonly autofill: AutofillService = autofillService
  ) {}

  /**
   * Clears navigation state for a session.
   */
  clearNavigation(sessionId: string): void {
    this.states.delete(sessionId);
  }

  /**
   * Retrieves active navigation state for a session or throws BrowserSessionNotFoundError.
   */
  getNavigationState(sessionId: string): NavigationState {
    this.browser.getSession(sessionId); // Validates session exists
    const state = this.states.get(sessionId);
    if (!state) {
      throw new NavigationNotAllowedError(`No active navigation state initialized for session "${sessionId}". Perform discovery first.`);
    }
    return state;
  }

  /**
   * Normalizes button / control text for deterministic matching.
   */
  normalizeLabel(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Classifies control semantically based on deterministic DOM signals.
   * Final Submit / Apply controls are ALWAYS classified as TERMINAL with isExecutable = false.
   */
  classifyControl(raw: {
    text: string;
    ariaLabel: string | null;
    type: string | null;
    value: string | null;
  }): {
    type: NavigationControlType;
    direction: NavigationDirection;
    isExecutable: boolean;
    isTerminal: boolean;
  } {
    const combined = [raw.text, raw.ariaLabel, raw.value]
      .filter(Boolean)
      .join(' ');
    const norm = this.normalizeLabel(combined);
    const rawType = (raw.type || '').toLowerCase();

    // 1. TERMINAL CONTROLS (Highest precedence: never executable by M12.1)
    // Matches Submit, Apply, Finish application, etc.
    const isTerminalText =
      /(submit\s+application|apply\s+now|submit\s+now|submit\s+candidate|apply\s+for\s+job|finish\s+application|complete\s+application|finalize\s+application|send\s+application|^submit$|^apply$|^finish$)/i.test(
        norm
      );

    const isExplicitSubmitInput =
      rawType === 'submit' && (norm === '' || /(submit|apply|finish)/i.test(norm));

    if (isTerminalText || isExplicitSubmitInput) {
      return {
        type: 'TERMINAL',
        direction: 'TERMINAL',
        isExecutable: false,
        isTerminal: true,
      };
    }

    // 2. REVIEW CONTROLS
    // Matches Review, Review application, Review answers
    const isReviewText = /(review\s+application|review\s+details|review\s+answers|^review$)/i.test(
      norm
    );
    if (isReviewText) {
      return {
        type: 'REVIEW',
        direction: 'REVIEW',
        isExecutable: true,
        isTerminal: false,
      };
    }

    // 3. PREVIOUS / BACK CONTROLS
    // Matches Back, Previous, Go back, Return
    const isPreviousText = /(go\s+back|previous\s+step|^previous$|^back$|^return$)/i.test(norm);
    if (isPreviousText) {
      const type: NavigationControlType = norm.includes('back') ? 'BACK' : 'PREVIOUS';
      return {
        type,
        direction: 'BACKWARD',
        isExecutable: true,
        isTerminal: false,
      };
    }

    // 4. NEXT / CONTINUE CONTROLS
    // Matches Next, Continue, Continue to next step, Save and continue, Proceed
    const isNextOrContinue =
      /(continue\s+to\s+next\s+step|save\s+and\s+continue|next\s+step|proceed\s+to\s+next\s+step|^next$|^continue$|^proceed$)/i.test(
        norm
      );
    if (isNextOrContinue) {
      const type: NavigationControlType = norm.includes('continue') ? 'CONTINUE' : 'NEXT';
      return {
        type,
        direction: 'FORWARD',
        isExecutable: true,
        isTerminal: false,
      };
    }

    // 5. UNKNOWN / NON-NAVIGATIONAL
    return {
      type: 'UNKNOWN',
      direction: 'UNKNOWN',
      isExecutable: false,
      isTerminal: false,
    };
  }

  /**
   * Observational discovery of the current page step and navigation controls.
   */
  async discoverNavigation(
    sessionId: string,
    targetUrl?: string
  ): Promise<NavigationState> {
    // 1. Validate session and navigate if targetUrl provided
    this.browser.getSession(sessionId);

    if (targetUrl) {
      await this.browser.navigate(sessionId, targetUrl);
    }

    // 2. Read-only extraction of DOM step markers and controls
    const rawDom = await this.browser.evaluateInSession<RawDomNavigationInspection>(
      sessionId,
      () => {
        const url = window.location.href || '';
        const title = document.title || '';

        // Extract active step indicator and heading
        let heading: string | null = null;
        let stepIndicatorText: string | null = null;
        let stepperIndex: number | null = null;

        const currentBadgeEl = document.querySelector('[aria-current="step"], .step-badge.active, .step.active');
        if (currentBadgeEl) {
          stepIndicatorText = currentBadgeEl.textContent?.trim() || null;
          const match = stepIndicatorText?.match(/step\s*(\d+)/i);
          if (match) {
            stepperIndex = parseInt(match[1], 10);
          }
        }

        const activeSectionEl = document.querySelector('.step-section.active, form .active');
        if (activeSectionEl) {
          const innerH2 = activeSectionEl.querySelector('h2, h3, legend');
          if (innerH2) {
            heading = innerH2.textContent?.trim() || null;
          }
        }

        if (!heading && stepIndicatorText) {
          heading = stepIndicatorText;
        }

        if (!heading) {
          const fallbackHeadingEl = document.querySelector('h2, legend, h1');
          if (fallbackHeadingEl) {
            heading = fallbackHeadingEl.textContent?.trim() || null;
          }
        }

        if (!stepperIndex && heading) {
          const match = heading.match(/step\s*(\d+)/i);
          if (match) {
            stepperIndex = parseInt(match[1], 10);
          }
        }

        // Interactive field counts (scoped to active step if multi-step sections exist)
        const allFields = Array.from(
          document.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
          )
        );
        const fields = allFields.filter((el) => {
          const parentSection = el.closest('.step-section');
          if (parentSection) {
            return parentSection.classList.contains('active');
          }
          return true;
        });

        const requiredFields = fields.filter((el) =>
          el.hasAttribute('required') || el.getAttribute('aria-required') === 'true'
        );

        // Validation error indicators
        const errorElements = Array.from(
          document.querySelectorAll(
            '.error-message, .invalid-feedback, .alert-danger, [aria-invalid="true"], :invalid'
          )
        );
        const validationErrors = errorElements
          .map((el) => {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
              return el.validationMessage ? `${el.name || el.id || 'Field'}: ${el.validationMessage}` : '';
            }
            return el.textContent?.trim() || '';
          })
          .filter((msg) => msg.length > 0 && msg.length < 150)
          .slice(0, 10);

        // Candidate controls: buttons, input buttons, links with role="button"
        // Scoped to active step if multi-step sections exist
        const allControlElements = Array.from(
          document.querySelectorAll(
            'button, input[type="button"], input[type="submit"], [role="button"], a.btn, a.button'
          )
        );
        const controlElements = allControlElements.filter((el) => {
          const parentSection = el.closest('.step-section');
          if (parentSection) {
            return parentSection.classList.contains('active');
          }
          return true;
        });

        const rawControls = controlElements.map((el, index) => {
          const tag = el.tagName.toLowerCase() as 'button' | 'a' | 'input';
          const id = el.getAttribute('id');
          const name = el.getAttribute('name');
          const role = el.getAttribute('role');
          const ariaLabel = el.getAttribute('aria-label');
          const type = el.getAttribute('type') || (tag === 'button' ? 'button' : null);
          const disabled = (el as HTMLButtonElement).disabled || false;

          let text = el.textContent?.trim() || '';
          let value: string | null = null;
          if (el instanceof HTMLInputElement) {
            value = el.value || null;
            if (!text && value) {
              text = value;
            }
          }

          const parentForm = el.closest('form');
          const allForms = Array.from(document.querySelectorAll('form'));
          const formIndex = parentForm ? allForms.indexOf(parentForm) : null;

          // Build reliable CSS selector
          let suggestedSelector = '';
          if (id) {
            suggestedSelector = `#${CSS.escape(id)}`;
          } else if (name) {
            suggestedSelector = `${tag}[name="${CSS.escape(name)}"]`;
          } else if (ariaLabel) {
            suggestedSelector = `[aria-label="${CSS.escape(ariaLabel)}"]`;
          } else {
            suggestedSelector = `${tag}:nth-of-type(${index + 1})`;
          }

          return {
            id,
            name,
            text,
            ariaLabel,
            role,
            tag,
            type,
            value,
            disabled,
            formIndex: formIndex !== -1 ? formIndex : null,
            suggestedSelector,
          };
        });

        return {
          url,
          title,
          heading,
          stepIndicatorText,
          stepperIndex,
          discoveredFieldCount: fields.length,
          requiredFieldCount: requiredFields.length,
          validationErrors,
          rawControls,
        };
      }
    );

    // 3. Process raw controls and build NavigationControl list
    const controls: NavigationControl[] = [];
    let terminalDetected = false;

    rawDom.rawControls.forEach((raw, idx) => {
      const classification = this.classifyControl(raw);
      if (classification.isTerminal) {
        terminalDetected = true;
      }

      // Generate stable controlId
      const slug = (raw.id || raw.name || classification.type.toLowerCase()).replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      const controlId = `ctrl-${idx + 1}-${slug}`;

      controls.push({
        id: controlId,
        type: classification.type,
        label: raw.text || raw.value || raw.ariaLabel || `Button ${idx + 1}`,
        normalizedLabel: this.normalizeLabel(raw.text || raw.value || raw.ariaLabel || ''),
        direction: classification.direction,
        isExecutable: classification.isExecutable,
        isTerminal: classification.isTerminal,
        tag: raw.tag,
        buttonType: raw.type || undefined,
        selector: raw.suggestedSelector,
        disabled: raw.disabled,
        formIndex: raw.formIndex,
      });
    });

    // 4. Resolve Step Identity
    const existingState = this.states.get(sessionId);
    let stepIndex = rawDom.stepperIndex;
    if (!stepIndex) {
      if (!existingState || !existingState.currentStep) {
        stepIndex = 1;
      } else {
        stepIndex = existingState.currentStep.stepIndex;
      }
    }

    const stepHeading = rawDom.heading || rawDom.stepIndicatorText || `Step ${stepIndex}`;
    const stepSlug = stepHeading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const stepId = `step-${stepIndex}-${stepSlug || 'page'}`;

    const currentStep: NavigationStep = {
      stepId,
      stepIndex,
      url: rawDom.url,
      title: rawDom.title,
      heading: rawDom.heading,
      discoveredFieldCount: rawDom.discoveredFieldCount,
      requiredFieldCount: rawDom.requiredFieldCount,
      controls,
      isTerminalDetected: terminalDetected,
      hasValidationErrors: rawDom.validationErrors.length > 0,
      visitedAt: new Date().toISOString(),
      completed: false,
    };

    // 5. Update or initialize NavigationState
    const state: NavigationState = existingState || {
      sessionId,
      status: 'STEP_DETECTED',
      currentStep: null,
      visitedSteps: [],
      stepHistory: [],
      currentUrl: rawDom.url,
      currentTitle: rawDom.title,
      detectedControls: controls,
      terminalControlDetected: terminalDetected,
      hasValidationErrors: rawDom.validationErrors.length > 0,
      lastDiscoveryTimestamp: new Date().toISOString(),
    };

    state.currentStep = currentStep;
    state.currentUrl = rawDom.url;
    state.currentTitle = rawDom.title;
    state.detectedControls = controls;
    state.terminalControlDetected = terminalDetected;
    state.hasValidationErrors = rawDom.validationErrors.length > 0;
    state.lastDiscoveryTimestamp = new Date().toISOString();
    state.status = terminalDetected ? 'TERMINAL_REACHED' : 'WAITING_FOR_APPROVAL';

    this.states.set(sessionId, state);
    return state;
  }

  /**
   * Explicitly approves and executes a safe, non-terminal navigation control.
   * Terminal controls (Submit / Apply / Finish) are strictly rejected with 403 Forbidden.
   */
  async approveAndNavigate(
    sessionId: string,
    controlId: string
  ): Promise<ApproveNavigationResponse> {
    const state = this.getNavigationState(sessionId);
    const previousStep = state.currentStep;

    if (!previousStep) {
      throw new NavigationNotAllowedError('No step discovered yet. Run discovery before approving navigation.');
    }

    // Locate the control
    const control = previousStep.controls.find((c) => c.id === controlId);
    if (!control) {
      throw new NavigationControlNotFoundError(controlId);
    }

    // SAFETY CHECK: Terminal actions are strictly forbidden from execution
    if (control.isTerminal || control.type === 'TERMINAL') {
      throw new TerminalActionForbiddenError(control.label);
    }

    // SAFETY CHECK: Non-executable controls cannot be run
    if (!control.isExecutable) {
      throw new NavigationNotAllowedError(
        `Control "${control.label}" (${control.type}) is not an executable navigation control.`
      );
    }

    // SAFETY CHECK: Ensure page hasn't mutated away from previous step
    const page: Page = this.browser.getPage(sessionId);
    const currentUrl = page.url();
    if (currentUrl !== previousStep.url && previousStep.url !== '') {
      throw new NavigationStepChangedError(previousStep.url, currentUrl);
    }

    // Preserve active autofill proposal/results for previous step
    this.autofill.preserveStepState(sessionId, previousStep.stepId);

    state.status = 'NAVIGATING';

    // Execute navigation click on the approved control
    try {
      const locator = page.locator(control.selector).first();
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {}),
        locator.click({ timeout: 5000 }),
      ]);
      // Brief DOM stabilization
      await page.waitForTimeout(300);
    } catch (err: unknown) {
      state.status = 'FAILED';
      const msg = err instanceof Error ? err.message : String(err);
      throw new BrowserOperationError(`Failed to execute approved navigation on control "${control.label}": ${msg}`);
    }

    // Mark previous step as completed and record in visitedSteps
    const completedPrevStep: NavigationStep = {
      ...previousStep,
      completed: true,
    };

    const visitedIdx = state.visitedSteps.findIndex((s) => s.stepId === previousStep.stepId);
    if (visitedIdx >= 0) {
      state.visitedSteps[visitedIdx] = completedPrevStep;
    } else {
      state.visitedSteps.push(completedPrevStep);
    }

    // Rediscover new page state
    const rediscoveryState = await this.discoverNavigation(sessionId);
    const nextStep = rediscoveryState.currentStep!;

    // Infer step progression if step index didn't change via DOM
    if (nextStep.stepIndex === previousStep.stepIndex) {
      if (control.direction === 'FORWARD') {
        nextStep.stepIndex = previousStep.stepIndex + 1;
        nextStep.stepId = `step-${nextStep.stepIndex}-${nextStep.heading?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'page'}`;
      } else if (control.direction === 'BACKWARD') {
        nextStep.stepIndex = Math.max(1, previousStep.stepIndex - 1);
        nextStep.stepId = `step-${nextStep.stepIndex}-${nextStep.heading?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'page'}`;
      }
    }

    // Record step transition in history
    const transitionRecord: StepTransitionRecord = {
      fromStepId: previousStep.stepId,
      toStepId: nextStep.stepId,
      controlId: control.id,
      controlType: control.type,
      controlLabel: control.label,
      timestamp: new Date().toISOString(),
    };
    state.stepHistory.push(transitionRecord);

    const validationStatus: NavigationValidationStatusDto = {
      hasErrors: nextStep.hasValidationErrors,
      errorCount: nextStep.hasValidationErrors ? 1 : 0,
      messages: [],
    };

    return {
      success: true,
      previousStep: completedPrevStep,
      currentStep: nextStep,
      controlUsed: control,
      newUrl: nextStep.url,
      newTitle: nextStep.title,
      rediscoveredFieldCount: nextStep.discoveredFieldCount,
      rediscoveredControls: nextStep.controls,
      terminalControlDetected: nextStep.isTerminalDetected,
      validationStatus,
      navigationState: state,
    };
  }
}

export const browserNavigationService = new BrowserNavigationService();
