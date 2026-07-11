import { db, getSetting } from "./db.js";

// ---------------- LLM 客户端（OpenAI 兼容） ----------------
export function llmConfigured() {
  return !!(getSetting("llm_base_url") && getSetting("llm_api_key") && getSetting("llm_model"));
}

async function chat(messages, { json = false } = {}) {
  const base = getSetting("llm_base_url").replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSetting("llm_api_key")}`,
    },
    body: JSON.stringify({
      model: getSetting("llm_model"),
      messages,
      temperature: 0.7,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function knowledgeText() {
  const rows = db
    .prepare(`SELECT category,title,content FROM knowledge_items WHERE enabled=1 AND TRIM(content)!=''`)
    .all();
  const label = { company: "公司知识", service: "服务知识", sales: "销售知识", platform: "平台知识", compliance: "合规禁区" };
  return rows.map((r) => `【${label[r.category] || r.category}】${r.title}：${r.content}`).join("\n");
}

function getKB(category, title) {
  const r = db
    .prepare(`SELECT content FROM knowledge_items WHERE category=? AND title=? AND enabled=1`)
    .get(category, title);
  return r?.content?.replace(/^示例：/, "") || "";
}

function extractJSON(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const m = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!m) throw new Error("LLM 未返回 JSON");
  return JSON.parse(m[0]);
}

// ---------------- 内容生成 ----------------
const TOPIC_TYPES = ["搜索", "避坑", "流程", "案例", "对比"];

// 演示模式模板（财税行业，占位符来自知识库）
function demoDrafts(cfg, count) {
  const city = getKB("company", "所在城市") || cfg.city || "本地";
  const brand = getKB("company", "一句话差异化定位");
  const templates = [
    {
      topic_type: "搜索",
      title: `${city}注册公司到底要花多少钱？先看这 4 件事`,
      title_variants: [
        { t: `${city}注册公司需要多少钱？`, scores: { search: 92, click: 70, trust: 85, risk: 10, total: 84 } },
        { t: `新手注册公司，别只问价格`, scores: { search: 60, click: 82, trust: 80, risk: 15, total: 74 } },
        { t: `${city}注册公司到底要花多少钱？先看这 4 件事`, scores: { search: 88, click: 85, trust: 85, risk: 10, total: 88 } },
      ],
      cover_text: "注册公司费用\n别只看低价",
      body: `很多老板第一次注册公司，最关心的就是费用。\n\n但注册公司这件事，不能只看"代办多少钱"，还要看后面有没有记账、报税、地址、开户这些事项。\n\n建议重点确认 4 件事：\n\n1. 营业执照代办是否收费\n2. 注册地址是否真实合规\n3. 代理记账怎么收费\n4. 后续税务申报谁负责\n\n如果有人只说"很便宜"，但不讲后续维护成本，就要多问一句。\n\n刚创业的老板，先把行业、地址、开票需求说清楚，再判断怎么注册更合适。`,
      tags: [`#${city}注册公司`, "#代理记账", "#创业", "#公司注册", "#财税知识"],
      comment_guide: `你可以评论"注册公司"，我整理一份新手注册流程清单给你。`,
      publish_note: "建议晚 20:00-22:00 发布；封面白底深字，突出「费用」二字。",
    },
    {
      topic_type: "避坑",
      title: "注册公司前一定要知道的 5 个坑",
      title_variants: [
        { t: "注册公司前一定要知道的 5 个坑", scores: { search: 75, click: 90, trust: 82, risk: 12, total: 86 } },
        { t: "低价代账的隐形成本，很多老板不知道", scores: { search: 62, click: 85, trust: 80, risk: 18, total: 76 } },
        { t: "公司不经营了，不注销会怎样？", scores: { search: 80, click: 84, trust: 85, risk: 10, total: 83 } },
      ],
      cover_text: "注册公司\n这 5 个坑先避开",
      body: `帮不少老板处理过工商财税问题，这 5 个坑最常见：\n\n1. 注册地址随便挂靠，后续异常被列入经营异常名录\n\n2. 只看代办价格，没问记账报税一年的总成本\n\n3. 注册资本随手填很大，认缴也有责任\n\n4. 拿了执照就不管，零申报也要按时报税\n\n5. 公司不经营了放着不注销，影响法人征信\n\n每一条都有对应的处理办法，篇幅有限先列出来。\n\n你踩过哪一条？评论区说说，我看到会回。`,
      tags: ["#注册公司避坑", "#创业", "#代理记账", "#财税知识", "#小微企业"],
      comment_guide: "评论你最担心的一条，我告诉你怎么处理。",
      publish_note: "避坑类适合工作日午间发布；封面用清单式排版。",
    },
    {
      topic_type: "对比",
      title: "个体户和有限公司，创业初期怎么选？",
      title_variants: [
        { t: "个体户和有限公司，创业初期怎么选？", scores: { search: 90, click: 80, trust: 86, risk: 8, total: 87 } },
        { t: "个体户 vs 公司：一张表看懂区别", scores: { search: 82, click: 84, trust: 84, risk: 8, total: 84 } },
        { t: "自由职业者到底要不要注册公司？", scores: { search: 78, click: 82, trust: 83, risk: 10, total: 81 } },
      ],
      cover_text: "个体户 vs 公司\n创业初期怎么选",
      body: `这是被问最多的问题之一，说下基本判断思路：\n\n选个体户，一般适合：\n· 一个人经营，没有合伙人\n· 客户基本不要求开专票\n· 前期营收规模小\n\n选有限公司，一般适合：\n· 有合伙人或后续要融资\n· 客户是企业，需要开票走对公\n· 想把个人财产和经营风险隔开\n\n两种形式的报税方式、责任承担都不一样，要看你的实际经营情况。\n\n拿不准的话，把你的行业和客户类型发在评论区，我帮你分析。`,
      tags: ["#个体户", "#注册公司", "#创业第一步", "#财税知识", "#自由职业"],
      comment_guide: "评论区写下你的行业+客户类型，我帮你判断选哪种。",
      publish_note: "对比类内容收藏率高，正文可配一张对比表图片。",
    },
    {
      topic_type: "流程",
      title: `${city}注册公司完整流程，照着做就行`,
      title_variants: [
        { t: `${city}注册公司完整流程，照着做就行`, scores: { search: 90, click: 76, trust: 88, risk: 6, total: 85 } },
        { t: "营业执照办下来之后，还要做什么？", scores: { search: 84, click: 80, trust: 86, risk: 8, total: 84 } },
      ],
      cover_text: "注册公司流程\n一步一步来",
      body: `第一次注册公司不用慌，流程其实是固定的：\n\n1. 核名：想 3-5 个备选名字\n\n2. 准备材料：身份证、注册地址材料、经营范围\n\n3. 工商登记：线上提交，等待审核\n\n4. 领取执照 + 刻章\n\n5. 银行开户、税务登记、开票设置\n\n拿到执照不是结束：记账报税从当月就开始了，哪怕没有收入也要按时申报。\n\n每一步的细节和常见问题，后面我会分几篇写。\n\n先收藏，用到的时候翻出来照着做。`,
      tags: [`#${city}注册公司`, "#公司注册流程", "#创业", "#营业执照", "#财税知识"],
      comment_guide: "卡在哪一步了？评论区说下，我看到会回。",
      publish_note: "流程类适合作为置顶笔记；封面用步骤编号排版。",
    },
    {
      topic_type: "案例",
      title: "一个电商老板注册公司后，第一个月都做错了什么",
      title_variants: [
        { t: "一个电商老板注册公司后，第一个月都做错了什么", scores: { search: 66, click: 88, trust: 80, risk: 14, total: 80 } },
        { t: "新公司第一个月财税事项清单", scores: { search: 82, click: 74, trust: 86, risk: 6, total: 81 } },
      ],
      cover_text: "新公司第一个月\n别做错这几件事",
      body: `说一类很典型的情况（细节做了处理）：\n\n一位做电商的老板，注册完公司觉得万事大吉，结果第一个月：\n\n· 没做税务登记，开不了票，耽误平台入驻\n· 以为没收入就不用报税，错过申报期\n· 对公账户没开，货款只能走私人卡\n\n这些不是个例，几乎每个新老板都会遇到其中一两条。\n\n新公司第一个月的正确动作：\n1. 税务登记 + 核定税种\n2. 开对公户\n3. 当月开始记账，按期申报\n\n刚注册完公司的老板，可以对照检查一遍。`,
      tags: ["#电商创业", "#新公司", "#记账报税", "#财税知识", "#创业避坑"],
      comment_guide: `评论"清单"，我把新公司第一个月的财税清单发给你。`,
      publish_note: "案例细节已做泛化处理，不指向具体客户；发布时避免使用真实店铺名。",
    },
  ];
  return templates.slice(0, count).map((t) => ({
    topic_type: t.topic_type,
    title: t.title,
    title_variants: t.title_variants,
    cover_text: t.cover_text,
    cover_plan: { style: "白底深字，简洁专业", note: "主标题加粗放大，副标题细字" },
    body: t.body,
    tags: t.tags,
    comment_guide: t.comment_guide,
    publish_note: t.publish_note + (brand ? `\n结尾人设口径：${brand}` : ""),
  }));
}

