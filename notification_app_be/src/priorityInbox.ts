import express from "express";
import axios from "axios";
import { log } from "../../logging_middleware/logger";

const app = express();
app.use(express.json());

const BASE_URL = "http://20.207.122.201/evaluation-service";
const TOP_N = 10;

interface Notification {
  ID: string;
  Type: "Placement" | "Result" | "Event";
  Message: string;
  Timestamp: string;
}

const WEIGHT: Record<string, number> = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

function priorityScore(n: Notification): number {
  const weight = WEIGHT[n.Type] ?? 0;
  const ts = new Date(n.Timestamp).getTime();
  return weight * 1e13 + ts;
}

type HeapItem = { score: number; notif: Notification };

function heapPush(heap: HeapItem[], item: HeapItem): void {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (heap[parent].score <= heap[i].score) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}

function heapPop(heap: HeapItem[]): HeapItem {
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < heap.length && heap[l].score < heap[smallest].score) smallest = l;
      if (r < heap.length && heap[r].score < heap[smallest].score) smallest = r;
      if (smallest === i) break;
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
  }
  return top;
}

async function getTopNNotifications(token: string, n: number): Promise<Notification[]> {
  console.log("Fetching notifications...");
  await log("backend", "info", "service", `Fetching notifications for top-${n} priority inbox`, token);

  const res = await axios.get<{ notifications: Notification[] }>(
    `${BASE_URL}/notifications`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const all = res.data.notifications;
  console.log(`Fetched ${all.length} notifications. Building heap...`);
  await log("backend", "info", "service", `Total notifications fetched: ${all.length}`, token);

  const heap: HeapItem[] = [];
  for (const notif of all) {
    const score = priorityScore(notif);
    heapPush(heap, { score, notif });
    if (heap.length > n) {
      heapPop(heap);
    }
  }

  console.log("Heap built. Sorting...");
  const result = heap
    .sort((a, b) => b.score - a.score)
    .map((h) => h.notif);

  await log("backend", "info", "service", `Top-${n} notifications selected`, token);
  return result;
}

app.post("/api/priority-inbox", async (req, res) => {
  console.log("Received POST /api/priority-inbox request");
  const token = req.body.token;
  if (!token) {
    return res.status(400).json({ error: "Token is required in request body" });
  }

  await log("backend", "info", "handler", "Priority Inbox API started", token);

  try {
    const topNotifs = await getTopNNotifications(token, TOP_N);
    await log("backend", "info", "handler", "Priority Inbox API completed", token);
    
    console.log("Successfully fetched notifications. Sending response...");
    res.json({
      status: "success",
      message: `Top ${TOP_N} Priority Notifications`,
      notifications: topNotifs
    });

  } catch (err: any) {
    console.error("Error occurred:", err);
    const msg = err instanceof Error ? err.message : String(err);
    await log("backend", "error", "handler", `Failed to fetch notifications: ${msg}`, token);
    res.status(500).json({ error: msg });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
