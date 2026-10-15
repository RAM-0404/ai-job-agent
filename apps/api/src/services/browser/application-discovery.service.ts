import { browserService, BrowserService } from './browser.service.js';
import { prisma } from '../../db/prisma.js';
import type {
  ApplicationPageAnalysisDto,
  ApplicationPageIndicatorDto,
  ApplicationTargetDto,
  DiscoveredButtonDto,
  DiscoveredFieldDto,
  DiscoveredFieldType,
  DiscoveredFormDto,
  ButtonClassification,
  CandidateFieldMappingDto,
  MissingCandidateInformationDto,
  RawDomInspection,
  RawDomField,
  RawDomButton,
  RawDomLink,
} from './application-discovery.types.js';

export class ApplicationDiscoveryService {
  constructor(private readonly browser: BrowserService = browserService) {}

  /**
   * Discovers and inspects application targets and form structures on the active session's page.
   * Completely observational: performs NO form filling, file uploading, button clicking, or database mutations.
   */
  async analyzePage(
    sessionId: string,
    targetUrl?: string,
    userProfileId?: string
  ): Promise<ApplicationPageAnalysisDto> {
    // 1. If targetUrl is explicitly provided, navigate to it using BrowserService URL validation
    if (targetUrl) {
      await this.browser.navigate(sessionId, targetUrl);
    }

    const pageInfo = await this.browser.getPageInfo(sessionId);

    // 2. Perform safe, read-only DOM extraction within page context
    const rawDom = await this.browser.evaluateInSession<RawDomInspection>(
      sessionId,
      () => {
        const title = document.title || '';
        const url = window.location.href || '';

        // Extract headings
        const headingElements = Array.from(document.querySelectorAll('h1, h2, h3'));
        const headings = headingElements
          .map((h) => h.textContent?.trim() || '')
          .filter((t) => t.length > 0);

        // Extract forms
        const formElements = Array.from(document.querySelectorAll('form'));
        const forms = formElements.map((form, index) => {
          const id = form.getAttribute('id');
          const name = form.getAttribute('name');
          const action = form.getAttribute('action');
          const method = form.getAttribute('method') || 'GET';
          const ariaLabel = form.getAttribute('aria-label');

          // Find nearby preceding heading
          let surroundingHeading: string | null = null;
          let prev = form.previousElementSibling;
          while (prev) {
            if (/^H[1-4]$/i.test(prev.tagName)) {
              surroundingHeading = prev.textContent?.trim() || null;
              break;
            }
            prev = prev.previousElementSibling;
          }

          const fieldElements = form.querySelectorAll('input:not([type="hidden"]), select, textarea');
          const requiredElements = form.querySelectorAll(
            'input[required], select[required], textarea[required], [aria-required="true"]'
          );
          const buttonElements = form.querySelectorAll(
            'button, input[type="submit"], input[type="button"], [role="button"]'
          );

          return {
            index,
            id,
            name,
            action,
            method: method.toUpperCase(),
            ariaLabel,
            surroundingHeading,
            fieldCount: fieldElements.length,
            requiredFieldCount: requiredElements.length,
            buttonCount: buttonElements.length,
          };
        });

        // Extract interactive fields
        const allFieldElements = Array.from(
          document.querySelectorAll('input, select, textarea')
        );

        const fields = allFieldElements.map((el, index) => {
          const tag = el.tagName.toLowerCase() as 'input' | 'select' | 'textarea';
          const inputEl = el as HTMLInputElement;
          const selectEl = el as HTMLSelectElement;

          const rawType = tag === 'input' ? (inputEl.type || 'text').toLowerCase() : tag;
          const name = el.getAttribute('name');
          const id = el.getAttribute('id');
          const placeholder = el.getAttribute('placeholder');
          const autocomplete = el.getAttribute('autocomplete');
          const ariaLabel = el.getAttribute('aria-label');
          const ariaLabelledByAttr = el.getAttribute('aria-labelledby');

          let ariaLabelledByText: string | null = null;
          if (ariaLabelledByAttr) {
            const labelledByEl = document.getElementById(ariaLabelledByAttr);
            if (labelledByEl) {
              ariaLabelledByText = labelledByEl.textContent?.trim() || null;
            }
          }

          const required = el.hasAttribute('required');
          const ariaRequired = el.getAttribute('aria-required') === 'true';
          const disabled = (el as HTMLInputElement).disabled || false;
          const readOnly = (el as HTMLInputElement).readOnly || false;

          // NEVER expose actual values or passwords for privacy/security
          const rawVal = (el as HTMLInputElement).value || '';
          const hasValue = rawVal.trim().length > 0;

          // Determine label for field
          let labelForText: string | null = null;
          if (id) {
            const labelForEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (labelForEl) {
              labelForText = labelForEl.textContent?.trim() || null;
            }
          }

          let wrappingLabelText: string | null = null;
          const parentLabel = el.closest('label');
          if (parentLabel) {
            // Clone label and remove element to get text only
            const clone = parentLabel.cloneNode(true) as HTMLElement;
            const nestedInput = clone.querySelector('input, select, textarea');
            if (nestedInput) nestedInput.remove();
            wrappingLabelText = clone.textContent?.trim() || null;
          }

          // Check nearby sibling text
          let nearbyText: string | null = null;
          if (el.parentElement) {
            const prevSibling = el.previousElementSibling;
            if (prevSibling && prevSibling.textContent && prevSibling.textContent.length < 80) {
              nearbyText = prevSibling.textContent.trim();
            }
          }

          // Help text
          let helpText: string | null = null;
          const describedBy = el.getAttribute('aria-describedby');
          if (describedBy) {
            const descEl = document.getElementById(describedBy);
            if (descEl) helpText = descEl.textContent?.trim() || null;
          }
          if (!helpText && el.parentElement) {
            const hintEl = el.parentElement.querySelector('.help-text, .hint, .form-text, small');
            if (hintEl) helpText = hintEl.textContent?.trim() || null;
          }

          // Form association
          const parentForm = el.closest('form');
          const formIndex = parentForm ? formElements.indexOf(parentForm) : null;

          // Select options
          let options: Array<{ value: string; label: string }> | undefined;
          if (tag === 'select') {
            options = Array.from(selectEl.options).map((opt) => ({
              value: opt.value,
              label: opt.text.trim(),
            }));
          }

          // File config
          const accept = tag === 'input' && rawType === 'file' ? el.getAttribute('accept') : null;
          const multiple = tag === 'input' && rawType === 'file' ? (inputEl as HTMLInputElement).multiple : false;

          return {
            index,
            formIndex: formIndex !== -1 ? formIndex : null,
            tag,
            rawType,
            name,
            id,
            placeholder,
            autocomplete,
            ariaLabel,
            ariaLabelledBy: ariaLabelledByText,
            required,
            ariaRequired,
            disabled,
            readOnly,
            hasValue,
            labelForText,
            wrappingLabelText,
            nearbyText,
            helpText,
            options,
            accept,
            multiple,
          };
        });

        // Extract buttons
        const buttonElements = Array.from(
          document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')
        );
        const buttons = buttonElements.map((btn) => {
          let text = btn.textContent?.trim() || '';
          if (!text && btn instanceof HTMLInputElement) {
            text = btn.value || '';
          }
          const type = (btn.getAttribute('type') || (btn.tagName === 'BUTTON' ? 'submit' : 'button')).toLowerCase();
          const parentForm = btn.closest('form');
          const formIndex = parentForm ? formElements.indexOf(parentForm) : null;
          const disabled = (btn as HTMLButtonElement).disabled || false;

          return {
            text,
            type,
            formIndex: formIndex !== -1 ? formIndex : null,
            disabled,
          };
        });

        // Extract candidate application links
        const linkElements = Array.from(document.querySelectorAll('a[href]'));
        const links = linkElements
          .map((a) => ({
            text: a.textContent?.trim() || '',
            href: a.getAttribute('href') || '',
          }))
          .filter((l) => l.text.length > 0 && l.href.length > 0);

        return {
          title,
          url,
          headings,
          forms,
          fields,
          buttons,
          links,
        };
      }
    );

    // 3. Process fields with deterministic classification and label resolution
    const processedFields: DiscoveredFieldDto[] = rawDom.fields.map((rawField) =>
      this.processField(rawField)
    );

    // 4. Process buttons with classification
    const processedButtons: DiscoveredButtonDto[] = rawDom.buttons.map((btn) =>
      this.classifyButton(btn, processedFields)
    );

    // 5. Discover application target links
    const applicationTargets: ApplicationTargetDto[] = this.discoverApplicationTargets(
      rawDom.links,
      rawDom.url
    );

    // 6. Compute application page detection signals and confidence
    const applicationIndicators = this.detectApplicationPage(
      rawDom,
      processedFields,
      processedButtons,
      applicationTargets
    );

    // 7. Load candidate profile for deterministic mapping (read-only query)
    const candidateData = await this.loadCandidateData(userProfileId);

    // 8. Generate candidate field mappings and missing information
    const { candidateMappings, missingInformation } = this.generateFieldMappings(
      processedFields,
      candidateData
    );

    return {
      sessionId,
      page: {
        url: rawDom.url || pageInfo.url,
        title: rawDom.title || pageInfo.title,
        status: pageInfo.status,
      },
      application: applicationIndicators,
      targets: applicationTargets,
      forms: rawDom.forms,
      fields: processedFields,
      buttons: processedButtons,
      candidateMappings,
      missingInformation,
    };
  }

