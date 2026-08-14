# Admin, Renewals, Reminders & PWA — August 2026

**Status:** committed to `feat/admin-renewals-and-payment-guards` (backend) and
`feat/admin-renewals-pwa-staging` (frontend). **Not pushed. Not deployed.**

Every section below is written twice: **In plain English** for presenting, and
**Technically** for the engineering detail.

---

## 1. Executive summary

We set out to add a renewals view to the admin. In doing so we found four things
that were quietly costing money or misleading the team:

| # | Finding | Impact |
|---|---|---|
| 1 | **WhatsApp reminders have not reached anyone since ~March 2026** | 212 of 225 messages never delivered. The system reported success every time. |
| 2 | **A customer was charged 3× for one renewal** | ₦15,000 taken for a ₦5,000 job. ₦10,000 still owed back. |
| 3 | **Reminder emails were sent per vehicle, not per customer** | A 12-vehicle customer could get 5 emails in one morning. |
| 4 | **Cancelling an order was a one-way door** | One mis-click left a paying, already-served customer showing as 909 days overdue for three months. |

All four are now either fixed or have a fix ready to deploy. Two require action
outside the codebase (see §8).

---

## 2. The renewals call list

**In plain English.** There is now a "Renewals" page in the admin showing every
customer whose vehicle licence has expired or is about to. It is grouped by
urgency, sorted so the most urgent are at the top, and every phone number and
email is a link you can tap to call, message or email straight away. The team
can work down the list.

Critically, it tells you who **not** to call. If someone has already paid and
their renewal is in progress, the row says so. If someone paid but their order
was cancelled, it flags that as a billing problem to sort out rather than a sales
call. Ringing a customer who has already paid is worse than not ringing at all.

There is also a tab for **34 customers who explicitly asked to be reminded**
about a document when they checked out. Nothing in the system had ever read that
list.

**Current state of the book:** 55 expired, 0 due today, 0 in the next 7 days,
5 in 8–30 days, 4 in 31–90 days. Two thirds of the book has already lapsed, and
the automated reminders only ever looked *forward* — they never revisited anyone
who had already expired.

**Technically.**

- `GET /admin/renewals?bucket=&search=&page=&limit=` — buckets are
  `expired | today | week | month | quarter`. Returns the requested page plus
  counts for every bucket, so tab badges stay accurate regardless of the open tab.
- `GET /admin/renewals/deferred` — reads `deferred_document_reminders`.
- Read-only by design. It sends nothing, so it cannot trigger a mass send.
- Classification per row (`renewal_state`):
  - `chase` — genuinely owes; safe to contact. Renders no badge; absence is the signal.
  - `in_progress` — an open (`pending`/`processing`) `renewal_orders` row exists.
  - `needs_review` — a cancelled order plus a successful renewal payment.
- Uses the existing `buildExpiryStatus(expiryDate, now, pendingOrder)` util. It has
  always accepted `pendingOrder` to return "Renewal in progress" — it was simply
  never passed. That omission was the original cause of paid customers appearing
  as overdue.
- Sorted by `days_left` ascending (most overdue first). The sort is stated in
  words in the UI, because a column arrow does not tell a non-technical user which
  end is urgent.

---

## 3. Payment reminders — what was actually happening

**In plain English.** We assumed reminders came from the main backend. They do
not: they run on **two separate scheduled jobs inside Supabase**, both firing at
8am, and neither is visible in the main codebase. That is why the behaviour was
confusing.

The email reminders work well and always have — 92 of the last 100 emails were
delivered. The problem was the *shape*: the system sent one email **per vehicle**.
A customer with 12 vehicles could receive five separate emails in the same
morning, each individually correct and collectively spam. It now sends **one
email per customer** listing all their vehicles.

WhatsApp is a different story — see §4.

**Technically.**

- Two Supabase Edge Functions, each on its own `pg_cron`, both `0 8 * * *`:
  - `expiry-notifications` — 9 stages per car: −30, −14, −7, −3, −2, −1, 0, +3, +7
  - `deferred-doc-notifications` — the "remind me later" table
- Rewrote `expiry-notifications` to group by `user_id` (not email — two accounts
  sharing an address must not merge) via `buildDigests()` → `processDigest()` →
  `sendExpiryDigest()`.
- A single-vehicle customer still receives the original one-car email, unchanged.
- **Idempotency preserved**: history is still written per `(car, stage, expiry)`
  into `expiry_notification_history`, and only *after* a successful send, so a
  failed digest retries in full rather than marking some vehicles as done.
- Digest subject takes urgency from the most urgent vehicle, so an overdue car is
  never buried behind a 30-day reminder in the inbox.
