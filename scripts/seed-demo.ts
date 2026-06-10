import Database from "better-sqlite3";
import { createHash } from "crypto";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "demo.db");
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Run the init migration inline
const migrationSql = fs.readFileSync(
  path.join(process.cwd(), "lib/db/migrations/001_init.sql"),
  "utf-8"
);
db.exec(migrationSql);
db.prepare(
  "INSERT INTO _migrations (name) VALUES (?)"
).run("001_init.sql");

// ── Helpers ──

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const between = (lo: number, hi: number) =>
  Math.round((lo + rng() * (hi - lo)) * 100) / 100;
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

function dedupKey(
  source: string,
  date: string,
  desc: string,
  amount: number,
  seq: number
) {
  return createHash("sha256")
    .update(`${source}|${date}|${desc}|${amount}|${seq}`)
    .digest("hex");
}

// ── Merchant pools ──

const GROCERIES = [
  "SAFEWAY #3421 VANCOUVER",
  "WHOLE FOODS MKT VANCOUVER",
  "REAL CDN SUPERSTORE BURNABY",
  "SAVE-ON-FOODS #121 VAN",
  "COSTCO WHOLESALE #468",
];
const COFFEE = [
  "STARBUCKS #12903 VANCOUVER",
  "BLENZ COFFEE DAVIE ST",
  "MATCHSTICK COFFEE ROASTERS",
  "49TH PARALLEL CAFE",
  "PALLET COFFEE ROASTERS",
];
const RESTAURANTS = [
  "TST* SUSHI MURA VANCOUVER",
  "MCDONALD'S #31042",
  "CHIPOTLE ONLINE 8821",
  "DOORDASH*THAI BASIL",
  "UBER EATS* PENDING",
  "RAMEN DANBO ROBSON",
  "TST* NUBA GASTOWN",
  "PHO GOODNESS MAIN ST",
  "A&W #4412 VANCOUVER",
];
const SUBSCRIPTIONS = [
  "NETFLIX.COM",
  "SPOTIFY P2834102",
  "GOOGLE*GOOGLE ONE",
  "APPLE.COM/BILL",
  "STRAVA PREMIUM",
  "AMAZON.CA PRIME MEMBER",
];
const PHONE_UTIL = ["TELUS MOBILITY", "BC HYDRO ONLINE"];
const GYM = ["EQUINOX VANCOUVER", "CLASSPASS *MONTHLY"];
const RUNNING = [
  "RUNNING ROOM #42 VAN",
  "SPORT CHEK #228",
  "ADIDAS ROBSON ST",
];
const TRANSPORT = [
  "COMPASS AUTOLOAD",
  "ESSO #3311 VANCOUVER",
  "UBER TRIP 89234",
  "PAYBYPHONE VANCOUVER",
  "IMPARK #V8042",
];
const TRAVEL = [
  "AIR CANADA 0142359481",
  "AIRBNB *HMGZ42F",
  "EXPEDIA BOOKING 77321",
];
const HEALTH = [
  "SHOPPERS DRUG MART #401",
  "REXALL PHARMACY MAIN",
  "BROADWAY DENTAL CENTRE",
];
const SHOPPING = [
  "AMAZON.CA*3K28RY1",
  "AMZN MKTP CA*2M7F4P",
  "LULULEMON #127 VANCOUVER",
  "BEST BUY #923 METRO",
  "WINNERS #351 VANCOUVER",
];

interface MerchantPool {
  category: string;
  merchants: string[];
  monthlyCount: [number, number];
  amountRange: [number, number];
}

const SPEND_POOLS: MerchantPool[] = [
  { category: "Groceries", merchants: GROCERIES, monthlyCount: [6, 10], amountRange: [28, 185] },
  { category: "Coffee", merchants: COFFEE, monthlyCount: [8, 16], amountRange: [4.5, 8.5] },
  { category: "Restaurants & takeout", merchants: RESTAURANTS, monthlyCount: [6, 12], amountRange: [12, 65] },
  { category: "Subscriptions", merchants: SUBSCRIPTIONS, monthlyCount: [3, 6], amountRange: [5.99, 22.99] },
  { category: "Phone / utilities", merchants: PHONE_UTIL, monthlyCount: [1, 2], amountRange: [55, 120] },
  { category: "Gym / fitness / recovery", merchants: GYM, monthlyCount: [1, 2], amountRange: [45, 89] },
  { category: "Running / cycling gear", merchants: RUNNING, monthlyCount: [0, 2], amountRange: [35, 220] },
  { category: "Transport / gas / parking", merchants: TRANSPORT, monthlyCount: [3, 6], amountRange: [3.5, 75] },
  { category: "Health / pharmacy", merchants: HEALTH, monthlyCount: [0, 2], amountRange: [15, 180] },
  { category: "Shopping / retail", merchants: SHOPPING, monthlyCount: [1, 4], amountRange: [15, 150] },
];

// ── Generate 12 months of data ──

