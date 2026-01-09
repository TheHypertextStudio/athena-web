#!/usr/bin/env bash
set -euo pipefail

# Athena API - GCP Cloud Run Deployment Setup (Fully Automated)
# This script configures all GCP resources and GitHub secrets for deployment

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Athena API - GCP Cloud Run Deployment Setup"
echo "════════════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────────────────────────
# Prerequisites Check
# ─────────────────────────────────────────────────────────────────

check_prerequisites() {
    local missing=()

    if ! command -v gcloud &> /dev/null; then
        missing+=("gcloud (https://cloud.google.com/sdk/docs/install)")
    fi

    if ! command -v gh &> /dev/null; then
        missing+=("gh (https://cli.github.com/)")
    fi

    if ! command -v openssl &> /dev/null; then
        missing+=("openssl")
    fi

    if ! command -v jq &> /dev/null; then
        missing+=("jq (brew install jq)")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools:"
        for tool in "${missing[@]}"; do
            echo "  - ${tool}"
        done
        exit 1
    fi

    # Check gcloud auth
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 | grep -q .; then
        log_error "Not logged in to gcloud. Run: gcloud auth login"
        exit 1
    fi

    # Check gh auth
    if ! gh auth status &> /dev/null; then
        log_error "Not logged in to GitHub CLI. Run: gh auth login"
        exit 1
    fi

    log_success "All prerequisites met"
}

# ─────────────────────────────────────────────────────────────────
# Auto-detection Functions
# ─────────────────────────────────────────────────────────────────

detect_github_repo() {
    local remote_url
    remote_url=$(git -C "${PROJECT_ROOT}" remote get-url origin 2>/dev/null || echo "")

    if [[ -z "${remote_url}" ]]; then
        return 1
    fi

    # Handle SSH format: git@github.com:owner/repo.git
    if [[ "${remote_url}" =~ git@github\.com:([^/]+)/([^/]+)(\.git)?$ ]]; then
        echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}"
        return 0
    fi

    # Handle HTTPS format: https://github.com/owner/repo.git
    if [[ "${remote_url}" =~ github\.com/([^/]+)/([^/]+)(\.git)?$ ]]; then
        echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}"
        return 0
    fi

    return 1
}

detect_gcp_project() {
    gcloud config get-value project 2>/dev/null || echo ""
}

