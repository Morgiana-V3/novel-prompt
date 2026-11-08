# 架构与契约地图

维护原则：目录迁移同时更新本文。外部名称和持久化字段保持原样；模块名称可以更清楚，协议不能跟着内部变量重命名。验证入口见 [测试说明](testing.md)。

## 运行与依赖

Electron 主进程是唯一应用宿主，窗口和 MCP 客户端共享服务、任务与数据。独立 Node MCP 代理只负责 stdio 与宿主桥接，不持有另一份业务状态。开发数据为 novel-prompt-dev；安装版使用 Electron userData。显式 NOVELPROMPT_USER_DATA 覆盖能力保留，开发版拒绝安装版目录及其父子目录；当前验收按用户约定直接连接现有开发实例，不使用独立 profile。

依赖方向为 app 装配 adapters 与 modules，adapters 调用 modules，modules 使用 providers / infrastructure。renderer 的 app 组合 features，功能使用 renderer/shared；src/shared 只能包含平台无关的模型、契约和规则。preload 只桥接明确授权的接口。

## 领域入口与持久化

| 领域   | 当前入口                                                                        | 数据与约束                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 工作台 | main/modules/workspace/service.ts、discussion.ts、execution.ts                  | userData/data/page-workspaces/<UUID>.json，schema=2；读取现有 schema=1 的迁移逻辑保留。revision、编辑锁和讨论快照必须保留；删除移入 removed。 |
| 生成   | main/modules/generation/service.ts、inpaint.ts；main/providers/novelai/         | 先校验额度，再逐张请求、合成和落库，最后核对两类 Anlas；取消等待当前图片保存，不重试未知写入。                                                |
| 图片   | main/modules/images/library.ts；workspace/image-references.ts、image-cleanup.ts | userData/image-library 下 saved、temporary、workspaces；保留旧 images 读取。图片旁 JSON 记录 schema=1 的实际生成请求；共享引用阻止误删。      |
| 规则   | main/modules/skills/service.ts                                                  | 安装包 skills 只读；userData/skills/user 保存单文件规则或含 SKILL.md 的目录包；设置保存选择，讨论记录冻结 snapshot。                          |
| 任务   | main/modules/tasks/task-manager.ts；main/adapters/ipc/tasks.ts                  | 内存状态；资源互斥、进度、取消模式、目标和 Agent 归属。IPC/MCP 不能各自另建生图队列。                                                         |
| 设置   | main/modules/settings/service.ts                                                | userData/data/settings.json；原子写入、损坏隔离与备份恢复。                                                                                   |
| 收藏   | main/modules/images/recipes.ts                                                  | userData/data/recipes/<UUID>.json 与 recipes/images/<UUID>.png；收藏保存独立原图副本，删除收藏不影响来源图片。                                |

## 核心调用链

人工操作或 MCP 前台命令 → 工作台明确动作 → preload API → 领域 IPC → 工作台用例 → 存储及图片服务。前台命令保留 token、窗口可见步骤、草稿与编辑归属保护。后台 MCP 工具经过权限和输入校验调用同一业务规则，不伪装成人工界面操作。

提交需求 → 创建讨论快照/冻结规则 → 内部 AI 或外部 Agent 回复 → 保存待审核 proposal → 采纳时核对 revision/contextKey → 更新草稿 → 明确生成或重绘 → 保存实际图片和参数 → 浏览/对比候选。viewedVersion 是浏览对象，discussionVersion 是讨论对象，currentVersionId 是采用稿，也是下一次执行底图；三者不能混同。

工作台消息的可选 `event` 使用 `shared/workspace/events.ts` 统一契约。一次生成或画布修图持久化一条 execution，记录来源、全部候选、执行时采用稿、完成/部分完成/失败及独立费用观测；`known` 仅表示余额差可观测，不是供应商逐请求账单。`unknown` 不得按零处理，`not-run` 仅用于尚未进入生成服务。MCP 摘要与桌面状态保留结构化 `latestExecution`，包含原消息编号和观测时间，不代表实时余额或再次消费授权。

聊天主线展示用户需求、Agent 判断、方案及执行结果；正常费用放在结果详情，常规操作放在可展开记录，异常继续显式展示。旧消息只按严格的已知程序格式分类，不改写存储、不猜测其费用归属。任务面板的内存记录不能替代持久化执行记录。模型历史在截取窗口前筛掉可确认冗余的回执，并单记 `filteredRoutineCount`；失败、费用未知、候选、底稿变更和关键决定继续保留。冻结输入记录最近执行与费用的历史观测，旧冻结输入不重算。

## IPC 注册清单

参数、返回值和事件载荷的权威类型是 `src/shared/contracts/api.ts` 中的 Api、IpcContract、AppEvents 与 RendererMessages；桌面命令使用 `contracts/desktop.ts`。主进程 typed handle、preload bridge 和 renderer 依赖同一契约。领域模型位于 shared 对应目录。

