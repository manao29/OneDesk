import { db } from "./db.js";

// 从知识库合规禁区读取违禁词表（第一条：违禁词表，逗号分隔）
export function getBannedWords() {
  const rows = db
    .prepare(`SELECT content FROM knowledge_items WHERE category='compliance' AND title='违禁词表' AND enabled=1`)
    .all();
  const words = new Set();
  for (const r of rows) {
    for (const w of String(r.content).split(/[,，、\s]+/)) {
      if (w.trim()) words.add(w.trim());
    }
  }
  return [...words];
}

const PROMISE_PATTERNS = [
  /保证[^，。]{0,8}(通过|退税|拿证|下证)/,
  /(百分之百|100%)[^，。]{0,6}(合规|通过|成功)/,
  /(必|肯定|一定)能(通过|办下|拿到)/,
];

// 返回违规命中列表；空数组=通过
export function scanText(text) {
  if (!text) return [];
  const hits = [];
  for (const w of getBannedWords()) {
    if (text.includes(w)) hits.push({ type: "banned_word", word: w });
  }
  for (const p of PROMISE_PATTERNS) {
    const m = text.match(p);
    if (m) hits.push({ type: "promise", word: m[0] });
  }
  return hits;
}

export function scanContentDraft(d) {
  const joined = [d.title, d.cover_text, d.body, d.comment_guide].filter(Boolean).join("\n");
  return scanText(joined);
}
