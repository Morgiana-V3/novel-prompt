# 代码写作规范

适用于 TypeScript、JavaScript、Vue 模板与 CSS/Less，包括测试和工程脚本。新代码及重构模块遵守本规范；存量代码按模块整理，不把全库格式化、变量重命名和业务修改混成一次改动。

当前状态：已建立规范和 `.editorconfig`；自动格式化、lint 与样式检查尚未接入，见根目录 `TODO.md` 的 R03。Less 尚未引入，试点见 R20。

## 1. 按逻辑分行

- 缩进使用 2 个空格，文件使用 UTF-8、LF，末尾保留换行。格式化目标行宽为 100 字符；长 URL、字符串和外部协议内容不强行拆断。
- 一行只放一条语句；每条变量声明独立书写，不用逗号一次声明多个不同职责的变量。
- `if`、`else`、循环和 `try/catch/finally` 使用花括号及多行代码块，简单提前返回也一样。
- 函数的块体展开书写；只有单个纯表达式的短箭头函数可以保持一行。不能为少写几行把副作用藏在表达式中。
- 按“输入校验、读取、计算、持久化、通知”等实际步骤留空行，不要求每条语句之间都空一行。
- 禁止嵌套三元表达式。简单的二选一值可以使用三元；多条件业务使用命名变量、分支或明确的函数。
- 多步数组处理链每步一行，回调命名应表达元素含义；复杂回调提取为有含义的函数。
- 不用 `condition && save()`、逗号表达式或多层链式赋值隐藏状态修改。用显式分支表达副作用。
- 多字段业务对象、多参数复杂调用按字段/参数分行；简短的坐标对象等可以紧凑书写，遵从统一格式化结果。
- 不通过禁用格式化、手工压缩或拼行满足文件行数限制。拆文件的依据是职责，不是行数。

不接受：

```ts
const w = readPage(id), v = pageCurrent(w)
if (!v) return
const r = v.editor.regions.find(r => r.id === regionId); if (r) r.target = target
```

推荐：

```ts
const workspace = readPage(workspaceId)
const currentVersion = pageCurrent(workspace)

if (!currentVersion) {
  return
}

const targetRegion = currentVersion.editor.regions.find(
  (region) => region.id === regionId,
)

if (targetRegion) {
  targetRegion.target = target
}
```

保留项目现有的单引号和省略语句尾分号风格，由格式化工具处理必要的语法分隔。可读性主要通过命名、分行和职责组织改善，不靠标点风格争论。

## 2. 名称表达业务含义

- 变量和函数用 `camelCase`，类型及 Vue 组件用 `PascalCase`；CSS 类名用有含义的 `kebab-case`。
- 业务对象不缩写成 `w`、`v`、`r`、`p`、`m`、`s`，包括回调参数。使用 `workspace`、`version`、`region`、`proposal`、`message`、`fileStats` 等实际名称。
- 避免 `cfg`、`tmp`、`obj`、`arr`、`fn` 等无助于识别职责的简称。上下文不足时，`data`、`result`、`item` 也应具体化为 `generationResult`、`workspaceSummary` 等名称。
- `id`、`url`、`api`、`ipc`、`mcp`、`png` 等领域通用缩写可以保留，名称按 camelCase 组合，如 `workspaceId`、`imageUrl`、`mcpSession`。
- 布尔值表达判断：`isSaving`、`hasPendingChanges`、`canEditWorkspace`。异步操作用具体动词：`loadWorkspace`、`saveDraft`、`deleteImage`。
- 明确相似但不同的对象：`viewedVersion`、`adoptedVersion`、`sourceImage`；禁止把它们都叫 `current` 或 `selected`。
- 带单位的数据写明单位，例如 `timeoutMs`、`imageWidthPx`、`fileSizeBytes`，避免靠调用者猜测。
- `x/y` 可用于局部坐标公式，常见数学符号可以用于短小且有公式解释的算法。循环下标优先用 `index`；确实使用 `i/j` 时仅限短小纯索引循环，不跨越异步或嵌套业务流程。
- 错误参数使用 `error`，事件参数使用 `event` 或 `pointerEvent`，不使用 `e`。泛型优先表达角色，如 `TRequest`、`TResult`；短小通用容器允许 `T`。
- 已持久化字段、IPC/MCP 参数和供应商协议字段不能随内部重命名一起变更。需要本地别名时在边界映射；通过符号引用重命名并核对调用者，不全库替换单个字母。

## 3. Vue 模板与状态