- Measured over a simulated year on real data: 233 → 218 emails (−6.4%). Modest in
  aggregate because most customers own one vehicle; the benefit is concentrated
  where the pain was — worst single day goes **4 emails → 1**, and the 12-vehicle
  customer loses 10 multi-email days.

> **Open question worth raising:** 9 stages is aggressive. That 12-vehicle customer
> would still hear from us on 36 days a year. Cutting −3/−2/−1 down to just −1
> would roughly halve that and probably convert no worse.

---

## 4. WhatsApp has been dead since March

**In plain English.** Every WhatsApp reminder sent since about March has reached
nobody. The phone number Motoka sends from is registered as **offline** with
Twilio, so the messages fail the moment they leave us.

Worse, the system reported success anyway. It logs "sent" when Twilio *accepts*
the request, not when the message is *delivered* — so five months of total failure
looked like five months of success on the dashboard.

Of 225 messages sent from the production number, **13 were ever read**, all on
22 March. A broadcast of 109 messages on 14 August failed 109 out of 109.

**This cannot be fixed in code.** Re-activating the sender is done in the
Twilio/Meta console.

**Technically.**

- Both senders (`+2349126217815` "Motoka", and sandbox `+14155238886`) report
  status `OFFLINE`. Failures are Twilio error `63002`.
- Root cause is sender registration, not application code.
- The same blind spot exists on email: the code logs success on Resend *accepting*
  the request, and no Resend webhook is configured (`/webhooks` returns empty), so
  the 8 bounces in the last 100 emails are invisible to anyone.
- **Recommendation:** record delivery outcomes, not just API acceptance. A Twilio
  status callback and a Resend webhook would have surfaced this in a day rather
  than five months.

### Manual broadcast buttons removed

The dashboard's "Send Now" buttons drove a *second*, redundant reminder system on
this dead channel, with no deduplication — one click sent 109 messages. Removed
from the UI, and blocked server-side unless `ADMIN_BROADCAST_ENABLED=true`. Dry
runs still work.

---

## 5. Duplicate charges

**In plain English.** One customer paid three times in ninety seconds for a single
renewal — ₦15,000 for a ₦5,000 job. They had several checkout pages open and paid
on each; one attempt even switched payment provider mid-flow.

Two safeguards existed and neither could catch it. The first only cleans up
payments that have not been completed yet, which is useless once the bank already
has the money. The second stops the *same* payment being processed twice, but
these were three genuinely different payments.

There is now a third check that recognises "this vehicle has already been paid
for and served" and refuses to create a second order. Importantly it never
rejects the payment — the money has already left the customer's account, so
recording it is what makes a refund possible. It marks the charge for refund
instead, and suppresses the "your order is confirmed" email that would otherwise
go out.

**Technically.**

- Sequence: 3 × `successful` @ ₦5,000 within 90s across Monicredit and Paystack,
  none linked to an order. Three earlier attempts were correctly tagged
  `duplicate_init` and abandoned.
- Why existing protection missed it:
  - the init-time guard in `payment-init.controller.js` only abandons **pending** rows
  - the RPC's `ON CONFLICT ON CONSTRAINT renewal_orders_transaction_unique` is
    per-**transaction**, so N distinct references for one car each pass
- Fix added in `processPaymentSuccess()` (`services/payment/transaction.service.js`)
  — the single choke point every success flows through. **Deliberately not in
  `process_payment_success()`**, which has been regressed twice (025 → 051 → 065)
  and is documented as fragile.
- Behaviour: if an earlier successful transaction for the same
  `user + car + payment_type` within `DUPLICATE_CHARGE_WINDOW_MS` (default 24h)
  already produced an order, the new charge is recorded `successful` with
  `cancellation_reason = 'duplicate_charge'`, the order-creating RPC is skipped,
  and it returns `{ duplicateCharge, refundDue, alreadyProcessed: true }`.
  `alreadyProcessed` is already checked by every caller, so confirmation emails
  are suppressed.
