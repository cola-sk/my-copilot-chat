# GitHub Copilot 本地代理

一个 GitHub Copilot 的本地代理服务，暴露 OpenAI 兼容接口，允许任何 Chat UI 直接接入使用。

## 功能特性

- ✅ GitHub Device Login 授权（无需保存密码）
- ✅ 自动获取并缓存 Copilot JWT Token
- ✅ OpenAI 兼容接口（可接入任何支持 OpenAI API 的客户端）
- ✅ 支持流式响应（Server-Sent Events）
- ✅ 支持 HTTP 代理配置（Clash、V2Ray 等）
- ✅ Token 自动过期更新

## 项目结构

```
.
├── index.ts              # 主程序文件
├── package.json          # 项目依赖配置
├── package-lock.json     # 依赖锁定文件
├── tsconfig.json         # TypeScript 配置
├── .gitignore           # Git 忽略规则
└── README.md            # 本文件
```

## 系统要求

- Node.js >= 18.0
- npm >= 9.0

## 安装

### 1. 克隆项目

```bash
git clone <repository-url>
cd my-copilot-chat
```

### 2. 安装依赖

```bash
npm install
```

## 使用方法

### 快速启动

```bash
npx ts-node index.ts
```

### 运行过程

1. **启动代理服务**
   ```
   🌐 使用代理: http://127.0.0.1:7897
   🚀 Copilot 代理已启动！
   📡 API 地址: http://localhost:3001/v1
   ```

2. **首次授权**（仅需一次）
   - 终端会显示 GitHub 授权链接和授权码
   - 点击链接访问，输入授权码
   - 浏览器完成授权后返回
   - 授权信息保存至 `~/.copilot-proxy-token.json`

3. **后续使用**
   - 代理会自动使用保存的 Token
   - Token 过期自动更新，无需手动干预

## API 接口

### 获取模型列表

**请求**
```
GET /v1/models
```

**响应示例**
```json
{
  "object": "list",
  "data": [
    {"id": "gpt-4o", "object": "model"},
    {"id": "claude-opus-4.6", "object": "model"},
    {"id": "claude-sonnet-4.6", "object": "model"}
  ]
}
```

### 聊天完成

**请求**
```
POST /v1/chat/completions
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "stream": false
}
```

**响应示例**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?"
      },
      "finish_reason": "stop"
    }
  ]
}
```

## 配置说明

### 代理配置

代理服务器地址可通过环境变量配置（优先级从高到低）：

```bash
# 方式 1: 环境变量
export HTTPS_PROXY=http://127.0.0.1:7897
npx ts-node index.ts

# 方式 2: 直接在代码中修改
# 编辑 index.ts 第 20 行的 PROXY_URL
```

**常见代理端口**
- **Clash**: 7897（默认）
- **V2Ray**: 1080
- **Shadowsocks**: 1086

### 授权 Token 位置

授权后的 Token 保存在：
```
~/.copilot-proxy-token.json
```

如需重新授权，删除该文件即可。

## 与 ChatBox 接入

### ChatBox 配置步骤

1. **打开 ChatBox** 应用
2. **进入设置 → API 配置**
3. **配置以下参数**
   - **API Base URL**: `http://localhost:3001/v1`
   - **API Key**: `any-string-here`（随意填写）
   - **模型**: 选择 `gpt-4o`、`claude-opus-4.6` 或 `claude-sonnet-4.6`

### 使用示例

启动本代理后，在 ChatBox 中发起对话：

```
用户: 你是谁？
ChatBox: 我是 Claude，由 Anthropic 开发...
```

所有请求会通过代理转发到 Copilot，响应通过本地 API 直接返回。

## 故障排除

### 问题 1: 无法连接代理

```
Error: connect ECONNREFUSED 127.0.0.1:7897
```

**解决**
- 确认代理工具（Clash/V2Ray）已启动
- 确认代理端口号正确
- 修改 `index.ts` 中的 `PROXY_URL`

### 问题 2: GitHub 授权超时

```
Error: 用户拒绝授权
```

**解决**
- 重新运行脚本
- 检查浏览器是否成功加载授权页面
- 检查网络连接

### 问题 3: Copilot Token 过期

代理会自动处理 Token 更新，无需手动干预。若需要清除缓存：

```bash
rm ~/.copilot-proxy-token.json
```

## 开发

### 编译 TypeScript

```bash
npx tsc
```

### 在编辑器中调试

使用 VS Code 的 TypeScript 调试器或直接运行 `ts-node`。

## 许可证

MIT

## 安全提示

- ⚠️ Token 文件包含敏感授权信息，不要分享
- ⚠️ 代理服务默认允许本地访问，不要暴露到互联网
- ⚠️ API Key 仅作占位符，不支持真正的身份验证