export async function generateDrafts(cfg = {}, count = 3) {
  if (!llmConfigured()) {
    return { mode: "demo", drafts: demoDrafts(cfg, count) };
  }
  const sys = `你是一名资深小红书财税行业内容运营。严格依据提供的公司知识库写作，禁止编造价格、案例、数据；禁止使用违禁词（${getBannedWords0()}）；正文500-800字、短句多分段、每段不超过2行、3-6个小节、开头抓痛点、结尾有互动引导；封面文字不超过16字。只输出 JSON。`;
  const refs = Array.isArray(cfg.reference_posts) && cfg.reference_posts.length
    ? `\n\n可借鉴的参考笔记（只借结构、痛点和表达方式，绝不可复述或虚构其数据）：\n${cfg.reference_posts.map((r, i) => `${i + 1}. 标题：${r.post_title}\n结构：${r.content_structure || "未填写"}\n痛点：${r.pain_point || "未填写"}\n行动引导：${r.call_to_action || "未填写"}`).join("\n")}`
    : "";
  const usr = `公司知识库：\n${knowledgeText()}\n\n任务配置：${JSON.stringify({ ...cfg, reference_posts: undefined })}${refs}\n\n请生成 ${count} 篇小红书笔记，选题类型从 ${TOPIC_TYPES.join("/")} 中分散选择。输出 JSON 数组，每项字段：\ntopic_type, title, title_variants(数组，每项 {t, scores:{search,click,trust,risk,total} 0-100}), cover_text, cover_plan({style,note}), body, tags(数组，含#), comment_guide, publish_note`;
  const text = await chat(
    [{ role: "system", content: sys }, { role: "user", content: usr }]
  );
  const arr = extractJSON(text);
  const drafts = Array.isArray(arr) ? arr : arr.drafts || [];
  if (!Array.isArray(drafts) || drafts.length === 0) throw new Error("LLM 未返回可用的内容草稿");
  return { mode: "llm", drafts: drafts.slice(0, count) };
}

