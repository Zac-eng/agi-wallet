import { ethers } from 'ethers';
import { getWallet } from '../src/wallet/wallet.js';
import { signTransferWithAuthorization, verifyTransferWithAuthorization, buildDomain } from '../src/wallet/eip3009.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  const wallet = getWallet();
  const network = await wallet.getNetwork();
  const name = await wallet.getName();
  const version = await wallet.getVersion();
  const decimals = await wallet.getDecimals();

  console.log('Contract Info:');
  console.log(' - Name:', name);
  console.log(' - Version:', version);
  console.log(' - ChainId:', network.chainId.toString());

  const to = '0x1234567890123456789012345678901234567890';
  const value = ethers.parseUnits('1.0', decimals);

  console.log('\nSigning 1.0 USDC...');
  const signed = await signTransferWithAuthorization(wallet.signer, {
    contractAddress: wallet.usdcAddress,
    chainId: network.chainId,
    to,
    value,
    contractName: name,
    contractVersion: version,
  });

  console.log('Signature generated.');

  console.log('\nVerifying signature locally...');
  const domain = buildDomain(wallet.usdcAddress, network.chainId, name, version);
  const recovered = verifyTransferWithAuthorization(signed.authorization, signed.signature, domain);

  if (recovered.toLowerCase() === wallet.signer.address.toLowerCase()) {
    console.log('✅ Local verification SUCCESS');
  } else {
    console.error('❌ Local verification FAILED');
    console.error('Expected:', wallet.signer.address);
    console.error('Recovered:', recovered);
    process.exit(1);
  }

  console.log('\nEstimating gas on-chain (to verify contract acceptance)...');
  try {
    const { from, to: dest, value: val, validAfter, validBefore, nonce } = signed.authorization;
    const { v, r, s } = signed.signature;

    const gas = await wallet.usdc.transferWithAuthorization.estimateGas(
      from, dest, val, validAfter, validBefore, nonce, v, r, s
    );
    console.log('✅ On-chain gas estimation SUCCESS. Gas units:', gas.toString());
  } catch (e) {
    console.error('❌ On-chain gas estimation FAILED');
    console.error('Reason:', e.message);
    if (e.data) console.error('Data:', e.data);
    process.exit(1);
  }

  console.log('\nVerification complete!');
}

test().catch(console.error);
