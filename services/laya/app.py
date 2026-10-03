"""
Laya Expert System Service - Docker-ready

This service provides the Expert System as a REST API.
Use this for:
1. Fallback when TypeScript module is not available
2. Batch inference
3. Experiments with future Laya ML models

Note: The primary implementation is in TypeScript at:
  packages/shared/src/laya-expert-system.ts

This Python service exists for:
- Docker deployment scenarios
- Batch processing via API
- Future Laya ML integration
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
import uvicorn

app = FastAPI(title="Laya Expert System", version="1.0.0")

# Event class patterns (same as TypeScript version)
PATTERNS = {
    'OPTICAL_FAULT': {
        'priority': 1,
        'patterns': ['los alarm', 'fiber cut', 'fiber break', 'service loss', 'optical loss', 'los all', 'all ONUs']
    },
    'OPTICAL_DEGRADATION': {
        'priority': 2,
        'patterns': ['rx power declining', 'degrad', 'attenuat', 'trending', 'slow optical', 'temperature effect']
    },
    'POWER_FAULT': {
        'priority': 3,
        'patterns': ['dying gasp', 'power fail', 'power failure', 'battery', 'ups deplet', 'customer power']
    },
    'DEVICE_FAULT': {
        'priority': 4,
        'patterns': ['temperature', 'thermal', 'hardware fail', 'board fail', 'equipment fail', 'malfunction']
    },
    'UPLINK_FAULT': {
        'priority': 5,
        'patterns': ['uplink port', 'aggregation switch', 'core connectivity lost']
    },
    'CONGESTION': {
        'priority': 6,
        'patterns': ['congestion', 'uplink utilization', 'bandwidth', 'peak hour', 'overload', 'high uplink']
    },
    'MASS_OUTAGE': {
        'priority': 7,
        'patterns': ['ONUs affected', 'multiple ONUs offline', 'widespread', 'large scale outage', 'common upstream']
    },
    'NORMAL': {
        'priority': 8,
        'patterns': ['online normal', 'operational', 'services operational', 'routine check', 'health check']
    },
    'UNKNOWN': {
        'priority': 9,
        'patterns': ['unknown', 'non-standard', 'cannot determine']
    }
}

# Severity mapping
SEVERITY_MAP = {
    'NORMAL': 'INFO',
    'OPTICAL_DEGRADATION': 'MEDIUM',
    'CONGESTION': 'LOW',
    'DEVICE_FAULT': 'HIGH',
    'POWER_FAULT': 'CRITICAL',
    'OPTICAL_FAULT': 'HIGH',
    'UPLINK_FAULT': 'HIGH',
    'MASS_OUTAGE': 'CRITICAL',
    'UNKNOWN': 'MEDIUM'
}

# Scope mapping
SCOPE_MAP = {
    'NORMAL': 'UNKNOWN',
    'OPTICAL_DEGRADATION': 'PON',
    'CONGESTION': 'UPLINK',
    'DEVICE_FAULT': 'OLT',
    'POWER_FAULT': 'ONU',
    'OPTICAL_FAULT': 'PON',
    'UPLINK_FAULT': 'UPLINK',
    'MASS_OUTAGE': 'PON',
    'UNKNOWN': 'UNKNOWN'
}

# Investigation mapping
INVESTIGATION_MAP = {
    'NORMAL': False,
    'OPTICAL_DEGRADATION': True,
    'CONGESTION': False,
    'DEVICE_FAULT': True,
    'POWER_FAULT': True,
    'OPTICAL_FAULT': True,
    'UPLINK_FAULT': True,
    'MASS_OUTAGE': True,
    'UNKNOWN': True
}


class DecisionEvent(BaseModel):
    eventId: Optional[str] = None
    source: str = 'api'
    rawSummary: str = Field(..., description="Raw event text to classify")


class DecisionRequest(BaseModel):
    event: DecisionEvent


class BatchRequest(BaseModel):
    events: List[DecisionEvent]


class DecisionResponse(BaseModel):
    eventId: Optional[str]
    eventClass: str
    severity: str
    probableScope: str
    requiresInvestigation: bool
    confidence: float
    matchedKeywords: List[str]
    latencyMs: int
    engine: str = 'expert-system'
    model: str = 'ftth-expert-system-v1'


class BatchResponse(BaseModel):
    decisions: List[DecisionResponse]
    total: int
    totalLatencyMs: int


def classify(text: str) -> tuple:
    """Classify event text and return (eventClass, confidence, matchedKeywords)"""
    text_lower = text.lower()
    scores = {}
    
    for event_class, config in PATTERNS.items():
        score = sum(1 for p in config['patterns'] if p in text_lower)
        scores[event_class] = score
    
    if max(scores.values()) == 0:
        return 'NORMAL', 0.5, []
    
    best_class = max(scores, key=lambda x: (scores[x], -PATTERNS[x]['priority']))
    score = scores[best_class]
    max_possible = len(PATTERNS[best_class]['patterns'])
    confidence = min(0.95, 0.5 + (score / max_possible) * 0.45)
    
    matched = [p for p in PATTERNS[best_class]['patterns'] if p in text_lower]
    
    return best_class, confidence, matched


@app.get('/health')
async def health():
    """Health check endpoint"""
    return {
        'status': 'ok',
        'modelLoaded': True,
        'model': 'ftth-expert-system-v1',
        'engine': 'expert-system'
    }


@app.post('/v1/decide', response_model=DecisionResponse)
async def decide(request: DecisionRequest):
    """Classify a single event"""
    import time
    start = time.time()
    
    event_class, confidence, matched = classify(request.event.rawSummary)
    
    latency_ms = int((time.time() - start) * 1000)
    
    return DecisionResponse(
        eventId=request.event.eventId,
        eventClass=event_class,
        severity=SEVERITY_MAP[event_class],
        probableScope=SCOPE_MAP[event_class],
        requiresInvestigation=INVESTIGATION_MAP[event_class],
        confidence=confidence,
        matchedKeywords=matched,
        latencyMs=latency_ms
    )


@app.post('/v1/batch', response_model=BatchResponse)
async def batch(request: BatchRequest):
    """Classify multiple events"""
    import time
    start = time.time()
    
    decisions = []
    for event in request.events:
        event_class, confidence, matched = classify(event.rawSummary)
        
        decisions.append(DecisionResponse(
            eventId=event.eventId,
            eventClass=event_class,
            severity=SEVERITY_MAP[event_class],
            probableScope=SCOPE_MAP[event_class],
            requiresInvestigation=INVESTIGATION_MAP[event_class],
            confidence=confidence,
            matchedKeywords=matched,
            latencyMs=0
        ))
    
    total_latency = int((time.time() - start) * 1000)
    
    return BatchResponse(
        decisions=decisions,
        total=len(decisions),
        totalLatencyMs=total_latency
    )


@app.get('/metrics')
async def metrics():
    """Prometheus metrics endpoint (placeholder)"""
    return {
        'ftth_laya_requests_total': 0,
        'ftth_laya_latency_ms': {},
        'ftth_laya_confidence': {}
    }


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8080)
