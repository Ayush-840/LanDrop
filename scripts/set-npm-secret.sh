#!/usr/bin/env bash
# set-npm-secret.sh — store the npm publish token as the NPM_TOKEN GitHub
# Actions secret so the tag-triggered publish.yml workflow can auto-publish.
#
# The token is encrypted with the repository's public key (libsodium sealed
# box) exactly as GitHub requires. It is never echoed, logged, or written
# to disk; it travels only inside this script's memory.
#
# Usage:
#   scripts/set-npm-secret.sh                  # prompts for the token
#   scripts/set-npm-secret.sh npm_xxxxxxxx     # or pass it as argv[1]
#
# Requires: git (for credentials), curl, node, and a temp npm install of
# tweetnacl-sealedbox-js (fetched into a throwaway dir, not the project).

set -euo pipefail

REPO="${REPO:-Ayush-840/LanDrop}"
SECRET_NAME="${SECRET_NAME:-NPM_TOKEN}"

say() { printf '%s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

# --- gather the npm token ------------------------------------------------
TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  printf 'Paste the npm granular token (input hidden): '
  stty -echo 2>/dev/null || true
  IFS= read -r TOKEN
  stty echo 2>/dev/null || true
  printf '\n'
fi
[ -n "$TOKEN" ] || die "no token provided"
case "$TOKEN" in
  npm_*) : ;;
  *) die "token should start with npm_ — generate one at npmjs.com → Access Tokens → Granular (with 'bypass 2FA for API and CI')" ;;
esac

# --- git credential for the GitHub API -----------------------------------
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2-)
[ -n "$GH_TOKEN" ] || die "no stored GitHub credential (run: git push, then retry)"
auth() { curl -sS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

# --- 1. fetch the repo's actions public key ------------------------------
say "→ fetching repo public key…"
KEY_JSON=$(auth "https://api.github.com/repos/${REPO}/actions/secrets/public-key")
KEY_ID=$(printf '%s' "$KEY_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(!j.key_id)process.exit(1);console.log(j.key_id)})') \
  || die "cannot fetch public key — check that the credential can access ${REPO}"
PUBKEY=$(printf '%s' "$KEY_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).key))')
say "  key_id: ${KEY_ID}"

# --- 2. seal the token (libsodium sealed box, base64 in/out) --------------
say "→ encrypting token with sealed box…"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
npm install --prefix "$WORK" --silent --no-fund --no-audit tweetnacl-sealedbox-js@1.2.0 >/dev/null 2>&1 \
  || die "could not fetch tweetnacl-sealedbox-js"
NACL="$WORK/node_modules/tweetnacl-sealedbox-js"
[ -d "$NACL" ] || die "tweetnacl-sealedbox-js not found in $WORK after install"

SEAL_JSON=$(NACL_DIR="$NACL" KEY_ID="$KEY_ID" node - "$PUBKEY" "$TOKEN" <<'EOF'
const nacl = require(process.env.NACL_DIR);
const [pubkeyB64, secret] = process.argv.slice(2);
const key = Buffer.from(pubkeyB64, "base64");
const sealed = nacl.seal(
  Buffer.from(secret, "utf8"),
  new Uint8Array(key.buffer, key.byteOffset, key.byteLength),
);
console.log(JSON.stringify({
  encrypted_value: Buffer.from(sealed).toString("base64"),
  key_id: process.env.KEY_ID,
}));
EOF
)
[ -n "$SEAL_JSON" ] || die "encryption failed"

# --- 3. PUT the secret ----------------------------------------------------
say "→ uploading secret ${SECRET_NAME}…"
RESPONSE=$(printf '%s' "$SEAL_JSON" | curl -sS -w '\n%{http_code}' -X PUT \
  -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "https://api.github.com/repos/${REPO}/actions/secrets/${SECRET_NAME}")
STATUS=$(printf '%s' "$RESPONSE" | tail -1)
[ "$STATUS" = "201" ] || [ "$STATUS" = "204" ] || {
  say "GitHub response (HTTP $STATUS):"
  printf '%s\n' "$RESPONSE" | head -5 >&2
  die "secret upload failed"
}

say "✓ ${SECRET_NAME} stored on ${REPO}"
say ""
say "Verify:  https://github.com/${REPO}/settings/secrets/actions"
say "Test:    git tag v9.9.9-test && git push origin v9.9.9-test"
say "         (Publish workflow will build, test, publish, then fail at the"
say "          GitHub Release step unless chunkkit/CHANGELOG.md path matches —"
say "          the npm publish itself is the 4th step, so watch its log.)"
say "Cleanup: git push origin :refs/tags/v9.9.9-test && git tag -d v9.9.9-test"