- Conservative by design: if the earlier charge produced **no** order, this one is
  allowed through (it may be the customer's only fulfilment) and logs a warning,
  so a burst cannot leave an orphan charge invisible.
- Tests: `src/__tests__/duplicateCharge.test.js` (4 cases, passing).

---

## 6. Reopening a cancelled order

**In plain English.** A customer's document had been processed and handed over,
but the order was marked "cancelled" by mistake. Because of that, the system never
advanced their licence expiry date — so they sat on the overdue list for three
months while having actually been served.

The awkward part: there was no way to undo it. Cancelling was a one-way door.
There is now a **Reopen Order** button. Reopening puts the order back in the
queue; marking it Completed afterwards is what actually updates the expiry date,
and that stays a separate deliberate step.

**Technically.**

- `POST /admin/orders/:orderNumber/reopen` — 409 unless the order is `cancelled`.
- Clears `cancelled_at` / `rejection_reason`, sets `status = 'pending'`, records a
  note and the acting admin.
- Does **not** complete the order. `completeOrder()` computes the new expiry as
  `expiry < today ? today : expiry` + `renewal_months`, so a long-lapsed vehicle
  correctly lands in the future rather than back-dated.
- Verified: all 6 previously completed orders had correctly advanced their car's
  expiry, so the write-back path itself was never broken.
- `completeOrder()` sends no email or WhatsApp, so completing an order months late
  will not fire a stale "your renewal is ready" message.

---

## 7. Progressive Web App (PWA)

**In plain English.** Motoka can now be installed on a phone's home screen
straight from the browser — no app store, no review delay, no 30% cut. It opens
full-screen like a normal app, and it still works on a poor connection: we proved
this by switching the server off entirely and reloading, and the app still opened.

Android users get a one-tap Install button. iPhone users get instructions,
because Apple does not allow websites to offer one-tap installation.

Push notifications are **not** included yet — that is a follow-up, and it depends
on the reminder work being deployed first.

**Technically.**

- `vite-plugin-pwa` with a generated manifest, icons rendered from the existing
  `motoka logo.svg` (192/512 standard + maskable + Apple touch icon).
- `registerType: 'prompt'`, not `autoUpdate`. This app takes payments; an
  automatic asset swap mid-checkout can strand a user on a half-old bundle. New
  builds download and wait for the user to tap Update.
- **Nothing from `/api` is cached** (`NetworkOnly`). Verified: 0 API responses in
  any cache after a live request. A stale cached price is a support incident.
- Raster media excluded from precache — the build ships a 14 MB PNG, a 10 MB JPG
  and two 5 MB GIFs; precaching ~40 MB on first visit over Nigerian mobile data
  would defeat the point. SVGs *are* precached (~900 KB) because the logo is one.
- Service worker disabled in `vite dev`; test installs against a preview build.
- Verified offline end-to-end by killing the preview server and reloading a deep
  link — app shell, logo and routing all resolved from cache.

> **Separate but related:** the build ships **41 MB of images**, and the JS is a
> single 2.8 MB chunk. Compressing that media and code-splitting would likely do
> more for real users than the PWA itself.

---

## 8. What still needs a human

| # | Item | Who |
|---|---|---|
| 1 | **Re-activate the WhatsApp sender** in the Twilio/Meta console. Nothing sends until this is done. | Ops |
| 2 | **Refund ₦10,000** to the customer charged three times. No payment records were touched. | Finance |
| 3 | **Reopen + complete `ORD-20260515-270C94`.** Orders → Reopen → Completed. Expiry will land on 2027-08-14. | Admin |
| 4 | **Deploy the edge function.** `supabase functions deploy expiry-notifications` — the digest fix does nothing until then. | Eng |
| 5 | **Resolve the Supabase project mismatch.** Migrations 014/047 point at `sbogxkurbwiwkaacochb`; `.env` uses `ucvnkouowpghnffvxrnb`. Confirm which runs the cron *before* deploying. | Eng |
| 6 | **Rotate the secret** committed in plaintext in migration 047. | Eng |

### Recommended next

- **Delivery tracking** on both channels (Twilio status callback, Resend webhook).
  This is the single change that would have caught the WhatsApp outage in a day.
- **Stagger the two crons** — both fire at `0 8 * * *`, so one customer can receive
  an expiry digest and a deferred-document email in the same minute.
- **Reduce reminder stages** from 9 to ~5.
- **Per-document expiry dates.** Motoka sells 7 renewal items (licence, insurance,
  roadworthiness, hackney permit…) but a vehicle has a single `expiry_date`. In
  reality insurance and roadworthiness expire on different dates, and the schema
  cannot represent that. This is the ceiling on "know which document is which".
- **Guest checkout is dormant** — 7 orders ever, zero converted, most recent March.
  A conversion problem, not a tooling gap.

---

## 9. Verification performed

- All 18 admin API endpoints return 200.
- Full test suite: 153 passing. **22 failures are pre-existing** — verified by
  stashing this work and re-running; identical failures in the same 3 suites. One
  (`expiryStatus.test.js`) fails purely on copy: it expects "No reminder available"
  where the code says "Up to date".
- Frontend lints clean on all changed files and builds successfully.
- Browser-verified: dashboard, renewals (all tabs, search, deep links), users,
  cars, payments. No console errors.
- Mobile-verified at a phone-width viewport: navigation collapses, tabs wrap, the
  table scrolls within its own container and the **page does not scroll sideways**.
- PWA verified against a production build, including a true offline reload.
