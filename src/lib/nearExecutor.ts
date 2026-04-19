import { Account } from "@near-js/accounts";
import { KeyPairSigner } from "@near-js/signers";
import { JsonRpcProvider } from "@near-js/providers";
import { actionCreators } from "@near-js/transactions";

const NEAR_NODE_URL =
  process.env.NEAR_NODE_URL?.trim() || "https://rpc.mainnet.near.org";
const NEAR_EXECUTOR_ACCOUNT_ID =
  process.env.NEAR_EXECUTOR_ACCOUNT_ID?.trim() || "";

const JACKPOT_CONTRACT_ID =
  process.env.JACKPOT_CONTRACT_ID?.trim() || "dripzjp.near";

const NEAR_EXECUTOR_PRIVATE_KEY =
  process.env.NEAR_EXECUTOR_PRIVATE_KEY?.trim() || "";

type ExecutorAccount = Account & { accountId: string };

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

  const provider = new JsonRpcProvider({ url: NEAR_NODE_URL });
  const signer = KeyPairSigner.fromSecretKey(privateKey as any);

  const account = new Account(accountId, provider, signer) as ExecutorAccount;
  cachedAccount = account;
  return cachedAccount;
}

export async function getNativeNearBalance(accountId?: string): Promise<string> {
  const executor = await getExecutorAccount();
  const target = accountId || String(executor.accountId || "");

  const raw: any = await executor.provider.query({
    request_type: "view_account",
    finality: "optimistic",
    account_id: target,
  });

  return String(raw?.amount || "0");
}

async function callContract(params: {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  attachedDeposit: string;
}) {
  const executor = await getExecutorAccount();

  return executor.signAndSendTransaction({
    receiverId: params.contractId,
    actions: [
      actionCreators.functionCall(
        params.methodName,
        Buffer.from(JSON.stringify(params.args)),
        BigInt(params.gas),
        BigInt(params.attachedDeposit)
      ),
    ],
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
