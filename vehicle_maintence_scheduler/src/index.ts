import axios from "axios";
import { log } from "./logger";

const BASE_URL = "http://20.207.122.201/evaluation-service";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiYXVkIjoiaHR0cDovLzIwLjI0NC41Ni4xNDQvZXZhbHVhdGlvbi1zZXJ2aWNlIiwiZW1haWwiOiJoaW1ha3NoaV9jaGFkYWxhdmFkYUBzcm1hcC5lZHUuaW4iLCJleHAiOjE3Nzc3MDMyNjYsImlhdCI6MTc3NzcwMjM2NiwiaXNzIjoiQWZmb3JkIE1lZGljYWwgVGVjaG5vbG9naWVzIFByaXZhdGUgTGltaXRlZCIsImp0aSI6IjY3NzBlNmM5LTdjNTEtNDk4Yy04YWMxLWNhZmNkM2ZiM2NiNSIsImxvY2FsZSI6ImVuLUlOIiwibmFtZSI6ImhpbWFrc2hpIGNoYWRhbGF2YWRhIiwic3ViIjoiZTliODMyN2ItYTljMS00NDdjLWI3ZTMtYzQ2OTY2Y2M1NzY1In0sImVtYWlsIjoiaGltYWtzaGlfY2hhZGFsYXZhZGFAc3JtYXAuZWR1LmluIiwibmFtZSI6ImhpbWFrc2hpIGNoYWRhbGF2YWRhIiwicm9sbE5vIjoiYXAyMzExMDAxMTU5NiIsImFjY2Vzc0NvZGUiOiJRa2JweEgiLCJjbGllbnRJRCI6ImU5YjgzMjdiLWE5YzEtNDQ3Yy1iN2UzLWM0Njk2NmNjNTc2NSIsImNsaWVudFNlY3JldCI6IkdReXJKdHN3ZFBYbWRHRW0ifQ.HbAQocCPXw1NH8oa4FjIGLlsw3IrGWaWmUBCwPhw0x4";

interface Depot {
  ID: number;
  MechanicHours: number;
}

interface Vehicle {
  TaskID: string;
  Duration: number;
  Impact: number;
}

async function fetchDepots(): Promise<Depot[]> {
  await log("backend", "info", "service", "Fetching depots from API", TOKEN);
  const res = await axios.get<{ depots: Depot[] }>(`${BASE_URL}/depots`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  await log("backend", "info", "service", `Fetched ${res.data.depots.length} depots`, TOKEN);
  return res.data.depots;
}

async function fetchVehicles(): Promise<Vehicle[]> {
  await log("backend", "info", "service", "Fetching vehicles from API", TOKEN);
  const res = await axios.get<{ vehicles: Vehicle[] }>(`${BASE_URL}/vehicles`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  await log("backend", "info", "service", `Fetched ${res.data.vehicles.length} vehicles`, TOKEN);
  return res.data.vehicles;
}

function knapsack(capacity: number, tasks: Vehicle[]): { bestScore: number; selected: Vehicle[] } {
  const n = tasks.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(capacity + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    const { Duration: d, Impact: v } = tasks[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (d <= w && dp[i - 1][w - d] + v > dp[i][w]) {
        dp[i][w] = dp[i - 1][w - d] + v;
      }
    }
  }

  const selected: Vehicle[] = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(tasks[i - 1]);
      w -= tasks[i - 1].Duration;
    }
  }

  return { bestScore: dp[n][capacity], selected };
}

async function main(): Promise<void> {
  await log("backend", "info", "handler", "Vehicle Maintenance Scheduler started", TOKEN);

  let depots: Depot[];
  let vehicles: Vehicle[];

  try {
    depots = await fetchDepots();
    vehicles = await fetchVehicles();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("backend", "error", "handler", `Failed to fetch data: ${msg}`, TOKEN);
    throw err;
  }

  for (const depot of depots) {
    await log("backend", "info", "service", `Processing depot ${depot.ID} with budget ${depot.MechanicHours} hrs`, TOKEN);

    const { bestScore, selected } = knapsack(depot.MechanicHours, vehicles);
    const hoursUsed = selected.reduce((sum, t) => sum + t.Duration, 0);

    await log("backend", "info", "service",
      `Depot ${depot.ID} → selected ${selected.length} tasks, ${hoursUsed}/${depot.MechanicHours} hrs, impact=${bestScore}`, TOKEN);

    process.stdout.write(`\n========================================\n`);
    process.stdout.write(`Depot ${depot.ID}  |  Budget: ${depot.MechanicHours} hrs\n`);
    process.stdout.write(`  Tasks selected : ${selected.length}\n`);
    process.stdout.write(`  Hours used     : ${hoursUsed} / ${depot.MechanicHours}\n`);
    process.stdout.write(`  Total impact   : ${bestScore}\n`);
    process.stdout.write(`----------------------------------------\n`);
    for (const t of selected) {
      process.stdout.write(`  • TaskID: ${t.TaskID}\n    Duration: ${t.Duration} hrs  |  Impact: ${t.Impact}\n`);
    }
  }

  process.stdout.write(`\n========================================\n`);
  process.stdout.write(`Vehicle Maintenance Scheduling Complete!\n`);
  await log("backend", "info", "handler", "Vehicle Maintenance Scheduler completed successfully", TOKEN);
}

main().catch(async (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  await log("backend", "fatal", "handler", `Unhandled error: ${msg}`, TOKEN);
  process.exit(1);
});
