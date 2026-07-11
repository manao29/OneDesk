import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  FilePenLine,
  HardDrive,
  Import,
  Keyboard,
  MessageSquareText,
  NotebookPen,
  ScanSearch,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserSearch,
  UsersRound,
} from "lucide-react";
import { api, fmtTime, AGENT_STATUS } from "../api.js";
import { PageHead, useToast } from "../components/common.jsx";

const FLOW = [
  { label: "内容策划", icon: FilePenLine },
  { label: "内容确认", icon: ClipboardCheck },
  { label: "人工发布", icon: Smartphone },
  { label: "评论导入", icon: Import },
  { label: "线索判断", icon: ScanSearch },
  { label: "人工跟进", icon: MessageSquareText },
  { label: "周度复盘", icon: BarChart3 },
];

export default function Office() {
  const [ov, setOv] = useState(null);
  const [running, setRunning] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  const load = () => api.get("/api/overview").then(setOv).catch((e) => toast.show(e.message));
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, []);

  const contentAgent = ov?.agents.find((agent) => agent.code === "content_op");
  const leadAgent = ov?.agents.find((agent) => agent.code === "lead_gen");

  const primaryAction = useMemo(() => {
    if (!ov) return null;
    if (ov.blocked) return { eyebrow: "开工前置", title: "先补齐公司与服务资料", desc: `当前完整度 ${ov.knowledge_pct}%，达到 60% 后两位员工即可开始工作。`, label: "去补资料", to: "/knowledge" };
    if (ov.pending.leads > 0) return { eyebrow: "需要你的判断", title: `${ov.pending.leads} 条强意向回复正在等你确认`, desc: "查看原评论、评分理由与拟回复，再决定是否跟进。", label: "确认回复", to: "/leads?status=waiting_approval" };
    if (ov.pending.ready_to_follow > 0) return { eyebrow: "闭环下一步", title: `${ov.pending.ready_to_follow} 条线索已经确认，等待人工跟进`, desc: "复制已确认回复，到小红书完成沟通后记录真实结果。", label: "去跟进", to: "/leads?status=approved" };
    if (ov.pending.contents > 0) return { eyebrow: "需要你的判断", title: `${ov.pending.contents} 篇内容草稿正在等你确认`, desc: "先核对内容与依据，再复制到小红书人工发布。", label: "确认内容", to: "/contents?tab=waiting_approval" };
    if (ov.pending.ready_to_publish > 0) return { eyebrow: "闭环下一步", title: `${ov.pending.ready_to_publish} 篇内容已经通过，可以发布`, desc: "复制发布清单，在小红书人工发布后登记链接，评论才能正确归因。", label: "去发布并登记", to: "/contents?tab=approved" };
    if (ov.today.contents < (contentAgent?.daily_quota || 3)) return { eyebrow: "建议下一步", title: "让阿禾准备今天的内容", desc: "系统会读取知识库与历史反馈，生成 3 篇待审草稿。", label: "让阿禾开工", action: "content" };
    if (ov.today.leads < (leadAgent?.daily_quota || 10)) return { eyebrow: "建议下一步", title: "把今天看到的公开评论交给阿盈", desc: "粘贴或导入评论，阿盈会逐条评分并保留判断依据。", label: "导入评论", to: "/leads?import=1" };
    return { eyebrow: "今日闭环", title: "两位员工的日常交付已完成", desc: "查看内容与线索的关联，记录真实跟进结果。", label: "查看数据", to: "/data" };
  }, [ov, contentAgent, leadAgent]);

  if (!ov) return <div className="py-20 text-center text-[#a39e92]">正在打开办公室…</div>;

  const dateStr = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  const totalPending = ov.pending.contents + ov.pending.leads;
  const activeAgents = ov.agents.filter((a) => !["blocked", "paused"].includes(a.status)).length;
  const contentWorking = running || contentAgent?.status === "working";
  const leadWorking = leadAgent?.status === "working";
  const activeTasks = ov.runtime?.active_tasks || [];
  const contentTask = activeTasks.find((task) => task.agent_code === "content_op");
  const flowDone = [
    (ov.workflow?.content_ready || 0) > 0,
    (ov.workflow?.content_confirmed || 0) > 0,
    (ov.workflow?.published || 0) > 0,
    (ov.workflow?.leads_imported || 0) > 0,
    (ov.workflow?.leads_judged || 0) > 0,
    (ov.workflow?.followed || 0) > 0,
    (ov.workflow?.reviewed || 0) > 0,
  ];
  const firstOpenFlow = flowDone.findIndex((done) => !done);
  const summary = ov.blocked
    ? "员工暂未开工，先把公司的真实情况告诉他们。"
    : `今天已准备 ${ov.today.contents} 篇内容、识别 ${ov.today.leads} 条线索。`;

  async function startContent() {
    const startedAt = Date.now();
    setRunning(true);
    try {
      const tasks = await api.get("/api/tasks");
      const hasPending = tasks.some((t) => t.type === "content_daily" && t.status === "waiting_approval");
      if (hasPending) {
        toast.show("已有内容草稿待确认，请先处理后再生成下一批。");
        nav("/contents?tab=waiting_approval");
        return;
      }
      let task = tasks.find((t) => t.type === "content_daily" && t.status === "pending");
      if (!task) {
        const r = await api.post("/api/tasks", { type: "content_daily", title: "每日小红书内容生成", config: { daily_count: 3 } });
        task = { id: r.id };
      }
      const res = await api.post(`/api/tasks/${task.id}/run`);
      toast.show(`阿禾生成了 ${res.draft_ids.length} 篇草稿${res.mode === "demo" ? "（演示模式）" : ""}，请到待确认处理`);
      await load();
    } catch (e) { toast.show(e.message); }
    finally {
      const remaining = 850 - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      setRunning(false);
    }
  }

  return (
    <div className="office-page">
      <PageHead title="办公室" sub={`${dateStr} · ${summary}`}>
        <span className="mode-badge"><HardDrive size={14} aria-hidden="true" />本地模式</span>
      </PageHead>
      {toast.node}

      <section className="metric-strip" aria-label="今日概况">
        <Metric icon={UsersRound} label="在岗员工" value={`${activeAgents} / ${ov.agents.length}`} note={ov.blocked ? "等待资料" : "协作中"} />
        <Metric icon={NotebookPen} label="今日内容" value={ov.today.contents} note={`目标 ${contentAgent?.daily_quota || 3} 篇`} />
        <Metric icon={UserSearch} label="新增线索" value={ov.today.leads} note={`强意向 ${ov.today.strong_leads} 条`} />
        <Metric icon={ClipboardCheck} label="待你确认" value={totalPending} note="发布与回复" accent={totalPending > 0} />
      </section>

      <section className={`office-stage ${contentWorking ? "is-content-working" : ""} ${leadWorking ? "is-lead-working" : ""}`} aria-label="数字员工办公室">
        <img src="/assets/onedesk-office-hero-v1.webp" alt="阿禾和阿盈在温暖明亮的办公室工位上工作" />
        <div className="office-stage-shade" aria-hidden="true" />

        <div className="stage-heading">
          <span>ONE DESK · TWO SPECIALISTS</span>
          <strong>一张桌子，两位专员，<br />把获客闭环做实。</strong>
        </div>

        <div className="wall-motto" aria-label="Digital Company For Everyone，让每个人都拥有自己的数字公司">
          <strong>Digital Company</strong>
          <span>For Everyone</span>
          <small>让每个人都拥有自己的数字公司</small>
        </div>

        <div className="mission-board">
          <div className="mission-title"><span>今日目标</span><small>{ov.blocked ? "等待开工" : "持续推进"}</small></div>
          <Mission label="公司资料" current={ov.knowledge_pct} total={100} suffix="%" />
          <Mission label="内容草稿" current={ov.today.contents} total={contentAgent?.daily_quota || 3} suffix="篇" />
          <Mission label="潜在线索" current={ov.today.leads} total={leadAgent?.daily_quota || 10} suffix="条" />
        </div>

        <AgentWorkSignal
          active={contentWorking}
          side="left"
          name="阿禾"
          detail={contentTask?.title || "正在读取公司资料并生成内容草稿"}
        />
        <AgentWorkSignal
          active={leadWorking}
          side="right"
          name="阿盈"
          detail="正在逐条识别需求、评分并整理拟回复"
        />

        {ov.agents.map((agent) => {
          const isContent = agent.code === "content_op";
          const count = isContent ? ov.today.contents : ov.today.leads;
          const effectiveStatus = isContent && running ? "working" : agent.status;
          const st = AGENT_STATUS[effectiveStatus] || { label: effectiveStatus };
          return (
            <Link
              key={agent.id}
              to="/staff"
              className={`desk-status ${isContent ? "desk-status-left" : "desk-status-right"} ${effectiveStatus === "working" ? "is-working" : ""}`}
              aria-label={`查看${agent.name}的员工档案`}
            >
              <span className={`status-pulse status-${effectiveStatus}`} aria-hidden="true" />
              <span className="desk-copy">
                <strong>{agent.name}<small>{agent.role}</small></strong>
                <span>{ov.blocked ? "等待公司资料" : effectiveStatus === "working" ? `${st.label} · 点击查看运行任务` : `${st.label} · 今日 ${count}/${agent.daily_quota}`}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          );
        })}
      </section>

      <section className="next-action-card">
        <span className="next-action-icon" aria-hidden="true"><Sparkles size={20} /></span>
        <div className="next-action-copy">
          <small>{primaryAction.eyebrow}</small>
          <strong>{primaryAction.title}</strong>
          <p>{primaryAction.desc}</p>
        </div>
        {primaryAction.action === "content" ? (
          <button className="btn btn-cinnabar" disabled={running} onClick={startContent}>
            {running ? "生成中…" : primaryAction.label}<ArrowRight size={15} aria-hidden="true" />
          </button>
        ) : (
          <Link to={primaryAction.to} className="btn btn-cinnabar">
            {primaryAction.label}<ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </section>

      <div className="office-lower-grid">
        <section className="card office-panel approvals-panel">
          <div className="panel-head">
            <div><h2>待你确认</h2><p>只把真正需要判断的事留给你。</p></div>
            <span className="panel-count">{totalPending}</span>
          </div>
          <div className="approval-grid">
            <ApprovalRow count={ov.pending.contents} title="内容草稿" desc="核对知识依据与合规后复制发布" to="/contents?tab=waiting_approval" icon={NotebookPen} />
            <ApprovalRow count={ov.pending.leads} title="强意向拟回复" desc="先看原评论与评分理由，再决定跟进" to="/leads?status=waiting_approval" icon={MessageSquareText} accent />
            {ov.pending.compliance_blocked > 0 && (
              <ApprovalRow count={ov.pending.compliance_blocked} title="合规拦截件" desc="命中禁区，须编辑或驳回" to="/contents?tab=waiting_approval" icon={ShieldCheck} accent />
            )}
          </div>
          <div className="human-boundary"><ShieldCheck size={16} aria-hidden="true" />OneDesk 不会替你发布、私信、关注或点赞。</div>
        </section>

        <section className="card office-panel activity-panel">
          <div className="panel-head">
            <div><h2>运行记录</h2><p>每一步都有来源、时间与责任人。</p></div>
          </div>
          <div className="activity-list">
            {ov.activities.length === 0 && <div className="empty-activity">员工开工后，记录会出现在这里。</div>}
            {ov.activities.slice(0, 6).map((log) => (
              <div key={log.id} className="activity-row">
                <span className="activity-dot" aria-hidden="true" />
                <span className="activity-copy"><strong>{log.actor === "user" ? "你" : log.actor}</strong>{log.action}{log.detail ? <small>{log.detail}</small> : null}</span>
                <time>{fmtTime(log.created_at)}</time>
              </div>
            ))}
          </div>
          <div className="executor-state">
            <span><HardDrive size={16} aria-hidden="true" /></span>
            <div><strong>监督式执行</strong><small>当前以手动导入为主；登录、验证码与发送动作始终由人处理。</small></div>
          </div>
        </section>
      </div>

      <section className="business-loop" aria-labelledby="business-loop-title">
        <div className="loop-title"><small>CONTENT → LEAD → LEARNING</small><h2 id="business-loop-title">一条可以复盘的获客链路</h2></div>
        <div className="loop-steps">
          {FLOW.map((step, index) => {
            const Icon = step.icon;
            const done = flowDone[index];
            const current = firstOpenFlow === index;
            return (
              <React.Fragment key={step.label}>
                <div className={`loop-step ${done ? "is-done" : ""} ${current ? "is-current" : ""}`} aria-label={`${step.label}：${done ? "已完成" : current ? "当前步骤" : "待开始"}`}>
                  <span>{done ? <Check size={16} aria-hidden="true" /> : <Icon size={17} aria-hidden="true" />}</span>
                  <strong>{step.label}</strong>
                </div>
                {index < FLOW.length - 1 && <ChevronRight className="loop-arrow" size={17} aria-hidden="true" />}
              </React.Fragment>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function AgentWorkSignal({ active, side, name, detail }) {
  return (
    <Link
      to="/tasks"
      className={`work-signal work-signal-${side} ${active ? "is-active" : ""}`}
      role="status"
      aria-live="polite"
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
    >
      <span className="work-signal-icon" aria-hidden="true"><Keyboard size={15} strokeWidth={1.8} /></span>
      <span className="work-signal-copy"><strong>{name}正在输入</strong><small>{detail}</small></span>
      <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
    </Link>
  );
}

function Metric({ icon: Icon, label, value, note, accent }) {
  return (
    <div className={`metric-card ${accent ? "is-accent" : ""}`}>
      <span className="metric-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
      <span className="metric-copy"><small>{label}</small><strong>{value}</strong><em>{note}</em></span>
    </div>
  );
}

function Mission({ label, current, total, suffix }) {
  const complete = current >= total;
  const progress = Math.min(100, (current / Math.max(total, 1)) * 100);
  return (
    <div className="mission-row">
      <div className="mission-label">
        <span>{complete ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}{label}</span>
        <strong>{suffix === "%" ? `${current}%` : `${current}/${total}${suffix}`}</strong>
      </div>
      <div className="mission-track"><span style={{ width: `${progress}%` }} /></div>
    </div>
  );
}

function ApprovalRow({ count, title, desc, to, icon: Icon, accent }) {
  return (
    <Link to={to} className={`approval-row ${accent && count > 0 ? "is-accent" : ""}`}>
      <span className="approval-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
      <span className="approval-copy"><strong>{title}</strong><small>{desc}</small></span>
      <span className={`approval-count ${count > 0 ? "has-items" : ""}`}>{count}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );
}
