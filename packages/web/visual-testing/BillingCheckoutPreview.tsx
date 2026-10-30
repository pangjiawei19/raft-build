/** Development-only, synthetic browser acceptance. Not imported by a production entry. */
import { createRoot } from "react-dom/client";
import { PlanSection } from "../src/components/settings/SettingsPanel";
import { useServerStore } from "../src/store/serverStore";
import api from "../src/api/client";
import { VisualTestingRoot } from "./VisualTestingRoot";
import "../src/index.css";
const query = new URLSearchParams(location.search);
useServerStore.setState({
  current: {
    id: "synthetic-server",
    name: "Synthetic workspace",
    slug: "synthetic",
    ownerId: "synthetic-owner",
    plan: "free",
    role: "owner",
    avatarUrl: null,
    onboardingAgentId: null,
    hideHumansFromMembers: false,
    planDowngradedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
  },
  usage: { agents: 0, machines: 0, channels: 0 },
  billing: {
    plan: "free",
    serverPlan: "free",
    displayName: "Free",
    source: "server",
    capacity: { maxHumans: 2, maxAgents: 20, maxUniversalSeats: 2 },
    usage: { humans: 1, agents: 0, universalSeats: 1 },
    provisioned: {
      humans: 2,
      agents: 20,
      proPackQuantity: 2,
      trialFreePackQuantity: 0,
    },
    price: {
      billingInterval: "monthly",
      monthlyUsd: 20,
      annualUsd: 211.2,
      discountPercent: 12,
      baseMonthlyUsd: 20,
      overageMonthlyUsd: 0,
      seatQuantity: 2,
      packQuantity: 2,
      humanSeatQuantity: 2,
      agentSeatQuantity: 20,
      agentSeatBlockQuantity: 10,
    },
    subscription: null,
    stripeConfigured: true,
    permissions: { canReadBillingSummary: true, canManageBilling: true },
  },
  loadingUsage: false,
  loadingBilling: false,
  loadUsage: async () => undefined,
  loadBilling: async () => undefined,
});
api.post = (async (path: string) => {
  if (path !== "/billing/checkout")
    throw new Error("Unexpected synthetic action");
  if (query.get("outcome") === "error")
    throw { response: { data: { code: "promotion_code_unavailable" } } };
  return { data: { url: "#synthetic-stripe-checkout" } };
}) as typeof api.post;
createRoot(document.getElementById("root")!).render(
  <VisualTestingRoot mode={query.get("theme") === "dark" ? "dark" : "light"}>
    <main className="mx-auto h-screen max-w-4xl overflow-y-auto p-4">
      <PlanSection />
    </main>
  </VisualTestingRoot>,
);
