# Ledger — Functional Specification (Handoff to Discovery & Development)

> **Purpose of this document.** Describe, at a functional level, the personal‑finance experience we prototyped, so the discovery team can refine details and development can plan implementation. It intentionally avoids visual styling (colors, fonts, exact sizes). Where it describes calculation logic or behavior, treat it as a **proposal to be validated during discovery**, not a final ruling.

> **Status of the logic.** Every business rule below (roll‑ups, proportional distribution, reassignment on delete, type/sign behavior) is a **proposed** behavior derived from the prototype. Discovery should confirm, adjust, or replace it.

---

## 1. Product overview

Ledger is a personal‑finance app for tracking money movements against a budget. It has two faces of the **same** product (shared data, shared concepts):

- **Mobile** — the everyday capture tool. The primary screen is registering a movement; budget is viewable one month at a time and operable on a phone; indicators are a condensed dashboard.
- **Desktop** — the planning and analysis tool. A full year‑wide budget grid with per‑month budgeted/actual columns, inline editing, category management, and a full dashboard.

The same data is presented at the depth each device affords. Nothing is mobile‑only or desktop‑only in *concept* — only in *layout and density*.

---

## 2. Core concepts (shared vocabulary)

These concepts underpin every screen. Discovery should lock the naming.

### 2.1 Movement types (3)
Every amount in the system belongs to one of three **types**:

