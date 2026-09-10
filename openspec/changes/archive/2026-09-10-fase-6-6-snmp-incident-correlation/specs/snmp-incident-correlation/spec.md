# Fase 6 PR #2 — SNMP Trap and Incident Correlation + Recovery Linking (Spec Delta)

## Why

Meet requirement 6.6 of Roadmap Fase 6: correlate traps with existing incidents and safely handle recovery and UDP out-of-order deliveries.

## Scenarios (Given/When/Then)

### Scenario: Alarm trap correlates with an open incident for the same device (6.6)

Given an open incident for device `(OLT, OLT-1)` in tenant `tenant-1`
When an alarm trap (`link_down` or `los`) for `(OLT, OLT-1)` arrives with timestamp T >= incident.lastSeenAt
Then the linker returns action `'correlate_alarm'` with the matched incident ID
  and suggested updated `lastSeenAt = T`.

### Scenario: Recovery trap links with an open incident to signal resolution (6.6)

Given an open incident for device `(ONU, ONU-01)` in tenant `tenant-1`
When a clearing trap (`link_up`) arrives for `(ONU, ONU-01)` with timestamp T > incident.lastSeenAt
Then the linker returns action `'mark_recovered'` with the matched incident ID and recovery timestamp T.

### Scenario: Out-of-order delayed alarm is rejected when a newer recovery already occurred (6.6)

Given an incident that was recovered or last observed at T2
When an out-of-order UDP alarm trap arrives with device timestamp T1 < T2
Then the linker returns action `'discard_stale'`
  and the recovered state is preserved.

### Scenario: Cross-tenant incidents are strictly isolated

Given an open incident for `(OLT, OLT-1)` in tenant A
When a trap arrives for `(OLT, OLT-1)` from tenant B's connection
Then the linker returns action `'no_match'` (never links across tenants).
