import React, { useEffect, useState } from "react";

export function PageHead({ title, sub, children }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h1 className="font-title text-[26px] font-semibold">{title}</h1>
        {sub && <p className="text-sm text-[#a39e92] mt-1">{sub}</p>}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function Toast({ msg, onClose }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClose, 2600);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#2b2a27] text-[#fffdf9] text-sm px-4 py-2 rounded-md shadow-lg">
      {msg}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState("");
  return { msg, show: setMsg, node: <Toast msg={msg} onClose={() => setMsg("")} /> };
}

export function Empty({ text = "暂无内容" }) {
  return <div className="py-14 text-center text-sm text-[#a39e92]">{text}</div>;
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25 p-6" onClick={onClose}>
      <div
        className={`card max-h-[88vh] overflow-y-auto w-full ${wide ? "max-w-4xl" : "max-w-xl"} p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-title text-lg font-semibold">{title}</h3>
          <button className="text-[#a39e92] hover:text-[#2b2a27] text-xl leading-none" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block mb-3">
      <div className="text-xs text-[#6b675e] mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-[#a39e92] mt-1">{hint}</div>}
    </label>
  );
}
