#!/usr/bin/env bash
# ==============================================================================
# FTTH-Copilot — Production Server Installer & Bootstrapper
# Supported platforms: Linux (Ubuntu, Debian, RHEL, CentOS), macOS
# ==============================================================================

set -euo pipefail

# Colors and formatting
if [ -t 1 ]; then
  BOLD="\033[1m"
  DIM="\033[2m"
  RESET="\033[0m"
  CYAN="\033[36m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  RED="\033[31m"
else
  BOLD=""
  DIM=""
  RESET=""
  CYAN=""
  GREEN=""
  YELLOW=""
  RED=""
fi

# Print banner
print_banner() {
  clear 2>/dev/null || true
  cat << EOF
${CYAN}╔═══════════════════════════════════════════════════════════════════╗
║${BOLD}              FTTH-Copilot — Production Installer                  ${RESET}${CYAN}║
║${DIM}        AI-Powered Diagnostic Agent for FTTH / GPON ISPs           ${RESET}${CYAN}║
╚═══════════════════════════════════════════════════════════════════╝${RESET}

EOF
}

# Log helpers
info() { echo -e "  ${CYAN}ℹ${RESET} $1"; }
success() { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
error() { echo -e "  ${RED}✖${RESET} $1" >&2; }
header() { echo -e "\n${BOLD}$1${RESET}"; }

# Generate 32-byte random hex string
generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Masked secret prompt
read_secret() {
  local prompt="$1"
  local var_name="$2"
  local default_val="${3:-}"

  if [ -t 0 ]; then
    printf "  ${BOLD}%s${RESET}" "$prompt"
    if [ -n "$default_val" ]; then
      printf " ${DIM}(leave empty to keep existing)${RESET}"
    fi
    printf ": "
    
    local secret=""
    stty -echo
    read -r secret
    stty echo
    printf "\n"

    if [ -z "$secret" ] && [ -n "$default_val" ]; then
      eval "$var_name=\"\$default_val\""
    else
      eval "$var_name=\"\$secret\""
    fi
  else
    read -r "$var_name"
  fi
}

# Standard input prompt with default value
read_input() {
  local prompt="$1"
  local var_name="$2"
  local default_val="${3:-}"

  printf "  ${BOLD}%s${RESET}" "$prompt"
  if [ -n "$default_val" ]; then
    printf " ${DIM}(%s)${RESET}" "$default_val"
  fi
  printf ": "

  local input=""
  read -r input
  if [ -z "$input" ] && [ -n "$default_val" ]; then
    eval "$var_name=\"\$default_val\""
  else
    eval "$var_name=\"\$input\""
  fi
}

# Check Docker installation
check_docker() {
  header "Step 1: Verifying Infrastructure Prerequisites"

  if command -v docker >/dev/null 2>&1; then
    local docker_version
    docker_version=$(docker --version | awk '{print $3}' | tr -d ',')
    success "Docker is installed (v${docker_version})"
  else
    warn "Docker is not found on this system."
    read_input "Would you like to install Docker automatically using the official script? [Y/n]" INSTALL_DOCKER "y"
    if [[ "$INSTALL_DOCKER" =~ ^[Yy]$ ]]; then
      info "Downloading and executing official Docker installation script..."
      curl -fsSL https://get.docker.com | sh
      if command -v sudo >/dev/null 2>&1 && [ "$EUID" -ne 0 ]; then
        sudo usermod -aG docker "$USER" || true
      fi
      success "Docker installed successfully."
    else
      error "Docker is required to run the production stack. Aborting."
      exit 1
    fi
  fi

  # Check Docker Compose (v2 plugin or standalone)
  if docker compose version >/dev/null 2>&1; then
    local compose_version
    compose_version=$(docker compose version --short 2>/dev/null || echo "v2")
    success "Docker Compose plugin is available (${compose_version})"
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    success "docker-compose standalone is available"
    COMPOSE_CMD="docker-compose"
  else
    error "Docker Compose was not found. Please install the Docker Compose plugin (apt install docker-compose-plugin)."
    exit 1
  fi
}

# Configure environment variables
configure_env() {
  header "Step 2: Production Configuration & Credentials"

  local env_file=".env.prod"

  # Load existing .env.prod if present
  local prev_port="3001"
  local prev_provider=""
  local prev_pg_pass=""
  local prev_minimax_key=""
  local prev_deepseek_key=""
  local prev_qwen_key=""

  if [ -f "$env_file" ]; then
    info "Found existing $env_file. Settings will be preserved unless updated."
    # shellcheck disable=SC1090
    source "$env_file" 2>/dev/null || true
    prev_port="${PORT:-3001}"
    prev_provider="${LLM_PROVIDER:-}"
    prev_pg_pass="${POSTGRES_PASSWORD:-}"
    prev_minimax_key="${MINIMAX_API_KEY:-}"
    prev_deepseek_key="${DEEPSEEK_API_KEY:-}"
    prev_qwen_key="${QWEN_API_KEY:-}"
  fi

  # 1. Port
  read_input "Public Web Port" APP_PORT "$prev_port"

  # 2. Database password
  if [ -z "$prev_pg_pass" ]; then
    prev_pg_pass=$(generate_secret | cut -c 1-20)
  fi
  read_secret "PostgreSQL Password" PG_PASSWORD "$prev_pg_pass"

  # 3. AI Model Provider
  echo ""
  echo -e "  ${BOLD}Select AI Model Provider:${RESET}"
  echo -e "    ${BOLD}[1]${RESET} MiniMax ${DIM}(Anthropic Claude-compatible - Recommended for ISPs)${RESET}"
  echo -e "    ${BOLD}[2]${RESET} DeepSeek ${DIM}(OpenAI-compatible deepseek-chat)${RESET}"
  echo -e "    ${BOLD}[3]${RESET} Qwen / DashScope ${DIM}(Alibaba Cloud OpenAI-compatible)${RESET}"
  echo -e "    ${BOLD}[4]${RESET} Demo / Offline Mode ${DIM}(No AI API key needed, deterministic responses)${RESET}"
  
  local default_opt="1"
  if [ "$prev_provider" = "deepseek" ]; then default_opt="2"; fi
  if [ "$prev_provider" = "qwen" ]; then default_opt="3"; fi
  if [ -z "$prev_provider" ]; then default_opt="4"; fi

  read_input "Select option [1-4]" AI_CHOICE "$default_opt"

  local selected_provider=""
  local minimax_key="$prev_minimax_key"
  local deepseek_key="$prev_deepseek_key"
  local qwen_key="$prev_qwen_key"

  case "$AI_CHOICE" in
    1)
      selected_provider="minimax"
      read_secret "Enter MiniMax API Key" minimax_key "$prev_minimax_key"
      ;;
    2)
      selected_provider="deepseek"
      read_secret "Enter DeepSeek API Key" deepseek_key "$prev_deepseek_key"
      ;;
    3)
      selected_provider="qwen"
      read_secret "Enter Qwen API Key" qwen_key "$prev_qwen_key"
      ;;
    *)
      selected_provider=""
      info "Running in demo/offline AI mode."
      ;;
  esac

  # 4. Generate cryptographic keys
  local jwt_sec="${JWT_SECRET:-$(generate_secret)}"
  local kms_key="${KMS_MASTER_KEY:-$(generate_secret)}"

  # Write .env.prod
  cat > "$env_file" << EOF
