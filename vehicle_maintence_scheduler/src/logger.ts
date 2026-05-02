import axios from "axios";

const LOG_URL = "http://20.207.122.201/evaluation-service/logs";

type Stack = "backend" | "frontend";
type Level = "info" | "warn" | "error" | "debug" | "fatal";
type Package =
  | "handler" | "repository" | "router" | "service"
  | "auth" | "config" | "middleware" | "util";

export async function log(
  stack: Stack,
  level: Level,
  pkg: Package,
  message: string,
  token: string
): Promise<void> {
  try {
    await axios.post(
      LOG_URL,
      { stack, level, package: pkg, message },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch {
   // not using console.log 
  }
}
