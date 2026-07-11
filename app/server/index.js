import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  db, now, log, getSetting, setSetting,
  knowledgeCompleteness, refreshAgentBlockState, WORKSPACE_DIR,
} from "./db.js";
import { scanText, scanContentDraft } from "./compliance.js";
import { generateDrafts, assessLead, generateWeeklyReview, llmConfigured } from "./llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "5mb" }));

const j = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };

// ---------------- overview / office ----------------
app.get("/api/overview", (req, res) => {
  const { pct, blocked } = refreshAgentBlockState();
  const agents = db.prepare(`SELECT * FROM agents`).all();
  const today = new Date().toISOString().slice(0, 10);
  const todayContents = db.prepare(`SELECT COUNT(*) c FROM content_drafts WHERE created_at LIKE ?`).get(`${today}%`).c;
  const todayLeads = db.prepare(`SELECT COUNT(*) c FROM leads WHERE created_at LIKE ?`).get(`${today}%`).c;
  const pendingContents = db.prepare(`SELECT COUNT(*) c FROM content_drafts WHERE status='waiting_approval'`).get().c;
  const pendingContentsToday = db.prepare(`SELECT COUNT(*) c FROM content_drafts WHERE created_at LIKE ? AND status='waiting_approval'`).get(`${today}%`).c;
  const pendingLeads = db.prepare(`SELECT COUNT(*) c FROM leads WHERE status='waiting_approval'`).get().c;
  const readyToPublish = db.prepare(`SELECT COUNT(*) c FROM content_drafts WHERE status='approved'`).get().c;
  const readyToFollow = db.prepare(`SELECT COUNT(*) c FROM leads WHERE status='approved'`).get().c;
  const strongToday = db.prepare(`SELECT COUNT(*) c FROM leads WHERE created_at LIKE ? AND lead_score>=80`).get(`${today}%`).c;
  const publishedToday = db.prepare(`SELECT COUNT(*) c FROM content_drafts WHERE publish_time LIKE ?`).get(`${today}%`).c;
  const followedToday = db.prepare(`SELECT COUNT(*) c FROM leads WHERE updated_at LIKE ? AND status IN ('replied','messaged','converted')`).get(`${today}%`).c;
  const reviewedToday = db.prepare(`SELECT COUNT(*) c FROM weekly_reviews WHERE created_at LIKE ?`).get(`${today}%`).c;
  const blockedItems = db.prepare(`SELECT COUNT(*) c FROM content_drafts WHERE status='waiting_approval' AND compliance_json != '[]'`).get().c;
  const activities = db.prepare(`SELECT * FROM activity_logs ORDER BY id DESC LIMIT 20`).all();
  const activeTasks = db.prepare(
    `SELECT t.id,t.type,t.title,t.status,t.run_at,a.code agent_code,a.name agent_name
     FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id
     WHERE t.status='running' ORDER BY t.run_at DESC`
  ).all();
  res.json({
    knowledge_pct: pct, blocked, llm_configured: llmConfigured(),
    agents, today: { contents: todayContents, leads: todayLeads, strong_leads: strongToday },
    pending: {
      contents: pendingContents,
      leads: pendingLeads,
      compliance_blocked: blockedItems,
      ready_to_publish: readyToPublish,
      ready_to_follow: readyToFollow,
    },
    workflow: {
      content_ready: todayContents,
      content_confirmed: todayContents > 0 && pendingContentsToday === 0 ? todayContents : 0,
      published: publishedToday,
      leads_imported: todayLeads,
      leads_judged: todayLeads,
      followed: followedToday,
      reviewed: reviewedToday,
    },
    runtime: { active_tasks: activeTasks },
    activities,
  });
});

