# 本地定制更新记录

本文件记录相对于上游 openhermit 主项目的**本地定制变更**，用于在 `git merge`/`git rebase` 同步上游时识别需要保留或手动处理的修改。

> 特性分支：`feat/multi-model-config`
> 基于上游：`a909892c`（2025-xx，main）

---

## 1. 企业级多模型配置与切换（核心功能）

### 1.1 数据库 Schema 变更

**新增表**（`packages/store/drizzle/0030_model_providers.sql`）：

- `gateway_secrets`：网关级加密密钥存储（AES-256-GCM），字段：`name`、`value_ciphertext`、`created_at`、`updated_at`
- `model_providers`：可用模型注册表，字段：`id`、`name`、`provider`、`model`、`max_tokens`、`base_url`、`api`、`thinking`、`secret_name`、`enabled`、`created_at`、`updated_at`

迁移 journal：`packages/store/drizzle/meta/_journal.json` 追加 idx:30 条目。

**⚠️ 同步上游时必须保留此迁移文件，否则 gateway 启动时迁移序号错乱。**

### 1.2 Store 层新增实现

`packages/store/src/` 新增/修改文件：

| 文件 | 变更 |
|------|------|
| `schema.ts` | 新增 `gatewaySecrets`、`modelProviders` 两个 drizzle 表定义 |
| `types.ts` | 新增 `GatewaySecretEntry`、`ModelProviderRecord` 类型 |
| `interfaces.ts` | 新增 `GatewaySecretStore`、`ModelProviderStore` 接口 |
| `impl/db-gateway-secret-store.ts` | **新增** - 实现加密存储，含 `open()`/`close()` 工厂方法 |
| `impl/db-model-provider-store.ts` | **新增** - 模型 CRUD 实现，含 `open()`/`close()` 工厂方法 |
| `impl/index.ts` | 导出两个新 Store 实现 |
| `index.ts` | 导出新类型和接口 |

### 1.3 Gateway 后端 API 新增（`apps/gateway/src/`）

**`app.ts`** 新增 8 个路由：

```
GET    /api/admin/models
POST   /api/admin/models
PUT    /api/admin/models/:id
DELETE /api/admin/models/:id
GET    /api/admin/gateway/secrets
PUT    /api/admin/gateway/secrets/:name
DELETE /api/admin/gateway/secrets/:name
GET    /api/agents/:agentId/available-models
```

`POST /api/agents`（agent 创建）：优先从 `modelProviderStore` 获取第一个启用模型作为默认配置。

**`index.ts`** 变更：
- 实例化 `DbModelProviderStore`、`DbGatewaySecretStore`
- 注入至 `createGatewayApp` 和 `AgentInstanceManager`
- shutdown handler 中新增关闭两个 store

**`agent-instance.ts`** 变更：
- 新增 `gatewaySecretStore` 私有字段和 `setGatewaySecretStore()` 方法
- 创建 `AgentRunner` 时传递 `gatewaySecretStore`

### 1.4 Agent Runner 密钥解析链升级（`apps/agent/src/agent-runner.ts`）

`resolveApiKey` 从同步改为**异步**，三级优先查找：

1. `agent_secrets`（per-agent 加密存储）
2. `gateway_secrets`（网关集中加密存储）— **新增**
3. `process.env`（环境变量）

`AgentRunnerOptions`（`apps/agent/src/agent-runner/types.ts`）新增字段：`gatewaySecretStore?: GatewaySecretStore`

---

## 2. Gateway Admin UI - Models 页签

### 新增文件

**`apps/gateway/ui/src/components/ModelsPanel.tsx`**（全新）：