| 通道                                                                                                                          | 注册来源                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `agents:list`                                                                                                                 | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts`                                                     |
| `ai:inpaint-plan-cancel`                                                                                                      | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/prompts/task-actions.ts`                                                       |
| `ai:inpaint-plan`                                                                                                             | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/prompts/task-actions.ts`                                                       |
| `ai:optimize`                                                                                                                 | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/prompts/task-actions.ts`                                                       |
| `ai:preview`                                                                                                                  | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/prompts/task-actions.ts`                                                       |
| `ai:vision-test`                                                                                                              | `src/main/adapters/ipc/settings.ts`                                                                                                 |
| `clipboard:read`                                                                                                              | `src/main/adapters/ipc/application.ts`                                                                                              |
| `clipboard:write`                                                                                                             | `src/main/adapters/ipc/application.ts`                                                                                              |
| `collections:list`、`collections:create`、`collections:rename`、`collections:delete`、`collections:assign`                    | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `confirmations:reply`                                                                                                         | `src/main/adapters/ipc/settings.ts` → `src/main/adapters/desktop/confirmations.ts`                                                  |
| `db:aiTranslate`                                                                                                              | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tags/task-actions.ts`                                                          |
| `db:implications`                                                                                                             | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tags/task-actions.ts`                                                          |
| `db:status`                                                                                                                   | `src/main/adapters/ipc/tags.ts`                                                                                                     |
| `db:update`                                                                                                                   | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tags/task-actions.ts`                                                          |
| `desktop:cancel-frontend`                                                                                                     | `src/main/adapters/desktop/bridge.ts`                                                                                               |
| `desktop:reply`                                                                                                               | `src/main/adapters/desktop/bridge.ts`                                                                                               |
| `desktop:state`                                                                                                               | `src/main/adapters/desktop/bridge.ts`                                                                                               |
| `images:cleanup-retry`                                                                                                        | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `images:cleanup-status`                                                                                                       | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `mcp:info`                                                                                                                    | `src/main/adapters/ipc/application.ts`                                                                                              |
| `nai:cancel`                                                                                                                  | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/generation/task-actions.ts`                                                    |
| `nai:copyImage`                                                                                                               | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:delete`                                                                                                                  | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:freeCheck`                                                                                                               | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:generate`                                                                                                                | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/generation/task-actions.ts`                                                    |
| `nai:inpaint`                                                                                                                 | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/generation/task-actions.ts`                                                    |
| `artists:catalog`                                                                                                             | `src/main/adapters/ipc/images.ts` → `modules/artists/catalog.ts` → `providers/quicktagcloud.ts`（公开图鉴，只读、分页、按模型缓存） |
| `nai:list`                                                                                                                    | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:readImage`                                                                                                               | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:recipe`                                                                                                                  | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:retain`                                                                                                                  | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:reveal`                                                                                                                  | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:saveAs`                                                                                                                  | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `nai:subscription`                                                                                                            | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `pages:agent`                                                                                                                 | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts`                                                     |
| `pages:cancel`                                                                                                                | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts`                                                     |
| `pages:chat`                                                                                                                  | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts`                                                     |
| `pages:cleanup-removed-images`                                                                                                | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:clear-image`                                                                                                           | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:create`                                                                                                                | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:delete`                                                                                                                | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:edit`                                                                                                                  | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:external-cancel`                                                                                                       | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts`                                                     |
| `pages:external-reply`                                                                                                        | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts`                                                     |
| `pages:generate`                                                                                                              | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts`                                                     |
| `pages:image-tool`                                                                                                            | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/workspace/task-actions.ts`                                                     |
| `pages:import`                                                                                                                | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:list`                                                                                                                  | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:read`                                                                                                                  | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:recover-image`                                                                                                         | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:removed`                                                                                                               | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `pages:restore`                                                                                                               | `src/main/adapters/ipc/workspace.ts`                                                                                                |
| `prompt:analyze`                                                                                                              | `src/main/adapters/ipc/tags.ts`                                                                                                     |
| `recipes:config`                                                                                                              | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `recipes:create`                                                                                                              | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `recipes:delete`                                                                                                              | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `recipes:export`                                                                                                              | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `recipes:list`                                                                                                                | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `recipes:update`                                                                                                              | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `recipes:workspace`                                                                                                           | `src/main/adapters/ipc/images.ts`                                                                                                   |
| `reverse:status`、`reverse:install`、`reverse:import`、`reverse:cancel`、`reverse:remove`、`reverse:analyze`、`reverse:score` | `src/main/adapters/ipc/reverse.ts`                                                                                                  |
| `settings:get`                                                                                                                | `src/main/adapters/ipc/settings.ts`                                                                                                 |
| `settings:save`                                                                                                               | `src/main/adapters/ipc/settings.ts`                                                                                                 |
| `skills:core`                                                                                                                 | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:create`                                                                                                               | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:delete`                                                                                                               | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:duplicate`                                                                                                            | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:get`                                                                                                                  | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:import`                                                                                                               | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:import-directory`、`skills:export`                                                                                    | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:list`                                                                                                                 | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:reveal`                                                                                                               | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:setConfig`                                                                                                            | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `skills:update`                                                                                                               | `src/main/adapters/ipc/skills.ts`                                                                                                   |
| `snippets:list`、`snippets:save`、`snippets:delete`                                                                           | `src/main/adapters/ipc/settings.ts`                                                                                                 |
| `statistics:get`、`statistics:clear`                                                                                          | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tasks/task-actions.ts`                                                         |
| `storage:info`、`storage:choose`、`storage:schedule`、`storage:cancel`、`storage:open`                                        | `src/main/adapters/ipc/settings.ts`                                                                                                 |
| `tag:complete`                                                                                                                | `src/main/adapters/ipc/tags.ts`                                                                                                     |
| `tag:search`                                                                                                                  | `src/main/adapters/ipc/tags.ts`                                                                                                     |
| `tag:setZh`                                                                                                                   | `src/main/adapters/ipc/tags.ts`                                                                                                     |
| `task:cancel`                                                                                                                 | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tags/task-actions.ts`                                                          |
| `tasks:cancel`                                                                                                                | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tasks/task-actions.ts`                                                         |
| `tasks:clear`                                                                                                                 | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tasks/task-actions.ts`                                                         |
| `tasks:list`                                                                                                                  | `src/main/adapters/ipc/tasks.ts` → `src/main/modules/tasks/task-actions.ts`                                                         |
| `update:check`                                                                                                                | `src/main/adapters/ipc/updates.ts`                                                                                                  |
| `update:download`                                                                                                             | `src/main/adapters/ipc/updates.ts`                                                                                                  |
| `update:install`                                                                                                              | `src/main/adapters/ipc/updates.ts`                                                                                                  |
| `update:open`                                                                                                                 | `src/main/adapters/ipc/updates.ts`                                                                                                  |
| `update:state`                                                                                                                | `src/main/adapters/ipc/updates.ts`                                                                                                  |
| `web:open`                                                                                                                    | `src/main/adapters/ipc/application.ts`                                                                                              |
| `window:image-preview`                                                                                                        | `src/main/adapters/ipc/application.ts`                                                                                              |

## 事件与窗口契约