// ---------------- agents ----------------
app.get("/api/agents", (req, res) => {
  refreshAgentBlockState();
  res.json(db.prepare(`SELECT * FROM agents`).all());
});
app.patch("/api/agents/:id", (req, res) => {
  const { daily_quota, is_paused } = req.body;
  const agent = db.prepare(`SELECT * FROM agents WHERE id=?`).get(req.params.id);
  if (!agent) return res.status(404).json({ error: "not found" });
  if (daily_quota !== undefined && (!Number.isInteger(Number(daily_quota)) || Number(daily_quota) < 1 || Number(daily_quota) > 30)) {
    return res.status(400).json({ error: "每日配额需为 1–30 的整数" });
  }
  db.prepare(`UPDATE agents SET daily_quota=COALESCE(?,daily_quota), is_paused=COALESCE(?,is_paused), updated_at=? WHERE id=?`)
    .run(daily_quota === undefined ? null : Number(daily_quota), is_paused === undefined ? null : (is_paused ? 1 : 0), now(), req.params.id);
  refreshAgentBlockState();
  const updated = db.prepare(`SELECT * FROM agents WHERE id=?`).get(req.params.id);
  log("user", updated.is_paused ? "暂停员工" : "更新员工设置", "agent", updated.id, updated.name);
  res.json(updated);
});

