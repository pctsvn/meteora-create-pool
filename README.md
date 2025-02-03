# Alpha vault sdk

An anti-bot vault for DLMM bootstrapping pools and Dynamic AMM pools that allows projects and their community to guard against mercenary sniper bots and secure a token allocation at the earliest (and likely lowest) price at launch!


#CREATE TOKEN 
Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

https://spl.solana.com/token

(Create Token and add metadata)


#CREATE POOL AND VAULT

step 1: npm i

step 2: cd ts-client

step 3: create .env file

PRIVATE_KEY=[...]

step 4: change token address in createDynamicPoolWithPermissionlessVault.ts

  const mintA = new PublicKey("Aw1d4RWJt6jzDPj622GHqsxGZ2PckL7kwv88VDDEwivL");
  const mintB = new PublicKey("So11111111111111111111111111111111111111112");

step 5: npm run build

step 6: npx ts-node src/examples/createDynamicPoolWithPermissionlessVault.ts
