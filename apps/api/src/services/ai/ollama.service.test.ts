import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OllamaService,
  OllamaConnectionError,
  OllamaTimeoutError,
  OllamaModelNotFoundError,
  OllamaInvalidJsonError,
  OllamaBusyError,
} from './ollama.service.js';

describe('OllamaService', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns parsed structured JSON on successful response', async () => {
    const expectedOutput = {
      greeting: 'Hello world',
      count: 42,
    };

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          message: {
            role: 'assistant',
            content: JSON.stringify(expectedOutput),
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const service = new OllamaService('http://127.0.0.1:11434', 'qwen2.5:7b', 5000);
    const result = await service.generateStructured<typeof expectedOutput>(
      'System prompt',
      'User prompt',
      { type: 'object' }
    );

    assert.deepEqual(result, expectedOutput);
  });

  test('throws OllamaConnectionError when Ollama HTTP endpoint is unavailable', async () => {
    globalThis.fetch = async () => {
      const err = new TypeError('fetch failed');
      (err as any).cause = { code: 'ECONNREFUSED' };
      throw err;
    };

    const service = new OllamaService('http://127.0.0.1:11434', 'qwen2.5:7b', 5000);
    await assert.rejects(
      async () => {
        await service.generateStructured('system', 'user');
      },
      (err: Error) => {
        assert(err instanceof OllamaConnectionError);
        assert.equal((err as OllamaConnectionError).statusCode, 503);
        assert.match(err.message, /Could not connect to Ollama/);
        return true;
      }
    );
  });

  test('throws OllamaTimeoutError when request exceeds configured timeout', async () => {
    globalThis.fetch = async () => {
      const timeoutErr = new Error('The operation was aborted due to timeout');
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    };

    const service = new OllamaService('http://127.0.0.1:11434', 'qwen2.5:7b', 5000);
    await assert.rejects(
      async () => {
        await service.generateStructured('system', 'user');
      },
      (err: Error) => {
        assert(err instanceof OllamaTimeoutError);
        assert.equal((err as OllamaTimeoutError).statusCode, 504);
        assert.match(err.message, /timed out/);
        return true;
      }
    );
  });

  test('throws OllamaModelNotFoundError when specified model does not exist', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: "model 'missing-model' not found" }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const service = new OllamaService('http://127.0.0.1:11434', 'missing-model', 5000);
    await assert.rejects(
      async () => {
        await service.generateStructured('system', 'user');
      },
      (err: Error) => {
        assert(err instanceof OllamaModelNotFoundError);
        assert.equal((err as OllamaModelNotFoundError).statusCode, 503);
        assert.match(err.message, /was not found/);
        return true;
      }
    );
  });

  test('throws OllamaInvalidJsonError when model returns malformed non-JSON prose', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          message: {
            role: 'assistant',
            content: 'Sorry, I cannot provide JSON for this prompt.',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    const service = new OllamaService('http://127.0.0.1:11434', 'qwen2.5:7b', 5000);
    await assert.rejects(
      async () => {
        await service.generateStructured('system', 'user');
      },
      (err: Error) => {
        assert(err instanceof OllamaInvalidJsonError);
        assert.equal((err as OllamaInvalidJsonError).statusCode, 422);
        assert.match(err.message, /not valid JSON/);
        return true;
      }
    );
  });

  test('enforces concurrency guard and throws OllamaBusyError on parallel generation calls', async () => {
    let resolveFirst: () => void;
    const hangingPromise = new Promise<Response>((resolve) => {
      resolveFirst = () => {
        resolve(
          new Response(
            JSON.stringify({
              message: { role: 'assistant', content: JSON.stringify({ ok: true }) },
            }),
            { status: 200 }
          )
        );
      };
    });

    globalThis.fetch = async () => {
      return hangingPromise;
    };

    const service = new OllamaService('http://127.0.0.1:11434', 'qwen2.5:7b', 5000);

    // Start first async generation without awaiting
    const firstCall = service.generateStructured('system', 'user');

    // Immediately attempt second parallel call
    await assert.rejects(
      async () => {
        await service.generateStructured('system', 'user');
      },
      (err: Error) => {
        assert(err instanceof OllamaBusyError);
        assert.equal((err as OllamaBusyError).statusCode, 429);
        return true;
      }
    );

    // Complete the first call
    resolveFirst!();
    await firstCall;
  });

  test('checkConnectivity returns true when Ollama ping succeeds', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    };

    const service = new OllamaService('http://127.0.0.1:11434', 'qwen2.5:7b', 5000);
    const connected = await service.checkConnectivity();
    assert.equal(connected, true);
  });

  test('checkConnectivity returns false gracefully when Ollama is down', async () => {
    globalThis.fetch = async () => {
      throw new Error('Connection refused');
    };

    const service = new OllamaService('http://127.0.0.1:11434', 'qwen2.5:7b', 5000);
    const connected = await service.checkConnectivity();
    assert.equal(connected, false);
  });
});
