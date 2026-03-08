import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.BASE_RPC_URL || 'https://sepolia.base.org';
const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const abi = [
    'function name() view returns (string)',
    'function version() view returns (string)',
    'function DOMAIN_SEPARATOR() view returns (bytes32)',
  ];
  const contract = new ethers.Contract(USDC_ADDRESS, abi, provider);

  console.log('Querying USDC at:', USDC_ADDRESS);
  console.log('RPC URL:', RPC_URL);

  try {
    const name = await contract.name();
    console.log('Contract Name:', name);
  } catch (e) {
    console.log('Could not get name:', e.message);
  }

  try {
    const version = await contract.version();
    console.log('Contract Version:', version);
  } catch (e) {
    console.log('Could not get version:', e.message);
  }

  try {
    const domainSeparator = await contract.DOMAIN_SEPARATOR();
    console.log('Domain Separator:', domainSeparator);
  } catch (e) {
    console.log('Could not get DOMAIN_SEPARATOR:', e.message);
  }

  const network = await provider.getNetwork();
  console.log('Chain ID:', network.chainId.toString());
}

main().catch(console.error);
