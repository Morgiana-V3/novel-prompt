# 架构与契约地图

维护原则：目录迁移同时更新本文。外部名称和持久化字段保持原样；模块名称可以更清楚，协议不能跟着内部变量重命名。验证入口见 [测试说明](testing.md)。

## 运行与依赖

Electron 主进程是唯一应用宿主，窗口和 MCP 客户端共享服务、任务与数据。独立 Node MCP 代理只负责 stdio 与宿主桥接，不持有另一份业务状态。开发数据为 novel-prompt-dev；安装版使用 Electron userData；显式 NOVELPROMPT_USER_DATA 用于隔离验收，开发版拒绝安装版目录及其父子目录。

依赖方向为 app 装配 adapters 与 modules，adapters 调用 modules，modules 使用 providers / infrastructure。renderer 的 app 组合 features，功能使用 renderer/shared；src/shared 只能包含平台无关的模型、契约和规则。preload 只桥接明确授权的接口。

## 领域入口与持久化

| 领域 | 当前入口 | 数据与约束 |
| --- | --- | --- |
| 工作台 | main/modules/workspace/service.ts、discussion.ts、execution.ts | userData/data/page-workspaces/<UUID>.json，schema=2；读取现有 schema=1 的迁移逻辑保留。revision、编辑锁和讨论快照必须保留；删除移入 removed。 |
| 生成 | main/modules/generation/service.ts、inpaint.ts；main/providers/novelai/ | 先校验额度，再逐张请求、合成和落库，最后核对两类 Anlas；取消等待当前图片保存，不重试未知写入。 |
| 图片 | main/modules/images/library.ts；workspace/image-references.ts、image-cleanup.ts | userData/image-library 下 saved、temporary、workspaces；保留旧 images 读取。图片旁 JSON 记录 schema=1 的实际生成请求；共享引用阻止误删。 |
| 规则 | main/modules/skills/service.ts | 安装包 skills 只读；userData/skills/user 保存用户规则；设置保存选择，讨论记录冻结 snapshot。 |
| 任务 | main/modules/tasks/task-manager.ts；main/adapters/ipc/tasks.ts | 内存状态；资源互斥、进度、取消模式、目标和 Agent 归属。IPC/MCP 不能各自另建生图队列。 |
| 设置 | main/modules/settings/service.ts | userData/data/settings.json；原子写入、损坏隔离与备份恢复。 |
| 收藏 | main/modules/images/recipes.ts | 保持当前保存格式和语义，本轮仅作必要引用调整。 |

## 核心调用链

人工操作或 MCP 前台命令 → 工作台明确动作 → preload API → 领域 IPC → 工作台用例 → 存储及图片服务。前台命令保留 token、窗口可见步骤、草稿与编辑归属保护。后台 MCP 工具经过权限和输入校验调用同一业务规则，不伪装成人工界面操作。

提交需求 → 创建讨论快照/冻结规则 → 内部 AI 或外部 Agent 回复 → 保存待审核 proposal → 采纳时核对 revision/contextKey → 更新草稿 → 明确生成或重绘 → 保存实际图片和参数 → 浏览/对比候选。viewedVersion 是浏览对象，discussionVersion 是讨论对象，currentVersionId 是采用稿，也是下一次执行底图；三者不能混同。

## IPC 注册清单

参数、返回值和事件载荷的权威类型是 `src/shared/contracts/api.ts` 中的 Api、IpcContract、AppEvents 与 RendererMessages；桌面命令使用 `contracts/desktop.ts`。主进程 typed handle、preload bridge 和 renderer 依赖同一契约。领域模型位于 shared 对应目录。

