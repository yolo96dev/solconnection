import express from "express";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function verifyPhantomSignature(params: {
  solAddress: string;
  signedMessage: string;
  signatureBase64: string;
}) {
  try {
    const publicKey = bs58.decode(params.solAddress);
    const message = new TextEncoder().encode(params.signedMessage);
    const signature = Uint8Array.from(Buffer.from(params.signatureBase64, "base64"));

    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

router.get("/", async (req, res) => {
  try {
    const nearAccountId = String(req.query.near_account_id || "").trim();

    if (!nearAccountId) {
      return res.status(400).json({ error: "near_account_id is required" });
    }

    const { data, error } = await supabase
      .from("sol_wallet_links")
      .select("sol_address")
      .eq("near_account_id", nearAccountId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "No linked wallet found" });
    }

    return res.json({ sol_address: data.sol_address });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const nearAccountId = String(req.body?.near_account_id || "").trim();
    const solAddress = String(req.body?.sol_address || "").trim();
    const signedMessage = String(req.body?.signed_message || "");
    const signatureBase64 = String(req.body?.signature_base64 || "");
    const nonce = String(req.body?.nonce || "").trim();

    if (!nearAccountId || !solAddress || !signedMessage || !signatureBase64 || !nonce) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!signedMessage.includes(`NEAR account: ${nearAccountId}`)) {
      return res.status(400).json({ error: "Signed message does not match NEAR account" });
    }

    if (!signedMessage.includes(`Solana wallet: ${solAddress}`)) {
      return res.status(400).json({ error: "Signed message does not match Solana wallet" });
    }

    if (!signedMessage.includes(`Nonce: ${nonce}`)) {
      return res.status(400).json({ error: "Signed message does not match nonce" });
    }

    const ok = verifyPhantomSignature({
      solAddress,
      signedMessage,
      signatureBase64,
    });

    if (!ok) {
      return res.status(401).json({ error: "Invalid Solana signature" });
    }

    const { data: existingWallet, error: existingWalletError } = await supabase
      .from("sol_wallet_links")
      .select("near_account_id, is_active")
      .eq("sol_address", solAddress)
      .eq("is_active", true)
      .maybeSingle();

    if (existingWalletError) {
      return res.status(500).json({ error: existingWalletError.message });
    }

    if (existingWallet && existingWallet.near_account_id !== nearAccountId) {
      return res.status(409).json({
        error: "This Solana wallet is already linked to another NEAR account",
      });
    }

    const { error } = await supabase
      .from("sol_wallet_links")
      .upsert(
        {
          near_account_id: nearAccountId,
          sol_address: solAddress,
          is_active: true,
          signed_message: signedMessage,
          signature_base64: signatureBase64,
          nonce,
          linked_at: new Date().toISOString(),
          unlinked_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "near_account_id" }
      );

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, sol_address: solAddress });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

router.delete("/", async (req, res) => {
  try {
    const nearAccountId = String(req.body?.near_account_id || "").trim();

    if (!nearAccountId) {
      return res.status(400).json({ error: "near_account_id is required" });
    }

    const { error } = await supabase
      .from("sol_wallet_links")
      .update({
        is_active: false,
        unlinked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("near_account_id", nearAccountId)
      .eq("is_active", true);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

export default router;