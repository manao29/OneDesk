import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { PageHead, useToast, Modal, Field } from "../components/common.jsx";

const CATS = [
  { key: "company", label: "公司知识", desc: "你是谁、在哪、有什么不同" },
  { key: "service", label: "服务知识", desc: "业务清单、流程、周期、价格区间" },
  { key: "sales", label: "销售知识", desc: "常见问题答复与沟通口径" },
  { key: "platform", label: "平台知识", desc: "小红书规则（系统内置）" },
  { key: "compliance", label: "合规禁区", desc: "违禁词与红线（硬约束）" },
];

export default function Knowledge() {
  const [data, setData] = useState({ items: [], completeness: 0 });
  const [cat, setCat] = useState("company");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const load = () => api.get("/api/knowledge").then(setData).catch((e) => toast.show(e.message));
  useEffect(() => { load(); }, []);

  const items = useMemo(() => data.items.filter((i) => i.category === cat), [data, cat]);
  const missing = useMemo(
    () => data.items.filter((i) => i.required && (!i.content.trim() || i.content.startsWith("示例："))),
    [data]
  );

  async function save(item, content) {
    try {
      const r = await api.patch(`/api/knowledge/${item.id}`, { content });
      toast.show(`已保存 · 完整度 ${r.completeness}%`);
      setEditing(null);
      load();
    } catch (e) { toast.show(e.message); }
  }

  return (
    <div>
      <PageHead title="知识库" sub="两位员工的一切产出都以这里为准。种子模板可以直接改，不必从零写。">
        <button className="btn btn-ghost" onClick={() => setAdding(true)}>+ 新增条目</button>
      </PageHead>
      {toast.node}

      {/* 完整度 */}
      <div className="card px-5 py-4 mb-5 flex items-center gap-5">
        <div className="flex-1">
          <div className="flex justify-between text-xs text-[#6b675e] mb-1.5">
            <span>必填资料完整度（≥60% 员工才能开工）</span>
            <b className={data.completeness >= 60 ? "text-[#5c6f52]" : "text-[#c2401f]"}>{data.completeness}%</b>
          </div>
          <div className="h-2 rounded-full bg-[#efeae0] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${data.completeness >= 60 ? "bg-[#5c6f52]" : "bg-[#c2401f]"}`}
              style={{ width: `${data.completeness}%` }}
            />
          </div>
        </div>
        {missing.length > 0 && (
          <div className="text-xs text-[#6b675e] max-w-72">
            还差：{missing.slice(0, 3).map((m) => m.title.split("：")[0]).join("、")}
            {missing.length > 3 ? ` 等 ${missing.length} 项` : ""}
          </div>
        )}
      </div>

      <div className="flex gap-5">
        <div className="w-44 shrink-0 space-y-1">
          {CATS.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${cat === c.key ? "bg-[#fffdf9] border border-[#e3ddd1] font-medium shadow-sm" : "text-[#6b675e] hover:bg-[#efeae0]"}`}
            >
              {c.label}
              <span className="block text-[10px] text-[#a39e92] font-normal mt-0.5">{c.desc}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-3">
          {items.map((it) => {
            const isPlaceholder = !it.content.trim() || it.content.startsWith("示例：");
            return (
              <div key={it.id} className="card px-5 py-4">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{it.title}</span>
                    {it.required === 1 && <span className="seal">必填</span>}
                    {it.source === "system_seed" && <span className="tag">系统内置</span>}
                    {isPlaceholder && it.required === 1 && <span className="text-xs text-[#c2401f]">待填写</span>}
                  </div>
                  <button className="btn btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setEditing({ ...it })}>编辑</button>
                </div>
                <p className={`text-sm whitespace-pre-wrap leading-relaxed ${isPlaceholder ? "text-[#a39e92]" : "text-[#2b2a27]"}`}>
                  {it.content || "（空）"}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 编辑弹窗 */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.title || ""}>
        {editing && (
          <div>
            <textarea
              className="input min-h-44 leading-relaxed"
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              placeholder="删除「示例：」前缀，填入你们公司的真实口径"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary" onClick={() => save(editing, editing.content)}>保存</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 新增弹窗 */}
      <AddModal open={adding} onClose={() => setAdding(false)} defaultCat={cat} onDone={() => { setAdding(false); load(); }} toast={toast} />
    </div>
  );
}

function AddModal({ open, onClose, defaultCat, onDone, toast }) {
  const [form, setForm] = useState({ category: defaultCat, title: "", content: "" });
  useEffect(() => { setForm((f) => ({ ...f, category: defaultCat })); }, [defaultCat, open]);
  async function submit() {
    if (!form.title) return toast.show("请填写标题");
    try {
      await api.post("/api/knowledge", form);
      toast.show("已新增");
      onDone();
    } catch (e) { toast.show(e.message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="新增知识条目">
      <Field label="分类">
        <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="标题">
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="内容">
        <textarea className="input min-h-32" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={submit}>新增</button>
      </div>
    </Modal>
  );
}