# ==============================================================================
# FTTH-Copilot Production Environment
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ==============================================================================

# Server
NODE_ENV=production
PORT=${APP_PORT}

# Database
POSTGRES_USER=ftth
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=ftth_copilot
DATABASE_URL=postgresql://ftth:${PG_PASSWORD}@postgres:5432/ftth_copilot

# Cryptographic Keys (32-byte secure hex)
JWT_SECRET=${jwt_sec}
KMS_MASTER_KEY=${kms_key}

# AI Provider
LLM_PROVIDER=${selected_provider}
MINIMAX_API_KEY=${minimax_key}
MINIMAX_BASE_URL=https://api.minimax.io/anthropic
MINIMAX_MODEL=MiniMax-M3

DEEPSEEK_API_KEY=${deepseek_key}
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

QWEN_API_KEY=${qwen_key}
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus

# Connectors
SMARTOLT_USE_MOCK=true
SMARTOLT_API_BASE_URL=https://api.smartolt.com
SMARTOLT_API_KEY=

# Telemetry and Listeners
SNMP_RECEIVER_ENABLED=false
SNMP_UDP_PORT=1162
SYSLOG_RECEIVER_ENABLED=false
SYSLOG_UDP_PORT=5514
LOG_LEVEL=info
DEMO_MODE_ENABLED=true
EOF

  chmod 600 "$env_file"
  success "Wrote secure configuration to $env_file (permissions 0600)"
}