  /**
   * Deterministically normalizes field types, resolves label priority, and detects required markers.
   */
  private processField(raw: RawDomField): DiscoveredFieldDto {
    const type = this.normalizeFieldType(raw.tag, raw.rawType);

    // Label resolution priority:
    // 1. <label for="...">
    // 2. wrapping <label>
    // 3. aria-label
    // 4. aria-labelledby
    // 5. placeholder
    // 6. nearby-text
    // 7. name
    // 8. id
    let label: string | null = null;
    let labelSource: string | null = null;

    if (raw.labelForText && raw.labelForText.length > 0) {
      label = this.cleanLabel(raw.labelForText);
      labelSource = 'label-for';
    } else if (raw.wrappingLabelText && raw.wrappingLabelText.length > 0) {
      label = this.cleanLabel(raw.wrappingLabelText);
      labelSource = 'wrapping-label';
    } else if (raw.ariaLabel && raw.ariaLabel.length > 0) {
      label = this.cleanLabel(raw.ariaLabel);
      labelSource = 'aria-label';
    } else if (raw.ariaLabelledBy && raw.ariaLabelledBy.length > 0) {
      label = this.cleanLabel(raw.ariaLabelledBy);
      labelSource = 'aria-labelledby';
    } else if (raw.placeholder && raw.placeholder.length > 0) {
      label = this.cleanLabel(raw.placeholder);
      labelSource = 'placeholder';
    } else if (raw.nearbyText && raw.nearbyText.length > 0 && raw.nearbyText.length < 50) {
      label = this.cleanLabel(raw.nearbyText);
      labelSource = 'nearby-text';
    } else if (raw.name && raw.name.length > 0) {
      label = this.humanizeIdentifier(raw.name);
      labelSource = 'name';
    } else if (raw.id && raw.id.length > 0) {
      label = this.humanizeIdentifier(raw.id);
      labelSource = 'id';
    }

    // Required detection: attribute, aria-required, or asterisk in label
    let required = raw.required || raw.ariaRequired;
    let requirementSource: string | null = null;

    if (raw.required) {
      requirementSource = 'attribute';
    } else if (raw.ariaRequired) {
      requirementSource = 'aria-required';
    } else if (
      raw.labelForText?.includes('*') ||
      raw.wrappingLabelText?.includes('*') ||
      raw.nearbyText?.includes('*') ||
      /\((required|mandatory)\)/i.test(raw.labelForText || '') ||
      /\((required|mandatory)\)/i.test(raw.wrappingLabelText || '')
    ) {
      required = true;
      requirementSource = 'label-asterisk';
    }

    return {
      index: raw.index,
      formIndex: raw.formIndex,
      tag: raw.tag,
      type,
      name: raw.name,
      id: raw.id,
      placeholder: raw.placeholder,
      autocomplete: raw.autocomplete,
      ariaLabel: raw.ariaLabel,
      required,
      requirementSource,
      disabled: raw.disabled,
      readOnly: raw.readOnly,
      hasValue: raw.hasValue,
      label,
      labelSource,
      helpText: raw.helpText,
      options: raw.options,
      fileConfig:
        type === 'FILE'
          ? {
              accept: raw.accept || null,
              multiple: Boolean(raw.multiple),
            }
          : undefined,
    };
  }