select_gcp_region() {
    log_info "Fetching available Cloud Run regions..." >&2

    local regions
    regions=$(gcloud run regions list --format="value(locationId)" 2>/dev/null | sort)

    if [[ -z "${regions}" ]]; then
        log_error "Failed to fetch regions" >&2
        return 1
    fi

    # Convert to array
    local region_array=()
    while IFS= read -r region; do
        region_array+=("${region}")
    done <<< "${regions}"

    # Find recommended regions (low cost, good latency)
    local recommended=("us-central1" "us-east1" "europe-west1" "asia-east1")

    echo "" >&2
    echo "Select a region (recommended regions marked with *):" >&2
    echo "" >&2

    local i=1
    for region in "${region_array[@]}"; do
        local marker=""
        for rec in "${recommended[@]}"; do
            if [[ "${region}" == "${rec}" ]]; then
                marker=" *"
                break
            fi
        done
        printf "  %2d) %s%s\n" "${i}" "${region}" "${marker}" >&2
        ((i++))
    done

    echo "" >&2
    local selection
    read -rp "Enter number [1]: " selection </dev/tty
    selection=${selection:-1}

    if [[ ! "${selection}" =~ ^[0-9]+$ ]] || [[ "${selection}" -lt 1 ]] || [[ "${selection}" -gt ${#region_array[@]} ]]; then
        log_error "Invalid selection" >&2
        return 1
    fi

    echo "${region_array[$((selection-1))]}"
}

# ─────────────────────────────────────────────────────────────────
# Supabase Database Provisioning
# ─────────────────────────────────────────────────────────────────

provision_supabase_database() {
    local project_name="$1"
    local gcp_region="$2"

    # Map GCP region to Supabase region
    local supabase_region
    case "${gcp_region}" in
        us-central1|us-east1|us-east4|us-west1|us-west2|us-west3|us-west4|us-south1|us-east5)
            supabase_region="us-east-1"
            ;;
        europe-west1|europe-west2|europe-west3|europe-west4|europe-west6|europe-north1|europe-central2|europe-southwest1|europe-west8|europe-west9|europe-west10|europe-west12|europe-north2)
            supabase_region="eu-west-1"
            ;;
        asia-east1|asia-east2|asia-northeast1|asia-northeast2|asia-northeast3|asia-south1|asia-south2|asia-southeast1|asia-southeast2|asia-southeast3)
            supabase_region="ap-southeast-1"
            ;;
        australia-southeast1|australia-southeast2)
            supabase_region="ap-southeast-2"
            ;;
        southamerica-east1|southamerica-west1)
            supabase_region="sa-east-1"
            ;;
        *)
            supabase_region="us-east-1"
            ;;
    esac

    log_info "Creating Supabase project in region: ${supabase_region}" >&2

    # Generate a secure database password
    local db_password
    db_password=$(openssl rand -base64 24 | tr -d '/+=')

    # Create the project
    local create_output
    if ! create_output=$(supabase projects create "${project_name}" \
        --db-password "${db_password}" \
        --region "${supabase_region}" \
        --org-id "$(supabase orgs list --output json 2>/dev/null | jq -r '.[0].id // empty')" \
        2>&1); then
        log_error "Failed to create Supabase project: ${create_output}" >&2
        return 1
    fi

    log_success "Supabase project created" >&2

    # Wait for project to be ready
    log_info "Waiting for project to initialize (this may take 1-2 minutes)..." >&2
    sleep 30

    # Get project reference
    local project_ref
    project_ref=$(supabase projects list --output json 2>/dev/null | jq -r ".[] | select(.name == \"${project_name}\") | .id // empty")

    if [[ -z "${project_ref}" ]]; then
        log_error "Could not find project reference" >&2
        return 1
    fi

    # Construct the pooled connection string (recommended for serverless)
    # Format: postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
    local database_url="postgresql://postgres.${project_ref}:${db_password}@aws-0-${supabase_region}.pooler.supabase.com:6543/postgres?sslmode=require"

    log_success "Database URL generated" >&2
    echo "${database_url}"
}

select_database_option() {
    echo "" >&2
    echo "How do you want to configure the database?" >&2
    echo "" >&2
    echo "  1) Create new Supabase database (recommended)" >&2
    echo "  2) Enter existing DATABASE_URL manually" >&2
    echo "  3) Skip (configure later in GCP Secret Manager)" >&2
    echo "" >&2

    local selection
    read -rp "Enter number [1]: " selection </dev/tty
    selection=${selection:-1}

    echo "${selection}"
}

# ─────────────────────────────────────────────────────────────────
# Secret Collection
# ─────────────────────────────────────────────────────────────────

