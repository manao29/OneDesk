import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 允许测试或便携部署显式指定数据目录；正常运行仍将所有数据保存在应用目录内。
const DATA_DIR = process.env.ONEDESK_DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const WORKSPACE_DIR = path.join(DATA_DIR, "workspace");
if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "onedesk.sqlite"));
db.pragma("journal_mode = WAL");

const now = () => new Date().toISOString();

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  daily_quota INTEGER NOT NULL DEFAULT 3,
  persona_note TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  config_json TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  result_summary TEXT DEFAULT '',
  run_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS knowledge_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  source TEXT DEFAULT 'user',
  enabled INTEGER DEFAULT 1,
  required INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS reference_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT DEFAULT 'xiaohongshu',
  keyword TEXT DEFAULT '',
  post_title TEXT NOT NULL,
  post_url TEXT DEFAULT '',
  author_name TEXT DEFAULT '',
  like_count INTEGER DEFAULT 0,
  collect_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  post_type TEXT DEFAULT '',
  cover_text TEXT DEFAULT '',
  post_summary TEXT DEFAULT '',
  content_structure TEXT DEFAULT '',
  hook_sentence TEXT DEFAULT '',
  pain_point TEXT DEFAULT '',
  solution TEXT DEFAULT '',
  call_to_action TEXT DEFAULT '',
  comment_feedback TEXT DEFAULT '',
  imitate_level TEXT DEFAULT '中',
  risk_note TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS content_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  topic_type TEXT DEFAULT '搜索',
  title TEXT NOT NULL,
  title_variants_json TEXT DEFAULT '[]',
  cover_text TEXT DEFAULT '',
  cover_plan_json TEXT DEFAULT '{}',
  body TEXT DEFAULT '',
  tags_json TEXT DEFAULT '[]',
  comment_guide TEXT DEFAULT '',
  publish_note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting_approval',
  reject_reason TEXT DEFAULT '',
  compliance_json TEXT DEFAULT '[]',
  post_url TEXT DEFAULT '',
  publish_time TEXT DEFAULT '',
  stats_json TEXT DEFAULT '{}',
  ref_post_ids_json TEXT DEFAULT '[]',
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT DEFAULT 'xiaohongshu',
  keyword TEXT DEFAULT '',
  post_title TEXT DEFAULT '',
  post_url TEXT NOT NULL,
  comment_user_name TEXT DEFAULT '',
  profile_url TEXT DEFAULT '',
  comment_text TEXT NOT NULL,
  detected_need TEXT DEFAULT '',
  lead_score INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  suggested_reply TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  source_content_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  follow_note TEXT DEFAULT '',
  created_at TEXT, updated_at TEXT,
  UNIQUE(post_url, comment_text)
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT DEFAULT '{}',
  after_json TEXT DEFAULT '{}',
  operator TEXT DEFAULT 'user',
  note TEXT DEFAULT '',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS push_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT DEFAULT 'inapp',
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  payload_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT DEFAULT '',
  target_id INTEGER,
  detail TEXT DEFAULT '',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  summary_md TEXT DEFAULT '',
  best_content_ids_json TEXT DEFAULT '[]',
  best_leads_count INTEGER DEFAULT 0,
  keep_writing_json TEXT DEFAULT '[]',
  stop_writing_json TEXT DEFAULT '[]',
  next_keywords_json TEXT DEFAULT '[]',
  content_lead_map_json TEXT DEFAULT '[]',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// SQLite 的 CREATE TABLE 不会为旧库补列。这里保持一次性、向后兼容的轻量迁移。
const agentColumns = db.prepare(`PRAGMA table_info(agents)`).all().map((c) => c.name);
if (!agentColumns.includes("is_paused")) {
  db.exec(`ALTER TABLE agents ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0`);
}

// ---------- helpers ----------
export function log(actor, action, target_type = "", target_id = null, detail = "") {
  db.prepare(
    `INSERT INTO activity_logs (actor, action, target_type, target_id, detail, created_at) VALUES (?,?,?,?,?,?)`
  ).run(actor, action, target_type, target_id, detail, now());
}

export function getSetting(key, fallback = "") {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(key, String(value ?? ""));
}

