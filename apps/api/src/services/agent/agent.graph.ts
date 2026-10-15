import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentStateAnnotation, type AgentState } from './agent.state.js';
import { loadContextNode } from './nodes/load-context.node.js';
import { createEvaluateNode } from './nodes/evaluate.node.js';
import {
  createApplicationGenerationNode,
  applicationGenerationNode,
  type ApplicationServiceDependencies,
} from './nodes/application-generation.node.js';
import {
  createApplicationValidationNode,
  applicationValidationNode,
  type ApplicationValidationDependencies,
} from './nodes/application-validation.node.js';
import { humanReviewNode } from './nodes/human-review.node.js';
import { completeNode } from './nodes/complete.node.js';
import { jobMatchService, type JobMatchService } from '../matching/job-match.service.js';
import { applicationService } from '../applications/application.service.js';
import { applicationValidationService } from '../applications/application-validation.service.js';

export interface AgentGraphDependencies {
  matchService?: Pick<JobMatchService, 'matchJob'>;
  appService?: ApplicationServiceDependencies;
  validationService?: ApplicationValidationDependencies;
}

/**
 * Builds the initial phase of the Milestone 9.3 Agent Orchestration StateGraph:
 *
 * START
 *   ↓
 * load_context (Verify UserProfile, Job, Application)
 *   ↓ (if valid)
 * evaluate (Invokes M7 JobMatchService; produces matchScore, matchRecommendation, and decision)
 *   ↓ (conditional routing)
 *   ├── STOP (LOW_PRIORITY / DO_NOT_APPLY) ─────────► complete (Sets COMPLETED, decision = STOP) ──► END
 *   └── CONTINUE (APPLY / CONSIDER)
 *          ↓
 *      generate_application (Invokes M8 ApplicationService; creates/reuses application and materials)
 *          ↓ (if valid)
 *      validate_application (Invokes M8 ApplicationValidationService; verifies factual grounding)
 *          ↓ (if valid or reviewable warnings)
 *      human_review (Sets WAITING_FOR_HUMAN) ──────────────────────────────────────────────────────► END
 *   └── FAILED (Technical or validation failure at any step) ──────────────────────────────────────► END
 */
export function buildAgentInitialGraph(
  dependenciesOrMatchService: AgentGraphDependencies | Pick<JobMatchService, 'matchJob'> = jobMatchService,
  appServiceParam?: ApplicationServiceDependencies,
  validationServiceParam?: ApplicationValidationDependencies
) {
  let matchService: Pick<JobMatchService, 'matchJob'> = jobMatchService;
  let appService: ApplicationServiceDependencies = applicationService;
  let validationService: ApplicationValidationDependencies = applicationValidationService;

  if (dependenciesOrMatchService && 'matchJob' in dependenciesOrMatchService) {
    matchService = dependenciesOrMatchService;
    if (appServiceParam) appService = appServiceParam;
    if (validationServiceParam) validationService = validationServiceParam;
  } else if (dependenciesOrMatchService && typeof dependenciesOrMatchService === 'object') {
    if (dependenciesOrMatchService.matchService) matchService = dependenciesOrMatchService.matchService;
    if (dependenciesOrMatchService.appService) appService = dependenciesOrMatchService.appService;
    if (dependenciesOrMatchService.validationService) validationService = dependenciesOrMatchService.validationService;
  }

  const evaluate = createEvaluateNode(matchService);
  const generateApplication = createApplicationGenerationNode(appService);
  const validateApplication = createApplicationValidationNode(validationService);

  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('load_context', loadContextNode)
    .addNode('evaluate', evaluate)
    .addNode('generate_application', generateApplication)
    .addNode('validate_application', validateApplication)
    .addNode('human_review', humanReviewNode)
    .addNode('complete', completeNode)
    .addEdge(START, 'load_context')
    .addConditionalEdges('load_context', (state: AgentState) => {
      if (state.status === 'FAILED') {
        return END;
      }
      return 'evaluate';
    })
    .addConditionalEdges('evaluate', (state: AgentState) => {
      if (state.status === 'FAILED') {
        return END;
      }
      if (state.decision === 'STOP') {
        return 'complete';
      }
      return 'generate_application';
    })
    .addConditionalEdges('generate_application', (state: AgentState) => {
      if (state.status === 'FAILED') {
        return END;
      }
      return 'validate_application';
    })
    .addConditionalEdges('validate_application', (state: AgentState) => {
      if (state.status === 'FAILED') {
        return END;
      }
      return 'human_review';
    })
    .addEdge('human_review', END)
    .addEdge('complete', END);

  return workflow.compile();
}

/**
 * Builds the post-human-approval continuation phase of the StateGraph:
 *
 * START
 *   ↓
 * complete (Sets COMPLETED, decision = APPROVED, completedAt)
 *   ↓
 *  END
 */
export function buildAgentContinuationGraph() {
  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('complete', completeNode)
    .addEdge(START, 'complete')
    .addEdge('complete', END);

  return workflow.compile();
}

export const agentInitialGraph = buildAgentInitialGraph();
export const agentContinuationGraph = buildAgentContinuationGraph();
