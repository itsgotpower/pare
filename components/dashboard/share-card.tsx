"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { categoryColor, PALETTE } from "@/lib/colors";
import { formatCurrency, formatMonthFull, formatMonthShort } from "@/lib/format";

// Month-in-review share card: a canvas-rendered 1080×1350 (4:5) image of the
// month's recap in the brutalist style — dark ground, mono type, category
// colour reserved for data. PRIVACY DEFAULT: percentages and category names
// only; dollar amounts render only behind an explicit toggle, and merchant
// names never render at all. Sharing is the point of the card, so the safe
// version has to be the effortless one.

export interface ShareCardData {
  month: string; // YYYY-MM
  spend: number;
  net: number;
  savingsRate: number | null;
  txnCount: number;
  spendDelta: number | null;
  prevMonth: string | null;
  topCategories: { category: string; total: number }[];
}

const W = 1080;
const H = 1350;
const PAD = 84;
const INNER = W - PAD * 2;

const BG = "#0a0a0a";
const FG = "#fafafa";
const MUTED = "#9a9a9a";
const LINE = "#3a3a3a";

function monoFamily(): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();
  return v || "monospace";
}

function draw(
  canvas: HTMLCanvasElement,
  data: ShareCardData,
  showAmounts: boolean
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const mono = monoFamily();
  const font = (weight: number, size: number) =>
    `${weight} ${size}px ${mono}`;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Frame — the 1px-border bento, scaled up.
  ctx.strokeStyle = FG;
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  // Header row.
  ctx.fillStyle = FG;
  ctx.font = font(700, 34);
  ctx.textBaseline = "alphabetic";
  ctx.fillText("P A R E", PAD, 128);
  ctx.fillStyle = MUTED;
  ctx.font = font(500, 24);
  ctx.textAlign = "right";
  ctx.fillText("M O N T H  I N  R E V I E W", W - PAD, 128);
  ctx.textAlign = "left";

  // Month title + txn count.
  ctx.fillStyle = FG;
  ctx.font = font(700, 92);
  ctx.fillText(formatMonthFull(data.month).toUpperCase(), PAD, 260);
  ctx.fillStyle = MUTED;
  ctx.font = font(500, 26);
  ctx.fillText(
    `${data.txnCount} TRANSACTIONS`,
    PAD,
    310
  );

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, 352);
  ctx.lineTo(W - PAD, 352);
  ctx.stroke();

  // Category breakdown — % of the month's outflow, top 5.
  ctx.fillStyle = MUTED;
  ctx.font = font(500, 26);
  ctx.fillText("W H E R E  I T  W E N T", PAD, 412);

  const cats = data.topCategories.slice(0, 5);
  const maxTotal = cats[0]?.total || 1;
  let y = 470;
  for (const c of cats) {
    const pct = data.spend > 0 ? (c.total / data.spend) * 100 : 0;
    ctx.fillStyle = FG;
    ctx.font = font(500, 32);
    ctx.fillText(c.category.toUpperCase(), PAD, y);
    ctx.font = font(700, 36);
    ctx.textAlign = "right";
    ctx.fillText(
      showAmounts ? formatCurrency(c.total) : `${pct.toFixed(0)}%`,
      W - PAD,
      y
    );
    ctx.textAlign = "left";
    ctx.fillStyle = categoryColor(c.category);
    ctx.fillRect(PAD, y + 18, Math.max(10, (c.total / maxTotal) * INNER), 18);
    y += 96;
  }

  // Stats band.
  const statsTop = y + 8;
  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(PAD, statsTop);
  ctx.lineTo(W - PAD, statsTop);
  ctx.stroke();

  const colX = [PAD, W / 2 + 24];
  const statY = statsTop + 64;

  // Savings rate.
  ctx.fillStyle = MUTED;
  ctx.font = font(500, 24);
  ctx.fillText("S A V I N G S  R A T E", colX[0], statY);
  const sr = data.savingsRate;
  ctx.fillStyle = sr == null ? MUTED : sr >= 0 ? PALETTE.sage : PALETTE.terracotta;
  ctx.font = font(700, 84);
  ctx.fillText(sr == null ? "—" : `${(sr * 100).toFixed(0)}%`, colX[0], statY + 92);
  ctx.fillStyle = MUTED;
  ctx.font = font(500, 24);
  ctx.fillText(
    sr != null && sr < 0 ? "spent more than earned" : "of income kept",
    colX[0],
    statY + 134
  );

  // Spend vs last month (percent only — never a $ figure unless toggled).
  ctx.fillStyle = MUTED;
  ctx.font = font(500, 24);
  ctx.fillText("V S  L A S T  M O N T H", colX[1], statY);
  if (data.spendDelta != null && data.spendDelta !== 0 && data.spend - data.spendDelta > 0) {
    const prevSpend = data.spend - data.spendDelta;
    const pct = (data.spendDelta / prevSpend) * 100;
    const up = pct > 0;
    ctx.fillStyle = up ? PALETTE.terracotta : PALETTE.sage;
    ctx.font = font(700, 84);
    ctx.fillText(`${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`, colX[1], statY + 92);
    ctx.fillStyle = MUTED;
    ctx.font = font(500, 24);
    ctx.fillText(
      data.prevMonth ? `vs ${formatMonthShort(data.prevMonth).toLowerCase()}` : "",
      colX[1],
      statY + 134
    );
  } else {
    ctx.fillStyle = MUTED;
    ctx.font = font(700, 84);
    ctx.fillText("—", colX[1], statY + 92);
    ctx.font = font(500, 24);
    ctx.fillText("no prior month", colX[1], statY + 134);
  }

  // Optional amounts line — only behind the explicit toggle.
  if (showAmounts) {
    ctx.fillStyle = FG;
    ctx.font = font(700, 40);
    const saved = data.net >= 0;
    ctx.fillText(
      `SPENT ${formatCurrency(data.spend)}  ·  ${saved ? "SAVED" : "OVER BY"} ${formatCurrency(Math.abs(data.net))}`,
      PAD,
      statY + 186
    );
  }

  // Footer.
  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(PAD, H - 132);
  ctx.lineTo(W - PAD, H - 132);
  ctx.stroke();
  ctx.fillStyle = FG;
  ctx.font = font(700, 28);
  ctx.fillText("pare.money", PAD, H - 76);
  ctx.fillStyle = MUTED;
  ctx.font = font(500, 24);
  ctx.textAlign = "right";
  ctx.fillText("private · local-first · no bank login", W - PAD, H - 76);
  ctx.textAlign = "left";
}

