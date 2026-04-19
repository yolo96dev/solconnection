import express from "express";
import {
  createIntentsQuote,
  getIntentsStatus,
  submitIntentsDepositTx,
} from "../lib/intents.js";
import {
  getExecutorAccount,
  getWrapNearBalance,
  unwrapWNear,
  enterJackpot,
} from "../lib/nearExecutor.js";

const router = express.Router();

export type IntentsQuoteRequest = {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  deadline: string;
};

export type IntentsQuoteResponse = {
  depositAddress?: string;
  amount?: string;
  amountIn?: string;
  amountOut?: string;
  expirationTime?: string;
  quoteHash?: string;
  timeEstimateSeconds?: number;
  deadline?: string;
  [key: string]: any;
};

export type IntentsDepositSubmitResponse = {
  ok?: boolean;
  [key: string]: any;
};

export type IntentsStatusResponse = {
  status:
    | "PENDING_DEPOSIT"
    | "KNOWN_DEPOSIT_TX"
    | "PROCESSING"
    | "SUCCESS"
    | "INCOMPLETE_DEPOSIT"
    | "REFUNDED"
    | "FAILED";
  [key: string]: any;
};

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(scope: string, payload?: unknown) {
  const ts = new Date().toISOString();
  if (payload === undefined) {
    console.log(`[${ts}] ${scope}`);
    return;
  }
  console.log(`[${ts}] ${scope}`, payload);
}

function extractReceivedAmountYoctoOrSmallestUnit(status: any): string | null {
  const candidates = [
    status?.destinationAmount,
    status?.amountOut,
    status?.outputAmount,
    status?.receivedAmount,
    status?.received_amount,
    status?.result?.destinationAmount,
    status?.result?.amountOut,
    status?.result?.outputAmount,
    status?.result?.receivedAmount,
    status?.swap?.destinationAmount,
    status?.swap?.amountOut,
    status?.swap?.outputAmount,
    status?.quote?.amountOut,
  ];

  for (const c of candidates) {
    const s = asString(c);
    if (s) return s;
  }

  return null;
}

function extractDepositAddress(quote: any): string {
  return (
    asString(quote?.depositAddress) ||
    asString(quote?.data?.depositAddress) ||
    asString(quote?.quote?.depositAddress) ||
    asString(quote?.execution?.depositAddress) ||
    asString(quote?.result?.depositAddress) ||
    ""
  );
}

router.post("/quote", async (req, res) => {
  try {
    const nearAccountId = asString(req.body?.nearAccountId);
    const solAddress = asString(req.body?.solAddress);
    const amount = asString(req.body?.amount);
    const slippageTolerance = Number(req.body?.slippageTolerance ?? 100);

    log("SOL BET QUOTE REQUEST", {
      nearAccountId,
      solAddress,
      amount,
      slippageTolerance,
    });

    if (!nearAccountId || !solAddress || !amount) {
      log("SOL BET QUOTE REJECTED_MISSING_FIELDS", {
        nearAccountId,
        solAddress,
        amount,
      });

      return res.status(400).json({
        error: "nearAccountId, solAddress, and amount are required",
      });
    }

    const originAsset = requiredEnv("INTENTS_ORIGIN_SOL_ASSET_ID");
    const destinationAsset = requiredEnv("INTENTS_DESTINATION_NEAR_ASSET_ID");
    const executorRecipient = requiredEnv("NEAR_EXECUTOR_ACCOUNT_ID");

    const deadlineMs = Date.now() + 10 * 60 * 1000;

    const payload: IntentsQuoteRequest = {
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance:
        Number.isFinite(slippageTolerance) && slippageTolerance > 0
          ? Math.trunc(slippageTolerance)
          : 100,
      originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset,
      amount,
      recipient: executorRecipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: solAddress,
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(deadlineMs).toISOString(),
    };

    log("SOL BET QUOTE PAYLOAD", payload);

    const quote = await createIntentsQuote(payload);
    const depositAddress = extractDepositAddress(quote);

    log("SOL BET QUOTE RESPONSE", {
      depositAddress,
      amountIn:
        asString((quote as any)?.amountIn) ||
        asString((quote as any)?.amount) ||
        amount,
      amountOut: asString((quote as any)?.amountOut) || null,
      expirationTime:
        asString((quote as any)?.expirationTime) ||
        asString((quote as any)?.deadline) ||
        payload.deadline,
      raw: quote,
    });

    if (!depositAddress) {
      log("INTENTS QUOTE MISSING DEPOSIT ADDRESS", {
        payload,
        quote,
      });

      return res.status(502).json({
        error: "Intents quote did not return an executable depositAddress",
        details: quote,
      });
    }

    return res.json({
      ok: true,
      quote: {
        depositAddress,
        expirationTime:
          asString((quote as any)?.expirationTime) ||
          asString((quote as any)?.deadline) ||
          payload.deadline,
        amountIn:
          asString((quote as any)?.amountIn) ||
          asString((quote as any)?.amount) ||
          amount,
        amountOut: asString((quote as any)?.amountOut) || null,
        executorRecipient,
        beneficiaryNearAccountId: nearAccountId,
        raw: quote,
      },
    });
  } catch (err: any) {
    console.error("SOL BET QUOTE ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to create Intents quote",
    });
  }
});

