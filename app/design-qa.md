# Design QA

## Build under review

- App: OneDesk local MVP
- Route: `http://127.0.0.1:8930/#/`
- Viewport: 1280 × 720
- Evidence: `audit/2026-07-10/`

## Checks

- [x] Existing paper / ink / cinnabar / moss design tokens retained
- [x] User-supplied office composition used as a reference, not copied
- [x] Office scene uses a real project asset rather than CSS or placeholder art
- [x] Navigation uses one coherent icon library
- [x] Main routes remain functional
- [x] Primary CTA resolves from real overview API state
- [x] Agent cards link to employee details
- [x] Approval rows link to real filtered pages
- [x] No broken image assets
- [x] No horizontal overflow at the target viewport
- [x] Text and icon states do not rely on color alone
- [x] Keyboard focus style is present
- [x] Reduced motion is respected
- [x] Smoke test passes
- [x] Production build passes

## Remaining non-blocking follow-ups

- Add a guided first-run knowledge setup flow.
- Add a supervised local “capture current page” executor after compliance validation.
- Test with 3–5 real finance/tax operators and calibrate density and terminology.

final result: passed

## 2026-07-10 动态办公室增量检查

- [x] 墙面标语在 1280 × 720 首屏可见且不遮挡员工与任务板
- [x] 工作动效只在真实 `working` / 本地运行状态下出现
- [x] 工作提示可点击进入任务页，并使用 `aria-live`
- [x] 任务完成后停止动效并切换到待确认状态
- [x] 下一步动作覆盖确认、发布登记、回复确认与人工跟进
- [x] 业务链路新增内容确认，并由真实 API 数据决定完成/当前/待开始
- [x] 每 3 秒同步后端员工状态
- [x] `prefers-reduced-motion` 仍会关闭循环动效
- [x] 生产构建与烟雾测试通过
- [x] 浏览器无横向溢出、损坏图片或控制台错误

final result: passed
