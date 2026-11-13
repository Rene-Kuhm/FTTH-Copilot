"""Tests for the Laya Expert System FastAPI service."""

import pytest
from fastapi.testclient import TestClient

from app import (
    INVESTIGATION_MAP,
    PATTERNS,
    SCOPE_MAP,
    SEVERITY_MAP,
    app,
    classify,
)

client = TestClient(app)


@pytest.mark.parametrize(
    ("text", "expected_class", "expected_keyword"),
    [
        ("OLT-SYNTH-01: LOS alarm detected on PON 0/1/2", "OPTICAL_FAULT", "los alarm"),
        ("PON 0/2/1 rx power declining across 4 ONUs", "OPTICAL_DEGRADATION", "rx power declining"),
        ("ONU-9901 reported dying gasp before disconnect", "POWER_FAULT", "dying gasp"),
        ("OLT-SYNTH-02 board fail on slot 3 thermal alert", "DEVICE_FAULT", "board fail"),
        ("Uplink port ge-0/0/1 down on aggregation switch", "UPLINK_FAULT", "uplink port"),
        ("High uplink utilization during peak hour", "CONGESTION", "peak hour"),
        ("Widespread service drop across common upstream", "MASS_OUTAGE", "widespread"),
        ("Routine check completed: services operational", "NORMAL", "routine check"),
        ("Non-standard vendor trap received", "UNKNOWN", "non-standard"),
    ],
)
def test_classify_maps_each_event_class(text: str, expected_class: str, expected_keyword: str) -> None:
    event_class, confidence, matched = classify(text)
    assert event_class == expected_class
    assert expected_keyword in matched
    assert 0.5 < confidence <= 0.95


def test_classify_unmatched_text_falls_back_to_normal() -> None:
    event_class, confidence, matched = classify("synthetic telemetry heartbeat 198.51.100.10")
    assert event_class == "NORMAL"
    assert confidence == 0.5
    assert matched == []


def test_classify_breaks_ties_using_priority() -> None:
    # 1 match for OPTICAL_FAULT (priority 1) vs 1 match for POWER_FAULT (priority 3)
    event_class, _, matched = classify("fiber cut reported alongside dying gasp")
    assert event_class == "OPTICAL_FAULT"
    assert matched == ["fiber cut"]


def test_classify_caps_confidence_at_0_95() -> None:
    # All 6 DEVICE_FAULT patterns present -> 0.5 + 1.0 * 0.45 = 0.95
    text = "temperature thermal hardware fail board fail equipment fail malfunction"
    event_class, confidence, matched = classify(text)
    assert event_class == "DEVICE_FAULT"
    assert len(matched) == len(PATTERNS["DEVICE_FAULT"]["patterns"])
    assert confidence == pytest.approx(0.95)


def test_mapping_tables_cover_all_pattern_classes() -> None:
    expected_classes = set(PATTERNS.keys())
    assert set(SEVERITY_MAP.keys()) == expected_classes
    assert set(SCOPE_MAP.keys()) == expected_classes
    assert set(INVESTIGATION_MAP.keys()) == expected_classes


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "modelLoaded": True,
        "model": "ftth-expert-system-v1",
        "engine": "expert-system",
    }


def test_decide_endpoint_classifies_single_event() -> None:
    payload = {
        "event": {
            "eventId": "evt-synth-001",
            "source": "snmp",
            "rawSummary": "OLT-01 fiber break on PON 0/1/4",
        }
    }
    response = client.post("/v1/decide", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["eventId"] == "evt-synth-001"
    assert body["eventClass"] == "OPTICAL_FAULT"
    assert body["severity"] == "HIGH"
    assert body["probableScope"] == "PON"
    assert body["requiresInvestigation"] is True
    assert body["matchedKeywords"] == ["fiber break"]
    assert body["engine"] == "expert-system"
    assert body["model"] == "ftth-expert-system-v1"
    assert body["latencyMs"] >= 0


def test_decide_endpoint_rejects_missing_raw_summary() -> None:
    response = client.post("/v1/decide", json={"event": {"eventId": "evt-invalid"}})
    assert response.status_code == 422


def test_batch_endpoint_classifies_multiple_events() -> None:
    payload = {
        "events": [
            {"eventId": "evt-1", "rawSummary": "ONU dying gasp power fail"},
            {"eventId": "evt-2", "rawSummary": "Routine check: operational"},
        ]
    }
    response = client.post("/v1/batch", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["totalLatencyMs"] >= 0
    assert [d["eventId"] for d in body["decisions"]] == ["evt-1", "evt-2"]
    assert body["decisions"][0]["eventClass"] == "POWER_FAULT"
    assert body["decisions"][0]["severity"] == "CRITICAL"
    assert body["decisions"][1]["eventClass"] == "NORMAL"
    assert body["decisions"][1]["requiresInvestigation"] is False


def test_batch_endpoint_handles_empty_list() -> None:
    response = client.post("/v1/batch", json={"events": []})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 0
    assert body["decisions"] == []


def test_metrics_endpoint() -> None:
    response = client.get("/metrics")
    assert response.status_code == 200
    body = response.json()
    assert "ftth_laya_requests_total" in body
    assert "ftth_laya_latency_ms" in body
    assert "ftth_laya_confidence" in body