- **Model Providers 区块**：模型 CRUD、API Protocol 下拉选择器（`openai-completions` / `anthropic-messages`）、Enable/Disable 切换、Key 按钮管理对应 secret
- **Gateway Secrets 区块**：独立展示全部已存储密钥（含脱敏值），支持删除；孤立密钥（未被任何模型引用）有明显标记

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/gateway/ui/src/router.ts` | `Tab` 类型和 `VALID_TABS` 添加 `'models'` |
| `apps/gateway/ui/src/components/Topbar.tsx` | tabs 数组追加 `{ id: 'models', label: 'Models' }` |
| `apps/gateway/ui/src/App.tsx` | 导入 `ModelsPanel`，添加 `models` tab 渲染分支 |

**注意**：API Protocol 字段为必填下拉选择器，有效值只有 `openai-completions` 和 `anthropic-messages`，填写 `"openai"` 等无效值会导致 agent 无法发送消息。

---

## 3. Web Chat UI - BasicPanel 重构

**`apps/web/ui/src/components/BasicPanel.tsx`**（重大重构）：

- **移除**：`catalog`（pi-ai 内置模型列表）、`secrets`（per-agent 密钥状态）、`providerMode`、`modelMode`、`baseUrl`、`api`、所有自由输入字段
- **新增**：仅调用 `GET /api/agents/:id/available-models` 获取 gateway 注册的模型列表
- 模型选择完全由网关配置驱动，无 API 密钥的模型显示为 disabled
- 无 gateway 模型时展示友好提示

**`apps/web/ui/src/api.ts`** 新增：
- `AvailableModel` 接口类型
- `fetchAvailableModels()` 函数

**`apps/web/ui/src/components/ManagePanel.tsx`**：
- **移除** `secrets` 页签（`SecretsPanel` 仍保留文件，仅路由入口被移除）
- `ManageTab` 类型移除 `'secrets'`

**`apps/web/ui/src/components/ChatShell.tsx`**：
- 移除本地 `ManageTab` 类型定义，改为从 `ManagePanel` 导入，消除类型不一致
- `MANAGE_TABS` 移除 `'secrets'`

---

## 4. 向后兼容设计

所有新 store 均通过 `if (store)` 守卫保护：

- `modelProviderStore`/`gatewaySecretStore` 未配置时，相关 API 返回 404 或空列表
- agent runner 密钥解析：gateway secrets 查找失败时自动 fallback 到 `process.env`
- 未配置 `OPENHERMIT_SECRETS_KEY` 时，`gatewaySecretStore` 不实例化

---

## 5. 上游同步注意事项

同步上游 `main` 分支时，以下文件**必须保留本地版本**（会产生冲突，需手动处理）：

| 文件 | 冲突处理策略 |
|------|------|
| `packages/store/src/schema.ts` | 保留本地新增的两个表定义，合并上游其他变更 |
| `packages/store/src/interfaces.ts` | 保留本地新增的两个接口 |
| `packages/store/src/types.ts` | 保留本地新增类型 |
| `packages/store/drizzle/0030_model_providers.sql` | **不可删除**，迁移编号固定 |
| `packages/store/drizzle/meta/_journal.json` | 保留本地 idx:30 条目；如上游新增迁移，需顺序追加 |
| `apps/gateway/src/app.ts` | 保留本地新增 8 个路由及 agent 创建时的模型同步逻辑 |
| `apps/gateway/src/index.ts` | 保留 store 实例化和注入代码 |
| `apps/gateway/src/agent-instance.ts` | 保留 `gatewaySecretStore` 字段和方法 |
| `apps/agent/src/agent-runner.ts` | 保留异步 `resolveApiKey` 及三级查找链 |
| `apps/agent/src/agent-runner/types.ts` | 保留 `gatewaySecretStore` 字段 |
| `apps/web/ui/src/components/BasicPanel.tsx` | 完全使用本地版本（gateway-only 模式） |
| `apps/web/ui/src/components/ManagePanel.tsx` | 保留移除 secrets tab 的本地版本 |
| `apps/web/ui/src/components/ChatShell.tsx` | 保留本地 ManageTab 类型引用方式 |
| `apps/web/ui/src/api.ts` | 保留 `AvailableModel` 和 `fetchAvailableModels` |
| `apps/gateway/ui/src/components/ModelsPanel.tsx` | **全新文件，无冲突风险** |
| `apps/gateway/ui/src/router.ts` | 保留 `'models'` tab |
| `apps/gateway/ui/src/components/Topbar.tsx` | 保留 Models tab 入口 |
| `apps/gateway/ui/src/App.tsx` | 保留 ModelsPanel 渲染分支 |

**全新文件（无冲突风险）**：

- `packages/store/src/impl/db-gateway-secret-store.ts`
- `packages/store/src/impl/db-model-provider-store.ts`
- `apps/gateway/ui/src/components/ModelsPanel.tsx`
- `packages/store/drizzle/0030_model_providers.sql`
- `UPDATES.md`（本文件）

---

## 7. 沙盒执行策略改进（性能优化）

### 7.1 问题背景

原始 `ondemand` 容器生命周期策略存在两个核心问题：

1. **首次执行延迟高**：第一次调用 `exec` 工具时才启动 Docker 容器，包括拉取镜像、创建容器、启动容器，耗时 5-30 秒
2. **并发竞态条件**：`DockerExecBackend.ensure()` 缺乏并发控制，多个并发 `exec` 调用可能触发重复容器创建

### 7.2 核心改进

#### 改进 1：并发锁机制

**文件**：`apps/agent/src/core/backends/docker.ts`

在 `DockerExecBackend` 中添加 `ensurePromise` 并发守卫：

```typescript
private ensurePromise: Promise<void> | null = null;

