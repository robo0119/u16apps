# U16 Apps Web版

iPhoneアプリ4つ(声のおこづかい帳・学習プランナー・ミス診断ノート・教科書音読チェッカー)のWeb版です。
HTML・CSS・JavaScriptだけで作っていて、外部ライブラリもサーバーのプログラムも使いません(QRコードも自作)。

## アプリとWebのつながり

| アプリ | アプリ → Web(「Webで共有」) | Web → アプリ(QRコード) |
|---|---|---|
| 声のおこづかい帳 `okozukai/` | 月のレポート(円グラフ・予算・表)を家族に見せる・印刷 | パソコンで入力した記録を取り込む。「アプリで声の記録」でアプリが開いてすぐ録音 |
| 学習プランナー `planner/` | 今日の計画・選んだ理由・使える時間・苦手度のレポート/今の設定をWebで編集 | 時間割・部活・テスト・成績をまとめて取り込む |
| ミス診断ノート `missnote/` | ミス診断レポート(写真なし)を先生に見せる・印刷 | 写真なしで書いた問題を取り込む |
| 教科書音読チェッカー `ondoku/` | 上達レポート(グラフ・よく読めない単語の発音) | 貼り付けた英文を「読む英文」に入れる |

## データの運び方(サーバーを使わない)

- データ → JSON → 圧縮(deflate-raw)→ base64url の文字にしてリンクに入れる
  - アプリ側:各アプリの `WebBridge.swift`、Web側:`common/bridge.js`(同じ手順)
- アプリ → Web:`https://(このサイト)/okozukai/#d=データ`
  - `#` より後ろはブラウザがサーバーに送らないので、データは見る人の端末の中だけで使われる
- Web → アプリ:`u16okozukai://import?d=データ` をQRコードにする → iPhoneのカメラで読むとアプリが開く
  - URLスキーム:`u16okozukai` `u16planner` `u16missnote` `u16ondoku`
- Webで入力したものは、そのブラウザの localStorage にだけ保存する

## パソコンで動かす

```
cd web
python3 -m http.server 8080
```

ブラウザで http://localhost:8080 を開く。iPhoneシミュレーターのSafariからも http://localhost:8080 で見られます。

## インターネットに公開する(例:GitHub Pages、無料)

1. GitHubで新しいリポジトリ(例:`u16apps`)を作り、この `web` フォルダの中身を入れる
2. リポジトリの Settings → Pages → Branch を `main` / `(root)` にして保存
3. 数分後に `https://あなたの名前.github.io/u16apps/` で見られる
4. 各アプリの「Web連携」画面の「WebサイトのURL」に、そのURLを入れる

## 声の入力について

Webの声の入力(おこづかい帳・音読)はブラウザの機能(Web Speech API)を使います。Chromeでは声がGoogleのサーバーに送られます。
iPhoneアプリは、できるときはiPhoneの中だけで認識するので、声の記録はアプリをおすすめします。