router.post("/deposit-submit", async (req, res) => {
  try {
    const depositAddress = asString(req.body?.depositAddress);
    const txHash = asString(req.body?.txHash);

    log("SOL BET DEPOSIT SUBMIT REQUEST", {
      depositAddress,
      txHash,
    });

    if (!depositAddress || !txHash) {
      log("SOL BET DEPOSIT SUBMIT REJECTED_MISSING_FIELDS", {
        depositAddress,
        txHash,
      });

      return res.status(400).json({
        error: "depositAddress and txHash are required",
      });
    }

    const result = await submitIntentsDepositTx({ depositAddress, txHash });

    log("SOL BET DEPOSIT SUBMIT RESPONSE", {
      depositAddress,
      txHash,
      result,
    });

    return res.json({
      ok: true,
      result,
    });
  } catch (err: any) {
    console.error("SOL BET DEPOSIT SUBMIT ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to submit deposit tx hash",
    });
  }
});

router.get("/status", async (req, res) => {
  try {
    const depositAddress = asString(req.query.depositAddress);

    log("SOL BET STATUS REQUEST", {
      depositAddress,
    });

    if (!depositAddress) {
      log("SOL BET STATUS REJECTED_MISSING_DEPOSIT_ADDRESS");
      return res.status(400).json({
        error: "depositAddress is required",
      });
    }

    const status = await getIntentsStatus(depositAddress);
    const receivedAmount = extractReceivedAmountYoctoOrSmallestUnit(status);

    log("SOL BET STATUS RESPONSE", {
      depositAddress,
      status: status?.status || null,
      receivedAmount,
      raw: status,
    });

    return res.json({
      ok: true,
      status: status?.status || null,
      receivedAmount,
      raw: status,
    });
  } catch (err: any) {
    console.error("SOL BET STATUS ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to load Intents status",
    });
  }
});

router.post("/finalize", async (req, res) => {
  try {
    const nearAccountId = asString(req.body?.nearAccountId);
    const entropyHex = asString(req.body?.entropyHex);
    const expectedNearYocto = asString(req.body?.expectedNearYocto);

    log("SOL BET FINALIZE REQUEST", {
      nearAccountId,
      entropyHex,
      expectedNearYocto,
      rawBody: req.body,
    });

    if (!nearAccountId || !entropyHex || !expectedNearYocto) {
      log("SOL BET FINALIZE REJECTED_MISSING_FIELDS", {
        nearAccountId,
        entropyHex,
        expectedNearYocto,
      });

      return res.status(400).json({
        error: "nearAccountId, entropyHex, and expectedNearYocto are required",
      });
    }

    const executor = await getExecutorAccount();

    log("SOL BET FINALIZE EXECUTOR_READY", {
      executorAccountId: executor?.accountId,
    });

    const needed = BigInt(expectedNearYocto);
    const wrapBalStr = await getWrapNearBalance(executor.accountId);
    const wrapBal = BigInt(wrapBalStr);

    log("SOL BET FINALIZE BALANCE_CHECK", {
      executorAccountId: executor.accountId,
      needed: needed.toString(),
      wrapBal: wrapBal.toString(),
      delta: (wrapBal - needed).toString(),
    });

    if (wrapBal <= 0n) {
      log("SOL BET FINALIZE REJECTED_NO_SETTLED_WRAP", {
        executorAccountId: executor.accountId,
        wrapBal: wrapBal.toString(),
        needed: needed.toString(),
      });

      return res.status(400).json({
        error: "Executor has no settled wNEAR yet. Wait a moment and try again.",
      });
    }

    const amountToUse = wrapBal < needed ? wrapBal : needed;

    log("SOL BET FINALIZE AMOUNT_SELECTED", {
      executorAccountId: executor.accountId,
      needed: needed.toString(),
      wrapBal: wrapBal.toString(),
      amountToUse: amountToUse.toString(),
      usingLessThanExpected: amountToUse !== needed,
    });

    if (amountToUse <= 0n) {
      log("SOL BET FINALIZE REJECTED_NO_USABLE_AMOUNT", {
        executorAccountId: executor.accountId,
        amountToUse: amountToUse.toString(),
      });

      return res.status(400).json({
        error: "No usable settled wNEAR available to finalize.",
      });
    }

    log("SOL BET FINALIZE UNWRAP_START", {
      executorAccountId: executor.accountId,
      amountToUse: amountToUse.toString(),
    });

    const unwrapTx: any = await unwrapWNear(amountToUse.toString());

    log("SOL BET FINALIZE UNWRAP_DONE", {
      executorAccountId: executor.accountId,
      amountToUse: amountToUse.toString(),
      unwrapTxHash:
        unwrapTx?.transaction_outcome?.id || unwrapTx?.transaction?.hash || null,
      unwrapRaw: unwrapTx,
    });

    await sleep(1200);

    log("SOL BET FINALIZE ENTER_START", {
      executorAccountId: executor.accountId,
      nearAccountId,
      entropyHex,
      amountToUse: amountToUse.toString(),
    });

    const tx: any = await enterJackpot({
      entropyHex,
      amountYocto: amountToUse.toString(),
    });

    const responseBody = {
      ok: true,
      executorAccountId: executor.accountId,
      beneficiaryNearAccountId: nearAccountId,
      expectedNearYocto,
      availableWrapYocto: wrapBal.toString(),
      enteredAmountYocto: amountToUse.toString(),
      txHash: tx?.transaction_outcome?.id || tx?.transaction?.hash || null,
    };

    log("SOL BET FINALIZE SUCCESS", {
      ...responseBody,
      enterRaw: tx,
    });

    return res.json(responseBody);
  } catch (err: any) {
    console.error("SOL BET FINALIZE ERROR:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });
    return res.status(500).json({
      error: err?.message || "Failed to finalize SOL bet",
    });
  }
});

export default router;
