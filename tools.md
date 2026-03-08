# AGI Wallet - Tools & Technologies

This document enumerates the tools, libraries, and protocols used in the AGI Wallet application.

## Core Stack
- **Node.js** (>=18.0.0): The JavaScript runtime environment.
- **Express.js**: The web framework used for the REST API.
- **ethers.js** (v6): Library for interacting with the Ethereum blockchain (Base network).
- **SQLite**: Lightweight database used for the transaction ledger (implemented via `Better-SQLite3` or similar via `src/api/db`).

## Blockchain & Payments
- **Base Network**: Ethereum Layer 2 where the USDC transactions occur.
- **USDC (ERC-20)**: The stablecoin used for payments.
- **EIP-3009**: The protocol used for "Transfer with Authorization," enabling gasless (meta) transactions for the agent.
- **EIP-712**: Typed structured data hashing and signing, used for secure off-chain authorizations.

## Dependencies (npm)
- `cors`: Middleware to enable Cross-Origin Resource Sharing.
- `dotenv`: Loads environment variables from a `.env` file.
- `uuid`: Generates unique transaction IDs.
- `ws`: WebSocket library for live dashboard updates.

## Development & Demo Tools
- **curl**: Command-line tool for making HTTP requests (used in `api-demo.sh`).
- **jq**: Command-line JSON processor (recommended for `api-demo.sh` output formatting).
- **Node Test Runner**: Built-in `node --test` for running unit tests.
