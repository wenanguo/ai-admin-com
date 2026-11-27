# dsh 独立项目（issue #183）

> **一个能自己装起来的 DeepSeek Harness（dsh）项目** —— 不依赖 AiAdmin 的业务系统。
> 新人 / 别的团队照着下面的步骤走一遍，就能跑起 dsh、连上 MiniMax、聊起来。

（本文档还在补全 ⇒ 见 `docs/minimax.md` 与 `../../docs/notes/2026-11-28-dsh-独立项目化.md`。）

## 30 秒速览

```bash
cd dsh
npm ci                          # 装依赖（自己的 lock ⇒ 不进本仓依赖树）
cp .env.example .env            # 填 MiniMax 的 key（**只在你机器上**）
npm run doctor                  # 自检：还差什么会列出来
npm run bootstrap               # 建 profile + 装外部插件
npm run chat -- "用一句话回答：1+1 等于几？"
```

## 它是什么

| | |
| --- | --- |
| **自己的依赖** | `dsh/package.json` + `dsh/package-lock.json`（**不进本仓依赖树**） |
| **自己的 profile** | `$STANDALONE_HOME/profiles/standalone`（一个独立的 pnpm 工程） |
| **自己的镜像** | `dsh/Dockerfile` |
| **外部插件** | 本仓的插件**按 `file:` 引用**装进 profile（**不复制源码**） |
| **凭据** | **只走环境变量** ⇒ 仓库里搜不到密钥 |
