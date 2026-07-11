import React, { useEffect, useMemo, useState } from "react";
import { api, copyText, fmtTime } from "../api.js";
import { Empty, Field, Modal, PageHead, useToast } from "../components/common.jsx";

const TABS = [
  ["all", "全部"], ["waiting_approval", "待确认"], ["approved", "待发布"], ["published", "已发布"], ["rejected", "已驳回"],
];
const STATUS = { waiting_approval: "待确认", approved: "待发布", published: "已发布", rejected: "已驳回", draft: "草稿" };
const parse = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };

export default function Contents() {
  const [contents, setContents] = useState([]);
  const [refs, setRefs] = useState([]);
  const [tab, setTab] = useState(new URLSearchParams(location.hash.split("?")[1] || "").get("tab") || "all");
  const [selected, setSelected] = useState(null);
  const [showRef, setShowRef] = useState(false);
  const [refIds, setRefIds] = useState([]);
  const [making, setMaking] = useState(false);
  const toast = useToast();
  const load = async () => { try { const [drafts, references] = await Promise.all([api.get("/api/contents"), api.get("/api/references")]); setContents(drafts); setRefs(references); } catch (e) { toast.show(e.message); } };
  useEffect(() => { load(); }, []);
  const shown = useMemo(() => tab === "all" ? contents : contents.filter((c) => c.status === tab), [contents, tab]);
  async function generate() {
    setMaking(true);
    try {
      const r = await api.post("/api/tasks", { type: "content_daily", title: "每日小红书内容生成", config: { daily_count: 3, reference_post_ids: refIds } });
      const out = await api.post(`/api/tasks/${r.id}/run`);
      toast.show(`阿禾已生成 ${out.draft_ids.length} 篇草稿${refIds.length ? "，已参考所选笔记结构" : ""}。`);
      setRefIds([]); load();
    } catch (e) { toast.show(e.message); } finally { setMaking(false); }
  }
  return <div>
    <PageHead title="内容" sub="先确认，再人工发布。参考笔记只用于借鉴结构与问题，不做原文改写。"><button className="btn btn-ghost" onClick={() => setShowRef(true)}>+ 录入参考笔记</button><button className="btn btn-primary" disabled={making} onClick={generate}>{making ? "生成中…" : "生成今日 3 篇"}</button></PageHead>
    {toast.node}
    <div className="grid grid-cols-4 gap-5">
      <aside className="col-span-1 space-y-4"><section className="card px-4 py-4"><h2 className="font-title font-semibold">内容状态</h2><div className="mt-3 space-y-1">{TABS.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`w-full flex justify-between px-3 py-2 rounded-md text-sm ${tab === key ? "bg-[#efeae0] font-medium" : "text-[#6b675e] hover:bg-[#f7f4ee]"}`}><span>{label}</span><span className="text-xs text-[#a39e92]">{key === "all" ? contents.length : contents.filter((x) => x.status === key).length}</span></button>)}</div></section><section className="card px-4 py-4"><h2 className="font-title font-semibold">参考笔记</h2><p className="mt-1 text-xs leading-relaxed text-[#a39e92]">勾选后，下一次生成会参考其结构、痛点与互动方式。</p><div className="mt-3 space-y-2 max-h-80 overflow-y-auto">{refs.length === 0 && <p className="text-xs text-[#a39e92]">暂无参考笔记</p>}{refs.map((r) => <label key={r.id} className="block border-b border-[#e3ddd1] pb-2 cursor-pointer"><div className="flex gap-2"><input type="checkbox" checked={refIds.includes(r.id)} onChange={() => setRefIds(refIds.includes(r.id) ? refIds.filter((id) => id !== r.id) : [...refIds, r.id])} /><span className="text-xs leading-relaxed">{r.post_title}</span></div><span className="block ml-5 mt-1 text-[10px] text-[#a39e92]">{r.keyword || "未设关键词"}</span></label>)}</div>{refIds.length > 0 && <p className="mt-3 text-xs text-[#c2401f]">已选 {refIds.length} 条参考</p>}</section></aside>
      <section className="col-span-3 space-y-3">{shown.length === 0 ? <div className="card"><Empty text={tab === "waiting_approval" ? "暂无待确认笔记。可让阿禾开始生成。" : "这里还没有内容。"} /></div> : shown.map((item) => <ContentRow key={item.id} item={item} onOpen={() => setSelected(item.id)} />)}</section>
    </div>
    <ReferenceModal open={showRef} onClose={() => setShowRef(false)} toast={toast} onDone={() => { setShowRef(false); load(); }} />
    {selected && <ContentDetail key={selected} item={contents.find((c) => c.id === selected)} refs={refs} toast={toast} onClose={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />}
  </div>;
}

