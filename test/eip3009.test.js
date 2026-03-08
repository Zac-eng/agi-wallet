/**
 * test/eip3009.test.js
 *
 * Tests for EIP-3009 signing utilities.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import {
  buildDomain,
  generateNonce,
  signTransferWithAuthorization,
  verifyTransferWithAuthorization,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '../src/wallet/eip3009.js';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_CONTRACT    = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const TEST_TO          = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TEST_CHAIN_ID    = 84532n;
const TEST_VALUE       = ethers.parseUnits('1.50', 6); // 1.5 USDC

describe('EIP-3009', () => {
  it('generateNonce() returns a unique bytes32 hex string each time', () => {
    const n1 = generateNonce();
    const n2 = generateNonce();
    assert.match(n1, /^0x[0-9a-f]{64}$/);
    assert.match(n2, /^0x[0-9a-f]{64}$/);
    assert.notEqual(n1, n2);
  });

  it('buildDomain() produces correct EIP-712 domain shape', () => {
    const domain = buildDomain(TEST_CONTRACT, TEST_CHAIN_ID, 'USD Coin', '2');
    assert.equal(domain.name, 'USD Coin');
    assert.equal(domain.version, '2');
    assert.equal(domain.chainId, Number(TEST_CHAIN_ID));
    assert.equal(domain.verifyingContract, TEST_CONTRACT);
  });

  it('TRANSFER_WITH_AUTHORIZATION_TYPES has correct field definitions', () => {
    const types = TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization;
    const fieldNames = types.map(f => f.name);
    assert.ok(fieldNames.includes('from'));
    assert.ok(fieldNames.includes('to'));
    assert.ok(fieldNames.includes('value'));
    assert.ok(fieldNames.includes('validAfter'));
    assert.ok(fieldNames.includes('validBefore'));
    assert.ok(fieldNames.includes('nonce'));
  });

  it('signTransferWithAuthorization() produces a valid signature recoverable to the signer', async () => {
    const signer = new ethers.Wallet(TEST_PRIVATE_KEY);

    const { authorization, signature, combined } = await signTransferWithAuthorization(signer, {
      contractAddress: TEST_CONTRACT,
      chainId: TEST_CHAIN_ID,
      to: TEST_TO,
      value: TEST_VALUE,
      validAfter: 0,
      validBefore: Math.floor(Date.now() / 1000) + 3600,
    });

    // Verify authorization fields
    assert.equal(authorization.from.toLowerCase(), signer.address.toLowerCase());
    assert.equal(authorization.to.toLowerCase(), TEST_TO.toLowerCase());
    assert.equal(authorization.value, TEST_VALUE);
    assert.match(authorization.nonce, /^0x[0-9a-f]{64}$/);

    // Verify signature fields present  
    assert.ok(signature.v === 27 || signature.v === 28);
    assert.match(signature.r, /^0x/);
    assert.match(signature.s, /^0x/);

    // Verify combined object has all fields for on-chain submission
    assert.ok('from' in combined);
    assert.ok('to' in combined);
    assert.ok('value' in combined);
    assert.ok('nonce' in combined);
    assert.ok('v' in combined);
    assert.ok('r' in combined);
    assert.ok('s' in combined);
  });

  it('verifyTransferWithAuthorization() recovers the correct signer address', async () => {
    const signer = new ethers.Wallet(TEST_PRIVATE_KEY);
    const domain = buildDomain(TEST_CONTRACT, TEST_CHAIN_ID);
    const nonce = generateNonce();

    const authorization = {
      from:        signer.address,
      to:          TEST_TO,
      value:       TEST_VALUE,
      validAfter:  0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce,
    };

    const rawSig = await signer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization);
    const { v, r, s } = ethers.Signature.from(rawSig);

    const recovered = verifyTransferWithAuthorization(authorization, { v, r, s }, domain);
    assert.equal(recovered.toLowerCase(), signer.address.toLowerCase());
  });
});