  /**
   * Maps HTML tag and type attributes to standardized DiscoveredFieldType.
   */
  private normalizeFieldType(tag: string, rawType: string): DiscoveredFieldType {
    if (tag === 'select') return 'SELECT';
    if (tag === 'textarea') return 'TEXTAREA';

    switch (rawType.toLowerCase()) {
      case 'email':
        return 'EMAIL';
      case 'tel':
      case 'phone':
        return 'TEL';
      case 'number':
        return 'NUMBER';
      case 'url':
        return 'URL';
      case 'date':
        return 'DATE';
      case 'datetime':
      case 'datetime-local':
        return 'DATETIME';
      case 'checkbox':
        return 'CHECKBOX';
      case 'radio':
        return 'RADIO';
      case 'file':
        return 'FILE';
      case 'password':
        return 'PASSWORD';
      case 'hidden':
        return 'HIDDEN';
      case 'text':
      case 'search':
        return 'TEXT';
      default:
        return 'UNKNOWN';
    }
  }

  /**
   * Classifies buttons based on semantic intent and application context.
   */
  private classifyButton(
    btn: RawDomButton,
    fields: DiscoveredFieldDto[]
  ): DiscoveredButtonDto {
    const text = btn.text.toLowerCase().trim();
    let classification: ButtonClassification = 'UNKNOWN';

    const hasAppFields = fields.some((f) =>
      /(email|resume|cv|first_name|full_name|experience|phone)/i.test(
        `${f.name} ${f.label}`
      )
    );

    if (
      /(submit\s+application|apply\s+now|send\s+application|complete\s+application|finish\s+application|submit\s+candidate)/i.test(
        text
      ) ||
      (text === 'submit' && hasAppFields) ||
      (text === 'apply' && hasAppFields)
    ) {
      classification = 'PRIMARY_APPLICATION_ACTION';
    } else if (
      /(save\s+draft|save|upload|attach|clear|cancel|back|previous)/i.test(text)
    ) {
      classification = 'SECONDARY_ACTION';
    } else if (
      /(next|continue|proceed|step\s*\d+|page\s*\d+)/i.test(text)
    ) {
      classification = 'NAVIGATION';
    }

    return {
      text: btn.text,
      type: btn.type,
      classification,
      formIndex: btn.formIndex,
      disabled: btn.disabled,
    };
  }

