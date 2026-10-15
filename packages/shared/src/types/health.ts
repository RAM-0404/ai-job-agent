export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  database?: 'connected' | 'disconnected';
  ollama?: 'connected' | 'disconnected';
  ollamaModel?: string;
  browser?: {
    enabled: boolean;
  };
}