- 一个标签有多个属性或指令时，每个属性独立一行；较长的标签结束符独立排列，由格式化工具统一。
- 模板只表达展示和事件绑定。包含多个步骤的保存、删除、生成操作提取为具名处理函数，不在 `@click` 内串联赋值和调用。
- 复杂展示条件放入有含义的计算属性，避免模板中多层三元和重复条件。
- 将状态、派生状态、用户动作和生命周期按职责分组。相关状态放在一起，不用一个超大 composable 隐藏超大组件。
- 组件输入和事件保持明确，不向调用者暴露所有内部状态。

```vue
<button
  class="workspace-save-button"
  :disabled="!canSaveDraft"
  @click="saveDraft"
>
  保存配置
</button>
```

## 4. CSS 与 Less

### 统一写法

- 无论 CSS 还是 Less，选择器、花括号、声明均展开；每行一个属性，结束分号不能省略。只有一个属性的规则也分行。
- 多选择器每个选择器一行；媒体查询、关键帧、伪类、伪元素保持可单独阅读的块。
- 新样式按布局、尺寸/间距、文字、颜色/边框、效果/动画分组书写。整理存量样式时保留影响覆盖关系的声明顺序，尤其是简写与长写属性，不自动按字母排序。
- 基础主题值优先复用现有 CSS 自定义属性；功能样式放在对应组件/功能目录，公共样式只容纳真正复用的规则。
- 静态样式不堆在模板 `style` 属性中；与坐标、尺寸等状态绑定的动态样式可以保留在绑定或 CSS 自定义属性中。
- 不为提高优先级层层嵌套、滥用 `!important` 或使用无边界的全局选择器。新增例外需说明原因。

```css
.workspace-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--line);
}

.workspace-toolbar__button:hover {
  background: var(--hover);
}
```

### Less 引入方案

将 Less 作为 R20 的受控试点，当前不批量更换 `.css` 后缀。先选一个样式独立的组件，接入编译与检查，再决定推广范围。格式化现有 CSS 可以先做，不以 Less 接入为前提。

- 主要用于组件内聚的样式、少量编译期变量和实际复用的 mixin；主题颜色等运行时值仍保留 CSS 自定义属性，不机械转换成 Less 变量。
- 嵌套最多两层（外层选择器加一层状态或子元素），不要复刻 DOM 层级。类名尽量完整可搜索，避免字符串拼接式类名。
- 不引入全局隐式 mixin、复杂循环生成选择器或大范围 `extend`；抽象必须对应真实复用需求。
- 首次迁移保留选择器、优先级、加载顺序和 `scoped` 作用域，不同时重做视觉或改变全局/局部归属。
- 试点验收包括开发启动、生产构建、默认/悬停/焦点/禁用状态，以及相关弹窗、溢出和窗口缩放表现。确认没有样式回归后再按模块推进。

拟采用的组件写法：

```vue
<style scoped lang="less">
.workspace-toolbar__button {
  padding: 6px 10px;
  color: var(--text);

  &:hover {
    background: var(--hover);
  }

  &:disabled {
    opacity: 0.5;
  }
}
</style>
```

## 5. 工具落地与检查职责

R03 分别落实以下检查，不能用“格式化通过”代替可读性审查：

| 手段 | 负责内容 | 状态 |
| --- | --- | --- |
| `.editorconfig` | 缩进、编码、换行、文件末尾换行 | 已配置；需编辑器支持，不是强制检查 |
| Prettier | TS/JS/Vue/CSS/Less 的机械格式、100 字符目标行宽、Vue 多属性换行 | 待接入 |
| ESLint 与 TS/Vue 规则 | 分支花括号、一行语句数量、独立变量声明、嵌套三元、Promise 及类型边界 | 待接入，先验证规则与格式化工具是否冲突 |
| Stylelint | 样式有效性及约定约束；Less 试点时接入对应语法支持 | 待接入，不启用可能改变覆盖关系的自动排序 |
| 人工/Agent 审查 | 名称是否表达业务、逻辑是否分段、模块职责、共享抽象是否合理 | 每批必查，不能仅凭变量长度判断 |

提供明确区分的“只检查”和“自动修复”命令；检查覆盖已迁移模块，逐步扩大范围。不得把未迁移文件的存量问题隐藏成全局关闭规则，也不得宣称尚未配置的检查已经生效。

机械格式化、语义重命名、职责拆分分别提交可审阅的改动批次。名称调整后检查类型、导出、模板引用、跨进程契约和受影响测试；样式调整后检查视觉及交互。不要为排版变化增加只验证代码长相的业务测试。