const MONTHS: [number, number][] = [];
for (let i = 11; i >= 0; i--) {
  const d = new Date(2026, 5 - i, 1); // June 2025 through May 2026
  MONTHS.push([d.getFullYear(), d.getMonth() + 1]);
}

const insertStmt = db.prepare(
  `INSERT OR IGNORE INTO statements (filename, source, account, period, row_count)
   VALUES (?, ?, ?, ?, ?)`
);
const insertTxn = db.prepare(
  `INSERT OR IGNORE INTO transactions
   (statement_id, source, account, period, txn_date, description, amount, category, flow, dedup_key)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

let globalSeq = 0;

const generate = db.transaction(() => {
  for (const [year, month] of MONTHS) {
    const period = `${year}-${String(month).padStart(2, "0")}`;
    const days = daysInMonth(year, month);

    // ── Amex card statement ──
    const amexFile = `amex_${period}.pdf`;
    insertStmt.run(amexFile, "amex", "amex_plat", period, 0);
    const amexId = Number(
      (db.prepare("SELECT id FROM statements WHERE filename = ?").get(amexFile) as { id: number }).id
    );

    let amexCount = 0;
    for (const pool of SPEND_POOLS) {
      const count =
        Math.floor(rng() * (pool.monthlyCount[1] - pool.monthlyCount[0] + 1)) +
        pool.monthlyCount[0];
      for (let i = 0; i < count; i++) {
        const day = Math.floor(rng() * days) + 1;
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const desc = pick(pool.merchants);
        const amount = between(pool.amountRange[0], pool.amountRange[1]);
        const key = dedupKey("amex", date, desc, amount, globalSeq);
        insertTxn.run(
          amexId, "amex", "amex_plat", period, date, desc, amount,
          pool.category, "spend", key
        );
        amexCount++;
        globalSeq++;
      }
    }
    db.prepare("UPDATE statements SET row_count = ? WHERE id = ?").run(
      amexCount, amexId
    );

    // ── CIBC Visa (subset of spend — split some volume) ──
    const visaFile = `cibc_visa_${period}.pdf`;
    insertStmt.run(visaFile, "cibc_visa", "cibc_visa_4521", period, 0);
    const visaId = Number(
      (db.prepare("SELECT id FROM statements WHERE filename = ?").get(visaFile) as { id: number }).id
    );

    let visaCount = 0;
    // Visa gets groceries + transport mainly
    for (const pool of [SPEND_POOLS[0], SPEND_POOLS[7]]) {
      const count = Math.floor(rng() * 3) + 2;
      for (let i = 0; i < count; i++) {
        const day = Math.floor(rng() * days) + 1;
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const desc = pick(pool.merchants);
        const amount = between(pool.amountRange[0], pool.amountRange[1]);
        const key = dedupKey("cibc_visa", date, desc, amount, globalSeq);
        insertTxn.run(
          visaId, "cibc_visa", "cibc_visa_4521", period, date, desc, amount,
          pool.category, "spend", key
        );
        visaCount++;
        globalSeq++;
      }
    }
    db.prepare("UPDATE statements SET row_count = ? WHERE id = ?").run(
      visaCount, visaId
    );

    // ── CIBC chequing statement ──
    const chqFile = `cibc_chq_${period}.pdf`;
    insertStmt.run(chqFile, "cibc_chequing", "cibc_chq_7890", period, 0);
    const chqId = Number(
      (db.prepare("SELECT id FROM statements WHERE filename = ?").get(chqFile) as { id: number }).id
    );

    let chqCount = 0;

    // Payroll (2x/month)
    for (const payDay of [15, days]) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(payDay).padStart(2, "0")}`;
      const amount = between(2800, 3200);
      const key = dedupKey("cibc_chequing", date, "PEOPLE CENTER PAYROLL", amount, globalSeq);
      insertTxn.run(
        chqId, "cibc_chequing", "cibc_chq_7890", period, date,
        "PEOPLE CENTER PAYROLL", amount, "Banking", "income", key
      );
      chqCount++;
      globalSeq++;
    }

    // Rent (transfer, 1st of month)
    {
      const date = `${year}-${String(month).padStart(2, "0")}-01`;
      const key = dedupKey("cibc_chequing", date, "E-TRANSFER SENT", 1850, globalSeq);
      insertTxn.run(
        chqId, "cibc_chequing", "cibc_chq_7890", period, date,
        "E-TRANSFER SENT", 1850, "Rent / housing", "transfer", key
      );
      chqCount++;
      globalSeq++;
    }

    // Card payments (transfers to pay off cards)
    {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(20, days)).padStart(2, "0")}`;
      const amount = between(1200, 2500);
      const key = dedupKey("cibc_chequing", date, "PAYMENT THANK YOU", amount, globalSeq);
      insertTxn.run(
        chqId, "cibc_chequing", "cibc_chq_7890", period, date,
        "PAYMENT THANK YOU", amount, "Banking", "payment", key
      );
      chqCount++;
      globalSeq++;
    }

    // Occasional e-transfer income (tax refund, reimbursement)
    if (rng() > 0.7) {
      const day = Math.floor(rng() * days) + 1;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const amount = between(200, 800);
      const desc = pick(["REMBOURS REMBOURSEMENT", "E-TRANSFER RECEIVED"]);
      const key = dedupKey("cibc_chequing", date, desc, amount, globalSeq);
      insertTxn.run(
        chqId, "cibc_chequing", "cibc_chq_7890", period, date,
        desc, amount, "Banking", "income", key
      );
      chqCount++;
      globalSeq++;
    }

    // Occasional debit purchases
    const debitCount = Math.floor(rng() * 3);
    for (let i = 0; i < debitCount; i++) {
      const day = Math.floor(rng() * days) + 1;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const desc = pick(["SAFEWAY #3421 DEBIT", "SHOPPERS DRUG MART DEBIT", "TIM HORTONS DEBIT"]);
      const amount = between(8, 65);
      const key = dedupKey("cibc_chequing", date, desc, amount, globalSeq);
      insertTxn.run(
        chqId, "cibc_chequing", "cibc_chq_7890", period, date,
        desc, amount, "Banking", "spend", key
      );
      chqCount++;
      globalSeq++;
    }

    db.prepare("UPDATE statements SET row_count = ? WHERE id = ?").run(
      chqCount, chqId
    );

    // ── One big one-off travel purchase in a random month ──
    if (month === 2 || month === 8) {
      const day = Math.floor(rng() * days) + 1;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const desc = pick(TRAVEL);
      const amount = between(350, 1200);
      const key = dedupKey("amex", date, desc, amount, globalSeq);
      insertTxn.run(
        amexId, "amex", "amex_plat", period, date, desc, amount,
        "Travel (air/hotel)", "spend", key
      );
      globalSeq++;
    }
  }

  // ── Seed category rules ──
  const RULES: [string, string[]][] = [
    ["Cash advance / fees", ["CASH ADVANCE", "CASH ADV/BT", "CONV CHQ FEE", "NSF", "OVERDRAFT", "INTEREST CHARGE"]],
    ["Groceries", ["SAFEWAY", "WHOLE FOODS", "REAL CDN", "SUPERSTORE", "COSTCO", "SAVE-ON-FOODS"]],
    ["Coffee", ["STARBUCKS", "BLENZ", "MATCHSTICK", "49TH PARALLEL", "PALLET COFFEE", "TIM HORTON"]],
    ["Restaurants & takeout", ["MCDONALD", "CHIPOTLE", "DOORDASH", "UBER EATS", "RAMEN", "SUSHI", "PHO ", "TST-", "TST*", "A&W", "NUBA"]],
    ["Subscriptions", ["NETFLIX", "SPOTIFY", "GOOGLE ONE", "GOOGLE*GOOGLE", "APPLE.COM/BILL", "STRAVA", "AMAZON.CA PRIME", "PRIME MEMBER"]],
    ["Phone / utilities", ["TELUS", "BC HYDRO"]],
    ["Gym / fitness / recovery", ["EQUINOX", "CLASSPASS", "GYM", "FITNESS"]],
    ["Running / cycling gear", ["RUNNING ROOM", "SPORT CHEK", "ADIDAS"]],
    ["Transport / gas / parking", ["COMPASS", "ESSO", "UBER TRIP", "PAYBYPHONE", "IMPARK", "EASYPARK"]],
    ["Travel (air/hotel)", ["AIR CANADA", "AIRBNB", "EXPEDIA", "HOTEL"]],
    ["Health / pharmacy", ["SHOPPERS DRUG", "REXALL", "DENTAL", "PHARMACY"]],
    ["Shopping / retail", ["AMAZON.CA*", "AMZN MKTP", "LULULEMON", "BEST BUY", "WINNERS"]],
    ["Rent / housing", ["E-TRANSFER SENT"]],
  ];

  const insertRule = db.prepare(
    "INSERT OR IGNORE INTO category_rules (category, keyword, sort_order) VALUES (?, ?, ?)"
  );
  let order = 0;
  for (const [cat, kws] of RULES) {
    for (const kw of kws) {
      insertRule.run(cat, kw, order++);
    }
  }

  // ── Seed spending goals ──
  const insertGoal = db.prepare(
    "INSERT OR IGNORE INTO spending_goals (category, monthly_limit) VALUES (?, ?)"
  );
  insertGoal.run("Groceries", 600);
  insertGoal.run("Coffee", 80);
  insertGoal.run("Restaurants & takeout", 400);
  insertGoal.run("Subscriptions", 100);
  insertGoal.run("Shopping / retail", 200);
  insertGoal.run("Transport / gas / parking", 150);
});

generate();

const txnCount = (db.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number }).c;
const stmtCount = (db.prepare("SELECT COUNT(*) as c FROM statements").get() as { c: number }).c;
console.log(`Seeded demo.db: ${txnCount} transactions across ${stmtCount} statements (${MONTHS.length} months)`);
db.close();
