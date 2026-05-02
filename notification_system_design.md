# notification_system_design.md

---

## Stage 1

### Overview
A campus notification platform where students receive real-time updates for **Placements**, **Events**, and **Results**. The REST API is designed for a front-end client that displays notifications when a student is logged in.

---

### Core Actions

| Action | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| Get all notifications | GET | `/notifications` | Returns all notifications for the authenticated student |
| Get unread count | GET | `/notifications/unread/count` | Returns count of unread notifications |
| Mark one as read | PATCH | `/notifications/{id}/read` | Marks a specific notification as read |
| Mark all as read | PATCH | `/notifications/read-all` | Marks every notification as read for the student |
| Get top-N priority | GET | `/notifications/priority?n=10` | Returns top N notifications ranked by priority + recency |
| Delete a notification | DELETE | `/notifications/{id}` | Removes a notification for the student |

---

### Request / Response Contracts

#### GET `/notifications`

**Headers:**
```
Authorization: Bearer <token>
Accept: application/json
```

**Response (200 OK):**
```json
{
  "notifications": [
    {
      "id": "d146095a-0d86-4a34-9e69-3900a14576bc",
      "type": "Result",
      "message": "mid-sem",
      "timestamp": "2026-04-22T17:51:30Z",
      "isRead": false
    }
  ],
  "total": 1
}
```

---

#### PATCH `/notifications/{id}/read`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Response (200 OK):**
```json
{
  "id": "d146095a-0d86-4a34-9e69-3900a14576bc",
  "isRead": true,
  "updatedAt": "2026-04-22T18:00:00Z"
}
```

---

#### GET `/notifications/priority?n=10`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| n | integer | No (default 10) | Number of top notifications to return |

**Response (200 OK):**
```json
{
  "notifications": [
    {
      "id": "b283218f-ea5a-4b7c-93a9-1f2f240d64b0",
      "type": "Placement",
      "message": "CSX Corporation hiring",
      "timestamp": "2026-04-22T17:51:18Z",
      "isRead": false,
      "priorityScore": 95
    }
  ]
}
```

---

### Notification Schema

```json
{
  "id":        "uuid-v4",
  "studentId": "uuid-v4",
  "type":      "Placement | Result | Event",
  "message":   "string",
  "timestamp": "ISO-8601 datetime",
  "isRead":    false
}
```

---

### Real-Time Mechanism

**Approach: Server-Sent Events (SSE)**

- The frontend opens a persistent HTTP connection to `GET /notifications/stream`.
- The server pushes new notification events as they arrive using the `text/event-stream` content type.
- SSE is chosen over WebSockets because notifications are **server-to-client only** — no bidirectional communication is needed — and SSE works over standard HTTP, making it simpler to implement and scale.

**SSE Endpoint:**
```
GET /notifications/stream
Authorization: Bearer <token>
Accept: text/event-stream
```

**SSE Event Format:**
```
event: new_notification
data: {"id":"uuid","type":"Placement","message":"Google hiring","timestamp":"2026-04-22T18:00:00Z","isRead":false}
```

---

## Stage 2

### Recommended Database: PostgreSQL

**Reasoning:**
- Notifications have a well-defined, predictable schema (id, studentId, type, message, timestamp, isRead) — relational storage fits naturally.
- PostgreSQL supports partial indexes and enum types natively, which are needed for efficient unread-notification queries.
- ACID compliance ensures that a notification is never lost or double-delivered during concurrent writes.
- Rich support for range queries on `timestamp` (needed for "last 7 days" queries).

---

