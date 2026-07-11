import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import {
  Building2,
  ChartNoAxesCombined,
  ClipboardCheck,
  HardDrive,
  LayoutDashboard,
  LibraryBig,
  NotebookPen,
  Settings2,
  UserSearch,
  UsersRound,
} from "lucide-react";
import "./index.css";
import Office from "./pages/Office.jsx";
import Staff from "./pages/Staff.jsx";
import Tasks from "./pages/Tasks.jsx";
import Leads from "./pages/Leads.jsx";
import Contents from "./pages/Contents.jsx";
import DataPage from "./pages/DataPage.jsx";
import Knowledge from "./pages/Knowledge.jsx";
import Settings from "./pages/Settings.jsx";

const NAV = [
  { to: "/", label: "办公室", icon: LayoutDashboard },
  { to: "/staff", label: "员工", icon: UsersRound },
  { to: "/tasks", label: "任务", icon: ClipboardCheck },
  { to: "/leads", label: "线索", icon: UserSearch },
  { to: "/contents", label: "内容", icon: NotebookPen },
  { to: "/data", label: "数据", icon: ChartNoAxesCombined },
  { to: "/knowledge", label: "知识库", icon: LibraryBig },
  { to: "/settings", label: "设置", icon: Settings2 },
];

function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <aside className="app-sidebar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true"><Building2 size={20} strokeWidth={1.8} /></span>
            <span>
              <strong>OneDesk</strong>
              <small>财税获客工作台</small>
            </span>
          </div>

          <nav className="app-nav" aria-label="主要导航">
            <p className="nav-eyebrow">数字公司</p>
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === "/"}
                  className={({ isActive }) => `nav-item ${isActive ? "is-active" : ""}`}
                >
                  <Icon className="nav-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{n.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="sidebar-foot">
            <div className="local-status">
              <span className="local-status-icon" aria-hidden="true"><HardDrive size={15} strokeWidth={1.8} /></span>
              <span><strong>本地工作区</strong><small>数据保存在这台电脑</small></span>
            </div>
            <p>数字员工先准备，关键动作由你确认。</p>
          </div>
        </aside>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<Office />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/contents" element={<Contents />} />
            <Route path="/data" element={<DataPage />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
