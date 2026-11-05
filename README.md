# WorldSim

WorldOS風のAI駆動の世界シミュレーション（自分専用・ブラウザ・0円）。
世界：第二次世界大戦 / ホグワーツ。

- 設計：[docs/plan.md](docs/plan.md)
- Claude Code向け指示：[CLAUDE.md](CLAUDE.md)

## 開発

```bash
npm install
npm run dev      # 開発サーバー
npm test         # エンジンのテスト（10ターン矛盾なしの関門を含む）
npm run build    # 本番ビルド（GitHub Pages向けは BASE_PATH=/worldsim/ npm run build）
```

- 設定画面で接続先を「テスト（AIなし）」にすると、無料枠を使わずに画面を確かめられる
- 世界パックは `src/worlds/<id>/pack.json` に置くだけで読み込まれる（`sample` は動作確認用）