function ContentRow({ item, onOpen }) {
  const tags = parse(item.tags_json, []);
  const hits = parse(item.compliance_json, []);
  return <button onClick={onOpen} className="card w-full text-left px-5 py-4 hover:border-[#b9b1a4] transition-colors"><div className="flex justify-between gap-5"><div className="min-w-0"><div className="flex items-center gap-2"><span className="tag">{item.topic_type}</span><span className="text-xs text-[#a39e92]">{fmtTime(item.created_at)}</span>{hits.length > 0 && <span className="seal">合规待编辑</span>}</div><h2 className="font-title font-semibold text-lg mt-2 truncate">{item.title}</h2><p className="mt-1.5 text-sm text-[#6b675e] line-clamp-2 whitespace-pre-wrap">{item.body}</p><div className="mt-3 flex gap-1 flex-wrap">{tags.slice(0, 5).map((tag) => <span className="text-xs text-[#a39e92]" key={tag}>{tag}</span>)}</div></div><span className="shrink-0 text-xs text-[#6b675e]">{STATUS[item.status] || item.status} →</span></div></button>;
}

function ContentDetail({ item, refs, toast, onClose, onDone }) {
  const [editing, setEditing] = useState(item.status === "waiting_approval");
  const [form, setForm] = useState({ title: item.title, cover_text: item.cover_text, body: item.body, tags: parse(item.tags_json, []).join(" "), comment_guide: item.comment_guide, publish_note: item.publish_note });
  const [postUrl, setPostUrl] = useState(item.post_url || "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const titleVariants = parse(item.title_variants_json, []);
  const compliance = parse(item.compliance_json, []);
  const linkedRefs = parse(item.ref_post_ids_json, []).map(Number).map((id) => refs.find((r) => r.id === id)).filter(Boolean);
  const edits = { ...form, tags: form.tags.split(/\s+/).filter(Boolean) };
  async function decide(action) { setSaving(true); try { await api.post(`/api/contents/${item.id}/decision`, { action, edits: editing ? edits : undefined, note: reason }); toast.show(action === "reject" ? "已驳回，原因会保留在记录中" : "已通过。请复制发布清单后在小红书 App 人工发布。"); onDone(); } catch (e) { toast.show(e.message); } finally { setSaving(false); } }
  async function saveDraft() { setSaving(true); try { await api.patch(`/api/contents/${item.id}`, edits); toast.show("草稿已保存，仍需通过审批才可发布。"); setEditing(false); } catch (e) { toast.show(e.message); } finally { setSaving(false); } }
  async function publish() { setSaving(true); try { await api.post(`/api/contents/${item.id}/published`, { post_url: postUrl.trim() }); toast.show("已登记发布链接；之后导入该帖评论会自动关联。 "); onDone(); } catch (e) { toast.show(e.message); } finally { setSaving(false); } }
  async function copySheet() { try { const { sheet } = await api.get(`/api/contents/${item.id}/publish-sheet`); const ok = await copyText(sheet); toast.show(ok ? "发布清单已复制" : "浏览器未允许复制，请手动选择文本复制"); } catch (e) { toast.show(e.message); } }
  return <Modal open onClose={onClose} title="内容确认" wide><div className="grid grid-cols-5 gap-6">{toast.node}<div className="col-span-3 space-y-4"><div className="flex justify-between items-center"><span className="tag">{item.topic_type}</span><span className="text-xs text-[#a39e92]">{STATUS[item.status]}</span></div>{compliance.length > 0 && <div className="rounded-md border border-[#c2401f]/40 bg-[#fdf6f3] px-3 py-2 text-xs text-[#c2401f]">命中合规词：{compliance.map((h) => h.word).join("、")}。必须编辑后才可以通过。</div>}<Field label="标题"><input className="input font-medium" readOnly={!editing} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><Field label="封面文字"><textarea className="input min-h-16" readOnly={!editing} value={form.cover_text} onChange={(e) => setForm({ ...form, cover_text: e.target.value })} /></Field><Field label="正文"><textarea className="input min-h-72 leading-relaxed" readOnly={!editing} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field><Field label="标签（空格分隔）"><input className="input" readOnly={!editing} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field><Field label="评论区引导"><textarea className="input min-h-20" readOnly={!editing} value={form.comment_guide} onChange={(e) => setForm({ ...form, comment_guide: e.target.value })} /></Field><Field label="发布注意事项"><textarea className="input min-h-20" readOnly={!editing} value={form.publish_note} onChange={(e) => setForm({ ...form, publish_note: e.target.value })} /></Field></div><aside className="col-span-2 space-y-4"><section className="rounded-md bg-[#f7f4ee] p-4"><h3 className="font-medium text-sm">标题备选</h3><div className="mt-2 space-y-2">{titleVariants.map((v, i) => <div key={i} className="text-xs"><p>{v.t}</p>{v.scores && <p className="mt-1 text-[#a39e92]">搜索 {v.scores.search} · 点击 {v.scores.click} · 可信 {v.scores.trust} · 风险 {v.scores.risk}</p>}</div>)}</div></section>{linkedRefs.length > 0 && <section className="rounded-md border border-[#e3ddd1] p-4"><h3 className="font-medium text-sm">参考依据</h3>{linkedRefs.map((r) => <div key={r.id} className="mt-2 text-xs leading-relaxed"><p>{r.post_title}</p><p className="text-[#a39e92]">{r.content_structure || r.pain_point || "已录入，未填写拆解"}</p></div>)}</section>}<section className="rounded-md border border-[#e3ddd1] p-4 text-xs leading-relaxed text-[#6b675e]"><b className="text-[#2b2a27]">人工发布边界</b><br />OneDesk 只生成和复制清单；发布动作永远在小红书 App 内由你完成。</section>{item.status === "waiting_approval" && <div className="space-y-2">{editing ? <button className="btn btn-ghost w-full justify-center" disabled={saving} onClick={saveDraft}>先保存草稿</button> : <button className="btn btn-ghost w-full justify-center" onClick={() => setEditing(true)}>编辑草稿</button>}{rejecting ? <div className="border border-[#e3ddd1] rounded-md p-3"><textarea className="input min-h-16" placeholder="写下驳回原因，阿禾下次会参考" value={reason} onChange={(e) => setReason(e.target.value)} /><div className="flex gap-2 mt-2"><button className="btn btn-ghost flex-1 justify-center !px-2" onClick={() => setRejecting(false)}>取消</button><button className="btn btn-cinnabar flex-1 justify-center !px-2" disabled={saving} onClick={() => decide("reject")}>确认驳回</button></div></div> : <button className="btn btn-ghost w-full justify-center" onClick={() => setRejecting(true)}>驳回</button>}<button className="btn btn-primary w-full justify-center" disabled={saving} onClick={() => decide(editing ? "edit_approve" : "approve")}>{saving ? "处理中…" : editing ? "编辑后通过" : "通过"}</button></div>}{item.status === "approved" && <div className="space-y-2"><button className="btn btn-ghost w-full justify-center" onClick={copySheet}>复制发布清单</button><input className="input text-xs" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="粘贴已发布的小红书链接" /><button className="btn btn-primary w-full justify-center" disabled={saving} onClick={publish}>登记为已发布</button></div>}{item.status === "published" && <div className="text-xs leading-relaxed text-[#5c6f52]">已于 {fmtTime(item.publish_time)} 登记发布。后续把该帖评论导入线索池时会自动归因。</div>}</aside></div></Modal>;
}

function ReferenceModal({ open, onClose, onDone, toast }) {
  const [form, setForm] = useState({ keyword: "", post_title: "", post_url: "", author_name: "", cover_text: "", content_structure: "", pain_point: "", solution: "", call_to_action: "", risk_note: "", imitate_level: "中" });
  useEffect(() => { if (open) setForm({ keyword: "", post_title: "", post_url: "", author_name: "", cover_text: "", content_structure: "", pain_point: "", solution: "", call_to_action: "", risk_note: "", imitate_level: "中" }); }, [open]);
  async function submit() { try { await api.post("/api/references", form); toast.show("参考笔记已保存"); onDone(); } catch (e) { toast.show(e.message); } }
  return <Modal open={open} onClose={onClose} title="录入公开参考笔记"><p className="text-xs leading-relaxed text-[#a39e92] mb-4">只记录你人工查看的公开内容。建议填“结构、痛点、互动方式”，不要复制整篇正文。</p><div className="grid grid-cols-2 gap-3"><Field label="关键词"><input className="input" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="东莞注册公司" /></Field><Field label="作者（可选）"><input className="input" value={form.author_name} onChange={(e) => setForm({ ...form, author_name: e.target.value })} /></Field></div><Field label="笔记标题 *"><input className="input" value={form.post_title} onChange={(e) => setForm({ ...form, post_title: e.target.value })} /></Field><Field label="帖子链接（可选）"><input className="input" value={form.post_url} onChange={(e) => setForm({ ...form, post_url: e.target.value })} /></Field><Field label="内容结构"><textarea className="input min-h-20" value={form.content_structure} onChange={(e) => setForm({ ...form, content_structure: e.target.value })} placeholder="如：问题切入 → 3 个避坑点 → 评论区提问" /></Field><Field label="目标痛点与解决思路"><textarea className="input min-h-20" value={`${form.pain_point}${form.solution ? `\n解决：${form.solution}` : ""}`} onChange={(e) => { const [pain, ...rest] = e.target.value.split("\n解决："); setForm({ ...form, pain_point: pain, solution: rest.join("\n解决：") }); }} /></Field><Field label="评论区引导"><input className="input" value={form.call_to_action} onChange={(e) => setForm({ ...form, call_to_action: e.target.value })} /></Field><div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-primary" onClick={submit}>保存参考</button></div></Modal>;
}
