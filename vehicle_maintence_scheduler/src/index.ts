import express from "express";
import axios from "axios";
import { log } from "../../logging_middleware/logger";

const app = express();
app.use(express.json());

const BASE_URL = "http://20.207.122.201/evaluation-service";

interface Depot {
  ID: number;
  MechanicHours: number;
}

interface Vehicle {
  TaskID: string;
  Duration: number;
  Impact: number;
}

async function fetchDepots(token: string): Promise<Depot[]> {
  await log("backend", "info", "service", "Fetching depots from API", token);
  const res = await axios.get<{ depots: Depot[] }>(`${BASE_URL}/depots`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await log("backend", "info", "service", `Fetched ${res.data.depots.length} depots`, token);
  return res.data.depots;
}

async function fetchVehicles(token: string): Promise<Vehicle[]> {
  await log("backend", "info", "service", "Fetching vehicles from API", token);
  const res = await axios.get<{ vehicles: Vehicle[] }>(`${BASE_URL}/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await log("backend", "info", "service", `Fetched ${res.data.vehicles.length} vehicles`, token);
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

app.post("/api/schedule", async (req, res) => {
  const token = req.body.token;
  if (!token) {
    return res.status(400).json({ error: "Token is required in request body" });
  }

  await log("backend", "info", "handler", "Vehicle Maintenance Scheduler API started", token);

  try {
    const depots = await fetchDepots(token);
    const vehicles = await fetchVehicles(token);

    const results = [];

    for (const depot of depots) {
      await log("backend", "info", "service", `Processing depot ${depot.ID} with budget ${depot.MechanicHours} hrs`, token);

      const { bestScore, selected } = knapsack(depot.MechanicHours, vehicles);
      const hoursUsed = selected.reduce((sum, t) => sum + t.Duration, 0);

      await log("backend", "info", "service",
        `Depot ${depot.ID} → selected ${selected.length} tasks, ${hoursUsed}/${depot.MechanicHours} hrs, impact=${bestScore}`, token);

      results.push({
        depotID: depot.ID,
        budget: depot.MechanicHours,
        tasksSelectedCount: selected.length,
        hoursUsed,
        totalImpact: bestScore,
        selectedTasks: selected
      });
    }

    await log("backend", "info", "handler", "Vehicle Maintenance Scheduler API completed successfully", token);
    
    res.json({
      status: "success",
      message: "Vehicle Maintenance Scheduling Complete",
      results
    });

  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    await log("backend", "error", "handler", `Failed API request: ${msg}`, token);
    res.status(500).json({ error: msg });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
