# OneDesk MVP 原型开发计划

对应 PRD：`PRD.md`。目标：4 周内交付可每日真实使用的本地单机 MVP，本仓库先完成 W1-W3 的可运行原型。

## 1. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 运行形态 | 本地单机 Web 应用（`npm run dev` / `npm start`），数据全在本机 | 符合"操作发生在用户本地电脑"约束，零部署成本 |
| 后端 | Node.js 22 + Express 5 | 生态成熟，与后续本地执行器（Playwright 脚本）同语言 |
| 数据库 | better-sqlite3（单文件 `data/onedesk.sqlite`） | 零配置、可靠、易备份，参考 claw-empire 的 local-first 思路 |
| 前端 | Vite + React 18 + TypeScript + Tailwind CSS | 快速迭代；Tailwind 便于做定制的"文房纸感"主题 |
| LLM | OpenAI 兼容 Chat Completions（BaseURL/Key/模型可配置） | DeepSeek/通义/Kimi/OpenAI 均兼容；无 Key 时走内置演示模板，保证全流程可演示 |
| 校验 | 后端 zod 轻校验 + 违禁词扫描器 | 合规硬约束 |

不引入：用户系统、云端服务、消息队列、ORM、像素游戏引擎。

## 2. 目录结构

```
OneDesk/
├── PRD.md / DEV_PLAN.md / VISION.md / 两份原始 PRD
└── app/
    ├── package.json
    ├── server/
    │   ├── index.ts            Express 入口，静态托管 + API
    │   ├── db.ts               SQLite 初始化 + migration + 种子数据
    │   ├── llm.ts              LLM 客户端（真实 + 演示模式）
    │   ├── compliance.ts       违禁词/承诺句式扫描
    │   └── routes/             agents / tasks / knowledge / contents / leads /
    │                           approvals / activities / reviews / settings / import
    ├── src/                    React 前端
    │   ├── pages/              Office / Staff / Tasks / Leads / Contents / Data /
    │   │                       Knowledge / Settings
    │   ├── components/         工位卡、审批队列、评分徽章、手机预览、导入向导…
    │   └── api.ts              前端 API 封装
    └── data/                   onedesk.sqlite + workspace/（导出 CSV）
```

## 3. 里程碑（对应 PRD 第 11 节）

- **W1 骨架**：脚手架、10 张表、知识库 CRUD + 财税种子 + 完整度、设置页。验收：填资料→完整度 100%→重启不丢。
- **W2 内容闭环**：关键词任务→生成 3 篇草稿（LLM/演示双通道）→违禁词扫描→审批→发布清单→回填 post_url。验收：真实知识库连跑 3 天，每天 3 篇"可直接发"。
- **W3 线索闭环**：粘贴/CSV 导入→判定（need/score/reason/reply）→高分审批→跟进流转→导出；办公室首页 + 活动流。验收：50 条真实评论样本（含"扣1"干扰）误判率 ≤10%。
- **W4 复盘 + 打磨**：数据录入、归因、周复盘回流选题；视觉打磨；（可选）Playwright 只读采集脚本原型。验收：连续 5 天完整闭环，日操作 ≤25 分钟。

## 4. 本原型（本次交付）范围

一次性实现 W1-W3 全部功能 + W4 的复盘页基础版：
1. 全部数据模型与 REST API；
2. 知识库五类 + 财税种子模板 + 完整度门槛（<60% 员工 blocked）；
3. 内容工作台：生成（演示模式内置高质量财税模板，配 Key 后走真实 LLM）、审批、发布清单、回填；
4. 线索池：三种导入、AI 判定、评分分档、拟回复、审批、跟进、CSV 导出、去重；
5. 办公室首页：工位卡 + 待你确认队列 + 活动流；
6. 数据页：发布数据录入 + 内容-线索归因 + 周复盘生成；
7. 视觉：米白纸感 + 墨色 + 朱砂红点缀，衬线标题，无游戏化元素。

## 5. 测试方法

- 后端：启动后用脚本调用核心 API 走一遍 ②→⑦ 闭环（种子演示数据）；
- 前端：本地手工走查 8 个页面主要操作；
- 演示模式保证无 Key 也能完整演示全流程。