DesktopCommand.type 包含 snapshot、capture-prepare、capture-end、navigate、apply-prompt、workspace-lock、workspace-release、show-image、frontend。FrontendRequest.action 与 DesktopState 见 shared/contracts/desktop.ts；修改要同时核对主进程桥和渲染命令执行器。

| 事件/桥接通道                                                    | 来源                             |
| ---------------------------------------------------------------- | -------------------------------- |
| `gallery:changed`                                                | `src/preload/api/application.ts` |
| `skills:changed`                                                 | `src/preload/api/application.ts` |
| `tasks:changed`                                                  | `src/preload/api/application.ts` |
| `agents:changed`                                                 | `src/preload/api/application.ts` |
| `confirmations:changed`、`favorites:changed`、`snippets:changed` | `src/preload/api/application.ts` |
| `nai:step`                                                       | `src/preload/api/application.ts` |
| `update:state`                                                   | `src/preload/api/application.ts` |
| `progress`                                                       | `src/preload/api/application.ts` |
| `ai:step`                                                        | `src/preload/api/application.ts` |
| `desktop:state`                                                  | `src/preload/api/desktop.ts`     |
| `desktop:reply`                                                  | `src/preload/api/desktop.ts`     |
| `desktop:command`                                                | `src/preload/api/desktop.ts`     |
| `desktop:cancel-frontend`                                        | `src/preload/api/desktop.ts`     |
| `desktop:frontend-cancel`                                        | `src/preload/api/desktop.ts`     |

## MCP 工具名称清单

按源码静态工具定义记录。最终目录由 buildTools、desktopTools、frontendTools 和会话管理工具合成；分组、权限、输入输出模式分别以 tool-groups、contract、output-schemas 和各工具定义为准。注册或迁移时核对完整目录与实际会话初始化结果。

