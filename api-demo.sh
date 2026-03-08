#!/bin/bash

# AGI Wallet API Demo Script
# This script demonstrates how to call the various endpoints of the AGI Wallet API.
# It uses 'curl' for requests and 'jq' for JSON parsing (if available).

# Configuration
BASE_URL=${BASE_URL:-"http://localhost:3000"}
# Load API key from .env if it exists and API_KEY is not set
if [ -z "$API_KEY" ] && [ -f ".env" ]; then
    API_KEY=$(grep AGI_API_KEY .env | cut -d '=' -f2)
fi

if [ -z "$API_KEY" ]; then
    echo "Error: API_KEY environment variable is not set and not found in .env"
    exit 1
fi

echo "Using BASE_URL: $BASE_URL"
echo "---"

# Helper for printing headers
function section() {
    echo ""
    echo "======================================"
    echo "$1"
    echo "======================================"
}

# 1. Wallet Information
section "1. Wallet Information"

echo "GET /v1/wallet/address"
curl -s -X GET "$BASE_URL/v1/wallet/address" -H "Authorization: Bearer $API_KEY" | jq .

echo -e "\nGET /v1/wallet/balance"
curl -s -X GET "$BASE_URL/v1/wallet/balance" -H "Authorization: Bearer $API_KEY" | jq .

echo -e "\nGET /v1/wallet/network"
curl -s -X GET "$BASE_URL/v1/wallet/network" -H "Authorization: Bearer $API_KEY" | jq .

echo -e "\nGET /v1/wallet/limits"
curl -s -X GET "$BASE_URL/v1/wallet/limits" -H "Authorization: Bearer $API_KEY" | jq .

# 2. Payments (Charge)
section "2. Payments: Charge (Authorize + Capture)"

echo "POST /v1/charge"
CHARGE_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/charge" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1.0, "merchant": "0x1234567890123456789012345678901234567890", "description": "Demo Charge"}')

echo "$CHARGE_RESPONSE" | jq .

# 3. Payments (Authorize and Capture)
section "3. Payments: Authorize and then Capture"

echo "POST /v1/authorize"
AUTH_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/authorize" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 0.5, "merchant": "0x1234567890123456789012345678901234567890", "description": "Demo Auth"}')

echo "$AUTH_RESPONSE" | jq .

AUTH_ID=$(echo "$AUTH_RESPONSE" | jq -r '.id')

if [ "$AUTH_ID" != "null" ]; then
    echo -e "\nPOST /v1/capture/$AUTH_ID"
    curl -s -X POST "$BASE_URL/v1/capture/$AUTH_ID" \
      -H "Authorization: Bearer $API_KEY" | jq .
else
    echo "Skipping capture: Authorization failed."
fi

# 4. Refund
section "4. Refund"

echo "POST /v1/refund"
curl -s -X POST "$BASE_URL/v1/refund" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 0.2, "merchant": "0x1234567890123456789012345678901234567890", "description": "Demo Refund"}' | jq .

# 5. Transaction History
section "5. Transaction History"

echo "GET /v1/transactions"
curl -s -X GET "$BASE_URL/v1/transactions?limit=5" -H "Authorization: Bearer $API_KEY" | jq .

echo -e "\nDone."