// ---------------- knowledge ----------------
app.get("/api/knowledge", (req, res) => {
  const items = db.prepare(`SELECT * FROM knowledge_items ORDER BY category, required DESC, id`).all();
  res.json({ items, completeness: knowledgeCompleteness() });
});
app.post("/api/knowledge", (req, res) => {
  const { category, title, content = "", tags = "" } = req.body;
  if (!category || !title) return res.status(400).json({ error: "category 与 title 必填" });
  const t = now();
  const r = db.prepare(
    `INSERT INTO knowledge_items (category,title,content,tags,source,enabled,required,created_at,updated_at) VALUES (?,?,?,?,'user',1,0,?,?)`
  ).run(category, title, content, tags, t, t);
  log("user", "新增知识条目", "knowledge", r.lastInsertRowid, title);
  refreshAgentBlockState();
  res.json({ id: r.lastInsertRowid });
});
app.patch("/api/knowledge/:id", (req, res) => {
  const item = db.prepare(`SELECT * FROM knowledge_items WHERE id=?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  const { content, title, enabled, tags } = req.body;
  db.prepare(
    `UPDATE knowledge_items SET content=COALESCE(?,content), title=COALESCE(?,title), enabled=COALESCE(?,enabled), tags=COALESCE(?,tags), updated_at=? WHERE id=?`
  ).run(content, title, enabled, tags, now(), req.params.id);
  const st = refreshAgentBlockState();
  res.json({ ok: true, completeness: st.pct });
});

// ---------------- tasks ----------------
app.get("/api/tasks", (req, res) => {
  res.json(db.prepare(`SELECT * FROM tasks ORDER BY id DESC`).all());
});
app.post("/api/tasks", (req, res) => {
  const { type = "content_daily", title, config = {} } = req.body;
  if (!title) return res.status(400).json({ error: "title 必填" });
  const agent = db.prepare(`SELECT * FROM agents WHERE code=?`).get(type === "lead_scan" ? "lead_gen" : "content_op");
  const t = now();
  const r = db.prepare(
    `INSERT INTO tasks (agent_id,type,title,config_json,status,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?)`
  ).run(agent?.id, type, title, JSON.stringify(config), t, t);
  log("user", "创建任务", "task", r.lastInsertRowid, title);
  res.json({ id: r.lastInsertRowid });
});

// 运行内容任务：生成草稿
app.post("/api/tasks/:id/run", async (req, res) => {
  const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id);
  if (!task) return res.status(404).json({ error: "not found" });
  const st = refreshAgentBlockState();
  if (st.blocked) return res.status(400).json({ error: `知识库完整度 ${st.pct}%，低于 60%，员工无法开工。请先完善知识库必填项。` });
  if (task.type !== "content_daily") return res.status(400).json({ error: "该任务类型请使用对应入口运行" });
  const agent = db.prepare(`SELECT * FROM agents WHERE code='content_op'`).get();
  if (agent?.is_paused) return res.status(400).json({ error: "阿禾已暂停，请在员工页恢复后再开工。" });

  const cfg = j(task.config_json, {});
  const count = Math.min(Number(cfg.daily_count) || 3, 5);
  const referenceIds = Array.isArray(cfg.reference_post_ids) ? cfg.reference_post_ids.map(Number).filter(Number.isInteger) : [];
  if (referenceIds.length) {
    const q = referenceIds.map(() => "?").join(",");
    cfg.reference_posts = db.prepare(`SELECT * FROM reference_posts WHERE id IN (${q})`).all(...referenceIds);
  }
  db.prepare(`UPDATE tasks SET status='running', run_at=?, updated_at=? WHERE id=?`).run(now(), now(), task.id);
  db.prepare(`UPDATE agents SET status='working', updated_at=? WHERE code='content_op'`).run(now());
  log("阿禾", "开始生成今日笔记", "task", task.id, `目标 ${count} 篇`);
  try {
    const { mode, drafts } = await generateDrafts(cfg, count);
    const t = now();
    const ins = db.prepare(
      `INSERT INTO content_drafts (task_id,topic_type,title,title_variants_json,cover_text,cover_plan_json,body,tags_json,comment_guide,publish_note,status,compliance_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const ids = [];
    for (const d of drafts) {
      const hits = scanContentDraft({ title: d.title, cover_text: d.cover_text, body: d.body, comment_guide: d.comment_guide });
      const r = ins.run(
        task.id, d.topic_type || "搜索", d.title,
        JSON.stringify(d.title_variants || []), d.cover_text || "",
        JSON.stringify(d.cover_plan || {}), d.body || "",
        JSON.stringify(d.tags || []), d.comment_guide || "", d.publish_note || "",
        "waiting_approval", JSON.stringify(hits), t, t
      );
      db.prepare(`UPDATE content_drafts SET ref_post_ids_json=? WHERE id=?`).run(JSON.stringify(referenceIds), r.lastInsertRowid);
      ids.push(r.lastInsertRowid);
    }
    db.prepare(`UPDATE tasks SET status='waiting_approval', result_summary=?, updated_at=? WHERE id=?`)
      .run(`生成 ${ids.length} 篇草稿（${mode === "demo" ? "演示模式" : "LLM"}），待确认`, now(), task.id);
    db.prepare(`UPDATE agents SET status='waiting_approval', updated_at=? WHERE code='content_op'`).run(now());
    log("阿禾", "完成笔记生成", "task", task.id, `${ids.length} 篇进入待确认${mode === "demo" ? "（演示模式，未配置 LLM）" : ""}`);
    res.json({ ok: true, mode, draft_ids: ids });
  } catch (e) {
    db.prepare(`UPDATE tasks SET status='failed', result_summary=?, updated_at=? WHERE id=?`).run(String(e.message), now(), task.id);
    db.prepare(`UPDATE agents SET status='idle', updated_at=? WHERE code='content_op'`).run(now());
    log("阿禾", "生成失败", "task", task.id, String(e.message));
    res.status(500).json({ error: String(e.message) });
  }
});

// ---------------- contents ----------------
app.get("/api/contents", (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) rows = db.prepare(`SELECT * FROM content_drafts WHERE status=? ORDER BY id DESC`).all(status);
  else rows = db.prepare(`SELECT * FROM content_drafts ORDER BY id DESC`).all();
  res.json(rows);
});
app.get("/api/contents/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});
app.patch("/api/contents/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const b = req.body;
  const fields = ["title", "cover_text", "body", "comment_guide", "publish_note", "post_url", "publish_time"];
  for (const f of fields) {
    if (b[f] !== undefined) db.prepare(`UPDATE content_drafts SET ${f}=?, updated_at=? WHERE id=?`).run(b[f], now(), row.id);
  }
  if (b.tags !== undefined) db.prepare(`UPDATE content_drafts SET tags_json=?, updated_at=? WHERE id=?`).run(JSON.stringify(b.tags), now(), row.id);
  if (b.stats !== undefined) db.prepare(`UPDATE content_drafts SET stats_json=?, updated_at=? WHERE id=?`).run(JSON.stringify(b.stats), now(), row.id);
  // 重新扫描合规
  const cur = db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(row.id);
  const hits = scanContentDraft(cur);
  db.prepare(`UPDATE content_drafts SET compliance_json=?, updated_at=? WHERE id=?`).run(JSON.stringify(hits), now(), row.id);
  res.json(db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(row.id));
});

