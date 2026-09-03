# Delta for evidence-provenance

## ADDED Requirements

### Requirement: Abstention attached to AgentResult (additive)

`packages/shared` MUST extend `AgentResult` and `ChatResponse` with additive optional fields to carry the Fase C `abstention.v1` payload. No existing field is renamed, removed, or has its semantics changed. Pre-Fase-C consumers MUST remain valid.

| Contract | New field | Type | Default |
|----------|-----------|------|---------|
| `AgentResult` | `abstention?` | `Abstention` | undefined |
| `AgentResult` | `abstained?` | `boolean` | undefined |
| `ChatResponse` | `abstention?` | `Abstention` | undefined |

`Abstention` is defined in `strict-mode-abstention` (schema `ftth.abstention.v1`). When `mode === 'strict'` and the run produces any `incomplete` verdict, `runAgent` populates all three fields together. Otherwise all three MUST remain undefined. Persistence into `Message.content` and the synthetic `Message.toolCalls` row named `__abstention__` is owned by the chat route (see `strict-mode-abstention`).

#### Scenario: Abstained flag set with abstention payload

- GIVEN a strict-mode run with `incomplete` verdicts
- WHEN `runAgent` returns
- THEN `result.abstained === true` AND `result.abstention` is a valid `Abstention`

#### Scenario: Missing abstention in observe mode (backward compatibility)

- GIVEN `mode: 'observe'`, any verdict set
- WHEN `runAgent` returns
- THEN `result.abstention === undefined` AND `result.abstained === undefined` AND `result.text` is the LLM's text

#### Scenario: ChatResponse carries abstention

- GIVEN `AgentResult.abstention` defined
- WHEN the chat route builds `ChatResponse`
- THEN `ChatResponse.abstention === AgentResult.abstention`

#### Scenario: Route persists __abstention__ pseudo-tool row

- GIVEN strict + incomplete run
- WHEN the route persists the assistant message
- THEN `Message.toolCalls` contains a row `{ name: '__abstention__', arguments: {}, result: <Abstention JSON> }` AND `Message.content` equals the rendered Spanish text