import { config } from '../../config/env.js';

export class OllamaError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly causeError?: unknown
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

export class OllamaConnectionError extends OllamaError {
  constructor(message: string, cause?: unknown) {
    super(message, 503, cause);
    this.name = 'OllamaConnectionError';
  }
}

export class OllamaTimeoutError extends OllamaError {
  constructor(message: string, cause?: unknown) {
    super(message, 504, cause);
    this.name = 'OllamaTimeoutError';
  }
}

export class OllamaModelNotFoundError extends OllamaError {
  constructor(model: string) {
    super(
      `Ollama model "${model}" was not found. Please ensure the model is pulled locally via: ollama pull ${model}`,
      503
    );
    this.name = 'OllamaModelNotFoundError';
  }
}

export class OllamaInvalidJsonError extends OllamaError {
  constructor(message: string, cause?: unknown) {
    super(message, 422, cause);
    this.name = 'OllamaInvalidJsonError';
  }
}

export class OllamaBusyError extends OllamaError {
  constructor() {
    super(
      'An AI analysis request is currently in progress. Only one AI generation can run at a time to prevent CPU saturation.',
      429
    );
    this.name = 'OllamaBusyError';
  }
}

export interface OllamaGenerateOptions {
  model?: string;
  timeoutMs?: number;
  format?: object | string;
  temperature?: number;
}

export class OllamaService {
  private isGenerating = false;

  constructor(
    private readonly baseUrl: string = config.ollamaBaseUrl,
    private readonly defaultModel: string = config.ollamaModel,
    private readonly defaultTimeoutMs: number = config.ollamaTimeoutMs
  ) {}

  /**
   * Send a prompt to Ollama requesting structured JSON output
   */
  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    schema?: object,
    options?: OllamaGenerateOptions
  ): Promise<T> {
    if (this.isGenerating) {
      throw new OllamaBusyError();
    }

    const model = options?.model || this.defaultModel;
    const timeoutMs = options?.timeoutMs || this.defaultTimeoutMs;
    const format = options?.format || schema || 'json';

    this.isGenerating = true;

    try {
      const endpoint = `${this.baseUrl}/api/chat`;
      const payload = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        format,
        options: {
          temperature: options?.temperature ?? 0.1,
        },
      };

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (networkErr: unknown) {
        if (
          networkErr instanceof Error &&
          (networkErr.name === 'TimeoutError' || networkErr.name === 'AbortError')
        ) {
          throw new OllamaTimeoutError(
            `Ollama generation request timed out after ${timeoutMs}ms.`,
            networkErr
          );
        }

        throw new OllamaConnectionError(
          `Could not connect to Ollama at ${this.baseUrl}. Ensure Ollama is running and accessible.`,
          networkErr
        );
      }

      if (!response.ok) {
        let errBody: { error?: string } | null = null;
        try {
          errBody = (await response.json()) as { error?: string };
        } catch {
          // ignore non-json error responses
        }

        const errMsg = errBody?.error || `HTTP ${response.status}: ${response.statusText}`;

        if (response.status === 404 || errMsg.toLowerCase().includes('not found')) {
          throw new OllamaModelNotFoundError(model);
        }

        throw new OllamaError(`Ollama API error (${response.status}): ${errMsg}`, response.status);
      }

      let data: any;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new OllamaInvalidJsonError('Failed to parse Ollama HTTP response as JSON', jsonErr);
      }

      const rawContent = data?.message?.content;
      if (!rawContent || typeof rawContent !== 'string') {
        throw new OllamaInvalidJsonError('Ollama response did not contain message content');
      }

      try {
        return JSON.parse(rawContent) as T;
      } catch (parseErr) {
        throw new OllamaInvalidJsonError(
          'Model output was not valid JSON conforming to the requested schema',
          parseErr
        );
      }
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Check if Ollama HTTP API is reachable and responding
   */
  async checkConnectivity(timeoutMs = 3000): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance using configuration
export const ollamaService = new OllamaService();
