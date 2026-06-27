# Phase 3c — Delete the Angular Frontend (Cutover)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the legacy Angular app once the Next.js app is confirmed at feature parity, removing roughly half the repo's maintenance surface and the duplicated type/logic copies.

**Architecture:** This is a deletion + reference-cleanup change, gated on a parity checklist. Remove `CostCalculator/frontend/`, then scrub every remaining reference (docker-compose comment, README, VS Code launch configs, docs). The Go backend and the `web` Next.js app are untouched in behavior; only the dead Angular tree and its mentions go away.

**Tech Stack:** git, docker-compose, Next.js `web/` (kept).

**Hard gate:** Do NOT start Task 2 (deletion) until Task 1's parity checklist is fully satisfied. Deletion is easy to revert via git, but a premature cutover that drops a feature users rely on is the real risk.

---

### Task 1: Confirm Next.js parity (gate)

**Files:** none (verification only)

- [ ] **Step 1: Enumerate Angular feature routes**

Run: `cd CostCalculator && ls frontend/src/app/features`
Expected: the legacy feature set (auth, dashboard, expenses, transfers, budget, insights/dashboard, lends, savings, planner, settings, import). Note each.

- [ ] **Step 2: Confirm each exists in the Next.js app**

Run: `cd CostCalculator && ls "web/app/(app)"`
Expected: `budget, dashboard, expenses, import, insights, lends, planner, savings, settings, transfers` plus `layout.tsx`. Cross-check against Step 1. Per the rebuild record, Phases 1–6 (all features) were completed and verified live — this step is the final confirmation, not new work.

- [ ] **Step 3: Smoke-test the Next.js app end to end**

Start the full stack (Mongo + Go API on :8080 + `web` on :3000), log in, and click through every nav item: dashboard, expenses (add/edit, recurring quick-add), transfers (incl. add-income + fee), budget (edit/rollover/copy-previous), insights, lends (create/settle), savings (move-to-savings), planner (windows/reminders), settings (all CRUD tabs), import/export. Confirm no console errors and each page renders real data.

- [ ] **Step 4: Decision checkpoint**

Only proceed if every Angular feature has a working Next.js equivalent. If any gap is found, STOP and address it as a separate Next.js task before continuing this plan. Record the parity confirmation (or the gap list) in the commit message of Task 2.

---

### Task 2: Remove the Angular app

**Files:**
- Delete: `CostCalculator/frontend/` (entire directory)

- [ ] **Step 1: Delete the directory**

Run:
```bash
cd CostCalculator && git rm -r frontend
```
Expected: git stages the deletion of the whole `frontend/` tree.

- [ ] **Step 2: Confirm backend and web are untouched and still build**

Run:
```bash
cd CostCalculator/backend && go build ./...
cd ../web && npx tsc --noEmit && npm run build
```
Expected: all succeed — nothing in `backend` or `web` depends on `frontend`.

- [ ] **Step 3: Commit the deletion**

```bash
cd CostCalculator && git commit -m "chore(web): remove legacy Angular frontend after Next.js cutover

Next.js app at web/ confirmed at feature parity (see Phase 3c parity checklist)."
```

---

### Task 3: Scrub remaining references

**Files:**
- Modify: `CostCalculator/docker-compose.yml`
- Modify: `CostCalculator/README.md`
- Modify: `CostCalculator/.claude/launch.json`

- [ ] **Step 1: Find every remaining reference**

Run: `cd CostCalculator && grep -rni "angular\|frontend/" --include=*.yml --include=*.yaml --include=*.md --include=*.json --include=*.mjs . | grep -v "docs/superpowers/"`
Expected: a short list — at minimum the docker-compose `web` service comment, README mentions, and `.claude/launch.json` Angular launch entries. (Historical `docs/superpowers/*` plans/specs are intentionally left as-is — they're a record.)

- [ ] **Step 2: Remove the docker-compose comment**

In `CostCalculator/docker-compose.yml`, delete the stale reference line in the `web` service comment:

```
  # The legacy Angular app remains at ./frontend for reference until cutover is signed off.
```

Leave the rest of the `web` service comment (the same-origin proxy explanation) intact.

- [ ] **Step 3: Update the README**

In `CostCalculator/README.md`, remove or rewrite any section describing the Angular `frontend/` (setup, run instructions, architecture mentions) so the README describes only the `web/` Next.js frontend. Use the grep output from Step 1 to locate the exact lines. If the README has a "Frontend" run section pointing at Angular (`ng serve`, port 4200), replace it with the Next.js commands (`cd web && npm run dev`, port 3000).

- [ ] **Step 4: Remove Angular launch configs**

In `CostCalculator/.claude/launch.json`, remove any configuration that targets the Angular app (e.g. entries referencing `frontend`, `ng`, or port 4200). Keep the `web-next` (port 3000) and backend configs. Validate the JSON still parses:

Run: `cd CostCalculator && node -e "JSON.parse(require('fs').readFileSync('.claude/launch.json','utf8')); console.log('launch.json ok')"`
Expected: prints `launch.json ok`.

- [ ] **Step 5: Confirm no stray references remain**

Run: `cd CostCalculator && grep -rni "angular\|:4200\|ng serve\|frontend/" --include=*.yml --include=*.yaml --include=*.md --include=*.json --include=*.mjs . | grep -v "docs/superpowers/"`
Expected: no results (empty output).

- [ ] **Step 6: Commit**

```bash
cd CostCalculator && git commit -am "docs/chore: scrub Angular references after cutover"
```

---

## Final verification

- [ ] `cd CostCalculator/backend && go build ./...` → clean.
- [ ] `cd CostCalculator/web && npx tsc --noEmit && npm run build` → both succeed.
- [ ] `git status` shows the `frontend/` tree removed; no untracked Angular artifacts remain.
- [ ] Update the project memory note (`ribnat-nextjs-rebuild`) to record that Angular has been removed and `web/` is the sole frontend.

## Self-review (spec coverage)

| Phase 3 spec item | Covered by |
|---|---|
| #11 finish Next.js parity → delete Angular | Tasks 1–3 (gated on parity) |

**Risk note:** deletion is fully reversible via `git revert`/checkout of the deletion commit, so the only real risk is cutting over before parity. Task 1's gate exists precisely to prevent that.