1. **Expense** (money out)
2. **Income** (money in)
3. **Transfer** (money moved between the user's own places, e.g. to savings)

Each type carries a **sign** used when displaying amounts:
- Expense → shown as a negative/"minus" amount.
- Income → shown as a positive/"plus" amount.
- Transfer → shown as a neutral/"exchange" amount.

> **Proposed for discovery:** the three types are **fixed** (they are the top axis everywhere). The user does **not** create or delete types — only the hierarchy *beneath* them. (See Open Decision D‑1 for the fixed‑vs‑dynamic alternative.)

### 2.2 Category hierarchy (3 editable levels under each type)
Beneath each type, the user manages a hierarchy:

```
Type (fixed: Expense / Income / Transfer)
└── Group            (e.g. "Essentials", "Lifestyle", "Work")
    └── Category      (e.g. "Food", "Housing", "Transport")
        └── Subcategory (e.g. "Groceries", "Restaurants", "Coffee")
```

- A **Group** contains Categories.
- A **Category** contains Subcategories — **or** can stand alone as a leaf (no subcategories).
- A **Subcategory** is always a leaf.
- "Leaf" = the lowest level that actually holds amounts. A Category with no subcategories is itself a leaf.

### 2.3 Movement
A single recorded transaction: an **amount**, a **type**, a target **category (or subcategory)**, and a **period (month)**. Movements feed the **Actual** ("Ejecutado") figures.

### 2.4 Budgeted vs Actual
For each leaf and each month there are two numbers:
- **Budgeted** ("Presupuestado") — the plan.
- **Actual** ("Ejecutado") — what really happened (sum of movements, or a directly entered value).

Higher levels (Category, Group, Type) never store their own number — they **roll up** from their leaves (see §3.1).

---

## 3. Business rules (proposed — to be refined in discovery)

### 3.1 Roll‑up (bottom‑up aggregation)
Amounts always aggregate upward:

```
Subcategory → Category → Group → Type
```

- A Category's Budgeted/Actual for a month = the sum of its Subcategories' values for that month.
- A Group's value = the sum of its Categories.
- A Type's value = the sum of all its leaves.
- Editing a leaf re‑computes every ancestor automatically.

### 3.2 Proportional distribution (editing a parent)
When the user edits the **Budgeted** value of a node that **has children** (e.g. a Category with subcategories), the new total is **distributed proportionally** across its children, preserving their existing ratios. Example: a category budgeted at 2,000,000 split 50/30/20 across three subcategories, edited to 3,000,000, becomes 1,500,000 / 900,000 / 600,000.

- If children currently sum to zero, distribute evenly.
- Editing a **leaf** directly sets that leaf's value (no distribution).
- The same edit affordance exists for **Actual**, with the same distribution behavior. *(Discovery to confirm whether editing Actual on a parent should distribute, or be disallowed in favor of movement entry — see D‑3.)*

### 3.3 Reassignment on delete
When the user deletes a **Category that has movements** attached:
- The system must not silently lose history.
- The user is asked to **reassign** the affected movements to another sibling category (same type) before deletion completes.
- Deleting a leaf with no movements deletes directly.
- Deleting a Group that still contains categories is **blocked** until the categories are moved or removed first. *(Discovery to confirm the exact guardrail — block vs cascade.)*

### 3.4 Type / sign behavior
- The active type determines which slice of the hierarchy is shown and which **sign/semantics** amounts use.
- Variance coloring is driven by type:
  - **Expense:** Actual above Budgeted is an over‑budget condition (a warning state).
  - **Income:** Actual at/above Budgeted is favorable; below is an under‑performing state.
  - **Transfer:** neutral (informational, no over/under judgment). *(Discovery to validate whether transfers should ever flag variance.)*

### 3.5 Persistence
All data persists locally between sessions in the prototype. *(Discovery/architecture to define the real backend, sync, multi‑device, and currency handling. The prototype assumes a single currency, COP.)*

---

## 4. Modules & screens (functional prose)

There are four functional areas. Each is described by **what it does**, **what it contains**, and **what actions it offers**.

### 4.1 Category management

**What it does.** Lets the user build and maintain the full Type → Group → Category → Subcategory hierarchy that every other screen depends on.

**What it contains.**
- A selector across the **three fixed types** (Expense / Income / Transfer). Each type sits next to a small **type icon** (a "down/out" mark for expense, an "up/in" mark for income, an "exchange" mark for transfer) to its left.
- An expandable list of **Groups** for the selected type. Each group row shows:
  - A **chevron icon** (left) that expands/collapses the group.
  - A **group icon** (a folder mark) indicating it is a container.
  - The group name, preceded by a two‑digit ordinal (e.g. "01 — Essentials").
  - A short meta line (how many categories it holds).
  - On the right, an **edit icon** (pencil) and a **delete icon** (trash).
- Expanding a group reveals its **Categories**; each category row shows a chevron, its own **category icon** (a representative glyph the user picks), the name, an optional **count badge** ("N movs") when movements exist, and the edit/delete icons.
- Expanding a category reveals its **Subcategories**; each shows a small **branch/leaf icon**, the name, and edit/delete icons.
- At the end of each level, an **"add" affordance** with a **plus icon**: "New subcategory" inside a category, "New category" inside a group, and "New group" at the bottom.

**What actions it offers.**
- **Create** a group, category, or subcategory (opens a small form/sheet to name it; categories also pick an icon).
- **Rename** any node (pencil).
- **Delete** any node (trash) — triggering the reassignment / guardrail flow in §3.3.
- **Expand / collapse** at every level.

### 4.2 Movement registration ("Registrar")

**What it does.** Captures a single movement quickly. On mobile this is the **primary / home screen**.

**What it contains.**
- A prominent **amount display** at the top (the "hero"), preceded by the active type's **sign**.
- A selector across the **three types** (each with its type icon). Choosing a type re‑scopes the category options below.
- A **category selector** (horizontally scrollable on mobile; a dropdown on desktop), each option carrying its category icon.
- A **subcategory selector** that appears only when the chosen category has subcategories.
- A **month selector** (defaults to the current month).
- A numeric **keypad** (mobile) for entering the amount, including a "triple‑zero" key and a **backspace icon** key. On desktop, amount is typed directly.
- A primary **"Save movement"** button.
- A **recent movements** list below, each line showing the category icon, the category/subcategory name, a meta line (type + when), and the signed amount.

**What actions it offers.**
- Pick type → pick category → (optional) subcategory → pick month → enter amount → **Save**.
- Saving adds the amount to the **Actual** of the target leaf for the chosen month, updates all roll‑ups, and prepends the movement to the recent list.

> **Desktop note.** On desktop this same capability exists as an **optional side panel** ("New movement"), because on desktop the faster path is editing values directly in the budget grid (§4.3). On mobile it is the main screen.

### 4.3 Budget ("Presupuesto")

**What it does.** Shows the plan vs reality across time, and lets the user edit both the plan and the actuals in place.

#### Desktop layout
**What it contains.**
- A **summary strip** of headline indicators at the top (see below), driven by the active period filter.
- **Period filter** controls:
  - A **Month / Year** toggle.
  - When "Month" is active, a **month picker** (defaults to the current month).
  - **Important:** the filter affects only the **summary indicator cards at the top** — the grid below always shows all twelve months.
- A **view toggle**: **Summary** (the grid) vs **Dashboard** (§4.4).
- The **grid** itself:
  - A fixed (sticky) left **Category column** listing the hierarchy: each Type total row, then its Groups, Categories, and Subcategories, expandable at every level. Indentation communicates depth; a chevron icon toggles expansion; each node carries its level icon (type / folder / category glyph / branch).
  - **Twelve month columns**, horizontally scrollable, the column headers staying visible while scrolling. The currently selected month (from the filter) is highlighted in the header to connect the two.
  - Each month is split into **two sub‑columns: Budgeted and Actual**.
  - Type total rows and the hierarchy roll up per §3.1; over/under coloring per §3.4.
  - Hovering a hierarchy row reveals its **action icons**: a **plus** (add child, on categories), a **pencil** (rename), and a **trash** (delete). Type total rows have no actions.
  - End‑of‑level **"add" rows** (plus icon) to create a new group/category/subcategory directly in the grid.

**What actions it offers.**
- **Edit Budgeted** of any category or subcategory by clicking its Budgeted cell (parent edits distribute per §3.2).
- **Edit Actual** of any category or subcategory by clicking its Actual cell — the in‑grid alternative to the movement panel.
- **Add / rename / delete** hierarchy nodes inline (same model as §4.1, so the two stay in sync).
- **Switch** Summary/Dashboard; **change** the period filter for the summary cards.

#### Summary indicators (top strip) — minimum set
At minimum, the summary strip should present, for the selected period:
1. **Budgeted total** (expenses).
2. **Actual / executed total**, with the **percent of budget** used.
3. **Available / remaining** (budget minus actual), flagged when it goes negative (over budget).

### 4.4 Dashboard ("Indicadores")

**What it does.** Turns the same budget data into a financial health view. Respects the Month/Year period filter.

**Minimum set of indicators** (discovery may add more; chart *types* are intentionally unspecified — choose what communicates each best):
1. **Income** (executed, for the period) with its budgeted reference.
2. **Expenses** (executed) with its budgeted reference.
3. **Net balance** (income minus expenses), flagged positive/negative.
4. **Savings rate** (net balance as a percentage of income).
5. **Budget adherence for expenses** — how much of the expense budget has been executed (a single percentage with a sense of "under / near / over"). *(Visual treatment open; only the indicator is required.)*
6. **Top expense categories** — a ranked list of where money is going, largest first.
7. **Over‑budget list** — the categories whose Actual exceeds Budgeted, with how much over (and/or by what percent). When nothing is over budget, show a clear "all within budget" state.

> A monthly income‑vs‑expense trend across the year is desirable as a supporting visual, but the **seven indicators above are the minimum**. Whether any of them is a chart, a bar, or a number is for discovery/design to decide based on value.

---

## 5. Mobile vs Desktop — what changes

The product is one system; the device changes **density and entry points**, not concepts.

| Area | Mobile | Desktop |
|---|---|---|
| **Primary screen** | Register a movement (home). | The full budget grid. |
| **Navigation** | Bottom navigation with three destinations — Register, Budget, Indicators — each with an icon. | A view toggle (Summary / Dashboard) plus an optional movement panel. |
| **Budget view** | **One month at a time** (month picker in the header). Hierarchy shown as stacked cards with a progress bar and Budgeted/Actual per node. | **All twelve months** at once, horizontally scrollable, Budgeted/Actual sub‑columns, sticky category column + headers. |
| **Editing values** | Tap a node's Budgeted/Actual to edit (same rules). | Click any Budgeted/Actual cell in the grid to edit. |
| **Movement entry** | The main screen, with a numeric keypad. | An optional side panel (because in‑grid editing is faster on desktop). |
| **Category management** | Available within the budget cards (add/rename/delete icons per node). | Available inline in the grid, plus the standalone management list. |
| **Dashboard** | Condensed: stacked indicator cards. | Full: indicator cards plus supporting visuals side by side. |
| **Period filter** | Implicit via the month picker (mobile budget is single‑month by nature). | Month/Year toggle; affects the summary cards only, grid stays full‑year. |

**Responsive rule of thumb:** below a phone‑width breakpoint, the app presents the mobile shell (bottom nav + single‑month budget + keypad capture); at wider widths it presents the desktop shell (full grid + panels). The underlying data and rules are identical.

---

## 6. Icon inventory (placement & meaning — no visual styling)

| Icon (meaning) | Where it appears | What it does / represents |
|---|---|---|
| **Expense mark** (down/out) | Type selectors (categories, registration, budget type rows) | Identifies the Expense type. |
| **Income mark** (up/in) | Same type selectors | Identifies the Income type. |
| **Transfer mark** (exchange) | Same type selectors | Identifies the Transfer type. |
| **Chevron** (right/down) | Left of every expandable row (groups, categories, type totals) | Expand / collapse. |
| **Folder** | Group rows | Marks a node as a Group (container). |
| **Category glyph** (user‑chosen, e.g. food, home, transport…) | Category rows and chips | Visual identity of a category; chosen when creating/editing a category. |
| **Branch / leaf** | Subcategory rows | Marks the lowest level. |
| **Plus** | End‑of‑level "add" affordances; category row hover (add subcategory); mobile "New movement" entry | Create a new node / start a new movement. |
| **Pencil** | Hover/actions on a hierarchy row | Rename the node. |
| **Trash** | Hover/actions on a hierarchy row | Delete the node (triggers reassignment/guardrail flow). |
| **Check** and **X** | Inline delete confirmation on a row | Confirm / cancel the deletion. |
| **Backspace** | Mobile numeric keypad | Delete last digit of the amount. |
| **Calendar / month** | Period and month selectors | Scope by month/year. |
| **Trend (up‑right)** | Mobile bottom nav (Indicators) and certain category glyphs | Navigate to the dashboard / represent growth categories. |
| **Close (X)** | Top of the desktop movement panel and any sheet/overlay | Dismiss the panel/overlay. |

> Icons are **functional markers only**; their concrete artwork is a design decision. The product uses **no emoji**.

---

## 7. Open decisions for discovery

These are deliberately unresolved — they shape data model and scope.

- **D‑1 — Fixed vs dynamic types.** The prototype treats the three types (Expense/Income/Transfer) as **fixed**, with the editable hierarchy beneath them (regression‑safe). An alternative is to let the top axis be **user‑defined groups that each declare a sign**. Decide which model to build; it materially changes the data model.
- **D‑2 — Reassignment on delete.** Confirm the exact flow when deleting a category with history: forced reassignment to a sibling (proposed), soft‑delete/archive, or cascade. Confirm the guardrail for deleting non‑empty groups (block vs cascade).
- **D‑3 — Editing Actual directly.** We allow editing the **Actual** value in the grid as a shortcut. Decide whether actuals should be **derived only from movements** (edit disabled), or remain directly editable (and if so, how that reconciles with the movement log).
- **D‑4 — Proportional distribution.** Validate that distributing a parent's edited amount across children by existing ratios is the desired behavior (vs. locking parents, or a different allocation strategy).
- **D-5 — Movement ↔ budget linkage.** In the prototype the registration panel and the budget grid write to the same actuals. Confirm whether mobile capture and desktop grid share one movement log end‑to‑end, including edits and deletions.
- **D‑6 — Periods, currency, and projection.** The prototype shows a single year, single currency (COP), with some months "executed" and future months "projected." Define multi‑year, currency handling, and how projection vs actual is determined.
- **D‑7 — Reordering.** Drag‑to‑reorder of groups/categories/subcategories is **not** in the prototype; decide if it is in scope.
- **D‑8 — Subcategory‑level movement assignment.** Confirm whether movements can target subcategories directly (prototype allows it) and how that interacts with category‑level budgets.

---

## 8. Proposed phased development

A gradual path so value ships early and risk is contained. Phases are sequential but each is independently shippable.

### Phase 0 — Foundations
- Lock the **data model**: types, hierarchy (Group/Category/Subcategory), movements, budgeted/actual per leaf per month.
- Decide **D‑1** (fixed vs dynamic types) and **D‑6** (periods/currency) — both block later work.
- Establish persistence/backend and the responsive shell (mobile bottom nav vs desktop layout).

### Phase 1 — Capture (mobile‑first MVP)
- **Movement registration** screen (mobile home): type, category, optional subcategory, month, amount, save.
- Category hierarchy **read** + minimal **create** so there's something to register against.
- Recent movements list.
- *Outcome:* users can record real money movements on a phone.

### Phase 2 — Category management (full CRUD)
- Complete create/rename/delete across all three levels, with icons for categories.
- **Reassignment on delete** and group guardrails (resolve **D‑2**).
- Sync this management with wherever categories are edited (mobile cards and desktop grid).
- *Outcome:* users fully own their taxonomy.

### Phase 3 — Budget (mobile single‑month, then desktop grid)
- **Mobile:** single‑month budget cards with progress, inline Budgeted/Actual editing per node, roll‑ups.
- **Desktop:** full‑year grid with Budgeted/Actual sub‑columns, sticky category column + headers, horizontal scroll, inline editing, proportional distribution (**D‑4**), in‑grid CRUD.
- Resolve **D‑3** (direct actual editing) and **D‑5** (movement ↔ budget linkage).
- Summary indicator strip with the minimum three indicators.
- *Outcome:* plan vs reality, editable, on both devices.

### Phase 4 — Dashboard / indicators
- The seven minimum indicators (§4.4), respecting the Month/Year filter.
- Supporting trend visual if validated.
- *Outcome:* financial health at a glance.

### Phase 5 — Enhancements (post‑MVP, optional)
- Drag‑to‑reorder (**D‑7**), multi‑year, multi‑currency, export, and any indicators beyond the minimum.

---

*End of functional specification. All calculation/behavior rules above are proposals for the discovery team to validate and refine.*