  /**
   * Identifies candidate external application links on job overview pages.
   */
  private discoverApplicationTargets(
    links: RawDomLink[],
    currentUrl: string
  ): ApplicationTargetDto[] {
    const targets: ApplicationTargetDto[] = [];

    for (const link of links) {
      const text = link.text.trim();
      const href = link.href.trim();

      if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
        continue;
      }

      // Check for application keywords in link text
      const isApplyText =
        /(apply\s+(now|today|online)?|submit\s+application|apply\s+on\s+company\s+site|apply\s+via|easy\s+apply)/i.test(
          text
        );

      const isApplyUrl =
        /(careers?\/apply|jobs?\/apply|application\/start|\/apply(\/|\?|$))/i.test(
          href
        );

      if (isApplyText || isApplyUrl) {
        let fullUrl: string;
        try {
          fullUrl = new URL(href, currentUrl).toString();
        } catch {
          continue;
        }

        const isExternal = /(external|company\s+site|redirect)/i.test(text);
        const confidence = isApplyText && isApplyUrl ? 0.95 : isApplyText ? 0.90 : 0.75;

        targets.push({
          url: fullUrl,
          text,
          type: isExternal ? 'EXTERNAL_PORTAL' : 'APPLICATION_LINK',
          confidence,
        });
      }
    }

