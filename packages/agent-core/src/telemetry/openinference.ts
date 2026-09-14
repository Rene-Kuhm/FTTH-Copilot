/**
 * OpenInference semantic conventions and span contracts for Arize Phoenix.
 * @see https://github.com/Arize-ai/openinference
 */

export const OpenInferenceSpanKind = {
  LLM: 'LLM',
  CHAIN: 'CHAIN',
  TOOL: 'TOOL',
  RETRIEVER: 'RETRIEVER',
  AGENT: 'AGENT',
} as const;

export type OpenInferenceSpanKindType =
  (typeof OpenInferenceSpanKind)[keyof typeof OpenInferenceSpanKind];

export const SemanticAttributes = {
  // OpenInference Core
  OPENINFERENCE_SPAN_KIND: 'openinference.span.kind',

  // LLM Attributes
  LLM_MODEL_NAME: 'llm.model_name',
  LLM_PROVIDER_NAME: 'llm.provider_name',
  LLM_TOKEN_COUNT_PROMPT: 'llm.token_count.prompt',
  LLM_TOKEN_COUNT_COMPLETION: 'llm.token_count.completion',
  LLM_TOKEN_COUNT_TOTAL: 'llm.token_count.total',
  LLM_INVOCATION_PARAMETERS: 'llm.invocation_parameters',
  LLM_INPUT_MESSAGES: 'llm.input_messages',
  LLM_OUTPUT_MESSAGES: 'llm.output_messages',

  // Input / Output Values
  INPUT_VALUE: 'input.value',
  OUTPUT_VALUE: 'output.value',
  INPUT_MIME_TYPE: 'input.mime_type',
  OUTPUT_MIME_TYPE: 'output.mime_type',

  // Tool Attributes
  TOOL_NAME: 'tool.name',
  TOOL_DESCRIPTION: 'tool.description',
  TOOL_PARAMETERS: 'tool.parameters',
  TOOL_OUTPUT: 'tool.output',

  // Retriever Attributes
  RETRIEVAL_DOCUMENTS: 'retrieval.documents',

  // Metadata & Context
  SESSION_ID: 'session.id',
  USER_ID: 'user.id',
  TENANT_ID: 'tenant.id',
  CONNECTION_ID: 'connection.id',
  DATA_SOURCE_MODE: 'datasource.mode',
  DATA_SOURCE_PROVIDER: 'datasource.provider',
} as const;

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface SpanEvent {
  name: string;
  timestampMs: number;
  attributes?: Record<string, unknown>;
}

export interface SpanStatus {
  code: 'OK' | 'ERROR';
  message?: string;
}

export interface TelemetrySpan {
  readonly name: string;
  readonly context: SpanContext;
  readonly parentSpanId?: string;
  readonly startTimeMs: number;
  endTimeMs?: number;
  readonly attributes: Record<string, string | number | boolean>;
  readonly events: SpanEvent[];
  status: SpanStatus;
}