// 审批：approve / reject / edit_approve
app.post("/api/contents/:id/decision", (req, res) => {
  const row = db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const { action, note = "", edits } = req.body;
  const before = JSON.stringify(row);
  if (edits) {
    const fields = ["title", "cover_text", "body", "comment_guide", "publish_note"];
    for (const f of fields) if (edits[f] !== undefined)
      db.prepare(`UPDATE content_drafts SET ${f}=?, updated_at=? WHERE id=?`).run(edits[f], now(), row.id);
    if (edits.tags !== undefined) {
      db.prepare(`UPDATE content_drafts SET tags_json=?, updated_at=? WHERE id=?`).run(JSON.stringify(edits.tags), now(), row.id);
    }
  }
  const cur = db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(row.id);
  const hits = scanContentDraft(cur);
  db.prepare(`UPDATE content_drafts SET compliance_json=? WHERE id=?`).run(JSON.stringify(hits), row.id);

  if (action === "approve" || action === "edit_approve") {
    if (hits.length > 0) return res.status(400).json({ error: `内容命中合规拦截（${hits.map((h) => h.word).join("、")}），请编辑后再通过。`, hits });
    db.prepare(`UPDATE content_drafts SET status='approved', updated_at=? WHERE id=?`).run(now(), row.id);
    log("user", "通过内容草稿", "content", row.id, cur.title);
  } else if (action === "reject") {
    db.prepare(`UPDATE content_drafts SET status='rejected', reject_reason=?, updated_at=? WHERE id=?`).run(note, now(), row.id);
    log("user", "驳回内容草稿", "content", row.id, `${cur.title}｜原因：${note}`);
  } else return res.status(400).json({ error: "action 无效" });

  db.prepare(
    `INSERT INTO approvals (target_type,target_id,action,before_json,after_json,operator,note,created_at) VALUES ('content',?,?,?,?,'user',?,?)`
  ).run(row.id, action, before, JSON.stringify(db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(row.id)), note, now());

  // 若无待审内容，员工回到 done/idle
  const pending = db.prepare(`SELECT COUNT(*) c FROM content_drafts WHERE status='waiting_approval'`).get().c;
  if (pending === 0) db.prepare(`UPDATE agents SET status='done', updated_at=? WHERE code='content_op'`).run(now());
  res.json({ ok: true });
});

// 标记已发布（回填 post_url）
app.post("/api/contents/:id/published", (req, res) => {
  const { post_url = "" } = req.body;
  const row = db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.status !== "approved") return res.status(400).json({ error: "仅已通过的内容可标记发布" });
  db.prepare(`UPDATE content_drafts SET status='published', post_url=?, publish_time=?, updated_at=? WHERE id=?`)
    .run(post_url, now(), now(), row.id);
  log("user", "标记笔记已发布", "content", row.id, post_url || row.title);
  res.json({ ok: true });
});

