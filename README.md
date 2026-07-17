# HootoDay

HootoDayは、スケジューラーと健康記録を統合する、完全な個人利用専用アプリです。配布、一般公開、複数ユーザー対応、ストア公開は予定していません。

## 現在の開発段階

Phase 0（初期環境と仕様記録）です。React + TypeScript + Viteの初期ひな型を作成し、今後の開発方針と仕様を記録しています。

## 使用技術

- React `^19.2.7`
- React DOM `^19.2.7`
- TypeScript `~6.0.2`
- Vite `^8.1.1`
- Oxlint `^1.71.0`

## 開発コマンド

PowerShellでは、実行ポリシーの影響を避けるため`npm`ではなく`npm.cmd`を使用します。

### 開発サーバー

```powershell
npm.cmd run dev
```

### ビルド

```powershell
npm.cmd run build
```

### lint

```powershell
npm.cmd run lint
```

詳細な仕様、開発方針、予定しているPhaseは[PROJECT_NOTES.md](./PROJECT_NOTES.md)を参照してください。
