import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import AlphaVault, { DYNAMIC_AMM_PROGRAM_ID, PoolType, VaultMode } from "..";
import DynamicAmm from "@mercurial-finance/dynamic-amm-sdk";
import {
  ActivationType,
  Clock,
  ClockLayout,
  createDummyMints,
  createTokenAndMint,
  loadKeypairFromFile,
} from "./utils";
import dotenv from "dotenv";
import { BN } from "bn.js";
import { derivePoolAddressWithConfig } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils";

dotenv.config();

/**
 *
 * @param connection
 * @param creator
 * @param activationType Pool activation based on time or slot
 * @param maximumActivationDuration Maximum duration for pool to be activation after creation
 * @param minimumLockDuration Minimum duration for bought token be locked
 * @param maximumLockDuration Maximum duration for bought token to be locked
 * @param minimumVestingDuration Minimum duration for bought token to be vested
 * @param maximumVestingDuration Maximum duration for bought token be vested
 * @param vaultMode Vault mode: fcfs or prorata
 */
async function getPoolConfigByRequirement(
  connection: Connection,
  creator: PublicKey,
  activationType: ActivationType,
  maximumActivationDuration: number,
  minimumLockDuration: number,
  maximumLockDuration: number,
  minimumVestingDuration: number,
  maximumVestingDuration: number,
  vaultMode: VaultMode
) {
  // 1. Pool configs that can be used by anyone to create pool
  const publicPoolConfigs = await DynamicAmm.getPoolConfigsWithPoolCreatorAuthority(
    connection,
    PublicKey.default
  );

  // 2. Pool configs that can only be used by specific pubkey to create pool
  const creatorPoolConfigs = await DynamicAmm.getPoolConfigsWithPoolCreatorAuthority(
    connection,
    creator
  );

  // 3. Look for pool configs that have vault support
  const poolConfigsWithVaultSupport = [
    ...publicPoolConfigs,
    ...creatorPoolConfigs,
  ].filter((config) => config.account.vaultConfigKey != PublicKey.default);

  console.log(
    `Gotten ${poolConfigsWithVaultSupport.length} usable pool configs with vault support`
  );

  const configFuture =
    vaultMode === VaultMode.FCFS
      ? AlphaVault.getFcfsConfigs(connection)
      : AlphaVault.getProrataConfigs(connection);

  const configs = await configFuture;

  for (const programAccount of poolConfigsWithVaultSupport) {
    const { account } = programAccount;
    // 3.1 Pool activation type and duration matches
    if (
      account.activationType == activationType &&
      account.activationDuration.toNumber() >= maximumActivationDuration
    ) {
      const vaultConfig = configs.find((c) =>
        c.publicKey.equals(account.vaultConfigKey)
      );

      if (!vaultConfig) {
        continue;
      }

      const startVestingDuration =
        vaultConfig.account.startVestingDuration.toNumber();
      const endVestingDuration =
        vaultConfig.account.endVestingDuration.toNumber();

      const vestingDuration = endVestingDuration - startVestingDuration;

      // 3.2 Vault activation type, lock and vesting duration matches
      if (
        startVestingDuration >= minimumLockDuration &&
        startVestingDuration <= maximumLockDuration &&
        vestingDuration >= minimumVestingDuration &&
        vestingDuration <= maximumVestingDuration &&
        vaultConfig.account.activationType == activationType
      ) {
        return programAccount;
      }
    }
  }

  return null;
}

async function createDynamicPoolWithPermissionlessVault(
  connection: Connection,
  payer: Keypair
) {
  // Thêm code kiểm tra token program
  const mintInfo = await connection.getAccountInfo(new PublicKey("preLJBCVzf3bDoRFNcR4Xuxxerrb3zVN6uh5KapYchA"));
  console.log("Token Program ID:", mintInfo.owner.toBase58());

  // Token addresses
  const mintA = new PublicKey("Aw1d4RWJt6jzDPj622GHqsxGZ2PckL7kwv88VDDEwivL");
  const mintB = new PublicKey("So11111111111111111111111111111111111111112");

  // Pool và vault requirement
  const maximumActivationDuration = 86400; // 1 day
  const minimumLockDuration = 60 * 30; // 30 minutes
  const maximumLockDuration = 86400; // 1 day
  const minimumVestingDuration = 60 * 60; // 1 hour
  const maximumVestingDuration = 60 * 60 * 24 * 7; // 1 week
  const vaultMode = VaultMode.PRORATA;

  // Thêm log để debug
  console.log("Getting pool configs...");
  const poolConfig = await getPoolConfigByRequirement(
    connection,
    payer.publicKey,
    ActivationType.Timestamp,
    maximumActivationDuration,
    minimumLockDuration,
    maximumLockDuration,
    minimumVestingDuration,
    maximumVestingDuration,
    vaultMode
  );

  console.log("Got pool config");
  console.log(poolConfig);

  const clockAccount = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  const clock: Clock = ClockLayout.decode(clockAccount.data);

  // Pool start trade after created for 5 hour
  const activationPoint = clock.unixTimestamp.add(new BN(3600 * 5));

  // 2. Create the pool
  const transactions =
    await DynamicAmm.createPermissionlessConstantProductPoolWithConfig2(
      connection,
      payer.publicKey,
      mintA,
      mintB,
      new BN(1_000_000_000_000_000),
      new BN(10_000_000),
      poolConfig.publicKey,
      {
        activationPoint,
      }
    );

  console.log("Creating pool");
  for (const tx of transactions) {
    const txHash = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(txHash);
  }

  const poolPubkey = derivePoolAddressWithConfig(
    mintA,
    mintB,
    poolConfig.publicKey,
    DYNAMIC_AMM_PROGRAM_ID
  );

  console.log("Pool created", poolPubkey.toBase58());

  // 3. Create the alpha vault
  const initPermissionlessVaultTx = await AlphaVault.createPermissionlessVault(
    connection,
    {
      baseMint: mintA,
      quoteMint: mintB,
      poolType: PoolType.DYNAMIC,
      vaultMode: VaultMode.PRORATA,
      poolAddress: poolPubkey,
      config: poolConfig.account.vaultConfigKey,
    },
    payer.publicKey
  );

  console.log("Creating vault");
  const txHash = await sendAndConfirmTransaction(
    connection,
    initPermissionlessVaultTx,
    [payer]
  );
  console.log(txHash);
}

// Thay đổi connection để sử dụng API key từ env
const connection = new Connection(
  `https://solemn-capable-arrow.solana-mainnet.quiknode.pro/f97e35ad5c276d311c3d97b32cd70acbd60c442e`
);
const payerPrivateKey = process.env.PRIVATE_KEY;
if (!payerPrivateKey) {
  throw new Error("Missing PRIVATE_KEY in environment variables");
}
const payer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(payerPrivateKey))
);

// Log program ID để kiểm tra
console.log("SDK version:", require("@mercurial-finance/dynamic-amm-sdk/package.json").version);
console.log("Using program ID:", DYNAMIC_AMM_PROGRAM_ID.toBase58());

/**
 * This example shows how to create dynamic pool with permissionless vault
 * Please contact meteora team if the existing pool and vault config doesn't meet the requirement
 * Currently only dynamic pool support permissionless vault
 */
createDynamicPoolWithPermissionlessVault(connection, payer)
  .then(() => {
    console.log("Done");
  })
  .catch(console.error);
