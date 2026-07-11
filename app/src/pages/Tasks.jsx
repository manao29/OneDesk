import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtTime } from "../api.js";
import { PageHead, useToast, Modal, Field, Empty } from "../components/common.jsx";

const STATUS = { pending: "待运行", running: "运行中", waiting_approval: "待确认", done: "已完成", failed: "失败" };
const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState(null);
  const toast = useToast();
  const nav = useNavigate();
  const load = () => api.get("/api/tasks").then(setTasks).catch((e) => toast.show(e.message));
  useEffect(() => { load(); }, []);
  async function run(task) {
    if (task.type === "lead_scan") return nav("/leads?import=1");
    setRunning(task.id);
    try { const r = await api.post(`/api/tasks/${task.id}/run`); toast.show(`已生成 ${r.draft_ids.length} 篇草稿，请到内容页确认。`); load(); }
    catch (e) { toast.show(e.message); } finally { setRunning(null); }
  }
  return <div>
    <PageHead title="任务" sub="任务记录“由谁、以什么口径、何时开工”。线索任务只负责整理，不会采集或发送。"><button className="btn btn-primary" onClick={() => setAdding(true)}>+ 新建任务</button></PageHead>
    {toast.node}
    <div className="card overflow-hidden">
      {tasks.length === 0 ? <Empty text="还没有任务。创建一个每日内容任务，从今天的 3 篇笔记开始。" /> : <table className="w-full text-sm">
        <thead className="bg-[#f7f4ee] text-xs text-[#6b675e]"><tr><th className="text-left p-4 font-medium">任务</th><th className="text-left p-4 font-medium">类型 / 口径</th><th className="text-left p-4 font-medium">状态</th><th className="text-left p-4 font-medium">最近运行</th><th className="p-4" /></tr></thead>
        <tbody>{tasks.map((t) => { const cfg = parse(t.config_json); return <tr key={t.id} className="border-t border-[#e3ddd1] align-top"><td className="p-4"><div className="font-medium">{t.title}</div>{t.result_summary && <div className="text-xs text-[#a39e92] mt-1 max-w-80">{t.result_summary}</div>}</td><td className="p-4 text-xs text-[#6b675e] leading-relaxed">{t.type === "content_daily" ? `内容生成 · ${cfg.daily_count || 3} 篇/次` : `线索整理 · ${cfg.keywords || "未设关键词"}`}{cfg.city ? ` · ${cfg.city}` : ""}</td><td className="p-4"><span className="tag">{STATUS[t.status] || t.status}</span></td><td className="p-4 text-xs text-[#6b675e]">{fmtTime(t.run_at || t.created_at)}</td><td className="p-4 text-right"><button className="btn btn-ghost !py-1" disabled={t.status === "running" || t.status === "waiting_approval"} onClick={() => run(t)}>{running === t.id ? "开工中…" : t.type === "lead_scan" ? "去导入" : "开工"}</button></td></tr>; })}</tbody>
      </table>}
    </div>
    <TaskModal open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} toast={toast} />
  </div>;
}

function TaskModal({ open, onClose, onDone, toast }) {
  const [form, setForm] = useState({ type: "content_daily", title: "每日小红书内容生成", city: "", keywords: "", daily_count: 3, style: "专业但不吓人，像真人经验分享" });
  useEffect(() => { if (open) setForm({ type: "content_daily", title: "每日小红书内容生成", city: "", keywords: "", daily_count: 3, style: "专业但不吓人，像真人经验分享" }); }, [open]);
  async function submit() {
    if (!form.title.trim()) return toast.show("请填写任务名称");
    try { await api.post("/api/tasks", { type: form.type, title: form.title, config: { city: form.city, keywords: form.keywords, daily_count: Number(form.daily_count), style: form.style } }); toast.show("任务已创建"); onDone(); }
    catch (e) { toast.show(e.message); }
  }
  return <Modal open={open} onClose={onClose} title="新建任务"><Field label="任务类型"><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, title: e.target.value === "content_daily" ? "每日小红书内容生成" : "小红书评论线索整理" })}><option value="content_daily">内容生成</option><option value="lead_scan">线索整理</option></select></Field><Field label="任务名称"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="城市（可选）"><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="如：东莞" /></Field>{form.type === "content_daily" && <Field label="每次生成"><input className="input" type="number" min="1" max="5" value={form.daily_count} onChange={(e) => setForm({ ...form, daily_count: e.target.value })} /></Field>}</div><Field label="业务关键词"><input className="input" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="注册公司、代理记账、工商变更" /></Field>{form.type === "content_daily" && <Field label="内容风格"><input className="input" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} /></Field>}<div className="flex justify-end gap-2 mt-3"><button className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-primary" onClick={submit}>创建</button></div></Modal>;
}