collect_secrets() {
    local env_file="${PROJECT_ROOT}/apps/api/.env"
    local gcp_region="${1:-us-central1}"

    echo ""
    echo "─────────────────────────────────────────────────────────────"
    echo "  Application Secrets Configuration"
    echo "─────────────────────────────────────────────────────────────"
    echo ""

    # Check for .env file
    if [[ -f "${env_file}" ]]; then
        log_info "Found .env file at apps/api/.env"
        read -rp "Import values from .env file? (Y/n): " import_env
        import_env=${import_env:-Y}

        if [[ "${import_env}" =~ ^[Yy]$ ]]; then
            # Source the .env file safely
            set -a
            # shellcheck disable=SC1090
            source <(grep -E '^(DATABASE_URL|BETTER_AUTH_SECRET|BETTER_AUTH_URL|FRONTEND_URL)=' "${env_file}" 2>/dev/null || true)
            set +a
            log_success "Imported values from .env"
        fi
    fi

    # DATABASE_URL
    if [[ -z "${DATABASE_URL:-}" ]]; then
        local db_option
        db_option=$(select_database_option)

        case "${db_option}" in
            1)
                # Check for Supabase CLI
                if ! command -v supabase &> /dev/null; then
                    log_error "Supabase CLI not installed. Install it: brew install supabase/tap/supabase"
                    log_info "Falling back to manual entry..."
                    echo ""
                    log_info "DATABASE_URL - PostgreSQL connection string"
                    echo "  Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
                    read -rp "  Enter DATABASE_URL: " DATABASE_URL
                elif ! supabase projects list &> /dev/null; then
                    log_error "Not logged in to Supabase. Run: supabase login"
                    log_info "Falling back to manual entry..."
                    echo ""
                    log_info "DATABASE_URL - PostgreSQL connection string"
                    echo "  Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
                    read -rp "  Enter DATABASE_URL: " DATABASE_URL
                else
                    echo ""
                    read -rp "  Enter Supabase project name [athena-api]: " supabase_project_name
                    supabase_project_name=${supabase_project_name:-athena-api}

                    DATABASE_URL=$(provision_supabase_database "${supabase_project_name}" "${gcp_region}")
                    if [[ -z "${DATABASE_URL}" ]]; then
                        log_error "Failed to provision Supabase database"
                        log_info "Please enter DATABASE_URL manually"
                        read -rp "  Enter DATABASE_URL: " DATABASE_URL
                    else
                        log_success "DATABASE_URL: [provisioned via Supabase]"
                    fi
                fi
                ;;
            2)
                echo ""
                log_info "DATABASE_URL - PostgreSQL connection string"
                echo "  Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
                read -rp "  Enter DATABASE_URL: " DATABASE_URL
                ;;
            3)
                log_warn "Skipping DATABASE_URL - you must set it manually in GCP Secret Manager"
                DATABASE_URL="PLACEHOLDER_SET_IN_GCP_SECRET_MANAGER"
                ;;
            *)
                log_error "Invalid selection, using manual entry"
                read -rp "  Enter DATABASE_URL: " DATABASE_URL
                ;;
        esac
    else
        log_success "DATABASE_URL: [imported from .env]"
    fi

    # BETTER_AUTH_SECRET
    if [[ -z "${BETTER_AUTH_SECRET:-}" ]]; then
        echo ""
        log_info "BETTER_AUTH_SECRET - Authentication signing key (min 32 chars)"
        read -rp "  Auto-generate secure secret? (Y/n): " auto_gen
        auto_gen=${auto_gen:-Y}

        if [[ "${auto_gen}" =~ ^[Yy]$ ]]; then
            BETTER_AUTH_SECRET=$(openssl rand -base64 32)
            log_success "Generated: ${BETTER_AUTH_SECRET:0:20}..."
        else
            read -rp "  Enter BETTER_AUTH_SECRET: " BETTER_AUTH_SECRET
        fi
    else
        log_success "BETTER_AUTH_SECRET: [imported from .env]"
    fi

    # BETTER_AUTH_URL
    if [[ -z "${BETTER_AUTH_URL:-}" ]]; then
        echo ""
        log_info "BETTER_AUTH_URL - Public API URL"
        echo "  Example: https://api.athena.app"
        read -rp "  Enter BETTER_AUTH_URL: " BETTER_AUTH_URL
    else
        log_success "BETTER_AUTH_URL: ${BETTER_AUTH_URL}"
    fi

    # FRONTEND_URL
    if [[ -z "${FRONTEND_URL:-}" ]]; then
        echo ""
        log_info "FRONTEND_URL - Frontend URL for CORS"
        echo "  Example: https://athena.app"
        read -rp "  Enter FRONTEND_URL: " FRONTEND_URL
    else
        log_success "FRONTEND_URL: ${FRONTEND_URL}"
    fi

    # Export for use in script
    export DATABASE_URL BETTER_AUTH_SECRET BETTER_AUTH_URL FRONTEND_URL
}

# ─────────────────────────────────────────────────────────────────
# GCP Setup
# ─────────────────────────────────────────────────────────────────

