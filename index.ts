/**
 * GitHub Copilot 本地代理
 * 暴露 OpenAI 兼容接口，任何 Chat UI 都可以接入
 * 
 * 用法：
 *   npx ts-node copilot-proxy.ts
 *   访问 http://localhost:3001
 */

import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import readline from "readline";
import { ProxyAgent, setGlobalDispatcher } from "undici";

// ─── 代理配置（按你本地工具修改端口）────────────────────────────────────────
const PROXY_URL = process.env.HTTPS_PROXY
  || process.env.https_proxy
  || "http://127.0.0.1:7897"; // Clash 默认端口，V2Ray 改成 1080

setGlobalDispatcher(new ProxyAgent(PROXY_URL));
console.log(`🌐 使用代理: ${PROXY_URL}`);

const PORT = 3001;
const TOKEN_FILE = path.join(process.env.HOME || ".", ".copilot-proxy-token.json");
const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98"; // GitHub Copilot 官方 Client ID

interface SavedAuth {
  oauth_token: string;
}

interface CopilotToken {
  token: string;
  expires_at: number;
}

let cachedCopilotToken: CopilotToken | null = null;

// ─── 1. GitHub Device Login ───────────────────────────────────────────────────

async function startDeviceLogin(): Promise<string> {
  const res = await post("https://github.com/login/device/code", {
    client_id: GITHUB_CLIENT_ID,
    scope: "read:user",
  });
  console.log(`\n🔗 请打开浏览器访问: ${res.verification_uri}`);
  console.log(`📋 输入 Code: ${res.user_code}\n`);

  // 轮询等待用户授权
  const interval = res.interval || 5;
  while (true) {
    await sleep(interval * 1000);
    try {
      const tokenRes = await post("https://github.com/login/oauth/access_token", {
        client_id: GITHUB_CLIENT_ID,
        device_code: res.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      if (tokenRes.access_token) {
        console.log("✅ GitHub 授权成功！");
        return tokenRes.access_token;
      }
      if (tokenRes.error === "access_denied") throw new Error("用户拒绝授权");
    } catch (e: any) {
      if (e.message === "用户拒绝授权") throw e;
    }
  }
}

// ─── 2. 换取 Copilot JWT Token ────────────────────────────────────────────────

async function getCopilotToken(oauthToken: string): Promise<string> {
  const now = Date.now() / 1000;
  if (cachedCopilotToken && cachedCopilotToken.expires_at > now + 60) {
    return cachedCopilotToken.token;
  }

  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `token ${oauthToken}`,
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot-chat/0.22.4",
      "User-Agent": "GithubCopilot/1.155.0",
    },
  });

  if (!res.ok) throw new Error(`获取 Copilot Token 失败: ${res.status}`);
  const data = await res.json() as any;
  cachedCopilotToken = { token: data.token, expires_at: data.expires_at };
  return data.token;
}

// ─── 3. 转发请求到 Copilot API ────────────────────────────────────────────────

async function forwardToCopilot(copilotToken: string, body: any): Promise<any> {
  const res = await fetch("https://api.githubcopilot.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${copilotToken}`,
      "Content-Type": "application/json",
      "Copilot-Integration-Id": "vscode-chat",        // 关键 Header！
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot-chat/0.22.4",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Copilot API 错误 ${res.status}: ${err}`);
  }

  // 支持流式响应
  if (body.stream) return res;
  return res.json();
}

// ─── 4. HTTP 服务器 (OpenAI 兼容接口) ────────────────────────────────────────

function startServer(oauthToken: string) {
  const server = http.createServer(async (req, res) => {
    // CORS 支持
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      try {
        // GET /v1/models — 返回可用模型列表
        if (req.method === "GET" && req.url === "/v1/models") {
          const copilotToken = await getCopilotToken(oauthToken);
          const modelsRes = await fetch("https://api.githubcopilot.com/models", {
            headers: {
              Authorization: `Bearer ${copilotToken}`,
              "Copilot-Integration-Id": "vscode-chat",
            },
          });
          const models = await modelsRes.json();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(models));
          return;
        }

        // POST /v1/chat/completions — 转发聊天请求
        if (req.method === "POST" && req.url === "/v1/chat/completions") {
          const parsed = JSON.parse(body);
          const copilotToken = await getCopilotToken(oauthToken);

          if (parsed.stream) {
            // 流式响应
            const upstream = await forwardToCopilot(copilotToken, parsed) as Response;
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            });
            const reader = upstream.body!.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
            res.end();
          } else {
            const data = await forwardToCopilot(copilotToken, parsed);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(data));
          }
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      } catch (e: any) {
        console.error("❌", e.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Copilot 代理已启动！`);
    console.log(`📡 API 地址: http://localhost:${PORT}/v1`);
    console.log(`\n接入任意 Chat UI：`);
    console.log(`  API Host : http://localhost:${PORT}/v1`);
    console.log(`  API Key  : any-string-here（随意填写）`);
    console.log(`  Model    : gpt-4o / claude-opus-4.6 / claude-sonnet-4.6\n`);
  });
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

async function post(url: string, data: any): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(data),
  });
  return res.json();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main() {
  let oauthToken: string;

  if (fs.existsSync(TOKEN_FILE)) {
    const saved: SavedAuth = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    oauthToken = saved.oauth_token;
    console.log("✅ 使用已保存的 GitHub Token");
  } else {
    console.log("🔑 需要先授权 GitHub Copilot...");
    oauthToken = await startDeviceLogin();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ oauth_token: oauthToken }));
    console.log(`💾 Token 已保存到 ${TOKEN_FILE}`);
  }

  // 验证 token 有效性
  try {
    await getCopilotToken(oauthToken);
    console.log("✅ Copilot Token 获取成功");
  } catch (e: any) {
    console.error("❌ Token 无效，重新授权...");
    fs.unlinkSync(TOKEN_FILE);
    return main();
  }

  startServer(oauthToken);
}

main().catch(console.error);