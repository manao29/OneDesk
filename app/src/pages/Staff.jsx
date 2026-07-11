import React, { useEffect, useState } from "react";
import { api, AGENT_STATUS } from "../api.js";
import { PageHead, useToast } from "../components/common.jsx";

const PROFILE = {
  content_op: {
    duties: "研究公开参考内容、整理选题，生成笔记与发布清单，并根据复盘调整下一批方向。",
    output: "每日 3 篇待审笔记；每篇含标题备选、封面文字、正文、标签与评论引导。",
    guard: "不编造案例、价格或效果；不承诺结果；所有笔记必须经你确认后再人工发布。",
  },
  lead_gen: {
    duties: "从你导入的公开帖子与评论中识别需求，生成评分、可追溯理由和拟回复。",
    output: "每日 10–20 条可判断线索；80 分以上自动进入待确认队列。",
    guard: "不自动私信、评论、关注或点赞；没有帖子来源与评论原文的线索不入库。",
  },
};

export default function Staff() {
  const [agents, setAgents] = useState([]);
  const [draftQuota, setDraftQuota] = useState({});
  const toast = useToast();
  const load = () => api.get("/api/agents").then((rows) => {
    setAgents(rows);
    setDraftQuota(Object.fromEntries(rows.map((a) => [a.id, a.daily_quota])));
  }).catch((e) => toast.show(e.message));
  useEffect(() => { load(); }, []);

  async function save(agent, patch) {
    try {
      await api.patch(`/api/agents/${agent.id}`, patch);
      toast.show(patch.is_paused !== undefined ? (patch.is_paused ? `${agent.name} 已暂停` : `${agent.name} 已恢复`) : "每日配额已保存");
      load();
    } catch (e) { toast.show(e.message); }
  }

  return <div>
    <PageHead title="员工" sub="岗位职责和边界固定；你只调整工作量与是否开工。" />
    {toast.node}
    <div className="space-y-5">
      {agents.map((agent) => {
        const p = PROFILE[agent.code];
        const status = AGENT_STATUS[agent.status] || { label: agent.status, cls: "text-[#6b675e]" };
        const unit = agent.code === "content_op" ? "篇/天" : "条/天";
        return <section key={agent.id} className="card overflow-hidden">
          <div className="px-6 py-5 flex items-start gap-4 border-b border-[#e3ddd1] bg-[#fffdf9]">
            <div className="w-14 h-14 rounded-full bg-[#efeae0] text-[#c2401f] font-title text-2xl flex items-center justify-center">{agent.code === "content_op" ? "禾" : "盈"}</div>
            <div className="flex-1">
              <div className="flex gap-2 items-center"><h2 className="font-title text-xl font-semibold">{agent.name}</h2><span className="text-sm text-[#6b675e]">{agent.role}</span></div>
              <p className={`text-xs mt-1 ${status.cls}`}>● {status.label}</p>
            </div>
            <button className="btn btn-ghost" onClick={() => save(agent, { is_paused: !agent.is_paused })}>{agent.is_paused ? "恢复工作" : "暂停"}</button>
          </div>
          <div className="grid grid-cols-3 gap-6 px-6 py-5 text-sm">
            <Info title="职责" text={p.duties} />
            <Info title="今日交付" text={p.output} />
            <Info title="禁止与质量规则" text={p.guard} />
          </div>
          <div className="px-6 py-4 bg-[#f7f4ee] flex items-center justify-between gap-4">
            <div className="text-xs text-[#6b675e]">今日配额只影响工作台进度提示，不会替你执行任何平台动作。</div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-sm text-[#6b675e]">每日</label>
              <input className="input !w-16 !py-1.5 text-center" type="number" min="1" max="30" value={draftQuota[agent.id] ?? agent.daily_quota} onChange={(e) => setDraftQuota({ ...draftQuota, [agent.id]: e.target.value })} />
              <span className="text-sm text-[#6b675e]">{unit}</span>
              <button className="btn btn-primary !py-1.5" onClick={() => save(agent, { daily_quota: Number(draftQuota[agent.id]) })}>保存</button>
            </div>
          </div>
        </section>;
      })}
    </div>
  </div>;
}

function Info({ title, text }) { return <div><h3 className="font-medium mb-1.5">{title}</h3><p className="leading-relaxed text-[#6b675e]">{text}</p></div>; }
