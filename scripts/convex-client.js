// frontend-user/scripts/convex-client.js
import { ConvexHttpClient } from "convex/browser";

// Your Convex deployment URL – replace if different
const CONVEX_URL = "https://grateful-quail-110.convex.cloud";

// Create the HTTP client – DO NOT call setAuth (R8)
export const convexHttpClient = new ConvexHttpClient(CONVEX_URL);