| 通道 | 注册来源 |
| --- | --- |
| `agents:list` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts` |
| `ai:inpaint-plan-cancel` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/prompts/task-actions.ts` |
| `ai:inpaint-plan` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/prompts/task-actions.ts` |
| `ai:optimize` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/prompts/task-actions.ts` |
| `ai:preview` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/prompts/task-actions.ts` |
| `clipboard:read` | `src/main/adapters/ipc/application.ts` |
| `clipboard:write` | `src/main/adapters/ipc/application.ts` |
| `db:aiTranslate` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tags/task-actions.ts` |
| `db:implications` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tags/task-actions.ts` |
| `db:status` | `src/main/adapters/ipc/tags.ts` |
| `db:update` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tags/task-actions.ts` |
| `desktop:cancel-frontend` | `src/main/adapters/desktop/bridge.ts` |
| `desktop:reply` | `src/main/adapters/desktop/bridge.ts` |
| `desktop:state` | `src/main/adapters/desktop/bridge.ts` |
| `images:cleanup-retry` | `src/main/adapters/ipc/images.ts` |
| `images:cleanup-status` | `src/main/adapters/ipc/images.ts` |
| `mcp:info` | `src/main/adapters/ipc/application.ts` |
| `nai:cancel` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/generation/task-actions.ts` |
| `nai:copyImage` | `src/main/adapters/ipc/images.ts` |
| `nai:delete` | `src/main/adapters/ipc/images.ts` |
| `nai:freeCheck` | `src/main/adapters/ipc/images.ts` |
| `nai:generate` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/generation/task-actions.ts` |
| `nai:inpaint` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/generation/task-actions.ts` |
| `nai:list` | `src/main/adapters/ipc/images.ts` |
| `nai:readImage` | `src/main/adapters/ipc/images.ts` |
| `nai:recipe` | `src/main/adapters/ipc/images.ts` |
| `nai:retain` | `src/main/adapters/ipc/images.ts` |
| `nai:reveal` | `src/main/adapters/ipc/images.ts` |
| `nai:saveAs` | `src/main/adapters/ipc/images.ts` |
| `nai:subscription` | `src/main/adapters/ipc/images.ts` |
| `pages:agent` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts` |
| `pages:cancel` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts` |
| `pages:chat` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts` |
| `pages:cleanup-removed-images` | `src/main/adapters/ipc/workspace.ts` |
| `pages:clear-image` | `src/main/adapters/ipc/workspace.ts` |
| `pages:create` | `src/main/adapters/ipc/workspace.ts` |
| `pages:delete` | `src/main/adapters/ipc/workspace.ts` |
| `pages:edit` | `src/main/adapters/ipc/workspace.ts` |
| `pages:external-cancel` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts` |
| `pages:external-reply` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts` |
| `pages:generate` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts` |
| `pages:import` | `src/main/adapters/ipc/workspace.ts` |
| `pages:list` | `src/main/adapters/ipc/workspace.ts` |
| `pages:read` | `src/main/adapters/ipc/workspace.ts` |
| `pages:recover-image` | `src/main/adapters/ipc/workspace.ts` |
| `pages:removed` | `src/main/adapters/ipc/workspace.ts` |
| `pages:restore` | `src/main/adapters/ipc/workspace.ts` |
| `prompt:analyze` | `src/main/adapters/ipc/tags.ts` |
| `recipes:config` | `src/main/adapters/ipc/images.ts` |
| `recipes:create` | `src/main/adapters/ipc/images.ts` |
| `recipes:delete` | `src/main/adapters/ipc/images.ts` |
| `recipes:list` | `src/main/adapters/ipc/images.ts` |
| `recipes:update` | `src/main/adapters/ipc/images.ts` |
| `recipes:workspace` | `src/main/adapters/ipc/images.ts` |
| `settings:get` | `src/main/adapters/ipc/settings.ts` |
| `settings:save` | `src/main/adapters/ipc/settings.ts` |
| `skills:core` | `src/main/adapters/ipc/skills.ts` |
| `skills:create` | `src/main/adapters/ipc/skills.ts` |
| `skills:delete` | `src/main/adapters/ipc/skills.ts` |
| `skills:duplicate` | `src/main/adapters/ipc/skills.ts` |
| `skills:get` | `src/main/adapters/ipc/skills.ts` |
| `skills:import` | `src/main/adapters/ipc/skills.ts` |
| `skills:list` | `src/main/adapters/ipc/skills.ts` |
| `skills:reveal` | `src/main/adapters/ipc/skills.ts` |
| `skills:setConfig` | `src/main/adapters/ipc/skills.ts` |
| `skills:update` | `src/main/adapters/ipc/skills.ts` |
| `tag:search` | `src/main/adapters/ipc/tags.ts` |
| `tag:setZh` | `src/main/adapters/ipc/tags.ts` |
| `task:cancel` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tags/task-actions.ts` |
| `tasks:cancel` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tasks/task-actions.ts` |
| `tasks:clear` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tasks/task-actions.ts` |
| `tasks:list` | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tasks/task-actions.ts` |
| `update:check` | `src/main/adapters/ipc/updates.ts` |
| `update:download` | `src/main/adapters/ipc/updates.ts` |
| `update:install` | `src/main/adapters/ipc/updates.ts` |
| `update:open` | `src/main/adapters/ipc/updates.ts` |
| `update:state` | `src/main/adapters/ipc/updates.ts` |
| `web:open` | `src/main/adapters/ipc/application.ts` |
| `window:dark-titlebar` | `src/main/adapters/ipc/application.ts` |

## 事件与窗口契约

DesktopCommand.type 包含 snapshot、capture-prepare、capture-end、navigate、apply-prompt、workspace-lock、workspace-release、show-image、frontend。FrontendRequest.action 与 DesktopState 见 shared/contracts/desktop.ts；修改要同时核对主进程桥和渲染命令执行器。

| 事件/桥接通道 | 来源 |
| --- | --- |
| `gallery:changed` | `src/preload/api/application.ts` |
| `skills:changed` | `src/preload/api/application.ts` |
| `tasks:changed` | `src/preload/api/application.ts` |
| `agents:changed` | `src/preload/api/application.ts` |
| `nai:step` | `src/preload/api/application.ts` |
| `update:state` | `src/preload/api/application.ts` |
| `progress` | `src/preload/api/application.ts` |
| `ai:step` | `src/preload/api/application.ts` |
| `desktop:state` | `src/preload/api/desktop.ts` |
| `desktop:reply` | `src/preload/api/desktop.ts` |
| `desktop:command` | `src/preload/api/desktop.ts` |
| `desktop:cancel-frontend` | `src/preload/api/desktop.ts` |
| `desktop:frontend-cancel` | `src/preload/api/desktop.ts` |

## MCP 工具名称清单

按源码静态工具定义记录。最终目录由 buildTools、desktopTools、frontendTools 和会话管理工具合成；分组、权限、输入输出模式分别以 tool-groups、contract、output-schemas 和各工具定义为准。注册或迁移时核对完整目录与实际会话初始化结果。

| 工具名 | 定义来源 |
| --- | --- |
| `add_workspace_region` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `agent_guide` | `src/main/adapters/mcp/tools/guides.ts` |
| `analyze_prompt` | `src/main/adapters/mcp/tools/prompts.ts` |
| `apply_app_prompt` | `src/main/adapters/mcp/desktop-tools.ts` |
| `apply_workspace_action` | `src/main/adapters/mcp/desktop-tools.ts` |
| `cancel_task` | `src/main/adapters/mcp/desktop-tools.ts` |
| `cancel_workspace_request` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `compare_workspace_versions` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `configure_tools` | `src/main/adapters/mcp/server.ts` |
| `create_skill` | `src/main/adapters/mcp/tools/skills.ts` |
| `create_workspace` | `src/main/adapters/mcp/desktop-tools.ts` |
| `delete_image` | `src/main/adapters/mcp/management-tools.ts` |
| `delete_skill` | `src/main/adapters/mcp/tools/skills.ts` |
| `delete_workspace` | `src/main/adapters/mcp/management-tools.ts` |
| `delete_workspace_image` | `src/main/adapters/mcp/management-tools.ts` |
| `generate_image` | `src/main/adapters/mcp/tools/images.ts` |
| `generate_workspace` | `src/main/adapters/mcp/desktop-tools.ts` |
| `get_app_state` | `src/main/adapters/mcp/desktop-tools.ts` |
| `get_operation` | `src/main/adapters/mcp/server.ts` |
| `get_skill` | `src/main/adapters/mcp/tools/skills.ts` |
| `get_workspace` | `src/main/adapters/mcp/desktop-tools.ts` |
| `get_workspace_context` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `inpaint_guide` | `src/main/adapters/mcp/inpaint-tools.ts` |
| `inpaint_image` | `src/main/adapters/mcp/inpaint-tools.ts` |
| `list_images` | `src/main/adapters/mcp/tools/images.ts` |
| `list_skills` | `src/main/adapters/mcp/tools/skills.ts` |
| `list_tasks` | `src/main/adapters/mcp/desktop-tools.ts` |
| `list_workspace_requests` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `list_workspaces` | `src/main/adapters/mcp/desktop-tools.ts` |
| `nai_subscription` | `src/main/adapters/mcp/tools/images.ts` |
| `navigate_app` | `src/main/adapters/mcp/desktop-tools.ts` |
| `optimize_prompt` | `src/main/adapters/mcp/tools/prompts.ts` |
| `plan_inpaint` | `src/main/adapters/mcp/inpaint-tools.ts` |
| `prepare_inpaint` | `src/main/adapters/mcp/inpaint-tools.ts` |
| `preview_prompt` | `src/main/adapters/mcp/tools/prompts.ts` |
| `prompt_guide` | `src/main/adapters/mcp/tools/prompts.ts` |
| `propose_workspace_edit` | `src/main/adapters/mcp/desktop-tools.ts` |
| `read_image` | `src/main/adapters/mcp/desktop-tools.ts` |
| `read_image_prompt` | `src/main/adapters/mcp/tools/images.ts` |
| `related_tags` | `src/main/adapters/mcp/tools/tags.ts` |
| `reply_workspace_request` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `report_workspace_progress` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `search_tags` | `src/main/adapters/mcp/tools/tags.ts` |
| `set_skill_config` | `src/main/adapters/mcp/tools/skills.ts` |
| `set_workspace_agent` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `submit_workspace_request` | `src/main/adapters/mcp/external-workspace-tools.ts` |
| `tag_wiki` | `src/main/adapters/mcp/tools/tags.ts` |
| `ui_add_workspace_region` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_cancel_workspace_request` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_capture_app` | `src/main/adapters/mcp/desktop-tools.ts` |
| `ui_create_workspace` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_delete_workspace` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_delete_workspace_image` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_delete_workspace_region` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_edit_workspace_config` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_generate_workspace` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_open_workspace` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_rename_workspace` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_reply_workspace_request` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_review_workspace` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_send_workspace_message` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_set_workspace_agent` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_set_workspace_input` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_update_workspace_region` | `src/main/adapters/mcp/frontend-tools.ts` |
| `ui_view_workspace` | `src/main/adapters/mcp/frontend-tools.ts` |
| `update_skill` | `src/main/adapters/mcp/tools/skills.ts` |
| `update_workspace` | `src/main/adapters/mcp/management-tools.ts` |
| `update_workspace_region` | `src/main/adapters/mcp/management-tools.ts` |
| `validate_tags` | `src/main/adapters/mcp/tools/tags.ts` |