// 发布清单文本
app.get("/api/contents/:id/publish-sheet", (req, res) => {
  const d = db.prepare(`SELECT * FROM content_drafts WHERE id=?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  const tags = j(d.tags_json, []).join(" ");
  const sheet = `标题：\n${d.title}\n\n封面文字：\n${d.cover_text}\n\n正文：\n${d.body}\n\n标签：\n${tags}\n\n评论区引导：\n${d.comment_guide}\n\n发布注意事项：\n${d.publish_note}\n\n建议发布时间：\n晚上 20:00-22:00\n\n发布方式：\n复制到手机小红书 App 人工发布`;
  res.json({ sheet });
});

// ---------------- reference posts ----------------
app.get("/api/references", (req, res) => {
  const { keyword = "" } = req.query;
  const rows = keyword
    ? db.prepare(`SELECT * FROM reference_posts WHERE keyword LIKE ? OR post_title LIKE ? ORDER BY id DESC`).all(`%${keyword}%`, `%${keyword}%`)
    : db.prepare(`SELECT * FROM reference_posts ORDER BY id DESC`).all();
  res.json(rows);
});
app.post("/api/references", (req, res) => {
  const b = req.body || {};
  if (!String(b.post_title || "").trim()) return res.status(400).json({ error: "参考笔记标题必填" });
  const fields = ["platform", "keyword", "post_title", "post_url", "author_name", "like_count", "collect_count", "comment_count", "post_type", "cover_text", "post_summary", "content_structure", "hook_sentence", "pain_point", "solution", "call_to_action", "comment_feedback", "imitate_level", "risk_note"];
  const values = fields.map((f) => {
    if (["like_count", "collect_count", "comment_count"].includes(f)) return Math.max(0, Number(b[f]) || 0);
    return String(b[f] || (f === "platform" ? "xiaohongshu" : f === "imitate_level" ? "中" : "")).trim();
  });
  const t = now();
  const r = db.prepare(`INSERT INTO reference_posts (${fields.join(",")},created_at,updated_at) VALUES (${fields.map(() => "?").join(",")},?,?)`).run(...values, t, t);
  log("user", "新增参考笔记", "reference_post", r.lastInsertRowid, b.post_title);
  res.json({ id: r.lastInsertRowid });
});
app.patch("/api/references/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM reference_posts WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const allowed = ["keyword", "post_title", "post_url", "author_name", "like_count", "collect_count", "comment_count", "post_type", "cover_text", "post_summary", "content_structure", "hook_sentence", "pain_point", "solution", "call_to_action", "comment_feedback", "imitate_level", "risk_note"];
  for (const field of allowed) if (req.body[field] !== undefined) {
    const value = ["like_count", "collect_count", "comment_count"].includes(field) ? Math.max(0, Number(req.body[field]) || 0) : String(req.body[field]);
    db.prepare(`UPDATE reference_posts SET ${field}=?, updated_at=? WHERE id=?`).run(value, now(), row.id);
  }
  res.json(db.prepare(`SELECT * FROM reference_posts WHERE id=?`).get(row.id));
});

// ---------------- leads ----------------
app.get("/api/leads", (req, res) => {
  const { status, min_score } = req.query;
  let sql = `SELECT * FROM leads WHERE 1=1`;
  const args = [];
  if (status) { sql += ` AND status=?`; args.push(status); }
  if (min_score) { sql += ` AND lead_score>=?`; args.push(Number(min_score)); }
  sql += ` ORDER BY lead_score DESC, id DESC`;
  res.json(db.prepare(sql).all(...args));
});

// 导入线索（数组），自动 AI 判定
app.post("/api/leads/import", async (req, res) => {
  const { items = [], source = "manual", keyword = "" } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items 为空" });
  if (items.length > 100) return res.status(400).json({ error: "一次最多导入 100 条评论，请分批处理。" });
  const st = refreshAgentBlockState();
  if (st.blocked) return res.status(400).json({ error: `知识库完整度 ${st.pct}%，低于 60%，员工无法开工。` });
  if (db.prepare(`SELECT is_paused FROM agents WHERE code='lead_gen'`).get()?.is_paused) return res.status(400).json({ error: "阿盈已暂停，请在员工页恢复后再导入。" });

  db.prepare(`UPDATE agents SET status='working', updated_at=? WHERE code='lead_gen'`).run(now());
  log("阿盈", "开始判定导入的评论", "lead", null, `共 ${items.length} 条`);

  const results = { inserted: 0, skipped_dup: 0, skipped_low: 0, skipped_invalid: 0, strong: 0 };
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  for (const it of items) {
    const lead = {
      platform: it.platform || "xiaohongshu",
      keyword: it.keyword || keyword,
      post_title: (it.post_title || "").trim(),
      post_url: (it.post_url || "").trim(),
      comment_user_name: (it.comment_user_name || "").trim(),
      profile_url: (it.profile_url || "").trim(),
      comment_text: (it.comment_text || "").trim(),
    };
    if (!lead.post_url || !lead.comment_text) { results.skipped_invalid++; continue; }
    // 去重：post_url+comment_text 唯一；同用户 7 天窗口
    const dup = db.prepare(`SELECT id FROM leads WHERE post_url=? AND comment_text=?`).get(lead.post_url, lead.comment_text);
    if (dup) { results.skipped_dup++; continue; }
    if (lead.comment_user_name) {
      const userDup = db.prepare(`SELECT id FROM leads WHERE comment_user_name=? AND created_at>=?`).get(lead.comment_user_name, sevenDaysAgo);
      if (userDup) { results.skipped_dup++; continue; }
    }
    let assessed;
    try { assessed = await assessLead(lead); }
    catch (e) {
      log("阿盈", "单条判定失败", "lead", null, String(e.message));
      continue;
    }
    if (assessed.lead_score < 40) { results.skipped_low++; continue; }
    // 关联自家笔记
    let sourceContentId = null, src = source;
    const own = db.prepare(`SELECT id FROM content_drafts WHERE post_url!='' AND post_url=?`).get(lead.post_url);
    if (own) { sourceContentId = own.id; src = "own_post"; }
    const status = assessed.lead_score >= 80 ? "waiting_approval" : "new";
    const t = now();
    db.prepare(
      `INSERT INTO leads (platform,keyword,post_title,post_url,comment_user_name,profile_url,comment_text,detected_need,lead_score,reason,suggested_reply,source,source_content_id,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      lead.platform, lead.keyword, lead.post_title, lead.post_url,
      lead.comment_user_name, lead.profile_url, lead.comment_text,
      assessed.detected_need, assessed.lead_score, assessed.reason, assessed.suggested_reply,
      src, sourceContentId, status, t, t
    );
    results.inserted++;
    if (assessed.lead_score >= 80) results.strong++;
  }

  db.prepare(`UPDATE agents SET status=?, updated_at=? WHERE code='lead_gen'`)
    .run(results.strong > 0 ? "waiting_approval" : "done", now());
  log("阿盈", "完成线索判定", "lead", null,
    `入库 ${results.inserted} 条（强意向 ${results.strong}），重复 ${results.skipped_dup}，低分未入库 ${results.skipped_low}，无来源 ${results.skipped_invalid}`);
  if (results.strong > 0) {
    db.prepare(`INSERT INTO push_notifications (channel,title,body,status,created_at) VALUES ('inapp',?,?,'pending',?)`)
      .run("发现强意向线索", `本次导入发现 ${results.strong} 条 80 分以上线索，请到「待你确认」处理拟回复。`, now());
  }
  res.json(results);
});