// ---------- seed ----------
function seed() {
  const agentCount = db.prepare(`SELECT COUNT(*) c FROM agents`).get().c;
  if (agentCount === 0) {
    const t = now();
    db.prepare(
      `INSERT INTO agents (code,name,role,status,daily_quota,persona_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      "content_op", "阿禾", "小红书内容运营专员", "blocked", 3,
      "研究爆款、生成选题与笔记、输出发布清单、每周复盘。不编造案例，不承诺结果，不写违规词。",
      t, t
    );
    db.prepare(
      `INSERT INTO agents (code,name,role,status,daily_quota,persona_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      "lead_gen", "阿盈", "小红书获客专员", "blocked", 15,
      "从公开帖子与评论中发现潜在客户，评分并写判断理由与拟回复。不自动私信，不无来源入库。",
      t, t
    );
  }

  const kCount = db.prepare(`SELECT COUNT(*) c FROM knowledge_items`).get().c;
  if (kCount === 0) {
    const t = now();
    const ins = db.prepare(
      `INSERT INTO knowledge_items (category,title,content,tags,source,enabled,required,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
    );
    const rows = [
      // 公司知识（必填最小集）
      ["company", "公司名称", "", "必填", "user", 1, 1],
      ["company", "所在城市", "", "必填", "user", 1, 1],
      ["company", "成立年份与团队规模", "", "必填", "user", 1, 1],
      ["company", "一句话差异化定位", "示例：8 年本地财税团队，服务 300+ 电商个体户，全程一对一会计。", "必填", "user", 1, 1],
      ["company", "服务过的行业", "示例：电商、跨境、餐饮、贸易、咨询", "", "user", 1, 0],
      // 服务知识（必填最小集）
      ["service", "注册公司：流程/周期/材料/价格区间", "示例：3-5 个工作日拿证；需法人身份证、注册地址材料；代办费用区间 XXX-XXX 元（只写区间，不承诺低价）。", "必填", "user", 1, 1],
      ["service", "代理记账：内容/周期/价格区间", "示例：小规模每月 XXX 元起，一般纳税人每月 XXX 元起，含记账、报税、年报。", "必填", "user", 1, 1],
      ["service", "工商变更/注销：口径", "示例：地址、股权、法人变更；注销周期与大致费用区间。", "必填", "user", 1, 1],
      ["service", "税务筹划边界", "只做合规范围内的税收优惠申请与核算建议，不做激进筹划。", "", "user", 1, 0],
      // 销售知识（必填最小集）
      ["sales", "客户问『最低多少钱』怎么答", "先问行业、是否需要开票、预计营收规模，再给区间报价；不直接报底价。", "必填", "user", 1, 1],
      ["sales", "新客沟通三步", "1) 确认业务与城市；2) 说明流程与周期；3) 给区间报价并邀请进一步沟通。", "必填", "user", 1, 1],
      ["sales", "不同客户类型要点", "电商个体户：关心开票与平台合规；初创公司：关心注册流程与后续记账；自由职业者：关心个体户 vs 公司选择。", "", "user", 1, 0],
      // 平台知识（系统内置）
      ["platform", "小红书排版规则", "短句多分段；每段不超过 2 行；每篇 500-800 字；3-6 个小节；开头 3 秒抓痛点；结尾有互动引导。", "内置", "system_seed", 1, 0],
      ["platform", "封面与标题规则", "封面文字不超过 16 字；标题优先可搜索（含城市+业务词）；每篇 4-8 个标签。", "内置", "system_seed", 1, 0],
      ["platform", "发布时间建议", "工作日晚 20:00-22:00 或午间 12:00-13:30。", "内置", "system_seed", 1, 0],
      // 合规禁区（系统内置）
      ["compliance", "违禁词表", "最便宜,保过,包过,100%,绝对,稳赚,免税包办,一定通过,保证退税,内部渠道,加微信,加V,扫码,私我领取", "内置,硬约束", "system_seed", 1, 0],
      ["compliance", "不可承诺事项", "不承诺拿证时间的最短极限；不承诺税负率；不承诺免罚；不编造客户案例与具体客户数据。", "内置,硬约束", "system_seed", 1, 0],
      ["compliance", "引流红线", "笔记与回复中不得出现微信号、二维码、站外链接；引导语只能是『评论区留言/私信我』等平台内动作。", "内置,硬约束", "system_seed", 1, 0],
    ];
    for (const r of rows) ins.run(...r, t, t);
  }

  if (!getSetting("company_inited")) {
    setSetting("company_inited", "1");
    setSetting("llm_base_url", "");
    setSetting("llm_api_key", "");
    setSetting("llm_model", "");
    log("system", "初始化 OneDesk 工作区", "system", null, "已载入财税行业种子知识库，请到「知识库」完善公司资料。");
  }
}
seed();

// 知识库完整度：required 条目中 content 非空的比例
export function knowledgeCompleteness() {
  const req = db.prepare(`SELECT COUNT(*) c FROM knowledge_items WHERE required=1 AND enabled=1`).get().c;
  if (req === 0) return 100;
  const filled = db
    .prepare(`SELECT COUNT(*) c FROM knowledge_items WHERE required=1 AND enabled=1 AND TRIM(content) != '' AND content NOT LIKE '示例：%'`)
    .get().c;
  return Math.round((filled / req) * 100);
}

export function refreshAgentBlockState() {
  const pct = knowledgeCompleteness();
  const blocked = pct < 60;
  const agents = db.prepare(`SELECT * FROM agents`).all();
  for (const a of agents) {
    if (a.is_paused) {
      if (a.status !== "paused") db.prepare(`UPDATE agents SET status='paused', updated_at=? WHERE id=?`).run(now(), a.id);
    } else if (blocked && a.status !== "blocked") {
      db.prepare(`UPDATE agents SET status='blocked', updated_at=? WHERE id=?`).run(now(), a.id);
    } else if (!blocked && (a.status === "blocked" || a.status === "paused")) {
      db.prepare(`UPDATE agents SET status='idle', updated_at=? WHERE id=?`).run(now(), a.id);
    }
  }
  return { pct, blocked };
}
refreshAgentBlockState();

export { now };