## 代码职责定位

- 主进程入口只调用 app/bootstrap；app 装配窗口、协议、任务服务和领域 IPC。任务执行用例位于对应 modules/*/task-actions.ts。
- 工作台 repository 负责读写与已有 schema 迁移；index-cache/queries 负责有容量上限的轻量查询及外部文件变化检测。service 统一 revision、锁和保存；editor-actions、proposals、versions 处理相应状态变更；validation 校验平台输入，共享 model/config 提供纯规则。
- discussion 编排内部 AI，external-collaboration 处理外部需求，execution 执行生成。snapshot 记录冻结上下文。图片模块提供导入暂存、保存、恢复和删除操作，工作台决定所有权与时机；共享引用扫描不修改项目。
- generation/service 编排费用保护、取消与保存；providers/novelai 负责 HTTP、供应商参数和响应解包。聊天 provider 接收配置，避免反向读取应用设置。
- MCP bridge/runtime 负责宿主连接，stdio 读取传输，server 管理会话/分组/去重；operations 是写入去重日志唯一入口。tools/ 按领域注册，workspace-read/result、connection-state、skills-cache 负责投影与连接缓存。前台命令依然经过真实界面。
- PageWorkspace 组合版本侧栏、画布、候选、讨论、方案、配置和执行栏；use-version-browser、use-config-editor、use-autosave、use-discussion-composer、use-agent-state 分担状态。commands 复用人工动作；工作台自动保存只有一个调度入口。
- InpaintEditor 组合 canvas-engine、history、use-mask-interaction、use-analysis、generation 与批注弹窗；canvas、URL、监听器和订阅由所属生命周期释放。
- Generate 使用 use-gallery 与 GenerationResult；Settings 使用 AgentSettings/use-mcp-settings 和 UpdateSettings/use-update-settings。业务状态归属对应 feature；renderer/shared/state 只保留跨页 shell/tasks。
- src/shared 不使用 Vue/Electron/文件存储/浏览器全局。PNG 文本解析注入 inflate；main 使用 zlib，renderer 使用 DecompressionStream。模型、采样器、调度与 UC 枚举由 shared/generation/types 同时供类型、校验和 MCP schema 使用。
- style.css 仅组织导入；共享基础样式、app 布局和功能样式分别归属。ThemeSelect 是唯一 Less 试点，保留 CSS 主题变量与 scoped，嵌套只用于一级 active 状态。

## 验证

统一入口、运行前提和隔离要求见 testing.md。验收关注行为与保护约束，不以文件数或文件行数判断成功。