### DB Schema

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE students (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL,
    email      TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id         UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID              NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type       notification_type NOT NULL,
    message    TEXT              NOT NULL,
    is_read    BOOLEAN           NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- Index for the most common query pattern: a student's unread notifications
CREATE INDEX idx_notifications_student_unread
    ON notifications (student_id, is_read, created_at DESC)
    WHERE is_read = false;

-- Index to support type-filtered queries (e.g. "last 7 days of Placement")
CREATE INDEX idx_notifications_type_created
    ON notifications (type, created_at DESC);
```

---

### Key Queries

**Fetch all unread notifications for a student (improved version of the slow query):**
```sql
SELECT id, type, message, created_at
FROM   notifications
WHERE  student_id = $1
  AND  is_read    = false
ORDER BY created_at DESC;
```

**Placement notifications in the last 7 days:**
```sql
SELECT id, type, message, created_at
FROM   notifications
WHERE  type       = 'Placement'
  AND  created_at >= now() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

---

### Scaling Problems & Solutions

| Problem | Occurs When | Solution |
|---------|-------------|----------|
| Table scan slowness | Millions of rows, no index | Partial index on `(student_id, is_read)` |
| Write bottleneck | 50 k bulk inserts at once | Batch inserts + async queue (see Stage 5) |
| Read hotspot | Every page load hits DB | Caching layer (see Stage 4) |
| Storage growth | Notifications never deleted | Archival/partition by month |

---

## Stage 3

### Analysis of the Slow Query

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**Why it is slow:**
1. `SELECT *` fetches every column including potentially large `message` text — this increases I/O even if most columns are unused by the client.
2. With 5,000,000 rows and no index on `(studentID, isRead)`, the database performs a **full table scan** on every request.
3. The `ORDER BY createdAt DESC` requires a sort step on the full filtered result set if there is no supporting index.

**Is the query accurate?**
The query logic is correct for its intent, but `SELECT *` is a code-smell in production — always specify the columns you actually need.

---

### Is "index every column" good advice?

No. Adding an index on **every** column is harmful:
- Each index consumes disk space and must be updated on every `INSERT`, `UPDATE`, or `DELETE`.
- For a notification table that receives bulk writes (50 k at once during placements), wide-index coverage would drastically slow down writes.
- The query planner may even ignore poorly selective indexes (e.g. an index on the boolean `isRead` alone is useless since it has only 2 values).

**Correct approach:** Create a **partial composite index** that matches the WHERE clause + ORDER BY:
```sql
CREATE INDEX idx_notifications_student_unread
    ON notifications (student_id, is_read, created_at DESC)
    WHERE is_read = false;
```
This index is compact (only covers unread rows), covers the filter, and pre-sorts by recency — the query becomes an index scan with zero additional sort cost.

---

### Computation Cost Comparison

| Approach | Time Complexity | Notes |
|----------|----------------|-------|
| Full table scan (original) | O(N) | N = 5,000,000 |
| With partial index | O(log N + K) | K = matching unread rows for student |

---

### Placement Notifications — Last 7 Days

```sql
SELECT id, type, message, created_at
FROM   notifications
WHERE  type       = 'Placement'
  AND  created_at >= now() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

Supported by the index on `(type, created_at DESC)` created in Stage 2.

---

## Stage 4

### Problem
The DB is queried on **every page load** for every student, causing excessive read load and poor user experience.

---

### Solution: Read-Through Cache with Redis

**Strategy:**
1. On first request for a student's notifications, query the DB, cache the result in Redis with a short TTL (e.g. 60 seconds).
2. Subsequent page loads within the TTL window are served from Redis — zero DB hits.
3. When a new notification is written for a student, **invalidate** (delete) that student's cache key so the next read fetches fresh data.

**Cache key pattern:**
```
notifications:{studentId}:unread
```

**TTL:** 60 seconds (balances freshness vs. DB load).

---

### Trade-offs by Strategy

| Strategy | Pros | Cons |
|----------|------|------|
| **No cache (current)** | Always fresh | DB overloaded at scale |
| **Cache with TTL (recommended)** | Dramatically reduces DB reads | Possible stale data within TTL window |
| **Cache + invalidation on write** | Nearly real-time freshness | Slightly more complex write path |
| **Client-side cache (browser)** | Zero server cost | Stale across devices, no server control |
| **CDN caching** | Scales globally | Not suitable for per-user private data |

**Recommended:** Cache-aside pattern with Redis + invalidation on write. This gives near-real-time data for students while protecting the DB from read storms.

---

## Stage 5

### Shortcomings of the Proposed `notify_all` Implementation

```python
function notify_all(student_ids: array, message: string):
    for student_id in student_ids:
        send_email(student_id, message)   # calls Email API
        save_to_db(student_id, message)   # DB insert
        push_to_app(student_id, message)  # real-time push
```

**Problems identified:**
1. **Sequential processing** — 50,000 students processed one by one. At even 10 ms per iteration, this takes ~8 minutes.
2. **No partial failure handling** — if `send_email` fails at student 200, the remaining 49,800 students never receive any notification.
3. **Tight coupling of email + DB insert** — these are independent operations but run in series. A slow email API blocks the DB write.
4. **No retry logic** — a transient email API error causes silent data loss.
5. **DB write inside a loop** — 50,000 individual `INSERT` statements instead of a single bulk insert.

---

### Should saving to DB and sending email happen together?

**No.** They serve different purposes and have different failure modes:
- The **DB write** is the source of truth — it should succeed regardless of email delivery.
- The **email send** is an external side-effect — it can be retried independently.

Coupling them inside a single loop means a failed email prevents the notification from even being recorded in the DB.

---

### Revised Design

```python
function notify_all(student_ids: array, message: string):

    # Step 1: Bulk-insert all notifications into DB atomically
    records = [{"student_id": sid, "message": message, "type": "Placement"} 
               for sid in student_ids]
    db.bulk_insert("notifications", records)   # single transaction

    # Step 2: Enqueue each student for async processing
    for student_id in student_ids:
        job_queue.enqueue({
            "student_id": student_id,
            "message":    message
        })

# Workers pick up jobs concurrently
function worker_process(job):
    try:
        send_email(job.student_id, job.message)
    except EmailAPIError as e:
        job_queue.retry(job, max_retries=3, backoff="exponential")

    push_to_app(job.student_id, job.message)
```

**Key improvements:**
- DB write is a single bulk transaction — fast and atomic.
- Email and push are handled by a **job queue** (e.g. Redis + Celery, or BullMQ) processed by multiple concurrent workers.
- Each job is retried independently on failure — 200 failed emails do not block the other 49,800.
- The loop itself is now just queue enqueue operations, which are ~1 ms each.

---

## Stage 6

### Priority Inbox — Top N Notifications

**Priority Rule:** `Placement > Result > Event`, combined with recency.

**Approach: Max-Heap (Priority Queue)**

Each notification is assigned a composite score:
```
priority_weight = { Placement: 3, Result: 2, Event: 1 }
score = priority_weight[type] * 1e12 + unix_timestamp
```

Multiplying by a large constant ensures type-weight dominates over timestamp, but among same-type notifications, more recent ones rank higher.

A **max-heap of size N** is maintained:
- On each new notification arriving via SSE, push it onto the heap.
- If heap size exceeds N, pop the smallest element.
- The heap always contains the top-N notifications efficiently.

**Time complexity:** O(log N) per insertion — suitable for a continuous stream of new notifications.

**Space complexity:** O(N) — only N items are kept in memory.

---

### Code (Python — Top 10 Priority Notifications)

```python
import heapq
import requests
from datetime import datetime

BASE_URL = "http://20.207.122.201/evaluation-service"
PRIORITY_WEIGHT = {"Placement": 3, "Result": 2, "Event": 1}
TOP_N = 10

def score(notification: dict) -> int:
    weight = PRIORITY_WEIGHT.get(notification["Type"], 0)
    ts = int(datetime.fromisoformat(notification["Timestamp"]).timestamp())
    return weight * (10 ** 12) + ts

def get_top_n_notifications(token: str, n: int = TOP_N) -> list[dict]:
    resp = requests.get(
        f"{BASE_URL}/notifications",
        headers={"Authorization": f"Bearer {token}"}
    )
    resp.raise_for_status()
    notifications = resp.json()["notifications"]

    # Use a min-heap of size n to find top-n by score
    heap = []
    for notif in notifications:
        s = score(notif)
        heapq.heappush(heap, (s, notif))
        if len(heap) > n:
            heapq.heappop(heap)   # evict lowest-priority item

    # Return sorted highest-first
    result = [item[1] for item in sorted(heap, key=lambda x: -x[0])]
    return result

def main():
    TOKEN = "YOUR_AUTH_TOKEN_HERE"
    top_notifications = get_top_n_notifications(TOKEN, TOP_N)
    print(f"Top {TOP_N} Priority Notifications:\n")
    for i, n in enumerate(top_notifications, 1):
        print(f"{i}. [{n['Type']}] {n['Message']}  —  {n['Timestamp']}")

if __name__ == "__main__":
    main()
```