export function ShareCardButton({ data }: { data: ShareCardData }) {
  const [open, setOpen] = useState(false);
  const [showAmounts, setShowAmounts] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setCanShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function"
    );
  }, []);

  // Callback ref instead of useEffect: base-ui portals DialogContent in after
  // `open` flips, so an [open] effect can fire before the canvas exists. The
  // callback runs exactly when the node attaches — and because it closes over
  // `showAmounts`/`data`, React re-attaches it (null → node) on toggle, which
  // is the redraw.
  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (!node) return;
      draw(node, data, showAmounts);
      // Redraw once fonts are in — the first open may race the font load.
      document.fonts.ready.then(() => {
        if (canvasRef.current === node) draw(node, data, showAmounts);
      });
    },
    [data, showAmounts]
  );

  const toBlob = useCallback(
    () =>
      new Promise<Blob | null>((resolve) =>
        canvasRef.current
          ? canvasRef.current.toBlob(resolve, "image/png")
          : resolve(null)
      ),
    []
  );

  const filename = `pare-review-${data.month}.png`;

  const download = useCallback(async () => {
    const blob = await toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [toBlob, filename]);

  const share = useCallback(async () => {
    const blob = await toBlob();
    if (!blob) return;
    const file = new File([blob], filename, { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch {
      // cancelled or unsupported — fall through to download
    }
    await download();
  }, [toBlob, filename, download]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="font-mono text-[10px] tracking-widest uppercase border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        SHARE CARD
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm tracking-widest uppercase">
            {formatMonthFull(data.month).toUpperCase()} — SHARE CARD
          </DialogTitle>
        </DialogHeader>
        <canvas
          ref={attachCanvas}
          width={W}
          height={H}
          className="w-full border border-border"
          aria-label="Month in review share card preview"
        />
        <label className="flex items-center gap-2 font-mono text-[11px] tracking-widest uppercase text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAmounts}
            onChange={(e) => setShowAmounts(e.target.checked)}
            className="accent-foreground"
          />
          INCLUDE $ AMOUNTS
        </label>
        <p className="text-xs text-muted-foreground">
          Default is safe to post: category percentages only — no dollar
          amounts, no merchants, no balances.
        </p>
        <div className="flex gap-2">
          <button
            onClick={download}
            className="flex-1 font-mono text-xs tracking-widest uppercase border border-input px-4 py-2 hover:bg-accent transition-colors"
          >
            DOWNLOAD PNG
          </button>
          {canShare && (
            <button
              onClick={share}
              className="flex-1 font-mono text-xs tracking-widest uppercase bg-foreground text-background px-4 py-2 hover:opacity-90 transition-opacity"
            >
              SHARE
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