function getBannedWords0() {
  const r = db
    .prepare(`SELECT content FROM knowledge_items WHERE category='compliance' AND title='违禁词表' LIMIT 1`)
    .get();
  return r?.content || "";
}

// ---------------- 线索判定 ----------------
const NEED_RULES = [
  { need: "注册公司", re: /(注册公司|办执照|营业执照|开公司|注册个体|工商登记)/ },
  { need: "代理记账", re: /(代账|代理记账|记账|报税|做账|申报)/ },
  { need: "公司注销", re: /(注销|吊销|不经营了)/ },
  { need: "工商变更", re: /(变更|换法人|改地址|股权)/ },
  { need: "税务咨询", re: /(税务|税筹|发票|开票|税率|退税)/ },
];
const INTENT_STRONG = /(多少钱|费用|价格|怎么收费|求推荐|有推荐|联系方式|怎么找你|在哪办|流程是什么|需要什么材料|帮我|急)/;
const INTENT_MID = /(怎么办|怎么弄|如何|想了解|请问|求教|要注意什么)/;
const BAIT = /^[\s]*([1一]|666|扣1|已扣|dd|顶|同问)[\s!！。.~]*$/;

function demoAssess(lead) {
  const text = String(lead.comment_text || "").trim();
  const city = getKB("company", "所在城市") || "";
  let need = "";
  for (const r of NEED_RULES) {
    if (r.re.test(text) || r.re.test(lead.post_title || "")) { need = r.need; break; }
  }
  let score = 0;
  const reasons = [];
  if (BAIT.test(text)) {
    // 引导型评论：结合帖子标题判断
    const postHasNeed = NEED_RULES.some((r) => r.re.test(lead.post_title || ""));
    score = postHasNeed ? 45 : 20;
    reasons.push(`评论仅为"${text}"，属于帖子引导的扣字回复，无法直接确认真实需求，需结合帖子主题（${lead.post_title || "未知"}）谨慎判断`);
  } else {
    if (need) { score += 35; reasons.push(`评论/帖子命中业务需求「${need}」`); }
    if (INTENT_STRONG.test(text)) {
      score += 40;
      reasons.push(`出现强意向表述："${text.match(INTENT_STRONG)[0]}"`);
    } else if (INTENT_MID.test(text)) {
      score += 20;
      reasons.push(`出现咨询式表述："${text.match(INTENT_MID)[0]}"`);
    }
    if (city && text.includes(city)) { score += 15; reasons.push(`提到目标城市「${city}」，地域匹配`); }
    if (text.length >= 15) { score += 5; reasons.push("评论内容较具体"); }
    if (!need && score > 0) score = Math.min(score, 55);
  }
  score = Math.max(0, Math.min(100, score));

  let reply = "";
  if (score >= 60) {
    const salesTone = getKB("sales", "新客沟通三步");
    const needWord = need || "这方面";
    reply = `你好，看到你在问${needWord}的事～ 不同情况（行业、是否要开票）流程和费用会不一样，方便的话说下你的行业和城市，我给你一个具体的参考。`;
    if (salesTone) reply = reply; // 口径已内化于话术
  }
  return {
    detected_need: need || (score >= 40 ? "潜在咨询" : "无明确需求"),
    lead_score: score,
    reason: reasons.join("；") || "未发现与财税业务相关的需求信号",
    suggested_reply: reply,
  };
}

