# dsh-plugin-network-proxy

为 DeepSeek Harness（DSH）提供**可在运行时配置的出站 HTTP(S) 代理**：

- 在 Web GUI 的 **Plugins → Built-in plugin settings → 网络代理** 中编辑代理，保存后立即生效，无需重启。
- 在聊天中输入 `/proxy` 查看状态，`/proxy on <url>` 开启，`/proxy off` 关闭，`/proxy test` 测试连通性。
- 作用于 DSH 进程内所有使用 Node `fetch` 的出站请求（模型、`web_search`、`web_fetch`、HTTP MCP），并让 shell 子进程继承代理环境。
- 复用 DSH 内置的 `@deepseek-ai/dsh-http-proxy`：路由、`no_proxy` 匹配、回环绕过和子进程环境都遵循同一套策略。
- 不启用时不改变任何路由；卸载插件会恢复启动时的环境代理策略。

## 安装到当前 web profile

本插件以 linked 包形式安装。若环境没有 pnpm，可用符号链接 + profile patch：

```sh
cd /path/to/dsh-plugin-network-proxy
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn "$PWD" ~/.dsh/profiles/web/node_modules/dsh-plugin-network-proxy
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: network-proxy
      name: 'dsh-plugin-network-proxy'
```

> 行 id 必须是 `network-proxy`：设置页命名空间和 `/proxy` 的持久化都按这个 id 地址。
>
> 修改 profile patch 后，已启用的 `dsh-hmr` 会重新组合配置。若当前进程没有热加载，重启 `dsh web` 后生效。

插件包本身也声明了 `dsh.bundle.patch`，安装 pnpm 后也可以用插件管理器作为 bundle 安装。

## 使用

### 设置页

打开 **Plugins → Built-in plugin settings → 网络代理**，填写：

| 字段 | 说明 |
|---|---|
| HTTP 代理 | 例如 `http://127.0.0.1:7890`；留空表示该协议不代理 |
| HTTPS 代理 | 留空时沿用 HTTP 代理 |
| 绕过列表 | 逗号分隔的主机或 `主机:端口`；子域自动匹配；不支持 CIDR；回环始终直连 |
| 测试地址 | `/proxy test` 的默认地址；留空使用 `https://www.google.com/generate_204` |

HTTP 和 HTTPS 都留空即关闭插件代理，进程回到启动时环境变量（或直连）决定的路由。

### `/proxy` 命令

| 输入 | 说明 |
|---|---|
| `/proxy` | 查看当前配置、生效阶段、测试地址路由、最近错误和诊断 |
| `/proxy on http://127.0.0.1:7890` | 同时设置 HTTP/HTTPS 代理，保存并测试 |
| `/proxy off` | 关闭插件代理，恢复启动环境策略 |
| `/proxy http <url>` | 只设置 HTTP 代理 |
| `/proxy https <url>` | 只设置 HTTPS 代理 |
| `/proxy no-proxy <list>` | 设置绕过列表；不带参数表示清空 |
| `/proxy test [url]` | 用当前策略请求测试地址，显示路由、状态码和耗时 |

命令在 UI 命令面执行，不进入模型请求；因此即使代理配置错误导致模型请求失败，仍可用 `/proxy off` 恢复。

### FlClash / Clash 示例

`.bashrc` 里常见的 WSL 配置是 FlClash 混合端口 `127.0.0.1:7890`。启动 FlClash 后：

```
/proxy on http://127.0.0.1:7890
/proxy test
```

HTTP 代理会同时被 HTTPS 回退使用；无需再填 HTTPS。

## 行为与限制

- 只支持 `http://` / `https://` 代理；SOCKS、PAC、系统代理探测不支持。SOCKS URL 会被报告，该协议保持直连。
- 回环地址（`localhost`、`127.0.0.0/8`、`::1` 等）始终直连，因此不能用本插件代理 DSH 自己的 Web UI 或本地测试服务器。
- `no_proxy` 不支持 CIDR；请改写为后缀形式（例如 `10.0.0.0/8` 写成具体域名后缀）。
- 代理 URL 中的用户名密码会以明文写进 profile 配置；状态和日志会脱敏。优先使用仅监听本机、无认证的代理。
- TLS 中间人代理需要在**启动 DSH 之前**设置 `NODE_EXTRA_CA_CERTS`；插件不管理 CA。
- 浏览器自身的网络不受影响；插件只影响 DSH Node 进程及其子进程。
- 遥测保持直连；模型生成的 PTC/workflow worker 不继承可能含凭据的代理 URL（沿用 DSH 内置库的既有边界）。
- 若代理不可达，DSH 的出站请求会失败；用 `/proxy test` 定位，`/proxy off` 恢复。

## 开发

```sh
cd /path/to/dsh-plugin-network-proxy
npm install        # 仅安装 devDependencies，用于测试
npm test           # node --test
```

测试覆盖：

- 配置读取、URL 校验、凭据脱敏、环境映射；
- `/proxy` 语法、持久化、输出；
- 用本地转发代理验证安装/切换/`no_proxy`/SOCKS 拒绝/卸载；
- client bundle 的模块注册与导出。

测试完成后可删除插件目录内的 `node_modules`；运行时不需要它，裸导入会由 DSH 的 app-boot 拦截到安装副本，确保与启动器共用同一份 `dsh-http-proxy` 状态。

## 文件

| 文件 | 作用 |
|---|---|
| `lib/index.js` | Cordis 插件入口、Config、命令与 Settings 接线 |
| `lib/controller.js` | 代理安装/卸载/重载队列、状态、测试 |
| `lib/command.js` | `/proxy` 解析、持久化、格式化 |
| `lib/config.js` | 配置读取、校验、脱敏、EnvLookup |
| `lib/client.js` | Web 设置页（lazy-CJS bundle） |
| `cordis.patch.yml` | bundle 形态的默认插入行 |
