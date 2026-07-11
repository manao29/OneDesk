async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

export const api = {
  get: (url) => req("GET", url),
  post: (url, body) => req("POST", url, body),
  patch: (url, body) => req("PATCH", url, body),
};

export function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const AGENT_STATUS = {
  idle: { label: "待命", cls: "text-ink-soft" },
  working: { label: "工作中", cls: "text-moss" },
  waiting_approval: { label: "等你确认", cls: "text-cinnabar" },
  done: { label: "今日完成", cls: "text-moss" },
  blocked: { label: "待补资料", cls: "text-amber-tone" },
  paused: { label: "已暂停", cls: "text-ink-faint" },
};

export function scoreBand(s) {
  if (s >= 80) return { label: "强意向", cls: "bg-[#c2401f] text-white" };
  if (s >= 60) return { label: "中意向", cls: "bg-[#b07d2b] text-white" };
  return { label: "弱意向", cls: "bg-[#a39e92] text-white" };
}

export const LEAD_STATUS = {
  new: "新线索",
  waiting_approval: "待确认",
  approved: "已确认",
  replied: "已回复",
  messaged: "已私信",
  converted: "已转化",
  invalid: "已忽略",
};

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch { return false; }
}
