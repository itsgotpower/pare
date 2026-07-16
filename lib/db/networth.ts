import { getDb } from "../db";
import { NOT_HIDDEN_SOURCE_SQL, getAccountMetaMap } from "./accounts";

// Statement-cadence net worth: each statement's closing balance is a
// point-in-time observation (chequing positive, card balances negative);
// manual entries (investments, vehicle) step forward from their effective
// date. Balances carry forward into months without a new observation, so
// the series is deliberately point-in-time, not live.

// Card accounts are liabilities (a balance owed); everything else (chequing,
// savings, manual assets) is an asset. Keyed on account_kind, not the literal
// source, so imported foreign card accounts are signed correctly too.

export interface ManualEntry {
  id: number;
  name: string;
  kind: "asset" | "liability";
  amount: number;
  effective_date: string;
  note: string | null;
  created_at: string;
}

export interface NetWorthAccount {
  name: string;
  label?: string; // nickname (account_meta) — display only; `name` stays the timeline key
  type: "statement" | "manual";
  kind: "asset" | "liability";
  current: number; // signed: liabilities negative
  asOf: string;
  closed?: boolean; // marked closed — balance no longer carries forward
}

export interface NetWorthPoint {
  month: string;
  net: number;
  assets: number;
  liabilities: number; // positive magnitude
  balances: Record<string, number>; // signed per account / manual item
}

export interface NetWorthData {
  series: NetWorthPoint[];
  accounts: NetWorthAccount[];
  entries: ManualEntry[];
  current: {
    month: string;
    net: number;
    assets: number;
    liabilities: number;
    delta: number | null; // vs previous month's net
  } | null;
}

interface Observation {
  date: string;
  value: number; // signed
}

export function listManualEntries(): ManualEntry[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM manual_entries ORDER BY effective_date DESC, id DESC")
    .all() as ManualEntry[];
}

export function addManualEntry(entry: {
  name: string;
  kind: "asset" | "liability";
  amount: number;
  effective_date: string;
  note?: string | null;
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO manual_entries (name, kind, amount, effective_date, note)
       VALUES (@name, @kind, @amount, @effective_date, @note)`
    )
    .run({ note: null, ...entry });
  return Number(result.lastInsertRowid);
}

export function updateManualEntry(
  id: number,
  entry: {
    name: string;
    kind: "asset" | "liability";
    amount: number;
    effective_date: string;
    note?: string | null;
  }
): void {
  const db = getDb();
  db.prepare(
    `UPDATE manual_entries
     SET name = @name, kind = @kind, amount = @amount,
         effective_date = @effective_date, note = @note
     WHERE id = @id`
  ).run({ note: null, ...entry, id });
}

export function deleteManualEntry(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM manual_entries WHERE id = ?").run(id);
}

export function getNetWorth(): NetWorthData {
  const db = getDb();

  // Hidden accounts are out of net worth entirely (consistent with every other
  // chart); closed ones keep their history but stop carrying forward below.
  const statements = db
    .prepare(
      `SELECT account, source, account_kind, closing_date, closing_balance
       FROM statements
       WHERE closing_balance IS NOT NULL AND closing_date IS NOT NULL
         AND ${NOT_HIDDEN_SOURCE_SQL}
       ORDER BY closing_date`
    )
    .all() as {
      account: string;
      source: string;
      account_kind: string;
      closing_date: string;
      closing_balance: number;
    }[];

  const entries = listManualEntries();

  // One observation timeline per account / manual item, values signed.
  const timelines = new Map<string, { kind: "asset" | "liability"; type: "statement" | "manual"; obs: Observation[] }>();
  const observe = (
    name: string,
    kind: "asset" | "liability",
    type: "statement" | "manual",
    date: string,
    value: number
  ) => {
    let t = timelines.get(name);
    if (!t) {
      t = { kind, type, obs: [] };
      timelines.set(name, t);
    }
    t.obs.push({ date, value });
  };

  // Timelines are keyed by account name; closed status and nicknames live on
  // the source — collect both per account name. Nicknames are display-only
  // labels: renaming the timeline/balances keys themselves would merge two
  // accounts' histories on a nickname collision.
  const meta = getAccountMetaMap();
  const closedNames = new Set<string>();
  const labelByName = new Map<string, string>();
  for (const s of statements) {
    const liability = s.account_kind === "card";
    const m = meta.get(s.source);
    if (m?.closed) closedNames.add(s.account);
    const nickname = m?.nickname?.trim();
    if (nickname) labelByName.set(s.account, nickname);
    observe(
      s.account,
      liability ? "liability" : "asset",
      "statement",
      s.closing_date,
      liability ? -s.closing_balance : s.closing_balance
    );
  }
  for (const e of entries) {
    observe(
      e.name,
      e.kind,
      "manual",
      e.effective_date,
      e.kind === "liability" ? -e.amount : e.amount
    );
  }

  if (timelines.size === 0) {
    return { series: [], accounts: [], entries, current: null };
  }

  for (const t of timelines.values()) {
    t.obs.sort((a, b) => a.date.localeCompare(b.date));
  }

  const allDates = [...timelines.values()].flatMap((t) => t.obs.map((o) => o.date));
  const months: string[] = [];
  let cursor = allDates.reduce((a, b) => (a < b ? a : b)).slice(0, 7);
  const last = allDates.reduce((a, b) => (a > b ? a : b)).slice(0, 7);
  while (cursor <= last) {
    months.push(cursor);
    const [y, m] = cursor.split("-").map(Number);
    cursor = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }

  const series: NetWorthPoint[] = months.map((month) => {
    const balances: Record<string, number> = {};
    let assets = 0;
    let liabilities = 0;
    for (const [name, t] of timelines) {
      // Latest observation up to the end of this month, carried forward.
      let latest: Observation | null = null;
      for (const o of t.obs) {
        if (o.date.slice(0, 7) > month) break;
        latest = o;
      }
      if (!latest) continue;
      // A closed account's balance stops carrying forward after its final
      // statement — otherwise its last printed balance would pollute net worth
      // forever. History up to (and including) that month is untouched.
      if (
        closedNames.has(name) &&
        month > t.obs[t.obs.length - 1].date.slice(0, 7)
      )
        continue;
      balances[name] = latest.value;
      if (latest.value >= 0) assets += latest.value;
      else liabilities += -latest.value;
    }
    return {
      month,
      net: Math.round((assets - liabilities) * 100) / 100,
      assets: Math.round(assets * 100) / 100,
      liabilities: Math.round(liabilities * 100) / 100,
      balances,
    };
  });

  const accounts: NetWorthAccount[] = [...timelines.entries()]
    .map(([name, t]) => {
      const latest = t.obs[t.obs.length - 1];
      return {
        name,
        label: labelByName.get(name),
        type: t.type,
        kind: t.kind,
        current: latest.value,
        asOf: latest.date,
        closed: closedNames.has(name) || undefined,
      };
    })
    .sort((a, b) => b.current - a.current);

  const lastPoint = series[series.length - 1];
  const prevPoint = series.length > 1 ? series[series.length - 2] : null;

  return {
    series,
    accounts,
    entries,
    current: {
      month: lastPoint.month,
      net: lastPoint.net,
      assets: lastPoint.assets,
      liabilities: lastPoint.liabilities,
      delta: prevPoint ? Math.round((lastPoint.net - prevPoint.net) * 100) / 100 : null,
    },
  };
}