setup_gcp() {
    local project_id="$1"
    local region="$2"
    local github_repo="$3"

    local service_account_name="athena-api-deployer"
    local service_account_email="${service_account_name}@${project_id}.iam.gserviceaccount.com"
    local workload_identity_pool="github-actions-pool"
    local workload_identity_provider="github-actions-provider"
    local artifact_registry_repo="athena"

    echo ""
    echo "─────────────────────────────────────────────────────────────"
    echo "  Setting up GCP Resources"
    echo "─────────────────────────────────────────────────────────────"
    echo ""

    log_info "Setting project to ${project_id}..."
    gcloud config set project "${project_id}" --quiet

    log_info "Enabling required APIs..."
    gcloud services enable \
        run.googleapis.com \
        artifactregistry.googleapis.com \
        iam.googleapis.com \
        iamcredentials.googleapis.com \
        cloudresourcemanager.googleapis.com \
        secretmanager.googleapis.com \
        --quiet
    log_success "APIs enabled"

    log_info "Creating Artifact Registry repository..."
    if gcloud artifacts repositories describe "${artifact_registry_repo}" --location="${region}" &> /dev/null; then
        log_warn "Repository already exists, skipping"
    else
        gcloud artifacts repositories create "${artifact_registry_repo}" \
            --repository-format=docker \
            --location="${region}" \
            --description="Athena application Docker images" \
            --quiet
        log_success "Repository created"
    fi

    log_info "Creating service account..."
    if gcloud iam service-accounts describe "${service_account_email}" &> /dev/null; then
        log_warn "Service account already exists, skipping"
    else
        gcloud iam service-accounts create "${service_account_name}" \
            --display-name="Athena API Deployer" \
            --description="Service account for GitHub Actions to deploy Athena API to Cloud Run" \
            --quiet
        log_success "Service account created"
    fi

    log_info "Granting service account permissions..."
    local roles=(
        "roles/run.admin"
        "roles/artifactregistry.writer"
        "roles/iam.serviceAccountUser"
        "roles/secretmanager.secretAccessor"
    )
    for role in "${roles[@]}"; do
        gcloud projects add-iam-policy-binding "${project_id}" \
            --member="serviceAccount:${service_account_email}" \
            --role="${role}" \
            --condition=None \
            --quiet 2>/dev/null || true
    done
    log_success "Permissions granted"

    log_info "Setting up Workload Identity Federation..."

    if gcloud iam workload-identity-pools describe "${workload_identity_pool}" --location="global" &> /dev/null; then
        log_warn "Workload Identity Pool already exists"
    else
        gcloud iam workload-identity-pools create "${workload_identity_pool}" \
            --location="global" \
            --display-name="GitHub Actions Pool" \
            --description="Workload Identity Pool for GitHub Actions" \
            --quiet
        log_success "Workload Identity Pool created"
    fi

    if gcloud iam workload-identity-pools providers describe "${workload_identity_provider}" \
        --workload-identity-pool="${workload_identity_pool}" \
        --location="global" &> /dev/null; then
        log_warn "Workload Identity Provider already exists"
    else
        gcloud iam workload-identity-pools providers create-oidc "${workload_identity_provider}" \
            --workload-identity-pool="${workload_identity_pool}" \
            --location="global" \
            --issuer-uri="https://token.actions.githubusercontent.com" \
            --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
            --attribute-condition="assertion.repository == '${github_repo}'" \
            --quiet
        log_success "Workload Identity Provider created"
    fi

    log_info "Binding service account to Workload Identity Pool..."
    local project_number
    project_number=$(gcloud projects describe "${project_id}" --format='value(projectNumber)')

    gcloud iam service-accounts add-iam-policy-binding "${service_account_email}" \
        --role="roles/iam.workloadIdentityUser" \
        --member="principalSet://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${workload_identity_pool}/attribute.repository/${github_repo}" \
        --quiet 2>/dev/null || true
    log_success "Service account bound to Workload Identity"

    # Create/update Secret Manager secrets
    log_info "Configuring Secret Manager secrets..."
    declare -A secrets=(
        ["DATABASE_URL"]="${DATABASE_URL}"
        ["BETTER_AUTH_SECRET"]="${BETTER_AUTH_SECRET}"
        ["BETTER_AUTH_URL"]="${BETTER_AUTH_URL}"
        ["FRONTEND_URL"]="${FRONTEND_URL}"
    )

    for secret_name in "${!secrets[@]}"; do
        local secret_value="${secrets[${secret_name}]}"
        if gcloud secrets describe "${secret_name}" &> /dev/null; then
            # Add new version to existing secret
            echo -n "${secret_value}" | gcloud secrets versions add "${secret_name}" --data-file=- --quiet
            log_success "Updated secret: ${secret_name}"
        else
            # Create new secret
            echo -n "${secret_value}" | gcloud secrets create "${secret_name}" \
                --data-file=- \
                --replication-policy="automatic" \
                --quiet
            log_success "Created secret: ${secret_name}"
        fi
    done

    # Export values for GitHub secrets setup
    export GCP_SERVICE_ACCOUNT_EMAIL="${service_account_email}"
    export GCP_WORKLOAD_IDENTITY_PROVIDER="projects/${project_number}/locations/global/workloadIdentityPools/${workload_identity_pool}/providers/${workload_identity_provider}"
}

