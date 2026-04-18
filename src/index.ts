import "dotenv/config";
import express from "express";
import cors from "cors";
import solWalletLinkRouter from "./routes/sol-wallet-link.js";
import solBetRouter from "./routes/sol-bet.js";

const app = express();

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN?.split(",").map((s) => s.trim()) || true,
    credentials: false,
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/sol-wallet-link", solWalletLinkRouter);
app.use("/api/sol-bet", solBetRouter);

const port = Number(process.env.PORT || 3001);

app.listen(port, () => {
  console.log(`sol-link-api listening on http://localhost:${port}`);
});