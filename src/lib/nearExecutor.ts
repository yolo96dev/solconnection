import * as nearAPI from "near-api-js";

const NEAR_NETWORK_ID = process.env.NEAR_NETWORK_ID?.trim() || "mainnet";
const NEAR_NODE_URL =
  process.env.NEAR_NODE_URL?.trim() || "https://rpc.mainnet.near.org";
const NEAR_EXECUTOR_ACCOUNT_ID =
  process.env.NEAR_EXECUTOR_ACCOUNT_ID?.trim() || "";
const NEAR_EXECUTOR_PRIVATE_KEY =
  process.env.NEAR_EXECUTOR_PRIVATE_KEY?.trim() || "";

const WRAP_NEAR_CONTRACT_ID =
  process.env.WRAP_NEAR_CONTRACT_ID?.trim() || "wrap.near";

const JACKPOT_CONTRACT_ID =
  process.env.JACKPOT_CONTRACT_ID?.trim() || "dripzjp.near";

type ExecutorAccount = any;

let cachedAccount: ExecutorAccount | null = null;

function required(name: string, value: string) {
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export async function getExecutorAccount(): Promise<ExecutorAccount> {
  if (cachedAccount) return cachedAccount;

  const accountId = required(
    "NEAR_EXECUTOR_ACCOUNT_ID",
    NEAR_EXECUTOR_ACCOUNT_ID
  );
  const privateKey = required(
    "NEAR_EXECUTOR_PRIVATE_KEY",
    NEAR_EXECUTOR_PRIVATE_KEY
  );

  const keyStores: any = (nearAPI as any).keyStores;
  const KeyPair: any = (nearAPI as any).KeyPair;
  const connectFn: any =
    (nearAPI as any).connect || (nearAPI as any).default?.connect;

  if (!keyStores?.InMemoryKeyStore) {
    throw new Error("near-api-js keyStores.InMemoryKeyStore is unavailable");
  }

  if (!KeyPair?.fromString) {
    throw new Error("near-api-js KeyPair.fromString is unavailable");
  }

  if (!connectFn) {
    throw new Error("near-api-js connect() is unavailable");
  }

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(privateKey as any);

  await keyStore.setKey(NEAR_NETWORK_ID, accountId, keyPair);

  const near = await connectFn({
    networkId: NEAR_NETWORK_ID,
    nodeUrl: NEAR_NODE_URL,
    keyStore,
    headers: {},
  });

  cachedAccount = await near.account(accountId);
  return cachedAccount!;
}

export async function getWrapNearBalance(
  accountId?: string
): Promise<string> {
  const executor = await getExecutorAccount();
  const target = accountId || String(executor.accountId || "");

  let result: any;

  if (typeof executor.viewFunction === "function") {
    result = await executor.viewFunction({
      contractId: WRAP_NEAR_CONTRACT_ID,
      methodName: "ft_balance_of",
      args: {
        account_id: target,
      },
    });
  } else {
    const provider = executor.connection?.provider;
    if (!provider?.query) {
      throw new Error("Executor account has no usable viewFunction/provider.query");
    }

    const raw = await provider.query({
      request_type: "call_function",
      finality: "optimistic",
      account_id: WRAP_NEAR_CONTRACT_ID,
      method_name: "ft_balance_of",
      args_base64: Buffer.from(
        JSON.stringify({ account_id: target }),
        "utf8"
      ).toString("base64"),
    });

    const bytes = Array.isArray(raw?.result)
      ? Buffer.from(raw.result)
      : Buffer.from([]);
    const text = bytes.toString("utf8");
    result = text ? JSON.parse(text) : "0";
  }

  return String(result || "0");
}

async function callContract(params: {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  attachedDeposit: string;
}) {
  const executor = await getExecutorAccount();

  if (typeof executor.functionCall === "function") {
    return executor.functionCall({
      contractId: params.contractId,
      methodName: params.methodName,
      args: params.args,
      gas: BigInt(params.gas),
      attachedDeposit: BigInt(params.attachedDeposit),
    });
  }

  if (typeof executor.signAndSendTransaction === "function") {
    const txns: any = (nearAPI as any).transactions;

    if (!txns?.functionCall) {
      throw new Error(
        "Executor has no functionCall, and near-api-js transactions.functionCall is unavailable"
      );
    }

    return executor.signAndSendTransaction({
      receiverId: params.contractId,
      actions: [
        txns.functionCall(
          params.methodName,
          Buffer.from(JSON.stringify(params.args)),
          BigInt(params.gas),
          BigInt(params.attachedDeposit)
        ),
      ],
    });
  }

  throw new Error(
    "Executor account has neither functionCall nor signAndSendTransaction"
  );
}

export async function unwrapWNear(amountYocto: string) {
  return callContract({
    contractId: WRAP_NEAR_CONTRACT_ID,
    methodName: "near_withdraw",
    args: {
      amount: String(amountYocto),
    },
    gas: "100000000000000",
    attachedDeposit: "1",
  });
}

export async function enterJackpot(params: {
  entropyHex: string;
  amountYocto: string;
}) {
  return callContract({
    contractId: JACKPOT_CONTRACT_ID,
    methodName: "enter",
    args: {
      entropy_hex: params.entropyHex,
    },
    gas: "200000000000000",
    attachedDeposit: String(params.amountYocto),
  });
}