export async function assessLead(lead) {
  if (!llmConfigured()) return { mode: "demo", ...demoAssess(lead) };
  const sys = `你是财税公司的获客分析师。根据小红书评论判断是否为潜在客户。评分规则：80-100 强意向、60-79 中等、40-59 弱、0-39 无效。注意：若评论只是"1/666/扣1"等帖子引导的扣字，不能直接判高分，需结合帖子标题。reason 必须引用评论原文证据。suggested_reply 不超过80字、针对评论内容、不得出现微信号/二维码/站外引流、语气像真人。只输出 JSON 对象：{detected_need, lead_score, reason, suggested_reply}`;
  const usr = `公司知识库：\n${knowledgeText()}\n\n帖子标题：${lead.post_title}\n关键词：${lead.keyword}\n评论用户：${lead.comment_user_name}\n评论内容：${lead.comment_text}`;
  const text = await chat([{ role: "system", content: sys }, { role: "user", content: usr }]);
  const obj = extractJSON(text);
  const score = Math.max(0, Math.min(100, Number(obj.lead_score) || 0));
  const comment = String(lead.comment_text || "").trim();
  // 判断理由不能脱离原评论：模型未引用任何有效片段时，退回可审计的规则结论。
  const reason = String(obj.reason || "").trim();
  const quotedEvidence = comment.length >= 4 && (reason.includes(comment) || [...comment.matchAll(/[，。！？、\s]/g)].some((m) => {
    const fragment = comment.slice(Math.max(0, m.index - 5), Math.min(comment.length, m.index + 7)).trim();
    return fragment.length >= 4 && reason.includes(fragment);
  }));
  if (!quotedEvidence) return { mode: "llm_fallback", ...demoAssess(lead) };
  return {
    mode: "llm",
    detected_need: obj.detected_need || "",
    lead_score: score,
    reason,
    suggested_reply: String(obj.suggested_reply || "").slice(0, 80),
  };
}

// ---------------- 周复盘 ----------------
export async function generateWeeklyReview(stats) {
  // stats: {contents:[{id,title,topic_type,stats,leadCount,avgScore}], totalLeads, strongLeads}
  const ranked = [...stats.contents].sort((a, b) => (b.leadCount - a.leadCount) || ((b.stats.comments || 0) - (a.stats.comments || 0)));
  const keep = ranked.filter((c) => c.leadCount > 0 || (c.stats.comments || 0) > 3).map((c) => `${c.topic_type}类：${c.title}`);
  const stop = ranked
    .filter((c) => (c.stats.views || 0) > 200 && c.leadCount === 0 && (c.stats.comments || 0) <= 1)
    .map((c) => `${c.topic_type}类：${c.title}（有曝光无转化）`);
  const summary = [
    `本周共发布 ${stats.contents.length} 篇笔记，产生线索 ${stats.totalLeads} 条（强意向 ${stats.strongLeads} 条）。`,
    keep.length ? `带来线索/互动最好的内容：${keep.slice(0, 3).join("；")}。` : "本周暂无明显带线索的内容，建议增加搜索型与避坑型选题占比。",
    stop.length ? `建议停止或改写：${stop.slice(0, 3).join("；")}。` : "",
    "下周建议：优先延续高互动选题的系列化，评论区高频问题转化为新笔记选题。",
  ].filter(Boolean).join("\n\n");
  return {
    summary_md: summary,
    keep_writing: keep.slice(0, 5),
    stop_writing: stop.slice(0, 5),
    next_keywords: ranked.slice(0, 3).map((c) => c.title.slice(0, 12)),
  };
}
