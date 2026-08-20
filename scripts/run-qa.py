#!/usr/bin/env python3
"""
Run the FTTH-Copilot agent QA suite.

Posts the canonical 10 diagnostic questions to the dev server's /api/chat,
captures each response (tool used, latency, full reply), and writes:
  - JSON:    docs/validation/qa-results-YYYY-MM-DD.json
  - Summary: prints to stdout

Usage:
  python3 scripts/run-qa.py [endpoint]
  # default endpoint: http://127.0.0.1:3001/api/chat

Output JSON shape:
  [
    {
      "q": "...",
      "ok": true,
      "latency_s": 4.73,
      "reply": "...",
      "tools_used": ["list_onus", "get_network_overview"],
      "tool_args": [{...}, {...}]
    },
    ...
  ]
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3001/api/chat"

# 10 canonical diagnostic questions for Phase 1 → 2 transition.
# Designed to cover all 6 tools + various complexity levels.
# Update these carefully — the QA log references them by content.
QUESTIONS = [
    # Simple counts
    "Cuantas ONUs hay offline?",
    # Filter by status
    "Listame las ONUs que estan degradadas",
    # Threshold filter
    "Que ONUs tienen RX menor a -27 dBm?",
    # Per-OLT detail (multi-tool)
    "Como esta el OLT-001? Cuantas ONUs conectadas?",
    # Lookup by customer name (tests agent's ability to search without a dedicated tool)
    "La ONU del cliente Carlos Lopez tiene problema. Que onda?",
    # Lookup by serial
    "Dame los detalles de la ONU SN-A1B2C3D4",
    # Edge case: unknown ID
    "Buscame la ONU serial SN-NOEXISTE-123",
    # Temperature check
    "Cuales OLTs tienen temperatura alta y cuanto?",
    # Multi-step diagnostic
    "Por que tengo 2 ONUs caidas en el mismo OLT? Investigame",
    # Aggregate summary
    "Dame un resumen general de la red",
]


def ask(question: str, endpoint: str) -> dict:
    """Send a question and return the response or an error."""
    t0 = time.time()
    body = json.dumps({"message": question}).encode()
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            elapsed = time.time() - t0
            data = json.loads(r.read())
            return {
                "ok": True,
                "latency_s": round(elapsed, 2),
                "reply": data.get("reply", ""),
                "tools_used": [t["name"] for t in data.get("toolsUsed", [])],
                "tool_args": [t["args"] for t in data.get("toolsUsed", [])],
            }
    except urllib.error.HTTPError as e:
        elapsed = time.time() - t0
        return {
            "ok": False,
            "latency_s": round(elapsed, 2),
            "error": f"HTTP {e.code}: {e.read().decode(errors='ignore')[:200]}",
        }
    except Exception as e:
        elapsed = time.time() - t0
        return {
            "ok": False,
            "latency_s": round(elapsed, 2),
            "error": f"{type(e).__name__}: {e}",
        }


def main():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"Running {len(QUESTIONS)} QA questions against {ENDPOINT}\n")
    results = []
    for i, q in enumerate(QUESTIONS, 1):
        print(f"[{i}/10] {q}")
        r = ask(q, ENDPOINT)
        r["q"] = q
        results.append(r)
        if r["ok"]:
            tools = r["tools_used"] or ["(none)"]
            print(f"  -> {r['latency_s']}s | tools: {tools}")
        else:
            print(f"  -> ERROR: {r.get('error')}")
        time.sleep(1)  # be polite

    # Save raw JSON
    out_dir = Path("docs/validation")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"qa-results-{today}.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nRaw results saved to {out_path}")

    # Summary stats
    ok = [r for r in results if r["ok"]]
    print(f"\nSuccess: {len(ok)}/{len(results)}")
    if ok:
        avg = sum(r["latency_s"] for r in ok) / len(ok)
        print(f"Avg latency (ok): {avg:.2f}s")
        from collections import Counter

        all_tools = []
        for r in ok:
            all_tools.extend(r["tools_used"])
        print(f"Tool use frequency: {dict(Counter(all_tools))}")


if __name__ == "__main__":
    main()