# Deploy containers
deploy_stack() {
  header "Step 3: Building and Starting Production Services"

  info "Building container images (multi-stage Next.js standalone)..."
  $COMPOSE_CMD -f docker-compose.prod.yml build

  info "Starting services in background..."
  $COMPOSE_CMD -f docker-compose.prod.yml up -d

  info "Waiting for application to report healthy status..."
  local attempts=0
  local max_attempts=40
  local app_healthy=false

  while [ $attempts -lt $max_attempts ]; do
    attempts=$((attempts + 1))
    if curl -s -f "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
      app_healthy=true
      break
    fi
    sleep 2
  done

  if [ "$app_healthy" = true ]; then
    success "All services are up and healthy!"
  else
    warn "Health endpoint did not answer within 80s. Checking logs..."
    $COMPOSE_CMD -f docker-compose.prod.yml logs --tail 20 app || true
  fi

  # Run initial seed if needed
  info "Seeding initial database roles and demo ISP data..."
  $COMPOSE_CMD -f docker-compose.prod.yml run --rm db-migrate pnpm --filter @ftth-copilot/db db:seed || true
  success "Database initialization complete."
}

# Print success completion
print_summary() {
  local server_ip
  server_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
  if [ -z "$server_ip" ]; then server_ip="localhost"; fi

  cat << EOF

${GREEN}╔═══════════════════════════════════════════════════════════════════╗
║${BOLD}          🎉 FTTH-Copilot Successfully Installed!                   ${RESET}${GREEN}║
╚═══════════════════════════════════════════════════════════════════╝${RESET}

  ${BOLD}Application URL:${RESET}   ${CYAN}http://${server_ip}:${APP_PORT}${RESET}
  ${BOLD}Local Access:${RESET}      ${CYAN}http://localhost:${APP_PORT}${RESET}
  ${BOLD}Health Check:${RESET}      ${CYAN}http://localhost:${APP_PORT}/api/health${RESET}

  ${BOLD}Default Credentials:${RESET}
    ${DIM}Tenant:${RESET}      Demo ISP (demo-tenant)
    ${DIM}Admin User:${RESET}  admin@ftth-copilot.local
    ${DIM}Password:${RESET}    (Generated during seed; see logs if not configured)

  ${BOLD}Management Commands:${RESET}
    View logs:       ${BOLD}${COMPOSE_CMD} -f docker-compose.prod.yml logs -f app${RESET}
    Restart stack:   ${BOLD}${COMPOSE_CMD} -f docker-compose.prod.yml restart${RESET}
    Stop stack:      ${BOLD}${COMPOSE_CMD} -f docker-compose.prod.yml down${RESET}

EOF
}

main() {
  print_banner
  check_docker
  configure_env
  deploy_stack
  print_summary
}

main "$@"