async ensure(): Promise<void> {
  // 如果已经在确保中，返回同一个 promise
  if (this.ensurePromise) {
    return this.ensurePromise;
  }
  
  this.ensurePromise = this.ensureInternal().finally(() => {
    this.ensurePromise = null;  // 完成后释放锁
  });
  
  return this.ensurePromise;
}
```

**效果**：
- 5 个并发 `exec` 调用 → 只创建 1 个容器（而非 5 个）
- 总耗时从 ~500ms 降至 ~100ms
- 通过测试验证：`test/docker-concurrent.test.ts` ✔

#### 改进 2：异步预启动容器

**文件**：`apps/agent/src/agent-runner.ts`（`openSession` 方法）

在 `openSession()` 时异步预启动容器，消除首次 `exec` 延迟：

```typescript
const lifecycleStart = config.exec?.lifecycle?.start ?? 'ondemand';
if (this.execBackendManager) {
  const preStartContainer = async (): Promise<void> => {
    // 预启动所有后端
    await this.execBackendManager!.ensureAll();
  };

  if (lifecycleStart === 'session') {
    await preStartContainer();  // 同步：阻塞等待
  } else {
    void preStartContainer();   // 异步：不阻塞 session 打开
  }
}
```

**效果**：
- `ondemand` 策略：容器在后台预启动，用户发送第一条消息时已就绪
- 首次 `exec` 延迟从 5-30 秒降至 0-1 秒
- 预启动失败不影响 session 打开，会在首次 `exec` 时重试

#### 改进 3：ExecBackendManager.ensureAll() 方法

**文件**：`apps/agent/src/core/exec-backend.ts`

新增 `ensureAll()` 方法，支持并发确保所有后端：

```typescript
async ensureAll(): Promise<void> {
  await Promise.allSettled(
    [...this.backends.values()].map((b) => b.ensure()),
  );
}
```

**设计要点**：
- 使用 `Promise.allSettled` 容错：单个后端失败不影响其他后端
- 配合并发锁，即使多次调用也不会重复创建

#### 改进 4：exec() 方法增强

**文件**：`apps/agent/src/core/backends/docker.ts`

在每次 `exec()` 调用前确保容器运行中：

```typescript
async exec(command: string, opts?: ExecOpts): Promise<ExecResult> {
  // 确保容器运行中（并发锁防止重复启动）
  await this.ensure();
  return this.containerManager.execInWorkspace(...);
}
```

**效果**：
- 自动恢复状态漂移（容器被外部停止后自动重启）
- 减少因状态不一致导致的失败

#### 改进 5：错误信息优化

**文件**：`apps/agent/src/core/container-manager.ts`

增强 `execInWorkspace` 的错误提示：

```typescript
throw new NotFoundError(
  `Workspace container not found: ${name}. ` +
  `This should not happen if backend.ensure() was called. ` +
  `Please check Docker status and agent configuration.`,
);
```

### 7.3 性能日志

在 `agent-runner.ts` 中添加详细的容器启动日志：

```
[container] pre-starting backends for session xxx (lifecycle=ondemand)
[container] pre-start completed in 1234ms
[container] pre-start failed (will retry on first exec): ...
```

### 7.4 测试验证

**新增测试文件**：`apps/agent/test/docker-concurrent.test.ts`

测试结果：
```
✔ DockerExecBackend concurrent ensure() calls should only create one container (118ms)
✔ DockerExecBackend sequential ensure() calls should reuse completed state (213ms)
✔ DockerExecBackend ensure() should release lock on failure (1ms)
✔ ExecBackendManager.ensureAll calls all backends
✔ ExecBackendManager.ensureAll tolerates failures
```

### 7.5 实际效果对比

| 场景 | 改进前 | 改进后 |
|------|--------|--------|
| 首次 exec 调用 | 5-30 秒（容器启动） | **0-1 秒**（预启动） |
| 5 个并发 exec | 可能创建 5 个容器 | **只创建 1 个** |
| 容器状态漂移 | 直接报错 | **自动恢复** |
| 错误诊断 | 模糊的错误信息 | **详细的诊断提示** |

### 7.6 向后兼容

- 完全向后兼容，不改变任何公开 API
- 默认行为增强：`ondemand` 策略现在自动预启动
- 可通过 `lifecycle.start` 配置精确控制：
  - `'session'`：同步启动（阻塞等待）
  - `'ondemand'`：异步预启动（不阻塞）

---

## 8. 上游同步注意事项

同步上游 `main` 分支时，以下文件**必须保留本地版本**（会产生冲突，需手动处理）：

| 文件 | 冲突处理策略 |
|------|------|
| `apps/agent/src/core/backends/docker.ts` | 保留并发锁机制和 exec() 增强逻辑 |
| `apps/agent/src/core/exec-backend.ts` | 保留 ensureAll() 方法 |
| `apps/agent/src/agent-runner.ts` | 保留 openSession 中的异步预启动逻辑 |
| `apps/agent/src/core/container-manager.ts` | 保留增强的错误信息 |
| `apps/agent/test/docker-concurrent.test.ts` | **全新文件，无冲突风险** |
| `apps/agent/test/exec-backend.test.ts` | 保留 ensureAll 测试用例 |

---

## 9. 已知问题与限制

### 9.1 多模型配置相关

- pi-ai 内置模型目录不再在 web chat UI 中展示（这是设计决策，非缺陷）
- `SecretsPanel.tsx` 组件文件保留但无路由入口，可在需要时重新启用
- 上游若修改 `resolveApiKey` 相关逻辑，需同步检查三级查找链是否仍正确

### 9.2 沙盒执行策略相关

- 异步预启动会在 session 打开时增加系统负载（后台启动容器）
  - **缓解**：容器启动失败不影响 session 打开，会延迟到首次 exec 时重试
  - **监控**：通过 `[container]` 日志跟踪预启动成功率
- `Promise.allSettled` 会吞掉单个后端的失败，需要查看日志才能发现
  - **建议**：在生产环境监控容器启动失败率

---

## 10. Web UI react-i18next 双语言接入

### 10.1 依赖与初始化

**新增依赖**：`react-i18next`、`i18next`、`i18next-browser-languagedetector`

**新增文件**：

| 文件 | 说明 |
|------|------|
| `apps/web/ui/src/i18n.ts` | i18next 初始化，配置 localStorage + navigator 自动检测语言 |
| `apps/web/ui/src/i18n.d.ts` | TypeScript 类型声明，使 `t('key')` 具有类型检查和 IDE 补全 |
| `apps/web/ui/src/locales/en.ts` | 英文翻译（340+ 条 key，分 16 个命名空间） |
| `apps/web/ui/src/locales/zh.ts` | 中文翻译（对应 en.ts 全部 key） |

**修改文件**：

| 文件 | 变更 |
|------|------|
| `apps/web/ui/src/main.tsx` | 添加 `import './i18n'`（在 styles.css 前） |

### 10.2 语言切换组件

**新增文件**：`apps/web/ui/src/components/LangToggle.tsx`

简洁胶囊按钮，显示当前语言反向（中→EN，英→中），点击调用 `i18n.changeLanguage()` 切换。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `apps/web/ui/src/styles.css` | 末尾添加 `.lang-toggle` 样式（胶囊按钮） |
| `apps/web/ui/src/components/ChatShell.tsx` | header 添加 LangToggle 组件 |
| `apps/web/ui/src/components/PickAgentScreen.tsx` | header 添加 LangToggle 组件 |

### 10.3 文案迁移范围（全部硬编码 → `t()` 调用）

以下组件全部完成 i18n 迁移，无剩余硬编码中文/英文文案：

| 组件 | 状态 |
|------|------|
| `SetupScreen.tsx` | ✅ 含 `dangerouslySetInnerHTML` 渲染 HTML 提示 |
| `PickAgentScreen.tsx` | ✅ |
| `ChatShell.tsx` | ✅ status 改为联合类型 + `statusLabel` 映射 |
| `ManagePanel.tsx` | ✅ tab 标签全部用 t() |
| `BasicPanel.tsx` | ✅ |
| `SkillsPanel.tsx` | ✅ |
| `McpPanel.tsx` | ✅ |
| `SchedulesPanel.tsx` | ✅ 含子组件 CreateScheduleDialog、RunsDialog |
| `PoliciesPanel.tsx` | ✅ 含子组件 CreatePolicyDialog |
| `SecretsPanel.tsx` | ✅ |
| `ApprovalsPanel.tsx` | ✅ |
| `FilePanel.tsx` | ✅ |
| `Composer.tsx` | ✅ |
| `ChannelsPanel.tsx` | ✅ 含子组件 BuiltinChannelFields、ChannelCard |

**翻译命名空间**：`common`、`setup`、`pick_agent`、`chat`、`composer`、`session_list`、`manage`、`basic`、`skills`、`mcp`、`schedules`、`policies`、`secrets`、`approvals`、`file_panel`、`channels`、`lang_toggle`

### 10.4 技术要点

- **DeepStringRecord 类型技巧**：`en.ts` 使用 `as const` 后导致 `zh.ts` 无法赋值不同字符串，通过递归泛型 `DeepStringRecord<T>` 将叶节点字符串类型宽松化为 `string`
- **含 HTML 的翻译文本**：对 `help_restore_key`、`token_bearer_hint`、`secrets.hint` 等含 `<code>`、`<strong>` 的翻译，使用 `dangerouslySetInnerHTML={{ __html: t('...') }}` 渲染
- **类型安全**：`i18n.d.ts` 声明 `CustomTypeOptions`，使 `t('key')` 参数必须为合法的 key 路径，拼写错误会在编译期捕获

### 10.5 向后兼容

- 语言检测优先级：localStorage → 浏览器 navigator，首次访问按浏览器语言自动选择
- 语言切换后持久化到 localStorage（键：`i18n_lang`），刷新页面保持
- `fallbackLng: 'en'`，当某个 key 在 zh.ts 中不存在时自动 fallback 到英文

### 10.6 上游同步注意事项

同步上游 `main` 分支时，以下文件**必须保留本地版本**：

| 文件 | 冲突处理策略 |
|------|------|
| `apps/web/ui/src/i18n.ts` | **全新文件，无冲突风险** |
| `apps/web/ui/src/i18n.d.ts` | **全新文件，无冲突风险** |
| `apps/web/ui/src/locales/en.ts` | **全新文件，无冲突风险** |
| `apps/web/ui/src/locales/zh.ts` | **全新文件，无冲突风险** |
| `apps/web/ui/src/components/LangToggle.tsx` | **全新文件，无冲突风险** |
| `apps/web/ui/src/main.tsx` | 保留 `import './i18n'` |
| `apps/web/ui/src/styles.css` | 保留 `.lang-toggle` 样式 |
| `apps/web/ui/src/components/ChatShell.tsx` | 保留 LangToggle + 全部 t() 调用 |
| `apps/web/ui/src/components/PickAgentScreen.tsx` | 保留 LangToggle + 全部 t() 调用 |
| `apps/web/ui/src/components/*.tsx` | 保留全部迁移后的组件（见 10.3 列表） |

---

## 11. FilePanel 预览面板 UI 改进

### 11.1 下载和关闭按钮改为无边框图标按钮

**修改文件**：`apps/web/ui/src/components/FilePanel.tsx`

下载和关闭按钮从 `btn btn--ghost btn--sm` 改为 `file-panel__icon-btn`，与头部刷新/关闭按钮风格一致，无边框无背景，hover 时只改色。

### 11.2 预览/源码切换改为两段式开关

**修改文件**：

| 文件 | 变更 |
|------|------|
| `apps/web/ui/src/components/FilePanel.tsx` | 从单按钮点击切换改为并排两段式开关（`预览 | 源码`） |
| `apps/web/ui/src/styles.css` | 替换 `.file-panel__md-toggle` 为 `.file-panel__md-switch` 样式 |

**新样式特点**：

- 外层统一圆角边框（`border-radius: 99px`），内部两个按钮无间距
- 当前激活项高亮填充主色，文字白色
- 未激活项保持透明背景，hover 时文字变色
- 视觉上清晰区分两个模式，一眼看出当前所处状态

### 11.3 上游同步注意事项

同步上游 `main` 分支时，以下文件**必须保留本地版本**：

| 文件 | 冲突处理策略 |
|------|------|
| `apps/web/ui/src/components/FilePanel.tsx` | 保留预览面板 UI 改进 + i18n 迁移 |
| `apps/web/ui/src/styles.css` | 保留 `.file-panel__md-switch` + `.lang-toggle` 样式 |

---

_最后更新：2026-05-20_
