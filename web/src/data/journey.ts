export interface Stage {
  n: string
  title: string
  where: string
  body: string
  fail: string
  lang: 'http' | 'sql' | 'python'
  code: string
  lights: string[]
}

export const STAGES: Stage[] = [
  {
    n: '01',
    title: 'The request carries its own identity',
    where: 'Client → FastAPI',
    body: 'Checkout sends an Idempotency-Key. Pydantic validates the body before any database work begins; the key is what makes a retry safe.',
    fail: 'Client times out and retries with the same key → the API returns the original order. No second order, no second decrement.',
    lang: 'http',
    code: `POST /api/v1/orders HTTP/1.1
Idempotency-Key: 9f1c2e7a-checkout-41
Content-Type: application/json

{
  "customer_id": "cus_8d2k",
  "items": [{ "sku": "SKU-ORBIT-DESK", "qty": 1 }]
}`,
    lights: ['client', 'api'],
  },
  {
    n: '02',
    title: 'Claim the key, lock the stock row',
    where: 'PostgreSQL · BEGIN',
    body: 'One transaction opens. The idempotency key is inserted first; then the inventory row is locked so concurrent checkouts for the same SKU queue instead of racing.',
    fail: 'Two buyers race for the last unit → the second waits on the row lock, then sees on_hand = 0 and gets 409 INSUFFICIENT_STOCK.',
    lang: 'sql',
    code: `BEGIN;

INSERT INTO idempotency_keys (key, request_hash)
VALUES ($1, $2)
ON CONFLICT (key) DO NOTHING;      -- 0 rows → replay path

SELECT on_hand
  FROM inventory
 WHERE sku = 'SKU-ORBIT-DESK'
   FOR UPDATE;                     -- row lock, not table lock`,
    lights: ['t-idem', 't-inv'],
  },
  {
    n: '03',
    title: 'Write the order and move the stock',
    where: 'PostgreSQL · same transaction',
    body: 'Order, line items, the guarded decrement and an inventory movement are written together. A CHECK (on_hand >= 0) constraint is the last line of defence.',
    fail: 'Process dies mid-transaction → PostgreSQL rolls back. No order, no stock change, no event — nothing half-done to clean up.',
    lang: 'sql',
    code: `INSERT INTO orders (id, customer_id, status, total_cents)
VALUES ('ord_7Hq2', 'cus_8d2k', 'placed', 34900);

INSERT INTO order_items (order_id, sku, qty, unit_price_cents)
VALUES ('ord_7Hq2', 'SKU-ORBIT-DESK', 1, 34900);

UPDATE inventory
   SET on_hand = on_hand - 1
 WHERE sku = 'SKU-ORBIT-DESK' AND on_hand >= 1;

INSERT INTO inventory_movements (sku, delta, reason, order_id)
VALUES ('SKU-ORBIT-DESK', -1, 'sale', 'ord_7Hq2');`,
    lights: ['t-orders', 't-inv'],
  },
  {
    n: '04',
    title: 'The event commits with the order',
    where: 'PostgreSQL · COMMIT',
    body: 'Instead of writing to MongoDB (a dual write that can half-fail), the event is a row in the outbox table — durable in the very same commit.',
    fail: 'Crash right after COMMIT → the event is already durable. The relay will find it; nothing is lost and nothing was written twice.',
    lang: 'sql',
    code: `INSERT INTO outbox (event_id, aggregate_id, event_type, payload)
VALUES ('evt_51Ra', 'ord_7Hq2', 'order.placed',
        jsonb_build_object('order_id', 'ord_7Hq2', 'total_cents', 34900));

COMMIT;  -- order + stock + event: all visible, or none`,
    lights: ['t-outbox', 'commit'],
  },
  {
    n: '05',
    title: 'A relay publishes, at least once',
    where: 'Outbox relay → change stream',
    body: 'Relay workers claim unpublished rows with SKIP LOCKED, publish them in order, then mark them. Delivery is at-least-once by design.',
    fail: 'Relay crashes after publishing but before marking → the row is published again. That duplicate is expected, and handled downstream.',
    lang: 'sql',
    code: `SELECT event_id, payload
  FROM outbox
 WHERE published_at IS NULL
 ORDER BY position
 LIMIT 100
   FOR UPDATE SKIP LOCKED;   -- N relays, no double-claim

-- publish batch …

UPDATE outbox SET published_at = now()
 WHERE event_id = ANY($1);`,
    lights: ['relay', 'broker'],
  },
  {
    n: '06',
    title: 'The consumer applies it exactly once',
    where: 'Idempotent consumer → MongoDB',
    body: 'A processed-events ledger turns at-least-once delivery into an exactly-once effect. The resume token is checkpointed only after the write is durable.',
    fail: 'Consumer crashes → it resumes from its token. Token fell off the oplog (ChangeStreamHistoryLost) → full resync from PostgreSQL.',
    lang: 'python',
    code: `def handle(event):
    with client.start_session() as s, s.start_transaction():
        if db.processed_events.find_one({"_id": event.id}, session=s):
            return  # duplicate delivery: already applied

        db.order_views.update_one(
            {"_id": event.order_id},
            {"$set": project(event), "$max": {"version": event.position}},
            upsert=True, session=s)
        db.processed_events.insert_one({"_id": event.id}, session=s)

    checkpoint(event.resume_token)  # only after commit`,
    lights: ['consumer', 'mongo'],
  },
  {
    n: '07',
    title: 'Screens read the projection',
    where: 'MongoDB → API → dashboard',
    body: 'Order screens read one document shaped like the UI. Anything that must be exact — refunds, stock, money — still reads PostgreSQL.',
    fail: 'Read model drifts or is wiped → reconciliation compares against PostgreSQL and re-projects. The projection is disposable; the ledger is not.',
    lang: 'http',
    code: `GET /api/v1/orders/ord_7Hq2/view   → 200 OK

{
  "_id": "ord_7Hq2",
  "customer": { "id": "cus_8d2k", "tier": "gold" },
  "items": [{ "sku": "SKU-ORBIT-DESK", "qty": 1 }],
  "total_cents": 34900,
  "source_event_id": "evt_51Ra",
  "projected_by": "consumer"
}`,
    lights: ['mongo', 'dash'],
  },
]
