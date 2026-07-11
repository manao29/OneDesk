import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "onedesk-smoke-"));
const port = 18930 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), ONEDESK_DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API 未启动：${output}`);
}

async function request(method, url, body) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${url}: ${json.error || response.status}`);
  return json;
}

try {
  await waitForServer();
  const knowledge = await request("GET", "/api/knowledge");
  const required = knowledge.items.filter((item) => item.required);
  for (const item of required) {
    const content = item.category === "company" && item.title === "所在城市"
      ? "东莞"
      : `测试用${item.title}：只用于本地冒烟测试，不作对外承诺。`;
    await request("PATCH", `/api/knowledge/${item.id}`, { content });
  }
  const overview = await request("GET", "/api/overview");
  assert.equal(overview.blocked, false, "资料完整后员工应可以开工");

  const reference = await request("POST", "/api/references", {
    keyword: "东莞注册公司",
    post_title: "参考：注册公司前先确认这四件事",
    content_structure: "问题切入 → 四点清单 → 评论区提问",
    pain_point: "首次创业不清楚流程与后续责任",
  });
  const task = await request("POST", "/api/tasks", {
    type: "content_daily",
    title: "冒烟测试内容任务",
    config: { city: "东莞", daily_count: 3, reference_post_ids: [reference.id] },
  });
  const generated = await request("POST", `/api/tasks/${task.id}/run`);
  assert.equal(generated.draft_ids.length, 3, "应生成三篇草稿");
  const drafts = await request("GET", "/api/contents?status=waiting_approval");
  assert.equal(drafts.length, 3, "三篇草稿均应待审批");
  for (const draft of drafts) {
    await request("POST", `/api/contents/${draft.id}/decision`, { action: "approve" });
  }
  const approved = await request("GET", "/api/contents?status=approved");
  assert.equal(approved.length, 3, "审批后内容应进入待发布");
  const first = approved[0];
  await request("POST", `/api/contents/${first.id}/published`, { post_url: "https://example.test/xhs/post-1" });
  await request("PATCH", `/api/contents/${first.id}`, { stats: { views: 520, likes: 34, collects: 18, comments: 9, new_leads: 1 } });

  const imported = await request("POST", "/api/leads/import", {
    source: "manual",
    items: [
      { keyword: "东莞注册公司", post_title: first.title, post_url: "https://example.test/xhs/post-1", comment_user_name: "小林", comment_text: "请问东莞注册公司需要什么材料，大概多少钱？" },
      { keyword: "东莞注册公司", post_title: "注册公司流程", post_url: "https://example.test/xhs/post-2", comment_user_name: "路人甲", comment_text: "666" },
    ],
  });
  assert.equal(imported.inserted, 2, "强意向和弱意向均应按规则入库");
  assert.equal(imported.strong, 1, "应识别一条强意向线索");
  const pending = await request("GET", "/api/leads?status=waiting_approval");
  assert.equal(pending.length, 1, "强意向线索必须等待人工确认");
  assert.equal(pending[0].source, "own_post", "已发布内容的评论应自动归因");
  await request("POST", `/api/leads/${pending[0].id}/decision`, { action: "approve" });
  await request("PATCH", `/api/leads/${pending[0].id}`, { status: "replied", follow_note: "已由人工回复" });
  const review = await request("POST", "/api/reviews/generate", {});
  assert.ok(review.summary_md.includes("本周"), "应生成周复盘摘要");
  const finalOverview = await request("GET", "/api/overview");
  assert.equal(finalOverview.pending.ready_to_publish, 2, "首页应提示仍有两篇内容待发布");
  assert.equal(finalOverview.workflow.content_confirmed, 3, "首页业务链路应识别内容已全部确认");
  assert.equal(finalOverview.workflow.published, 1, "首页业务链路应识别已发布步骤");
  assert.equal(finalOverview.workflow.followed, 1, "首页业务链路应识别已跟进步骤");
  assert.equal(finalOverview.workflow.reviewed, 1, "首页业务链路应识别已复盘步骤");
  assert.ok(Array.isArray(finalOverview.runtime.active_tasks), "首页应返回运行中的任务列表");
  const exported = await fetch(`${base}/api/leads/export.csv`);
  assert.equal(exported.status, 200, "线索 CSV 应可导出");
  assert.ok((await exported.text()).includes("comment_text"), "导出应包含约定字段");
  console.log("Smoke test passed: knowledge → content → approval → publish → leads → review");
} finally {
  server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
}
