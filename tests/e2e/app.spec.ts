import { expect, test, type Page, type Route } from "@playwright/test";

const metrics = {
  status: "success",
  model: "test-model",
  costUsd: 0,
  durationMs: 12,
  apiDurationMs: 8,
  inputTokens: 10,
  outputTokens: 20,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  sdkTurns: 1,
  toolCalls: 1,
  toolErrors: 0,
  repaired: false,
  validationIssues: 0,
} as const;

function sse(events: unknown[]): string {
  return events.map((event) => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function exactDutyCycleResponse() {
  return sse([
    { type: "meta", conversationId: "test-conversation" },
    { type: "text_delta", text: "At 200 A on 240 V in MIG mode, the published rating is 25%: weld for 2.5 minutes, then rest for 7.5 minutes in each 10-minute period. Owner's Manual, pp. 7, 14, 23." },
    {
      type: "evidence",
      sources: [{
        id: "table:duty_cycles:mig-240-200",
        kind: "structured-data",
        title: "MIG duty-cycle table",
        dataset: "duty_cycles",
        recordIds: ["mig-240-200"],
        sourceId: "owner-manual",
        pages: [7, 14, 23],
      }],
    },
    {
      type: "visual",
      visual: {
        id: "duty-cycle-summary",
        assets: [],
        spec: {
          schemaVersion: 1,
          kind: "metric-summary",
          title: "MIG duty cycle",
          description: "MIG · 240 V · 200 A",
          sourceRefs: [{ kind: "document", sourceId: "owner-manual", pages: [7, 14, 23] }],
          metrics: [
            { id: "duty", label: "Published duty cycle", value: "25", unit: "%", tone: "primary" },
            { id: "weld", label: "Maximum welding", value: "2.5", unit: "minutes" },
            { id: "cool", label: "Cooling", value: "7.5", unit: "minutes" },
          ],
          callout: { title: "10-minute rating period", body: "Leave power on while cooling so the fan can run." },
        },
      },
    },
    { type: "done", sessionId: "00000000-0000-4000-8000-000000000001", metrics },
  ]);
}

function clarificationResponse() {
  return sse([
    { type: "meta", conversationId: "test-conversation" },
    {
      type: "clarification_request",
      clarification: {
        id: "clarify-voltage",
        originalQuestion: "What's the MIG duty cycle at 200 amps?",
        question: "Which input voltage are you using?",
        options: [
          { id: "120", label: "120 V", description: "Using a standard 120 V supply" },
          { id: "240", label: "240 V", description: "Using a 240 V supply" },
        ],
        allowOther: true,
      },
    },
    { type: "done", sessionId: "00000000-0000-4000-8000-000000000002", metrics },
  ]);
}

async function stubPersistence(page: Page) {
  await page.route("**/api/chats**", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { conversations: [] } });
      return;
    }
    await route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.route("**/api/telemetry**", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { sampledTurns: 0, totals: {}, averages: {}, recent: [] } });
      return;
    }
    await route.fulfill({ status: 201, json: { ok: true } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await stubPersistence(page);
});

test("renders the welcome screen and example prompts", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "OmniPro 220 Assistant" })).toBeVisible();
  await expect(page.getByRole("button", { name: "What’s the duty cycle for MIG welding at 200A on 240V?" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message the OmniPro 220 assistant" })).toBeVisible();
});

test("streams a duty-cycle answer and renders the published rating summary", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: exactDutyCycleResponse(),
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message the OmniPro 220 assistant" }).fill("What's the duty cycle for MIG welding at 200A on 240V?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("the published rating is 25%", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "MIG duty cycle" })).toBeVisible();
  await expect(page.getByText("2.5", { exact: true })).toBeVisible();
  await expect(page.getByText("7.5", { exact: true })).toBeVisible();
  await expect(page.getByText("Published duty cycle", { exact: true })).toBeVisible();
  await expect(page.getByText("10-minute rating period", { exact: true })).toBeVisible();
  await expect(page.getByText("Owner's Manual, pp. 7, 14, 23", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play cycle" })).toHaveCount(0);
});

test("renders clarification choices and sends the selected context", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON()?.message ?? "");
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: clarificationResponse(),
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message the OmniPro 220 assistant" }).fill("What's the MIG duty cycle at 200 amps?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("heading", { name: "Which input voltage are you using?" })).toBeVisible();
  const option = page.getByRole("button", { name: /240 V/ });
  await expect(option).toBeVisible();
  await option.click();

  await expect(page.getByText("Continuing with: 240 V", { exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toContain("240 V");
});