    // Limit to top 5 unique targets
    const seen = new Set<string>();
    return targets.filter((t) => {
      if (seen.has(t.url)) return false;
      seen.add(t.url);
      return true;
    }).slice(0, 5);
  }

  /**
   * Deterministically evaluates whether page appears to be a job application page.
   */
  private detectApplicationPage(
    rawDom: RawDomInspection,
    fields: DiscoveredFieldDto[],
    buttons: DiscoveredButtonDto[],
    targets: ApplicationTargetDto[]
  ): ApplicationPageIndicatorDto {
    const signals: string[] = [];
    let score = 0;

    // 1. Resume / CV upload field
    const hasResumeField = fields.some(
      (f) =>
        f.type === 'FILE' &&
        /(resume|cv|curriculum\s*vitae)/i.test(`${f.name} ${f.label} ${f.id}`)
    );
    if (hasResumeField) {
      score += 0.35;
      signals.push('resume upload field detected');
    }

    // 2. Primary application action button
    const hasApplyButton = buttons.some(
      (b) => b.classification === 'PRIMARY_APPLICATION_ACTION'
    );
    if (hasApplyButton) {
      score += 0.25;
      signals.push('submit application button detected');
    }

    // 3. Contact / identity fields
    const hasContactFields = fields.some(
      (f) =>
        f.type === 'EMAIL' ||
        /(email|phone|first\s*name|last\s*name|full\s*name)/i.test(
          `${f.name} ${f.label}`
        )
    );
    if (hasContactFields) {
      score += 0.20;
      signals.push('candidate contact fields detected');
    }

    // 4. Application terminology in headings or title
    const textBlob = `${rawDom.title} ${rawDom.headings.join(' ')}`;
    const hasAppTerms =
      /(apply\s+(for|now|today)|job\s+application|candidate\s+information|submit\s+application|personal\s+details|employment\s+application)/i.test(
        textBlob
      );
    if (hasAppTerms) {
      score += 0.20;
      signals.push('application title or heading detected');
    }

    // 5. Work experience, cover letter, or education fields
    const hasProfileSections = fields.some((f) =>
      /(experience|education|cover\s*letter|portfolio|linkedin|github|expected\s*salary)/i.test(
        `${f.name} ${f.label}`
      )
    );
    if (hasProfileSections) {
      score += 0.15;
      signals.push('work history or qualification fields detected');
    }

    // 6. Application URL pattern
    if (/(\/apply|\/application|\/careers\/.*\/job)/i.test(rawDom.url)) {
      score += 0.10;
      signals.push('application URL pattern detected');
    }

    const confidence = Math.min(Math.round(score * 100) / 100, 1.0);
    const isApplicationPage = confidence >= 0.45;

    return {
      isApplicationPage,
      confidence,
      signals,
    };
  }

  /**
   * Generates candidate field mappings against candidate profile data and identifies missing information.
   */
  private generateFieldMappings(
    fields: DiscoveredFieldDto[],
    candidate: Record<string, any> | null
  ): {
    candidateMappings: CandidateFieldMappingDto[];
    missingInformation: MissingCandidateInformationDto[];
  } {
    const candidateMappings: CandidateFieldMappingDto[] = [];
    const missingInformation: MissingCandidateInformationDto[] = [];

    for (const field of fields) {
      if (field.type === 'HIDDEN' || field.disabled) {
        continue;
      }

      const descriptor = `${field.name || ''} ${field.id || ''} ${field.label || ''} ${field.autocomplete || ''}`.toLowerCase();
      let matchedSource: { source: string; confidence: number; reason: string } | null = null;

      // Deterministic source matching rules
      if (field.type === 'FILE' && /(resume|cv|curriculum)/i.test(descriptor)) {
        matchedSource = {
          source: 'resume.latest',
          confidence: 0.98,
          reason: 'File field matches candidate resume document',
        };
      } else if (/(cover\s*letter|pitch|letter)/i.test(descriptor)) {
        matchedSource = {
          source: 'application.coverLetter',
          confidence: 0.95,
          reason: 'Field matches tailored application cover letter',
        };
      } else if (field.type === 'EMAIL' || /email/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.email',
          confidence: 0.99,
          reason: 'Field matches candidate email address',
        };
      } else if (field.type === 'TEL' || /(phone|mobile|tel|contact\s*num)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.phone',
          confidence: 0.96,
          reason: 'Field matches candidate phone number',
        };
      } else if (/(full\s*name|candidate\s*name|applicant\s*name|^name$)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.fullName',
          confidence: 0.95,
          reason: 'Field matches candidate full name',
        };
      } else if (/(first\s*name|given\s*name|fname)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.fullName',
          confidence: 0.90,
          reason: 'Field matches candidate given name derived from profile',
        };
      } else if (/(last\s*name|family\s*name|surname|lname)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.fullName',
          confidence: 0.90,
          reason: 'Field matches candidate surname derived from profile',
        };
      } else if (/(years\s*of\s*experience|total\s*experience|experience\s*years)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.yearsOfExperience',
          confidence: 0.90,
          reason: 'Field matches candidate years of experience',
        };
      } else if (/(current\s*title|job\s*title|headline|designation)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.currentTitle',
          confidence: 0.88,
          reason: 'Field matches candidate current professional title',
        };
      } else if (/(summary|bio|professional\s*summary|about\s*me)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.professionalSummary',
          confidence: 0.85,
          reason: 'Field matches candidate professional summary',
        };
      } else if (/(skill|technolog|stack)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.skills',
          confidence: 0.85,
          reason: 'Field matches candidate verified skills',
        };
      } else if (/(education|degree|university|college|school)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.education',
          confidence: 0.85,
          reason: 'Field matches candidate education credentials',
        };
      } else if (/(experience|employer|past\s*compan|work\s*histor)/i.test(descriptor)) {
        matchedSource = {
          source: 'profile.experience',
          confidence: 0.85,
          reason: 'Field matches candidate work experience history',
        };
      }

      const fieldIdentifier = field.id || field.name || `field_${field.index}`;

      if (matchedSource) {
        const isAvailable = this.checkCandidateSourceAvailability(
          matchedSource.source,
          candidate
        );

        candidateMappings.push({
          fieldId: fieldIdentifier,
          fieldName: field.name,
          label: field.label,
          candidateSource: matchedSource.source,
          confidence: matchedSource.confidence,
          reason: matchedSource.reason,
          available: isAvailable,
        });

        // If field is required but candidate data is missing
        if (field.required && !isAvailable) {
          missingInformation.push({
            fieldId: fieldIdentifier,
            fieldName: field.name,
            label: field.label || fieldIdentifier,
            required: true,
            reason: `Required source "${matchedSource.source}" is missing in candidate profile`,
          });
        }
      } else if (field.required) {
        // Required field with no known mapping candidate
        missingInformation.push({
          fieldId: fieldIdentifier,
          fieldName: field.name,
          label: field.label || fieldIdentifier,
          required: true,
          reason: 'No corresponding candidate profile field exists',
        });
      }
    }

    return { candidateMappings, missingInformation };
  }

  /**
   * Checks whether candidate profile contains actual data for a mapped source.
   */
  private checkCandidateSourceAvailability(
    source: string,
    candidate: Record<string, any> | null
  ): boolean {
    if (!candidate) {
      // If no candidate record loaded, default availability to false
      return false;
    }

    switch (source) {
      case 'profile.fullName':
        return Boolean(candidate.fullName && candidate.fullName.trim().length > 0);
      case 'profile.email':
        return Boolean(candidate.email && candidate.email.trim().length > 0);
      case 'profile.phone':
        return Boolean(candidate.phone && candidate.phone.trim().length > 0);
      case 'profile.yearsOfExperience':
        return candidate.yearsOfExperience !== null && candidate.yearsOfExperience !== undefined;
      case 'profile.currentTitle':
        return Boolean(candidate.currentTitle && candidate.currentTitle.trim().length > 0);
      case 'profile.professionalSummary':
        return Boolean(
          candidate.professionalSummary && candidate.professionalSummary.trim().length > 0
        );
      case 'resume.latest':
        return Array.isArray(candidate.resumes) && candidate.resumes.length > 0;
      case 'profile.skills':
        return Array.isArray(candidate.skills) && candidate.skills.length > 0;
      case 'profile.education':
        return Array.isArray(candidate.education) && candidate.education.length > 0;
      case 'profile.experience':
        return Array.isArray(candidate.experiences) && candidate.experiences.length > 0;
      case 'application.coverLetter':
        return true; // Tailored cover letter generator is available in M8
      default:
        return false;
    }
  }

  /**
   * Read-only retrieval of candidate profile facts.
   * NEVER performs mutations.
   */
  private async loadCandidateData(userProfileId?: string): Promise<Record<string, any> | null> {
    try {
      const profile = await prisma.userProfile.findFirst({
        where: userProfileId ? { id: userProfileId } : undefined,
        orderBy: { createdAt: 'asc' },
        include: {
          resumes: { orderBy: { version: 'desc' }, take: 1 },
          skills: true,
          experiences: { orderBy: { startDate: 'desc' } },
          education: true,
        },
      });
      return profile;
    } catch {
      return null;
    }
  }

  /**
   * Cleans trailing punctuation and asterisks from resolved label text.
   */
  private cleanLabel(text: string): string {
    return text
      .replace(/[*:\s]+$/, '')
      .replace(/^\s*[*]+\s*/, '')
      .replace(/\s*\((required|mandatory)\)\s*$/i, '')
      .trim();
  }

  /**
   * Converts camelCase, snake_case, or kebab-case identifiers to readable title words.
   */
  private humanizeIdentifier(id: string): string {
    return id
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }
}

export const applicationDiscoveryService = new ApplicationDiscoveryService();
