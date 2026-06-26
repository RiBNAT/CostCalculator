// Dev seed: populates the demo account's period with opening balances, expenses, a transfer, a budget.
const B = "http://localhost:8080/api/v1";
async function j(method, path, body, token) {
  const r = await fetch(B + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text(); let d; try { d = JSON.parse(txt); } catch { d = txt; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${txt}`);
  return d;
}
const email = "demo@ribnat.app", password = "demo1234";
let auth;
try { auth = await j("POST", "/auth/login", { email, password }); }
catch { auth = await j("POST", "/auth/register", { name: "Tanbir Rahman", email, password }); }
const tok = auth.tokens.accessToken;

const cats = await j("GET", "/categories", null, tok);
const accts = await j("GET", "/accounts", null, tok);
const expenseCats = cats.filter((c) => c.kind === "expense");
const cash = accts.find((a) => a.kind === "cash");
const mobile = accts.find((a) => a.kind === "mobile");
const bank = accts.find((a) => a.kind === "bank");
const savings = accts.find((a) => a.kind === "savings");
const sub = (c) => (c.subcategories || []).find((s) => s.active)?.name || (c.subcategories || [])[0]?.name || "General";

let period = (await j("GET", "/periods", null, tok))[0];
if (!period) period = await j("POST", "/periods", { name: "Jun 2026", startDate: "2026-05-25", endDate: "2026-06-24" }, tok);
await j("PUT", `/periods/${period.id}`, {
  name: period.name, startDate: "2026-05-25", endDate: "2026-06-24",
  openingBalances: [cash, mobile, bank].filter(Boolean).map((a, i) => ({ accountId: a.id, amount: [1500000, 1800000, 6000000][i] })),
  openingSavings: savings ? [{ accountId: savings.id, amount: 18500000 }] : [],
}, tok);

const existing = await j("GET", `/periods/${period.id}/expenses`, null, tok);
if (existing.length === 0 && expenseCats.length) {
  const pick = (i) => expenseCats[i % expenseCats.length];
  const accFor = (i) => [cash, bank, mobile, cash, bank][i % 5] || cash;
  const rows = [
    ["2026-06-18", 0, "18000", "Monthly rent"],
    ["2026-06-24", 1, "360+20+330+470", "Karwan Bazar"],
    ["2026-06-20", 1, "4260", "Monthly groceries"],
    ["2026-06-22", 2, "2140", "Electricity bill"],
    ["2026-06-21", 3, "560", "Ride to office"],
    ["2026-06-19", 3, "3000", "Fuel"],
    ["2026-06-14", 1, "3200", "Fish & meat"],
    ["2026-06-23", 0, "920", "Misc"],
  ];
  for (let i = 0; i < rows.length; i++) {
    const [date, ci, expr, remarks] = rows[i];
    const c = pick(ci);
    await j("POST", `/periods/${period.id}/expenses`, { date, categoryId: c.id, subcategory: sub(c), accountId: accFor(i).id, amountExpr: expr, remarks }, tok);
  }
  if (bank && cash) await j("POST", `/periods/${period.id}/transfers`, { date: "2026-06-20", fromAccountId: bank.id, toAccountId: cash.id, amountExpr: "5000", feeExpr: "15", note: "ATM withdrawal" }, tok);
  await j("PUT", `/periods/${period.id}/budget`, {
    rollover: false,
    items: expenseCats.slice(0, 4).map((c, i) => ({ categoryId: c.id, subcategory: sub(c), amount: [1800000, 800000, 300000, 500000][i] || 200000 })),
  }, tok);
}
const fin = await j("GET", `/periods/${period.id}/summary`, null, tok);
console.log("seeded:", { period: period.name, inHand: fin.inHand, categories: cats.length, accounts: accts.length, expenses: existing.length || "new" });