# ─────────────────────────────────────────────────────────────────
# GitHub Secrets Setup
# ─────────────────────────────────────────────────────────────────

setup_github_secrets() {
    local github_repo="$1"
    local project_id="$2"
    local region="$3"

    echo ""
    echo "─────────────────────────────────────────────────────────────"
    echo "  Setting up GitHub Secrets"
    echo "─────────────────────────────────────────────────────────────"
    echo ""

    log_info "Adding secrets to ${github_repo}..."

    # GCP Secrets
    gh secret set GCP_PROJECT_ID --repo="${github_repo}" --body="${project_id}"
    log_success "Set GCP_PROJECT_ID"

    gh secret set GCP_REGION --repo="${github_repo}" --body="${region}"
    log_success "Set GCP_REGION"

    gh secret set GCP_SERVICE_ACCOUNT --repo="${github_repo}" --body="${GCP_SERVICE_ACCOUNT_EMAIL}"
    log_success "Set GCP_SERVICE_ACCOUNT"

    gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --repo="${github_repo}" --body="${GCP_WORKLOAD_IDENTITY_PROVIDER}"
    log_success "Set GCP_WORKLOAD_IDENTITY_PROVIDER"

    log_success "All GitHub secrets configured"
}

# ─────────────────────────────────────────────────────────────────
# Verification
# ─────────────────────────────────────────────────────────────────