app.patch("/api/leads/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM leads WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const { status, follow_note, suggested_reply, lead_score } = req.body;
  db.prepare(
    `UPDATE leads SET status=COALESCE(?,status), follow_note=COALESCE(?,follow_note), suggested_reply=COALESCE(?,suggested_reply), lead_score=COALESCE(?,lead_score), updated_at=? WHERE id=?`
  ).run(status, follow_note, suggested_reply, lead_score, now(), row.id);
  if (status && status !== row.status) log("user", "更新线索状态", "lead", row.id, `${row.status} → ${status}`);
  res.json(db.prepare(`SELECT * FROM leads WHERE id=?`).get(row.id));
});

// 拟回复审批
app.post("/api/leads/:id/decision", (req, res) => {
  const row = db.prepare(`SELECT * FROM leads WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const { action, note = "", reply } = req.body;
  const before = JSON.stringify(row);
  if (reply !== undefined) {
    const hits = scanText(reply);
    if (hits.length) return res.status(400).json({ error: `回复命中合规拦截（${hits.map((h) => h.word).join("、")}）`, hits });
    db.prepare(`UPDATE leads SET suggested_reply=?, updated_at=? WHERE id=?`).run(reply, now(), row.id);
  }
  if (action === "approve" || action === "edit_approve") {
    const cur = db.prepare(`SELECT * FROM leads WHERE id=?`).get(row.id);
    const hits = scanText(cur.suggested_reply);
    if (hits.length) return res.status(400).json({ error: `回复命中合规拦截（${hits.map((h) => h.word).join("、")}），请编辑后通过。`, hits });
    db.prepare(`UPDATE leads SET status='approved', updated_at=? WHERE id=?`).run(now(), row.id);
    log("user", "确认线索拟回复", "lead", row.id, cur.comment_user_name);
  } else if (action === "ignore") {
    db.prepare(`UPDATE leads SET status='invalid', follow_note=?, updated_at=? WHERE id=?`).run(note || "已忽略", now(), row.id);
    log("user", "忽略线索", "lead", row.id, note);
  } else return res.status(400).json({ error: "action 无效" });
  db.prepare(
    `INSERT INTO approvals (target_type,target_id,action,before_json,after_json,operator,note,created_at) VALUES ('lead_reply',?,?,?,?,'user',?,?)`
  ).run(row.id, action, before, JSON.stringify(db.prepare(`SELECT * FROM leads WHERE id=?`).get(row.id)), note, now());
  res.json({ ok: true });
});

// CSV 导出
app.get("/api/leads/export.csv", (req, res) => {
  const rows = db.prepare(`SELECT * FROM leads ORDER BY id DESC`).all();
  const headers = ["platform","keyword","post_title","post_url","comment_user_name","profile_url","comment_text","detected_need","lead_score","reason","suggested_reply","status","created_at"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const file = path.join(WORKSPACE_DIR, `leads_${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(file, csv);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=leads.csv`);
  res.send(csv);
});

// 粘贴解析：把评论区文本解析成 items 预览
app.post("/api/leads/parse-paste", (req, res) => {
  const { text = "", post_title = "", post_url = "", keyword = "" } = req.body;
  const lines = String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    // 常见格式："用户名：评论内容" / "用户名 评论内容" / 纯评论
    const m = line.match(/^(.{1,20}?)[：:]\s*(.+)$/);
    if (m) items.push({ comment_user_name: m[1].trim(), comment_text: m[2].trim(), post_title, post_url, keyword });
    else items.push({ comment_user_name: "", comment_text: line, post_title, post_url, keyword });
  }
  res.json({ items });
});

// ---------------- reviews ----------------
app.get("/api/reviews", (req, res) => {
  res.json(db.prepare(`SELECT * FROM weekly_reviews ORDER BY id DESC`).all());
});
app.post("/api/reviews/generate", async (req, res) => {
  const published = db.prepare(`SELECT * FROM content_drafts WHERE status='published'`).all();
  const contents = published.map((c) => {
    const leads = db.prepare(`SELECT COUNT(*) c, AVG(lead_score) avg FROM leads WHERE source_content_id=?`).get(c.id);
    return {
      id: c.id, title: c.title, topic_type: c.topic_type,
      stats: j(c.stats_json, {}), leadCount: leads.c, avgScore: Math.round(leads.avg || 0),
    };
  });
  const totalLeads = db.prepare(`SELECT COUNT(*) c FROM leads`).get().c;
  const strongLeads = db.prepare(`SELECT COUNT(*) c FROM leads WHERE lead_score>=80`).get().c;
  const rv = await generateWeeklyReview({ contents, totalLeads, strongLeads });
  const weekStart = new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const t = now();
  const r = db.prepare(
    `INSERT INTO weekly_reviews (week_start,summary_md,best_content_ids_json,best_leads_count,keep_writing_json,stop_writing_json,next_keywords_json,content_lead_map_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    weekStart, rv.summary_md,
    JSON.stringify(contents.filter((c) => c.leadCount > 0).map((c) => c.id)),
    strongLeads, JSON.stringify(rv.keep_writing), JSON.stringify(rv.stop_writing),
    JSON.stringify(rv.next_keywords), JSON.stringify(contents), t
  );
  log("阿禾", "生成本周复盘", "review", r.lastInsertRowid, `覆盖 ${contents.length} 篇已发布笔记`);
  res.json(db.prepare(`SELECT * FROM weekly_reviews WHERE id=?`).get(r.lastInsertRowid));
});

// ---------------- misc ----------------
app.get("/api/activities", (req, res) => {
  res.json(db.prepare(`SELECT * FROM activity_logs ORDER BY id DESC LIMIT 50`).all());
});
app.get("/api/approvals", (req, res) => {
  res.json(db.prepare(`SELECT * FROM approvals ORDER BY id DESC LIMIT 50`).all());
});
app.get("/api/notifications", (req, res) => {
  res.json(db.prepare(`SELECT * FROM push_notifications ORDER BY id DESC LIMIT 20`).all());
});
app.post("/api/notifications/:id/read", (req, res) => {
  db.prepare(`UPDATE push_notifications SET status='read' WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/settings", (req, res) => {
  res.json({
    llm_base_url: getSetting("llm_base_url"),
    llm_model: getSetting("llm_model"),
    llm_key_set: !!getSetting("llm_api_key"),
    workspace_dir: WORKSPACE_DIR,
  });
});
app.post("/api/settings", (req, res) => {
  const { llm_base_url, llm_api_key, llm_model, clear_llm_api_key } = req.body;
  if (llm_base_url !== undefined) setSetting("llm_base_url", llm_base_url);
  if (llm_api_key !== undefined && llm_api_key !== "") setSetting("llm_api_key", llm_api_key);
  if (clear_llm_api_key) setSetting("llm_api_key", "");
  if (llm_model !== undefined) setSetting("llm_model", llm_model);
  log("user", "更新设置", "settings", null, "LLM 配置已更新");
  res.json({ ok: true, configured: llmConfigured() });
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

// production 静态托管
const dist = path.join(__dirname, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = process.env.PORT || 8930;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`OneDesk API ready at http://127.0.0.1:${PORT}`);
});
