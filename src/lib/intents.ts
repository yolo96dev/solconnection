import type {
  IntentsQuoteRequest,
  IntentsQuoteResponse,
  IntentsStatusResponse,
  IntentsDepositSubmitResponse,
} from "../routes/sol-bet.js";

const INTENTS_BASE_URL =
  process.env.INTENTS_BASE_URL?.trim() || "https://1click.chaindefuser.com/v0";

const INTENTS_JWT = process.env.INTENTS_JWT?.trim() || "";

function buildHeaders(extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(extra || {}),
  };

  if (INTENTS_JWT) {
    headers.Authorization = `Bearer ${INTENTS_JWT}`;
  }

  return headers;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text().catch(() => "");
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg =
      json?.error ||
      json?.message ||
      text ||
      `Intents request failed (${res.status})`;
    throw new Error(String(msg));
  }

  return json as T;
}

export async function createIntentsQuote(
  payload: IntentsQuoteRequest
): Promise<IntentsQuoteResponse> {
  const res = await fetch(`${INTENTS_BASE_URL}/quote`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });

  return parseJson<IntentsQuoteResponse>(res);
}

export async function submitIntentsDepositTx(params: {
  depositAddress: string;
  txHash: string;
}): Promise<IntentsDepositSubmitResponse> {
  const res = await fetch(`${INTENTS_BASE_URL}/deposit/submit`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      depositAddress: params.depositAddress,
      txHash: params.txHash,
    }),
  });

  return parseJson<IntentsDepositSubmitResponse>(res);
}

export async function getIntentsStatus(
  depositAddress: string
): Promise<IntentsStatusResponse> {
  const url = new URL(`${INTENTS_BASE_URL}/status`);
  url.searchParams.set("depositAddress", depositAddress);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders({ Accept: "application/json" }),
  });

  return parseJson<IntentsStatusResponse>(res);
}