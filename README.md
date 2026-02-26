# LINE Mini App × MCP Server Template

LINE Login + Supabase で認証するリモートMCPサーバーのテンプレートです。
Cloudflare Workers 上で動作し、Claude Desktop などの MCP Host からあなたのサービスのデータにアクセスできるようにします。

## 仕組み

```
MCP Host (Claude Desktop等)
    ↕  OAuth 2.0 (access_token + refresh_token)
Cloudflare Workers (OAuthProvider + McpAgent)
    ↓  LINE Login (認証時のみ)
LINE Login → Supabase Auth → あなたのDB (RLS適用)
```

1. MCP Host が接続 → OAuth フローが開始
2. ユーザーが LINE Login で認証
3. Supabase に signInWithPassword でログイン（RLS が自動適用）
4. MCP トークン発行 → 以降は自動更新

## セットアップ

### 前提条件

- [LINE Developers Console](https://developers.line.biz/) で LINE Login チャンネルを作成済み
- [Supabase](https://supabase.com/) プロジェクトを作成済み
- ユーザーが LINE ID ベースの email/password で Supabase に登録される仕組みがある

### 1. テンプレートを使う

```bash
# リポジトリをクローン
git clone https://github.com/Yongtae723/line-miniapp-mcp-template.git my-mcp-server
cd my-mcp-server

# 依存インストール
npm install
```

### 2. 環境変数を設定

```bash
# .dev.vars を作成（ローカル開発用シークレット）
cp .dev.vars.example .dev.vars
# → 各値を自分の環境に合わせて編集
```

### 3. wrangler 設定を編集

`wrangler.jsonc` と `wrangler.prod.jsonc` の以下を変更：

- `name`: Worker 名
- `SUPABASE_URL`: あなたの Supabase URL
- `SUPABASE_ANON_KEY`: あなたの Supabase anon key
- Durable Object の `class_name`: `MyMCP` のまま、またはリネーム

### 4. カスタマイズ

#### ツールを追加する

`src/tools/` にファイルを作成し、`src/index.ts` と `src/index.dev.ts` で登録：

```typescript
// src/tools/my-tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export function registerMyTool(
  server: McpServer,
  getClient: () => Promise<SupabaseClient | null>,
  getUserId: () => string,
) {
  server.tool(
    "my_tool",
    "ツールの説明",
    { param1: z.string().describe("パラメータの説明") },
    async ({ param1 }) => {
      const client = await getClient();
      if (!client) {
        return { content: [{ type: "text", text: "Auth error" }] };
      }

      const { data, error } = await client
        .from("your_table")
        .select("*")
        .eq("user_id", getUserId());

      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );
}
```

```typescript
// src/index.ts の init() に追加
import { registerMyTool } from "./tools/my-tool";

// init() 内:
registerMyTool(this.server, getClient, getUserId);
```

#### 認証ロジックを変更する

`src/supabase-client.ts` の email/password 生成ロジックを、あなたのサービスに合わせて変更してください。

#### 承認ダイアログを変更する

`src/line-handler.ts` の `renderApprovalDialog` に渡す `server.name`, `server.description`, `server.logo` を変更してください。

### 5. ローカル開発

```bash
# OAuth 付きで起動（LINE Login 必要）
npm run dev

# OAuth なしで起動（ツールテスト用）
npm run dev:noauth
# → npx @modelcontextprotocol/inspector --url http://localhost:8788/mcp
```

#### フル OAuth フローをローカルでテスト

```bash
# 1. wrangler dev 起動
npm run dev

# 2. HTTPS トンネル作成
cloudflared tunnel --url http://localhost:8788

# 3. LINE Developers Console で Callback URL を登録
#    https://<tunnel-url>/callback

# 4. Claude Desktop の設定に追加
#    "command": "npx", "args": ["mcp-remote", "https://<tunnel-url>/mcp"]
```

### 6. デプロイ

```bash
# KV namespace 作成
npx wrangler kv namespace create OAUTH_KV
# → 出力された id を wrangler.prod.jsonc に設定

# シークレット設定
npx wrangler secret put LINE_CHANNEL_ID
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put COMMON_PASSWORD_PREFIX
npx wrangler secret put COOKIE_ENCRYPTION_KEY  # openssl rand -hex 32

# デプロイ
npm run deploy:prod

# LINE Developers Console で Callback URL を登録
# https://your-mcp-server.<subdomain>.workers.dev/callback
```

## ファイル構成

```
├── src/
│   ├── index.ts                # エントリポイント (OAuthProvider + McpAgent)
│   ├── index.dev.ts            # 開発用エントリポイント (OAuth バイパス)
│   ├── line-handler.ts         # LINE Login OAuth フロー (Hono)
│   ├── utils.ts                # LINE OAuth ヘルパー + Props 型
│   ├── workers-oauth-utils.ts  # CSRF, state, session 管理
│   ├── supabase-client.ts      # Supabase 認証
│   └── tools/
│       └── hello.ts            # サンプルツール（これを置き換える）
├── wrangler.jsonc              # ローカル開発設定
├── wrangler.noauth.jsonc       # OAuth なし開発設定
├── wrangler.prod.jsonc         # 本番デプロイ設定
├── .dev.vars.example           # シークレットのテンプレート
├── worker-configuration.d.ts   # Env 型定義
├── tsconfig.json
└── package.json
```

## 関連記事

- [LINE Mini App で動くレシピサービスの MCP サーバーを作ってみた](TODO)

## License

MIT
