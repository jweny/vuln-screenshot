# vuln-screenshot

[![CI](https://github.com/jweny/vuln-screenshot/actions/workflows/ci.yml/badge.svg)](https://github.com/jweny/vuln-screenshot/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> **AI 已经帮你找到漏洞，为什么复现截图还得自己做？**

[English](README.md) · [MCP 配置](docs/mcp.md) · [证据格式](docs/evidence-format.md) · [安全模型](docs/threat-model.md)

AI 挖洞经常停在漏洞报告完成前的最后一步：

- AI 执行了 PoC，却只返回文字版结果，请求、响应和命令输出不够直观。
- AI 编写漏洞报告时没有复现截图，还需要人工重新执行命令、粘贴请求包并截图。
- 手工截图样式不统一，报告图片也容易和背后的原始证据脱节。

## vuln-screenshot 解决漏洞报告的最后一公里

通过本地 CLI 或 MCP，AI 可以直接调用 `vuln-screenshot`：

- 发送真实的原始 HTTP/1.1 请求，生成 Burp Suite 风格的请求与响应截图；
- 在伪终端中执行真实命令，生成只包含命令和响应的终端截图；
- 同时保存原始 HTTP 数据、终端输出、规范化文本和 JSON 清单；
- 将统一、直观的图片直接用于漏洞报告，无需人工重新复现和截图。

**AI 负责复现，`vuln-screenshot` 负责把复现结果变成直观、统一、可复核的证据。**

## 效果预览

以下图片来自本地复现的 GitLab CVE-2026-85706 本地复现环境。仅用于演示。

### HTTP 请求与响应

![GitLab CVE HTTP 证据](docs/assets/gitlab-cve-http.png)

### 命令与终端响应

![GitLab CVE 命令证据](docs/assets/gitlab-cve-command.png)

## 核心特点

- **保留真实输入：** 保存原始请求字节、重复请求头、正文、CRLF 边界、ANSI 输出和非零退出码。
- **证据优先：** 截图用于报告展示，原始文件才是后续复核的依据。
- **适合报告：** HTTP 使用紧凑的请求/响应双栏界面；终端图片只显示命令和响应。
- **CLI 与 MCP：** 可以从 Shell 使用，也可以接入支持 MCP 的客户端。
- **不掩盖异常：** 超时、截断、渲染失败和传输信息都会写入结果与清单。

## 环境要求

- Node.js 20 或更新版本
- macOS 或 Linux
- Playwright 安装的 Chromium，或者本机 Google Chrome/Chromium

## 安装

从源码安装：

```bash
git clone https://github.com/jweny/vuln-screenshot.git
cd vuln-screenshot
npm install
npm run install-browser
npm run build
```

项目发布至 npm 后也可以全局安装：

```bash
npm install --global vuln-screenshot
```

在 Unix 上，安装脚本和命令捕获都会检查 `node-pty` 预编译辅助程序所需的可执行权限。即使包管理器禁用了依赖安装脚本，运行时检查仍可完成修复。

## 快速开始

捕获原始 HTTP/1.1 请求：

```bash
printf 'GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n' | \
  vuln-screenshot http --target https://example.com --request -
```

`--target` 只决定 TCP/TLS 连接目标，请求字节不会被重新组装或规范化。可用 `--request -` 从标准输入读取；`--insecure` 只应在明确需要连接不受信任或自签名 TLS 目标时使用。

仓库同时提供可重复使用的请求文件：[`examples/requests/example.raw`](examples/requests/example.raw)。

捕获命令：

```bash
vuln-screenshot command --cwd /tmp -- \
  'printf "\033[32mevidence captured\033[0m\n"; uname -a'
```

命令以当前用户权限通过 `$SHELL -lc` 执行。与真实终端一样，PTY 会合并标准输出和标准错误。通过 `VULN_SCREENSHOT_OUTPUT_DIR` 可以修改默认的 `./artifacts` 输出目录。

如果尚未全局安装，请将示例中的 `vuln-screenshot` 替换为 `node dist/cli.js`。

## 证据包

HTTP 捕获结果：

```text
artifacts/<UTC 时间>-<UUID>/
├── manifest.json
├── request.raw
├── response.raw
└── screenshots/
    └── 001.png ...
```

命令捕获使用 `command.txt`、`terminal.raw` 和 `terminal.txt`。在支持 POSIX 权限的平台上，目录权限为 `0700`，文件权限为 `0600`。

详细字段见[证据格式](docs/evidence-format.md)，处理流程见[架构说明](docs/architecture.md)。

## MCP 服务

启动 stdio 服务：

```bash
vuln-screenshot mcp
```

提供两个工具：

- `capture_http_evidence`：发送一次原始 HTTP/1.1 请求并保存响应。
- `capture_command_evidence`：在宿主机 PTY 中执行一次非交互命令。

配置示例和参数说明见 [MCP 接入文档](docs/mcp.md)。

## 限制与安全边界

- 仅支持 HTTP/1.1，不自动重定向、重试、管理 Cookie、使用代理或改写请求。
- HTTP 响应和 PTY 输出最大保存 10 MiB。
- 单次最多生成 100 页截图。
- HTTP 默认超时 30 秒，命令默认超时 60 秒，最大均为 5 分钟。
- Cookie、凭据、命令和输出均会原样保存，**不会自动脱敏**。
- 当前清单不包含文件哈希和数字签名，不能宣称防篡改。
- 命令工具拥有当前用户的完整宿主机权限。

只能对自有或已获得明确授权的系统使用本项目。将其接入自动化 Agent 前，请先阅读[威胁模型](docs/threat-model.md)。

## 开发

```bash
npm ci
npm run install-browser
npm run check
npm test
npm run build
npm pack --dry-run
```

测试使用本地 TCP 服务，不依赖外部测试目标。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

项目采用 [Apache License 2.0](LICENSE)。
