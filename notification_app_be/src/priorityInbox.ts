import axios from "axios";
import { log } from "./logger";

const BASE_URL = "http://20.207.122.201/evaluation-service";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiYXVkIjoiaHR0cDovLzIwLjI0NC41Ni4xNDQvZXZhbHVhdGlvbi1zZXJ2aWNlIiwiZW1haWwiOiJoaW1ha3NoaV9jaGFkYWxhdmFkYUBzcm1hcC5lZHUuaW4iLCJleHAiOjE3Nzc3MDMyNjYsImlhdCI6MTc3NzcwMjM2NiwiaXNzIjoiQWZmb3JkIE1lZGljYWwgVGVjaG5vbG9naWVzIFByaXZhdGUgTGltaXRlZCIsImp0aSI6IjY3NzBlNmM5LTdjNTEtNDk4Yy04YWMxLWNhZmNkM2ZiM2NiNSIsImxvY2FsZSI6ImVuLUlOIiwibmFtZSI6ImhpbWFrc2hpIGNoYWRhbGF2YWRhIiwic3ViIjoiZTliODMyN2ItYTljMS00NDdjLWI3ZTMtYzQ2OTY2Y2M1NzY1In0sImVtYWlsIjoiaGltYWtzaGlfY2hhZGFsYXZhZGFAc3JtYXAuZWR1LmluIiwibmFtZSI6ImhpbWFrc2hpIGNoYWRhbGF2YWRhIiwicm9sbE5vIjoiYXAyMzExMDAxMTU5NiIsImFjY2Vzc0NvZGUiOiJRa2JweEgiLCJjbGllbnRJRCI6ImU5YjgzMjdiLWE5YzEtNDQ3Yy1iN2UzLWM0Njk2NmNjNTc2NSIsImNsaWVudFNlY3JldCI6IkdReXJKdHN3ZFBYbWRHRW0ifQ.HbAQocCPXw1NH8oa4FjIGLlsw3IrGWaWmUBCwPhw0x4";
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

async function getTopNNotifications(n: number): Promise<Notification[]> {
  await log("backend", "info", "service", `Fetching notifications for top-${n} priority inbox`, TOKEN);

  const res = await axios.get<{ notifications: Notification[] }>(
    `${BASE_URL}/notifications`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );

  const all = res.data.notifications;
  await log("backend", "info", "service", `Total notifications fetched: ${all.length}`, TOKEN);

  const heap: HeapItem[] = [];
  for (const notif of all) {
    const score = priorityScore(notif);
    heapPush(heap, { score, notif });
    if (heap.length > n) {
      heapPop(heap);
    }
  }

  const result = heap
    .sort((a, b) => b.score - a.score)
    .map((h) => h.notif);

  await log("backend", "info", "service", `Top-${n} notifications selected`, TOKEN);
  return result;
}

async function main(): Promise<void> {
  await log("backend", "info", "handler", "Priority Inbox service started", TOKEN);

  let topNotifs: Notification[];
  try {
    topNotifs = await getTopNNotifications(TOP_N);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("backend", "error", "handler", `Failed to fetch notifications: ${msg}`, TOKEN);
    throw err;
  }

  process.stdout.write(`\n==========================================\n`);
  process.stdout.write(`   Top ${TOP_N} Priority Notifications\n`);
  process.stdout.write(`==========================================\n`);

  topNotifs.forEach((n, idx) => {
    process.stdout.write(
      `\n${idx + 1}. [${n.Type}]\n   Message  : ${n.Message}\n   Timestamp: ${n.Timestamp}\n   ID       : ${n.ID}\n`
    );
  });

  process.stdout.write(`\n==========================================\n`);
  process.stdout.write(`Priority Inbox Complete!\n`);
  await log("backend", "info", "handler", "Priority Inbox service completed", TOKEN);
}

main().catch(async (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  await log("backend", "fatal", "handler", `Unhandled error: ${msg}`, TOKEN);
  process.exit(1);
});