verify_setup() {
    local project_id="$1"
    local region="$2"
    local github_repo="$3"

    echo ""
    echo "─────────────────────────────────────────────────────────────"
    echo "  Verifying Setup"
    echo "─────────────────────────────────────────────────────────────"
    echo ""

    local errors=0

    # Verify Artifact Registry
    if gcloud artifacts repositories describe athena --location="${region}" &> /dev/null; then
        log_success "Artifact Registry repository exists"
    else
        log_error "Artifact Registry repository not found"
        ((errors++))
    fi

    # Verify Service Account
    local sa_email="athena-api-deployer@${project_id}.iam.gserviceaccount.com"
    if gcloud iam service-accounts describe "${sa_email}" &> /dev/null; then
        log_success "Service account exists"
    else
        log_error "Service account not found"
        ((errors++))
    fi

    # Verify Workload Identity Pool
    if gcloud iam workload-identity-pools describe github-actions-pool --location="global" &> /dev/null; then
        log_success "Workload Identity Pool exists"
    else
        log_error "Workload Identity Pool not found"
        ((errors++))
    fi

    # Verify Secret Manager secrets
    for secret in DATABASE_URL BETTER_AUTH_SECRET BETTER_AUTH_URL FRONTEND_URL; do
        if gcloud secrets describe "${secret}" &> /dev/null; then
            log_success "Secret ${secret} exists"
        else
            log_error "Secret ${secret} not found"
            ((errors++))
        fi
    done

    # Verify GitHub secrets
    log_info "Verifying GitHub secrets..."
    local gh_secrets
    gh_secrets=$(gh secret list --repo="${github_repo}" 2>/dev/null || echo "")

    for secret in GCP_PROJECT_ID GCP_REGION GCP_SERVICE_ACCOUNT GCP_WORKLOAD_IDENTITY_PROVIDER; do
        if echo "${gh_secrets}" | grep -q "^${secret}"; then
            log_success "GitHub secret ${secret} exists"
        else
            log_error "GitHub secret ${secret} not found"
            ((errors++))
        fi
    done

    echo ""
    if [[ ${errors} -eq 0 ]]; then
        log_success "All verifications passed!"
        return 0
    else
        log_error "${errors} verification(s) failed"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

main() {
    check_prerequisites

    echo ""
    echo "─────────────────────────────────────────────────────────────"
    echo "  Configuration"
    echo "─────────────────────────────────────────────────────────────"
    echo ""

    # Auto-detect GitHub repo
    local github_repo
    if github_repo=$(detect_github_repo); then
        log_success "Detected GitHub repo: ${github_repo}"
        read -rp "Use this repo? (Y/n): " use_detected
        use_detected=${use_detected:-Y}
        if [[ ! "${use_detected}" =~ ^[Yy]$ ]]; then
            read -rp "Enter GitHub repo (owner/repo): " github_repo
        fi
    else
        read -rp "Enter GitHub repo (owner/repo): " github_repo
    fi

    # Auto-detect GCP project
    local project_id
    if project_id=$(detect_gcp_project) && [[ -n "${project_id}" ]]; then
        log_success "Detected GCP project: ${project_id}"
        read -rp "Use this project? (Y/n): " use_detected
        use_detected=${use_detected:-Y}
        if [[ ! "${use_detected}" =~ ^[Yy]$ ]]; then
            read -rp "Enter GCP project ID: " project_id
        fi
    else
        read -rp "Enter GCP project ID: " project_id
    fi

    # Select region interactively
    local region
    region=$(select_gcp_region)
    log_success "Selected region: ${region}"

    # Collect application secrets (pass region for Supabase region mapping)
    collect_secrets "${region}"

    # Summary and confirmation
    echo ""
    echo "─────────────────────────────────────────────────────────────"
    echo "  Configuration Summary"
    echo "─────────────────────────────────────────────────────────────"
    echo ""
    echo "  GitHub Repo:    ${github_repo}"
    echo "  GCP Project:    ${project_id}"
    echo "  GCP Region:     ${region}"
    echo "  DATABASE_URL:   ${DATABASE_URL:0:30}..."
    echo "  BETTER_AUTH_URL: ${BETTER_AUTH_URL}"
    echo "  FRONTEND_URL:   ${FRONTEND_URL}"
    echo ""
    read -rp "Proceed with setup? (Y/n): " confirm
    confirm=${confirm:-Y}

    if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
        log_warn "Aborted"
        exit 0
    fi

    # Run setup
    setup_gcp "${project_id}" "${region}" "${github_repo}"
    setup_github_secrets "${github_repo}" "${project_id}" "${region}"

    # Verify
    echo ""
    read -rp "Run verification checks? (Y/n): " run_verify
    run_verify=${run_verify:-Y}

    if [[ "${run_verify}" =~ ^[Yy]$ ]]; then
        verify_setup "${project_id}" "${region}" "${github_repo}"
    fi

    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  Setup Complete!"
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "  Next steps:"
    echo "    1. Push changes to main branch to trigger deployment"
    echo "    2. Monitor the workflow: gh run watch"
    echo "    3. View deployment: gcloud run services describe athena-api --region=${region}"
    echo ""
    echo "  Useful commands:"
    echo "    - View logs: gcloud run services logs read athena-api --region=${region}"
    echo "    - Get URL: gcloud run services describe athena-api --region=${region} --format='value(status.url)'"
    echo ""
}

main "$@"