| 工具名                                                                                                                                     | 定义来源                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `add_workspace_region`                                                                                                                     | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `agent_guide`                                                                                                                              | `src/main/adapters/mcp/tools/guides.ts`             |
| `analyze_prompt`                                                                                                                           | `src/main/adapters/mcp/tools/prompts.ts`            |
| `apply_app_prompt`                                                                                                                         | `src/main/adapters/mcp/tools/desktop.ts`            |
| `apply_workspace_action`                                                                                                                   | `src/main/adapters/mcp/tools/desktop.ts`            |
| `cancel_task`                                                                                                                              | `src/main/adapters/mcp/tools/desktop.ts`            |
| `cancel_workspace_request`                                                                                                                 | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `compare_workspace_versions`                                                                                                               | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `configure_tools`                                                                                                                          | `src/main/adapters/mcp/server.ts`                   |
| `create_skill`                                                                                                                             | `src/main/adapters/mcp/tools/skills.ts`             |
| `create_workspace`                                                                                                                         | `src/main/adapters/mcp/tools/desktop.ts`            |
| `delete_image`                                                                                                                             | `src/main/adapters/mcp/tools/management.ts`         |
| `delete_favorite`                                                                                                                          | `src/main/adapters/mcp/tools/library.ts`            |
| `delete_snippet`                                                                                                                           | `src/main/adapters/mcp/tools/library.ts`            |
| `delete_skill`                                                                                                                             | `src/main/adapters/mcp/tools/skills.ts`             |
| `delete_workspace`                                                                                                                         | `src/main/adapters/mcp/tools/management.ts`         |
| `delete_workspace_image`                                                                                                                   | `src/main/adapters/mcp/tools/management.ts`         |
| `generate_image`                                                                                                                           | `src/main/adapters/mcp/tools/images.ts`             |
| `generate_workspace`                                                                                                                       | `src/main/adapters/mcp/tools/desktop.ts`            |
| `get_app_state`                                                                                                                            | `src/main/adapters/mcp/tools/desktop.ts`            |
| `get_favorite`                                                                                                                             | `src/main/adapters/mcp/tools/library.ts`            |
| `get_operation`                                                                                                                            | `src/main/adapters/mcp/server.ts`                   |
| `get_skill`                                                                                                                                | `src/main/adapters/mcp/tools/skills.ts`             |
| `get_workspace`                                                                                                                            | `src/main/adapters/mcp/tools/desktop.ts`            |
| `get_workspace_context`                                                                                                                    | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `inpaint_guide`                                                                                                                            | `src/main/adapters/mcp/tools/inpaint.ts`            |
| `inpaint_image`                                                                                                                            | `src/main/adapters/mcp/tools/inpaint.ts`            |
| `list_images`                                                                                                                              | `src/main/adapters/mcp/tools/images.ts`             |
| `list_favorites`、`list_snippets`                                                                                                          | `src/main/adapters/mcp/tools/library.ts`            |
| `list_skills`                                                                                                                              | `src/main/adapters/mcp/tools/skills.ts`             |
| `list_tasks`                                                                                                                               | `src/main/adapters/mcp/tools/desktop.ts`            |
| `list_workspace_requests`                                                                                                                  | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `list_workspaces`                                                                                                                          | `src/main/adapters/mcp/tools/desktop.ts`            |
| `nai_subscription`                                                                                                                         | `src/main/adapters/mcp/tools/images.ts`             |
| `navigate_app`                                                                                                                             | `src/main/adapters/mcp/tools/desktop.ts`            |
| `optimize_prompt`                                                                                                                          | `src/main/adapters/mcp/tools/prompts.ts`            |
| `plan_inpaint`                                                                                                                             | `src/main/adapters/mcp/tools/inpaint.ts`            |
| `prepare_inpaint`                                                                                                                          | `src/main/adapters/mcp/tools/inpaint.ts`            |
| `preview_prompt`                                                                                                                           | `src/main/adapters/mcp/tools/prompts.ts`            |
| `prompt_guide`                                                                                                                             | `src/main/adapters/mcp/tools/prompts.ts`            |
| `propose_workspace_edit`                                                                                                                   | `src/main/adapters/mcp/tools/desktop.ts`            |
| `read_image`                                                                                                                               | `src/main/adapters/mcp/tools/desktop.ts`            |
| `read_image_prompt`                                                                                                                        | `src/main/adapters/mcp/tools/images.ts`             |
| `related_tags`                                                                                                                             | `src/main/adapters/mcp/tools/tags.ts`               |
| `reply_workspace_request`                                                                                                                  | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `report_workspace_progress`                                                                                                                | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `reverse_image`                                                                                                                            | `src/main/adapters/mcp/tools/library.ts`            |
| `run_workspace_image_tool`                                                                                                                 | `src/main/adapters/mcp/tools/desktop.ts`            |
| `save_favorite`、`save_snippet`                                                                                                            | `src/main/adapters/mcp/tools/library.ts`            |
| `search_tags`                                                                                                                              | `src/main/adapters/mcp/tools/tags.ts`               |
| `set_skill_config`                                                                                                                         | `src/main/adapters/mcp/tools/skills.ts`             |
| `set_workspace_agent`                                                                                                                      | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `submit_workspace_request`                                                                                                                 | `src/main/adapters/mcp/tools/external-workspace.ts` |
| `tag_wiki`                                                                                                                                 | `src/main/adapters/mcp/tools/tags.ts`               |
| `ui_add_workspace_region`                                                                                                                  | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_cancel_workspace_request`                                                                                                              | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_capture_app`                                                                                                                           | `src/main/adapters/mcp/tools/desktop.ts`            |
| `ui_configure_creation_ai`、`ui_propose_creation_edit`、`ui_review_creation_ai`                                                            | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_load_reverse_image`、`ui_compose_reverse_prompt`、`ui_propose_reverse_prompt`、`ui_adopt_reverse_prompt`、`ui_transfer_reverse_prompt` | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_create_workspace`                                                                                                                      | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_delete_workspace`                                                                                                                      | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_delete_workspace_image`                                                                                                                | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_delete_workspace_region`                                                                                                               | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_edit_workspace_config`                                                                                                                 | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_generate_workspace`                                                                                                                    | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_open_workspace`                                                                                                                        | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_rename_workspace`                                                                                                                      | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_reply_workspace_request`                                                                                                               | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_review_workspace`                                                                                                                      | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_send_workspace_message`                                                                                                                | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_set_workspace_agent`                                                                                                                   | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_set_workspace_input`                                                                                                                   | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_update_workspace_region`                                                                                                               | `src/main/adapters/mcp/tools/frontend.ts`           |
| `ui_view_workspace`                                                                                                                        | `src/main/adapters/mcp/tools/frontend.ts`           |
| `update_skill`                                                                                                                             | `src/main/adapters/mcp/tools/skills.ts`             |
| `update_favorite`                                                                                                                          | `src/main/adapters/mcp/tools/library.ts`            |
| `update_workspace`                                                                                                                         | `src/main/adapters/mcp/tools/management.ts`         |
| `update_workspace_region`                                                                                                                  | `src/main/adapters/mcp/tools/management.ts`         |
| `validate_tags`                                                                                                                            | `src/main/adapters/mcp/tools/tags.ts`               |

## 代码职责定位

- 主进程入口只调用 app/bootstrap；app 装配窗口、协议、任务服务和领域 IPC。任务执行用例位于对应 modules/*/task-actions.ts。
- `app/identity.ts` 统一开发版与打包版图标路径、AppUserModelID 和 Windows 重启属性；开发窗口显示前绑定软件图标及重启命令，避免任务栏回落为 Electron 图标。
- 工作台 repository 负责读写与已有 schema 迁移；index-cache/queries 负责有容量上限的轻量查询及外部文件变化检测。service 统一 revision、锁和保存；editor-actions、proposals、versions 处理相应状态变更；validation 校验平台输入，共享 model/config 提供纯规则。
- discussion 编排内部 AI，external-collaboration 处理外部需求，execution 执行生成。snapshot 记录冻结上下文。图片模块提供导入暂存、保存、恢复和删除操作，工作台决定所有权与时机；共享引用扫描不修改项目。
- generation/service 编排费用保护、取消与保存；providers/novelai 负责 HTTP、供应商参数和响应解包。聊天 provider 接收配置，避免反向读取应用设置。
- MCP bridge/runtime 负责宿主连接，stdio 读取传输，server 管理会话/分组/去重；operations 是写入去重日志唯一入口。tools/ 按领域注册，workspace-read/result、connection-state、skills-cache 负责投影与连接缓存。前台命令依然经过真实界面。
- PageWorkspace 组合版本侧栏、画布、候选、讨论、方案、配置和执行栏；use-version-browser、use-config-editor、use-autosave、use-discussion-composer、use-agent-state 分担状态。commands 复用人工动作；工作台自动保存只有一个调度入口。
- 工作台左侧标签仅浏览当前查看版本的画布、只读生成记录、修改对比与候选；「编辑配置」入口独立位于左侧工具栏右端，编辑仍在左侧，右侧始终保留 AI 对话。编辑沿用 use-config-editor 的同一份草稿与保存动作。版本侧栏默认展开，开合独立于编辑状态；人工点击历史版本时先保存草稿再浏览，不切换采用稿。候选缩略图沿用图集的方形 contain 展示，完整保留画幅，收藏和删除仅悬停/聚焦显示（触屏保留可发现入口）。生成记录展示冻结请求，起始稿明确不代表导入图片实际参数；角色布局及位置变化复用 prompts 公共位置对比组件，自动位置不伪装为已知坐标。位置对比通过 beforeReference / afterReference 接收两侧独立底图及画幅，未提供时保留共用 reference 的兼容行为；工作台按对比来源与正在查看版本传图，图片和坐标使用相同比例，缺失或加载失败时保留网格与位置记录。
- InpaintEditor 组合 canvas-engine、history、use-mask-interaction、use-analysis、generation 与批注弹窗；canvas、URL、监听器和订阅由所属生命周期释放。
- Generate 使用 use-gallery 与 GenerationResult；Settings 使用 AgentSettings/use-mcp-settings 和 UpdateSettings/use-update-settings。业务状态归属对应 feature；renderer/shared/state 只保留跨页 shell/tasks。
- src/shared 不使用 Vue/Electron/文件存储/浏览器全局。PNG 文本解析注入 inflate；main 使用 zlib，renderer 使用 DecompressionStream。模型、采样器、调度与 UC 枚举由 shared/generation/types 同时供类型、校验和 MCP schema 使用。
- style.css 仅组织导入；共享基础样式、app 布局和功能样式分别归属。ThemeSelect 是唯一 Less 试点，保留 CSS 主题变量与 scoped，嵌套只用于一级 active 状态。

## 验证

统一入口与当前本机开发验收规则见 testing.md。验收关注行为与保护约束，不以文件数或文件行数判断成功。

Skill 目录包由 modules/skills/package-files.ts 校验和整体写入；入口与 Markdown 参考资料分别冻结到 PageSkillSnapshot 的分段索引，resourcePath 标记按需资源。内置 AI 通过 prompts/chat.ts 的受限读取工具补读当前快照，MCP 通过 skills_ids 补读。图片保留在包内供界面预览，不注入模型上下文。新增 IPC：skills:import-directory（预览）、skills:export（整包导出）。

## 资源归属与模块边界

- `features/creation/CreationLayout.vue` 提供可对比的新「创作实验」布局。App 仅装配一套 Compare/Ai/Preview/Generate 实例，通过 `shared/lib/page-presentation.ts` 注入展示方式、当前面板、导航和编辑器引用；切换新旧入口不重建控制器、不重复注册任务订阅。原入口全部保留，默认仍进入提示词比对。
- 新布局的提示词使用既有共享草稿与历史，词条检查跟随编辑焦点，生成控件通过 Teleport 移至底部。`prompts/partial-adoption.ts` 根据请求前快照生成精确文字改动，`adoption-text.ts` 按完整 Tag 和相邻分隔符构建可逆项，共享权重与引号组不拆分。执行补丁保留逗号和换行以便精确撤销，展示描述按词条内容与出现次数判断新增 / 删除 / 替换，忽略随插入变化的分隔符，不把保留的相邻 Tag 标记为删除；`character-alignment.ts` 用唯一、完整匹配的角色作锚点，中间插入/删除不推移后续角色。重排、重复角色或无法对应的结构变化整组采纳，角色新增/删除和位置改动作为完整项；`use-partial-adoption.ts` 管理逐项采纳、取消及历史，`AiChangePicker.vue` 只负责显示和点击。应用时核对受影响字段，角色操作核对整个角色列表；遇到后续手动编辑拒绝覆盖，其他字段的手动编辑保留。新布局的结果导航只切换面板，不隐式采纳剩余建议。图片浏览不改写草稿，恢复原图配置继续走既有导入与撤销动作。这里不引入第二套 IPC、生成队列或存储格式。
- 生成控件只占左栏底部，右栏结果延伸到底；生成设置向上浮动，不改变编辑器尺寸。`generation/use-settings-popover.ts` 管理外部点击、焦点离开、Esc 和切页关闭，并识别属于浮层的下拉菜单；参数仍由原状态持有，关闭不撤销设置。原生图预览继续使用内嵌配置。
- 生成栏仅保留设置图标、图集、自动留存、简短费用状态与单行生成按钮。图集与自动留存相邻靠左，费用状态作为按钮外的灰色标记；模型、尺寸、步数等参数留在侧栏或设置浮层。免费资格复用现有检查，异步回复按版本过滤，实际提交仍经过原有费用保护。创作实验的出图结果不再显示推测与实际对照，原生图预览保留该功能。
- 创作实验的 `PromptPresetControl` 将内置质量词 / UC 放在主、负面输入框底部，与收藏 / 复制共用预留区；它直接使用已有 `promptState.params`，不把预设写入编辑正文。`GenerationParameters` 在这个布局中隐藏重复控件。
- 自动留存作为生成底栏的独立开关，复用设置保存和失败回滚，浮层不重复展示。AI 结果通过 `AiReviewOverview` 显示一次概述，不再附加重复正文的悬浮提示；`AiScopedReview` 按提示词分区显示完整前后对比，局部采纳按钮与对应说明紧随其后，没有单独的修改说明页签。`review-explanations.ts` 根据说明的 scope 和可选角色字段定位信息分配解释；新增角色使用输出列表序号，删除角色使用输入列表序号，经角色匹配关系关联。旧结果缺少定位且存在多处候选时作为一般说明保留，不猜测归属。后端过滤空角色时同步转换说明索引，防止错位。可选修改要求默认折叠；缺少提示词、需要画面描述时展开。新布局按请求前真实草稿生成对比（包括按描述重建），采纳不会改写对比基准；未通过校验、遗漏和文字保真问题仍直接显示。
- 词条检查中的卡片只定位提示词，词库翻译通过单独入口进入搜索页编辑。`shared/prompts/remove-tokens.ts` 按解析位置删除指定词条，清理因此删空的权重作用域及相邻分隔符，保留其他词的权重、引号、转义与 Text 块。批量删除使用同一份快照一次处理。`prompts/prompt-keyboard.ts` 仅接管精确选中完整词条时的 Backspace / Delete，并保留原生撤销；普通字符删除、组合键、输入法和只读输入不受影响。
- `ResolutionPicker` 使用 `shared/generation/resolutions.ts` 的 Normal / Large / Wallpaper / Small 分档，另有 Custom。V4.5 / V5 数值于 2026-11-02 核对 NovelAI 官方 image 页公开前端（`22evx8_5gmu-c.js`）：Normal 832×1216 / 1216×832 / 1024²；Large 1024×1536 / 1536×1024 / 1472²；Wallpaper 1088×1920 / 1920×1088；Small 512×768 / 768×512 / 640²。Wallpaper 不提供方图。尺寸选取仅更新原有宽高，不绕过费用校验。
- AI 优化可选 `promptPresets` 从界面传递质量词及 UC；`modules/prompts/preset-context.ts` 复用实际生成使用的预设常量、拼接函数，分别呈现编辑内容与实际输入，要求避免重复添加并说明预设冲突。质量词保留兼容的 `qualityTags` 开关，新增可选 `qualityMode=standard|light`（旧数据默认为 standard），关闭始终优先。V5 按官方质量词文档使用 Standard / Light / None，V4.5 不显示 Light，实际请求也回退到标准档；生成、优化与推测复用相同的有效预设。优化结果不直接改变设置；结果返回后模型或预设变化会提示重新优化。外部 MCP 的 `optimize_prompt` 同时提供 `quality_tags` 和 `uc_preset` 时使用该上下文，省略时明确状态未知。预期分析原已读取相同设置，本次补强推测时的冲突解释，不增加改写功能。
- 主进程 TaskManager 为每个任务保留实际进度步骤、相对时间所需的时间戳和最终状态，相邻重复步骤合并计数，每任务最多 200 条，完成任务保留本次启动最近 20 个。快照独立复制步骤，TaskCenter 的 `TaskSteps.vue` 折叠展示执行记录；创作实验不再在内容区重复铺开链路，旧页面仍保留原进度展示。
- 创作实验的预期分析通过可选 `forecastOnly` 请求仅推测当前画面，忽略期望并清空差距及修改建议字段；界面及复制结果也排除旧版结果中的这些字段。旧版画面推测与 MCP 调用省略此标记时保留完整评估。修改要求及改写操作集中在 AI 修改建议面板。

- `resources/skills/builtin/` 是只读内置规则，`resources/skills/user-seeds/` 是首次复制的用户规则，`resources/default-data/` 是词库。打包分别映射到原有 `skills/`、`skill-templates/`、`default-data/`，不改变安装版或用户数据路径。
- Skill 对外入口为 `modules/skills/service.ts`；catalog 定义清单及历史指纹，metadata 解析元信息，repository 管理文件，initialization/migrations 处理初始化及历史兼容，composition 构造冻结上下文。基础设施 paths 仅处理通用数据目录。
- 提示词优化通过 tag-tools 复用查询工具；MCP 与工作台讨论直接使用该能力，不再依赖优化器。preview-review 负责本地检查和报告，preview-response 负责响应规整，previewer 只编排 AI 请求。工具预算、重试与协议行为保持原样。
- MCP 工具定义统一在 `adapters/mcp/tools/`；宿主连接、会话、契约、缓存与投影保留在上层。generation/index 只导出生图服务和费用规则，不转导出图片路径或供应商实现。
- 前端收藏业务位于 `features/favorites/`；外部通过 public 使用动作和收藏按钮，app 负责装配收藏页。generation/public 提供只读的顶层状态视图与明确的修改动作。现有 prompt 参数导入和撤销都通过 applyGenerationParams 更新生图参数。
- 工作台 use-remote-workspace 负责远程占用及释放后的状态同步；重绘 commands 负责可见的远程区域操作，use-editor-persistence 负责快照、保存调度和恢复；反推 use-model-manager 管理模型操作与状态轮询。页面继续拥有展示状态，各入口复用原有动作。
- 边界检查强制上述已整理模块的入口。其余功能仍允许现有依赖；后续按实际职责逐个收紧，不以一个汇总文件转导出所有内部实现。

## 本地使用统计

- 任务卡中的 AI 用量独立折叠，位于执行记录下方。Anlas 按每张生图前后的订阅、购买余额分别核对负向变化，无法核对时记为未知；这不是供应商账单，官网并行使用、充值可能影响余额差。旧统计缺失的新积分字段补零，不丢弃原 Token 历史。
- `features/prompts/components/AiScopedReview.vue` 按主提示词、角色字段筛选完整前后对比，平铺呈现，不重复字段标题或提供展开开关；`AiFieldAdoption.vue` 直接排列整段切换与短 Tag 局部选项。旧页面保持原展示。采纳仍复用同一份不可变快照、可逆补丁和手动编辑保护。角色映射不明确时逐字段展示、整组应用，不把展示位置当作可靠的角色身份。

- `shared/statistics/model.ts` 统一接口用量口径：输入、输出、总量、缓存命中和思考量；缓存属于输入、思考属于输出，不能重复叠加。接口未完整返回用量的请求单独计数，不估算历史或未知消耗。
- `infrastructure/usage-context.ts` 用 AsyncLocalStorage 将实际请求归属到当前任务；提供给供应商层的记录通道不依赖业务模块。`providers/chat/client.ts` 每次请求尝试仅记录一次，工具循环、失败重试、取消和不可解析结果保留已知用量；任务快照独立复制用量，避免并行任务串账。
- `modules/statistics/service.ts` 按本地日期聚合到数据目录 `statistics.json`，原子写入，只保存计数、模型名和接口来源域名，不保存提示词、工具正文和凭据。没有旧统计时从本次启用开始；文件损坏另存备份，保存失败不丢弃已返回的 AI 结果。
- 图片在 NovelAI 成功返回后逐张计数，包含生成、重绘、工作台候选及临时图片；失败与取消批次已经完成的图片仍计数，导入或重新查看图片不计数。功能使用次数按结束任务计数，区分完成、失败与取消。
- 设置的「使用统计」提供累计概览、7 / 30 / 90 天趋势、每日明细、功能次数和模型累计用量；模型接口页显示累计 Token 快捷入口。清空统计使用独立 IPC 和确认框，不影响图片、设置、提示词或任务历史；清除任务历史也不清空统计。外部 Agent 自己调用模型的 Token 不纳入本软件统计。

## 图库与图集

- 独立入口 `features/gallery/` 复用现有 `modules/images/library.ts`、图片协议、生成记录和留存规则。`collections.ts` 管理逻辑分组，索引保存在 `data/image-collections.json`，只记录图集及文件名归属，不移动图片，也不修改 PNG 内的生成记录。
- 老图和无选择的生成结果归入不可删除的默认图集。删除自建图集只撤销分类归属，图片回到默认图集。工作台的归属与引用保护独立于图集分类；临时图片不会因为选择图集而自动留存。
- 生图栏选择保存在本地界面偏好，请求开始时冻结 `collectionId`，这个字段不发送给 NovelAI。若图集在生成期间被删除，结果回到默认图集。
- 图库位于侧边栏收藏上方。设置图标、图集、自动留存和生成按钮处于同一紧凑底栏行，不再在底栏展示模型、尺寸或步数，参数从设置图标展开。滚动条按需出现，不预留空槽。
- 生成图片和配方写盘成功后，图集索引写入失败仅记录警告，返回图片并归默认图集；不能让已完成的付费生成因辅助分类失败而丢失返回结果。手动图集修改仍报告写入错误。

## 画师调试与图鉴

- `features/artists/studio.ts` 管理按模型隔离的草稿、画师串、底稿和候选比较；`blueprints.ts` 从创作标签、图库配置构造独立快照。生成复用反推试图控制器和已有生成任务，不建立第二套供应商调用或费用策略。
- `ArtistStudio.vue` 组合方案和结果，`ArtistBlueprintPicker.vue` 处理底稿选择，`ArtistCatalog.vue` 处理图鉴浏览；图鉴通过 `modules/artists/catalog.ts` 校验、筛选、分页和缓存，`providers/quicktagcloud.ts` 负责公开资源下载及哈希校验。

## 2026-11-06 架构审查

- 主进程的 app / adapters / modules / providers / infrastructure、跨进程 shared、preload 与 renderer 分层仍成立；目录名与实际职责基本一致。运行时循环和既定入口由 `boundaries:check` 检查，不能据此推断所有模块已经完成职责拆分。
- 文档清单此前落后于实现，漏记图集、数据迁移、反推、片段、统计及部分 MCP 工具；本次按实际注册与共享契约补齐。后续新增接口应同时维护本表和对应测试登记。
- 前端仍有集中职责：`PageWorkspace.vue` 同时保留多类异步操作和布局；`InpaintEditor.vue` 保留图片处理、区域交互和视图装配；`App.vue` 还包含桌面状态及命令装配。优先按操作编排和生命周期继续提取，保留人工操作与前台 MCP 共用动作；不以行数为硬性门槛，也不把整页迁入一个大 composable。
- 跨 feature 依赖目前仅对 generation 的可变状态和 favorites 公共入口做强约束，其他领域仍可直连内部模块。后续围绕 creation/prompts/artists 的真实复用边界逐步定义入口；不能将当前检查通过表述为所有 feature 已隔离。
- 仓库根目录的 `skills/`、`skill-templates/` 是空的旧目录，实际资源源头为 `resources/skills/`；本次未迁移或删除本地非源码目录。`out/`、`release/` 为忽略的构建产物，不应作为源码职责的依据。
- MCP 性能基准发现两项后续优化点：约 35 MB 的合成工作台只取一条消息，仍整读、投影和计算指纹，中位耗时约 218 ms；200 个项目的列表命中缓存后仍需同步验证元数据与历史图片，中位耗时约 148 ms。可优先做按文件签名失效且有容量上限的查询投影、按需筛选，以及分离纯路径解析与目录初始化。保留外部修改和遮罩变化检测，不能以缓存加速牺牲正确性。
- 上述数据来自优化前 `mcp:performance` 输出的 `performance-results.json`，是源码加载器下的历史合成基准，当时与其他回归并行运行，不含浏览器和 stdio 端到端耗时，未清 OS 缓存或强制 GC；不能视为生产性能或内存峰值。后续优化与新的真实测试规则见下节。

## 2026-11-06 优化落地

- `modules/workspace/read-cache.ts` 保存深冻结的只读快照，最多 8 个项目、按序列化源文件计算的 64 MiB 预算；这不是 V8 堆内存上限。`readPageSnapshot` 供查询投影使用，写操作经 `readPage` 获取独立克隆。读取前后复核文件签名，保存或删除主动失效，不用时间窗口容忍旧状态。
- `adapters/mcp/workspace-read.ts` 的指定消息/版本查询先选中目标再投影，不为未请求的历史和遮罩计算指纹。普通增量查询复用已确认不可变的投影；返回数据与缓存分离，保留连接作用域的 revision 和遮罩变化识别。
- 工作台列表在一次扫描内复用图片路径和签名；图片访问将纯路径解析与目录初始化分离。图片内容哈希按文件身份、大小和修改/变更时间失效，最多 256 项，不保留图片字节；同名图片替换后不会继续相信旧持久化哈希。
- `app/desktop/` 分别管理桌面快照与 token、前台动作及取消、截图隐私租约、IPC 命令连接。`App.vue` 负责装配和页面呈现，桌面命令仍调用视图已暴露的动作。启动等待期间卸载时不再补注册监听和计时器。
- 工作台新增 `use-discussion-actions`、`use-proposal-actions`、`use-execution-actions`，分别管理讨论、方案审核与生成/修图；共用 `action-context` 的操作锁、autosave/revision 链和动态前台上下文。`PageWorkspace.vue` 保留布局、焦点、导航和选区显示。
- 重绘编辑器由 `use-source-image` 管理图片解码、元数据和 URL 生命周期，`use-mask-raster` 管理显示/命中/导出的同一遮罩栅格与缓存。它们与已有交互、持久化、分析模块协作；手动操作和前台 MCP 不维护第二套遮罩或草稿。
- prompts 公共接口按草稿观察、编辑动作、导入导出、审阅及组件拆分；creation 区分标签导航和标签会话；artists 提供页面装配入口。公共观察视图复用原状态，恢复标签、修改焦点/参数通过明确动作。边界检查拒绝跨 feature 直连内部实现和公共入口的通配转导出。
- `scripts/check-cases.mjs` 区分当前验收与历史 fixture。静态 IPC/事件及实际 MCP 目录核对文档，测试登记检查跟踪执行导入并防止 npm 脚本重新直启历史夹具。新接口、新测试及目录迁移必须同步维护这些检查。
- 用户已要求后续全部直接使用当前本机开发实例、配置与现有数据。`quick` 为静态检查加当前宿主只读核对，`full` 加真实计费灰度；不启动隔离应用、不改权限、不退出现有宿主。`runtime.startedAt/buildHash` 在启动时捕获，验收核对项目/模式/数据位置和实际加载的主进程代码。测试作品带标记并保留，旧作品不覆盖；完整操作要求见 `AGENTS.md` 和 `testing.md`。

## 工作台输入组织与传输

- `shared/workspace/context.ts` 定义 `PageInputContext`；`modules/workspace/input-context.ts` 在提交时冻结目标、保留要求、讨论对象、修改底稿与参数、图片用途、规则目录和历史范围。内置讨论及外部需求复用该构建入口，原规则正文仍保存在同一请求的 `skillSnapshot`。内置回复通过 `requestId` 关联请求；旧记录没有冻结输入时，不将当前状态当作历史事实。
- 内置模型输入使用同一清单核心，保留原有最近消息及较早摘录，不新增规则删减或历史摘要替换。当前 Chat Completions 接口按无状态请求组织，每次仍携带本轮所需的完整 `messages` 和规则正文；之前通过工具读入的参考正文也须保留在后续请求的消息中。本地缓存和供应商报告的缓存命中都不代表模型记得此前内容，不能据此省略必要文本。
- `discussion-images.ts` 保留每张图的讨论、修改、参考或区域用途；同一条模型请求内，编码内容相同的图片只装配一次字节，不同版本的角色说明和生成记录仍保留。JPEG 编码缓存最多 24 项、以字符串存储估算 16 MiB；源图内容、文件签名、遮罩与尺寸参与校验，外部替换不会沿用旧图。`images.mode` 及各项 `status` 说明装配带图、纯文本降级、缺图或外部可读取材料；部分装配失败会清除此前的 `included`、共用关系和区域边界，不能把半成品当作已发送输入。
- 图片装配与请求投递分别记录。可选 `images.delivery` 表示最近一次供应商请求的阶段：`prepared` 为已准备、尚未进入该次网络提交；`attempted` 为通过本地 Key 存在、授权、地址及请求前取消检查后进入网络提交尝试；`responded` 为返回有效供应商消息。`attempts` / `responses` 累计本轮实际尝试及有效消息数，保留多轮处理中此前已发生的请求。网络失败或 HTTP 鉴权拒绝可能已有尝试而无有效回复；这些状态都不证明模型理解、方案正确或执行完成。外部客户端和旧快照没有这些字段时，不推断其投递状态。
- `prompts/chat.ts` 在确定实际识图路由、必要时移除图片之后，通过可选 `onRoute` 同步快照的 `images` 字段及其 JSON 表示，再交给供应商序列化；纯文本降级按 `images.mode=text-only` 记录。供应商的可选 `onDispatch` 在实际提交前记录尝试，`onResponse` 在有效消息返回后记录回复。目标、草稿、规则和历史范围保持提交时的事实，图片路由及投递字段则记录本轮随后观察到的发送过程。
- 前端 `WorkspaceInputContext` 的“查看本轮输入”默认收起，从用户消息的冻结 `inputContext` 和同一消息的 `skillSnapshot` 展示原始任务、讨论图与修改底图、完整草稿/参数、区域、规则篇目及历史索引；回复通过 `requestId` 定位原请求。规则正文按冻结区段读取，缺失或不一致时明确提示，旧消息不拿当前状态补推。图片栏区分“已装配”和投递阶段，规则目录及历史索引不表示外部 Agent 已读取；决定状态冻结于提交时，链接仅定位原消息。
- 外部 `get_workspace_context` 的 `inputContext` 默认仅小摘要，完整冻结输入按 `get_workspace(detail:full,message_ids)` 读取；`materials` 给出图片、预览、缺失规则及近期决定的补读入口。`rules_only` 不装配图片与完整历史。旧需求重建会标记来源，无法重建时明确说明。
- 规则传输沿用篇目 digest，增加选择原因及选中、发送、复用、缺失的 UTF-16 字符数。显式 `skills_digests` 仅代表客户端声明正文仍在当前上下文；连接缓存仅证明曾投递。上下文丢失后使用空指纹表或 `skills_mode:full` 恢复，未发送且未持有的正文不能计为复用。既有用户 Skill 与优先级保持原样，本批不实施条件拆篇。

## 完整图片反推

`ReverseView.vue` 的单一反推动作并行启动本地画师/标签识别与完整提示词识图；一条失败不丢弃另一条结果。本地模型未就绪时仍可获取完整提示词，并明确提示画师参考缺失。默认展示画师组成和完整提示词，候选画师、画风对比入口、全部角色和反推说明直接展示，仅识别设置与原始模型分数保留折叠；角色、服装、环境等本地标签沿用原分类，在全局提示词上方默认展示且只读；本地结果缺失时从已有完整正向稿提取标签作为说明，不混入负面、自然语言或画面文字。

`ReversePrompt.vue` 使用 ReversePromptResult 只读展示主提示词、负面词、角色和位置，只有画师选择可调整；本地标签与角色候选同样只读，编辑统一在带入后的生图页。目标模型直接读取全局 naiVersion，没有独立目标模型、要求输入框或生图参数面板。内置反推完成即展示只读结果；外部 Agent 建议先展示再显式采纳。模型在请求中切换时拒绝应用旧模型结果并保留原稿；模型约束不符时提示修改角色数/位置。带入生图通过 openTabForLoad → importGenerationRequest 保留已有创作，用现有生图页执行；反推页没有完整提示词专用生成队列或预览。画幅按参考图比例准备，步数等沿用现有生图参数，默认关闭额外质量词/UC 预设以避免排除文字、分格或像素画。画师串可选择是否包含。

`ai:optimize` 的 AiOptimizeRequest 新增可选 referenceImage（静态 PNG/JPEG/WebP data URL，最多 25 MB），只允许 semantic 模式。主进程解码、去除元数据、等比限制到 2048 边长，再进入现有 Skill、标签工具及本地复查流程。requireVision 禁止纯文字降级；返回 warnings 公开未修复的结构问题。负面词是复现建议，位置不保证像素还原。

前台 MCP 反推工具共享界面动作与 desktop.reverse 快照（包含 localResult/localError）；load 只允许空页；compose 受 mcpAllowAi 控制，执行与按钮相同的双路反推；transfer 只将稿件带入生图页，不生图、不调用供应商。expected_token 保护草稿；step_delay_ms 和取消使用现有前台操作链路。ai:optimize 的可选 actionId 使用一次性 claimFrontend 票据并标记任务 origin=agent。ui_propose_reverse_prompt 可在实际看图和查词后提交外部 Agent 草稿，明确标注来源和未运行内置 AI 复查，仍需显式采纳。
