# Laya Decision Layer - Environment Variables (ADR-042)
# Copy these to your .env file to enable Laya

# ── Master Switch ──────────────────────────────────────────────────────────
# Set to true to enable Laya integration
LAYA_ENABLED=false

# ── Operating Mode ─────────────────────────────────────────────────────────
# disabled  : Laya is not consulted
# shadow    : Laya decides but results are only logged (RECOMMENDED for initial deployment)
# assisted  : Laya signal injected into adaptive router context
# automatic-routing : Laya can affect routing (requires validation)
LAYA_MODE=shadow

# ── Service Configuration ──────────────────────────────────────────────────
# URL of the Laya service (for microservice mode)
# For Docker: http://laya:8080
# For local development: http://localhost:8080
LAYA_URL=http://localhost:8080

# Request timeout in milliseconds
LAYA_TIMEOUT_MS=250

# ── Fail-safe Configuration ───────────────────────────────────────────────
# If true, fallback to pipeline when Laya is unavailable
# If false, errors propagate (not recommended)
LAYA_FAIL_OPEN=true

# ── Confidence Thresholds ─────────────────────────────────────────────────
# High threshold: decisions above this are considered high confidence
LAYA_CONFIDENCE_THRESHOLD_HIGH=0.95

# Low threshold: decisions below this are considered low confidence
LAYA_CONFIDENCE_THRESHOLD_LOW=0.75

# ── Model Configuration ───────────────────────────────────────────────────
# Checkpoint identifier (for fine-tuned models, use your custom checkpoint)
LAYA_MODEL=laya-multilingual

# Pin the model version for reproducibility
LAYA_MODEL_VERSION=1.0.0

# ── GPU Configuration ──────────────────────────────────────────────────────
# Set to 'cuda' for GPU acceleration (requires CUDA-enabled PyTorch)
# Set to 'cpu' for CPU-only inference
LAYA_DEVICE=cpu
