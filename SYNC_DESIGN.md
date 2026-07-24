# HootoDay 同期設計

## B-3f5e5 recovery-required local-only adapter

- Scope is exactly one date classified `local_only` by a fresh saved-recovery check. Preparation repeats a complete read-only pull and rejects remote active/tombstone appearance or any local, metadata, cursor, pending, intent, or push-block drift.
- `DayMemoPendingOperationV5` adds `operationMode: local_only_recovery` without changing metadata version. Its formal base is revision 0, change sequence 0, remote state `missing`, and remote updated time null; existing v5 data remains valid.
- An operation ID is generated once after explicit preparation confirmation and persisted/read back before RPC. The existing upsert RPC is called at most once for a valid preflight snapshot.
- Recovery preflight supports the existing active base for body mismatch and the proved missing base for local-only. A newly appearing active record or tombstone blocks the send.
- Applied RPC results retain pending as `recovery_required`; conflict, malformed result, or response unknown keep recovery evidence and never retry automatically.
- Existing operation-result read and post-send verification require applied history, active current remote, exact local payload, revision/sequence/timestamp agreement, and target reclassification to `exact_match_baseline_missing`.
- Atomic save adds only the target active baseline, advances cursor to the verified complete-pull maximum, and clears pending together. Other differences remain unresolved, so recovery status and null confirmation time continue.

## B-3f5eUI1 recovery UI navigation

- Sync logic and recovery UI navigation are separate responsibilities. New sync phases connect existing results, availability, eligibility, handlers, and discard lifecycles to the current-work navigator instead of adding another normal-view panel.
- The normal settings view has three layers: a concise sync-status summary, one current recovery step, and closed-by-default details/diagnostics. Completed and unrelated historical results remain diagnostic information and never select the next action.
- `SyncRecoveryUiStage` is React-derived UI state only. It is not stored in metadata and does not replace existing safety classifications, pending statuses, operation modes, or snapshot lifecycles.
- Stage selection uses validated metadata, pending kind/mode/status, the current saved recovery-state result, unresolved classifications, push block and intent presence, and existing snapshot availability. Object identity and render timing do not select a stage.
- Panel visibility is independent from button eligibility: the current step remains visible when its existing `canExecute` condition is false, with a disabled button and a safe reason. ThemeSettings does not reconstruct a write candidate or bypass an existing confirmation dialog.
- The local-only recovery step uses the date recommended by the fresh saved recovery-state result and calls the existing B-3f5e5 preparation handler. It never routes `remote_only_active` into a local-only handler.
- UI consolidation does not consume snapshots or mutate metadata, pending, DayMemo, baseline, cursor, intent, or remote data. Existing fail-closed safety remains authoritative.

## B-3f5e6 recovery remote-only active adoption

- This is a thin recovery adapter for one `remote_only_active` item selected by the current saved-recovery result. It does not reuse the normal conflict adoption precondition because that path requires `confirmed`, a conflict snapshot, and pending/intent evidence and would finalize metadata as confirmed.
- Candidate confirmation performs one explicit complete full pull and requires local absence, one canonical active remote, no target baseline, cursor equality, and no unrelated unresolved difference. Tombstones and any changed or unknown state are rejected.
- The React-only candidate snapshot binds the workspace, source metadata/local raw values, remote revision/sequence/timestamp/payload, and completed local candidate. No identifier or payload is shown in the normal summary.
- Explicit local adoption performs no additional pull. It rechecks source state, saves a backup, writes the completed DayMemo array with verified read-back, and relies on verified rollback to restore the original target absence on failure.
- A separate explicit post-adoption full pull proves the remote snapshot is unchanged, reclassifies every date, and builds a validated metadata v5 candidate. A final explicit save writes the active baseline and cursor together using compare-and-write/read-back while retaining null pending, `recovery_required`, and null confirmation time.
- No remote write RPC, operation ID, pending operation, metadata version, SQL, RLS, automatic retry, automatic pull, automatic adoption, batching, or automatic transition to `confirmed` is introduced.

## B-3f5e7 final confirmation and normal-sync readiness

- Finalization is available only from a fresh zero-difference saved recovery result. Before its one explicit full pull it revalidates metadata v5, workspace and React/storage equality, `recovery_required`, null confirmation time, null pending, no intent, no push block, valid baselines, and valid cursor.
- The same complete pull validates remote records, proves cursor equality, and classifies the union of local, remote, and baseline dates. Every date must be `exact_match_baseline_confirmed`; no expected count or sequence is hard-coded.
- The candidate snapshot is React-only and binds source metadata/local raw values, workspace, verified baselines/cursor, final full-pull sequence, confirmation time, and the whole validated metadata candidate. UI inspection does not consume it.
- After separate explicit confirmation, source state and candidate validity are rechecked without another pull. The snapshot is consumed immediately before compare-and-write. Baselines, cursor, `confirmed`, confirmation time, and null pending are written as one metadata v5 object, followed by strict read-back or verified rollback.
- Successful save updates React metadata only from verified storage. A separate explicit complete pull is required to report `normal_sync_ready`; saving does not automatically pull, send, retry, merge, repair, or start normal synchronization.

## B-3f5e8 confirmed v5 normal local-only routing

- `useDayMemoNormalDifferenceRecoveryPlan` is a recovery-only diagnostic. It is available only for validated metadata v5 whose baseline status is `recovery_required`; it must not be used as the normal confirmed local-only entry point.
- Recovery-plan results report the validated metadata's actual version. No fixed v4 presentation value or pre-migration result is authoritative after v5 migration or confirmed restoration.
- In confirmed v5, normal local-only detection uses the existing local-only preview: stored v5 baselines exclude the nine confirmed dates, and only a local date with no baseline and no active/tombstone remote may become the single normal upload candidate.
- The integrated UI delegates to the existing normal local-only preflight, preparation, and explicit send handlers. The pending remains `operationMode: normal`; successful upsert adds one active baseline, advances cursor, clears pending, and retains confirmed readiness.
- No recovery checkpoint, baseline rebuild, recovery operation mode, metadata migration, SQL/RPC change, automatic pull, automatic retry, or automatic send is introduced.

## 1. 文書の位置付け

この文書は、HootoDayのPC親機とiPhone子機の間で保存データを安全に同期するための正式設計である。同期実装は段階的に導入し、既存のlocalStorage単体動作、localStorageの各`version: 1`形式、JSONバックアップ`formatVersion: 2`および旧`formatVersion: 1`の復元互換を維持する。

本設計時点ではSupabaseライブラリ、SQL、同期UI、環境変数、Service Workerを実装しない。

## 2. 基本方針

- localStorageを各端末の正式な保存先として維持する。
- SupabaseはPCとiPhoneの差分を受け渡す同期媒体として使用する。
- アプリ起動時にクラウドだけを正としてローカル全体を即時上書きしない。
- 同期に失敗しても、ローカルでの入力、閲覧、編集、削除を継続できる。
- 同期はレコード単位の差分で行い、データ種別ごとに段階的に有効化する。
- 最初の同期対象は`DayMemo`だけとし、手動同期で安全性を検証する。
- `hootoDay.theme`、選択日、表示月、dialog、検索条件などの端末・画面状態は同期しない。
- Service Worker、バックグラウンド同期、自動同期、オフライン送信キューは後続Phaseとする。
- ブラウザではanon keyだけを使用し、service role keyを配置しない。
- anon keyの公開を前提とし、RLSによって所属していないworkspaceのデータを読めない構造にする。
- 同期導入によって既存localStorageデータへクラウド専用メタデータを大量に混在させない。

## 3. workspace・member・device

### 3.1 workspace

workspaceはHootoDayデータの共有単位である。

- ユーザー本人のPCとiPhoneは同じworkspaceへ所属する。
- workspaceは`app_id`を持ち、HootoDayの識別子は`hooto_day`とする。
- HootoPost・HootoSongと同じSupabaseプロジェクトを使用しても、`app_id`とworkspaceでデータを分離する。
- 異なるアプリの同期レコードを同一workspaceとして混在させない。
- workspaceの作成、所有者設定、削除は通常の公開INSERT/DELETEへ任せず、安全なRPCまたは本人所有条件で制御する。

### 3.2 member

memberはSupabase Authの匿名ユーザーとworkspaceの所属関係を表す。

- `auth.uid()`をworkspaceへ紐付ける。
- roleは最低限`owner`と`member`を持つ。
- 最初に設定するPCをownerとする。
- ペアリングしたiPhoneをmemberとする。
- 個人利用でも、RLS判定と端末接続解除を安全に行うためmember構造を維持する。
- member追加は公開INSERTを許可せず、ペアリングRPCだけが行う。

### 3.3 device

deviceは同期履歴の確認と端末識別に使用し、権限の根拠にはしない。

- PCとiPhoneを区別する`device_id`を端末内で生成する。
- 将来のlocalStorageキーは`hootoDay.syncDeviceId`とする。
- `device_name`は「自宅PC」「iPhone」などの任意表示名とする。
- 権限判定は常に`auth.uid()`とworkspace memberで行う。
- `device_id`は同期レコードの発生元、監査、再送調査に使用する。
- 今回はキーもdeviceも実装しない。

## 4. 匿名ログインとペアリング

### 4.1 PC親機

1. Supabaseへ匿名ログインする。
2. `app_id = hooto_day`のworkspaceを作成する。
3. ログイン中の`auth.uid()`をowner memberとして登録する。
4. ownerだけが短時間有効なペアリングコードを発行する。
5. 表示されたコードをiPhoneへ入力する。

### 4.2 iPhone子機

1. PCとは別の匿名ユーザーとしてログインする。
2. ペアリングコードを入力する。
3. security definer RPCでコードを検証する。
4. RPC内でiPhoneの`auth.uid()`を同じworkspaceのmemberへ追加する。
5. コードを使用済みにして即時無効化する。
6. RLSの範囲内で同じworkspaceのHootoDayデータを同期できるようにする。

### 4.3 ペアリングコード

- 文字数は8文字を標準とし、6～8文字の範囲を許容する。
- 文字集合は`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`とし、`I`、`O`、`0`、`1`など紛らわしい文字を除く。
- DBには平文を保存せず、十分なランダム性を持つコードのhashだけを保存する。
- 有効期限を短時間に限定する。
- 一度だけ使用可能とし、使用成功時に同一トランザクションで無効化する。
- ownerだけが発行・失効できる。
- RPCで試行回数、期限、使用済み状態、対象アプリ、発行workspaceを検証する。
- 総当たり対策として短時間の試行制限、失敗回数記録、連続失敗時の一時拒否を設ける。
- コードやhashをログ、エラー文、URLへ出さない。

## 5. 初回同期の最重要規則

**空のiPhoneが、データ入りPCを空で上書きしてはならない。**

### 5.1 クラウドが空、PCにデータ、iPhoneが空

- ownerのPCデータを初回アップロードする。
- iPhoneはアップロード完了後にクラウドから取得する。
- iPhoneの空配列を削除や全置換として送信しない。

### 5.2 クラウドにデータ、端末ローカルが空

- クラウドをローカルへ取得する。
- 空のローカル状態をクラウド削除として扱わない。

### 5.3 クラウドとローカルの両方にデータがある

- 自動的な全置換を行わない。
- 初回同期方向と差分件数を表示し、レコード単位で比較する。
- DayMemoは日付単位で同一・片側のみ・競合を分類する。
- 競合があれば同期結果の確定前にユーザーへ選択させる。

### 5.4 全データ初期化後

- ローカルが空になった事実だけでクラウド全削除を行わない。
- 「この端末のデータを初期化」と「workspaceのクラウドデータも削除」を別操作にする。
- クラウド全削除には二重確認と再認証相当の確認を要求する。

### 5.5 JSONバックアップ復元後

- 復元直後のデータを自動でクラウド全置換しない。
- 次回同期前に差分プレビューを表示する。
- 復元データを反映する場合も、レコード単位のupsertとtombstoneで処理する。

## 6. 採用するテーブル方式

### 6.1 比較

#### A：データ種別ごとの個別テーブル

例：`hooto_day_memos`、`hooto_day_events`、`hooto_day_weight_records`

利点：

- DB制約と列型で各データを強く検証できる。
- SQL集計や個別データ調査が分かりやすい。
- TypeScript型とDB列を対応させやすい。

欠点：

- 15種類以上についてテーブル、RLS、RPC、差分取得処理を繰り返し作る必要がある。
- 今日中のDayMemoパイロットまでの準備量が多い。
- 共通のrevision、tombstone、再送制御が分散する。

#### B：共通同期テーブル

例：`hooto_day_sync_records`

利点：

- revision、tombstone、差分取得、RLS、再送制御を一元化できる。
- DayMemoから他データへ段階的に広げやすい。
- 無料枠でテーブルやRealtime設定を増やしすぎない。
- 同じ同期エンジンと監査方法を再利用できる。

欠点：

- `payload`の型安全性をDB列だけでは保証できない。
- 種別ごとのバリデーションをTypeScriptとRPCで厳格に行う必要がある。
- SQLでの業務集計には向かない。
- 在庫・販売のような整合性が重要な処理には不十分である。

### 6.2 正式採用

Phase 2～4の一般データには**Bの共通同期テーブル方式**を採用する。

採用理由は、DayMemoで安全な同期試験へ進みやすく、15種類以上へ同期エンジンを再利用でき、RLS・revision・tombstoneを共通化できるためである。型安全性は`entity_type`ごとのTypeScript validator、送信前検証、受信後検証、許可されたentity_typeのDB制約で補う。不正payloadはlocalStorageへ反映せず、同期エラーとして隔離する。

在庫・販売系は、共通テーブルへ安易に追加しない。Phase 5でトランザクション、冪等性、売上修正を設計し、専用テーブルと台帳方式を採用する。A方式を一般データへ今すぐ採用しない理由は、初期工数とRLSの重複が大きく、パイロットの検証範囲を広げるためである。

## 7. 共通同期レコード

`hooto_day_sync_records`は少なくとも次の項目を持つ。

| 項目 | 役割 |
|---|---|
| `workspace_id` | 所属workspace。RLSと一意制約の境界に使う |
| `entity_type` | `day_memo`などデータ種別を表す許可済み識別子 |
| `entity_id` | 既存ローカルID。DayMemoだけは1日1件のため`date`を使用 |
| `payload` | 既存ローカルレコード本体を保持するJSON |
| `client_updated_at` | 端末が記録した更新日時。表示・調査用であり単独の勝敗判定には使わない |
| `server_updated_at` | DB側で設定する更新日時。差分取得と監査に使う |
| `deleted_at` | tombstone。nullでなければ削除済み |
| `updated_by` | 更新した`auth.uid()` |
| `source_device_id` | 更新元端末。権限ではなく監査と再送調査に使う |
| `revision` | サーバーが単調増加させるレコード単位の版番号 |

追加原則：

- 一意制約は`workspace_id + entity_type + entity_id`とする。
- 同じ送信の再試行で重複しないよう、同一entityへのupsertと操作IDによる冪等性を用いる。
- `server_updated_at`、`revision`、`updated_by`はクライアント任意値を信用せずDBで設定する。
- payloadへworkspace、revision、削除状態などのクラウド専用情報を重複保存しない。
- pullしたpayloadは既存の各storage validator相当で検証してからlocalStorageへ反映する。

## 8. DayMemo同期パイロット

### 8.1 現行型との対応

実コードの`DayMemo`は次の3項目である。

- `date: string`
- `content: string`
- `updatedAt: string`

独立した`id`はないため、`entity_type = day_memo`、`entity_id = date`（`YYYY-MM-DD`）を正式仕様とする。payloadは既存の`DayMemo`そのものとし、localStorageの`hootoDay.dayMemos`、`version: 1`、`memos`配列を変更しない。

### 8.2 ローカル変更の扱い

- 新規・編集：同じ日付を同じentityとしてupsert候補にする。
- 空欄保存による削除：ローカル配列から除外し、同期層では同じentityのtombstone候補として記録する。
- JSON復元：自動pushせず、次の手動同期で差分プレビューを要求する。
- 全初期化：自動で全tombstoneを作らず、端末初期化状態として扱う。
- 同期層が未実装・未接続でも既存保存処理はそのまま動作する。

### 8.3 手動同期

最初は設定画面の「同期する」操作だけで同期する。

1. 同期開始時点のDayMemo localStorage値をメモリまたは一時バックアップとして保持する。
2. 前回同期状態と現在のローカルを比較し、変更・削除候補を収集する。
3. 各変更を`base_revision`付きでクラウドへpushする。
4. 最終同期位置以降のレコードとtombstoneをpullする。
5. entity_id単位でローカル・クラウド・前回同期状態を3-way mergeする。
6. 統合結果を既存DayMemo validatorで検証する。
7. 競合がなければ`replaceDayMemos`相当でlocalStorageへ保存する。
8. 成功後だけ同期位置と同期状態を更新する。

通信、認証、検証、競合解決に失敗した場合は、同期開始前のlocalStorageを変更しない。候補キーは次のとおりとし、今回は追加しない。

- `hootoDay.syncCursor`：最後に正常取得したサーバー差分位置
- `hootoDay.syncState`：entityごとの最後に確認したrevision、内容hash、削除状態

## 9. revisionと競合規則

### 9.1 revision

- 各同期レコードはサーバー管理の整数`revision`を持つ。
- 初回作成はrevision 1とする。
- 端末は最後に同期したrevisionを`base_revision`として更新RPCへ送る。
- 現在revisionとbase revisionが一致した場合だけ更新し、成功時にrevisionを増やす。
- 不一致なら上書きせず競合として返す。
- 端末時計の`updatedAt`や`client_updated_at`だけで勝敗を決めない。
- 同じ操作IDと内容の再送は成功済み結果として扱い、revisionを重複して増やさない。

### 9.2 今日のパイロットでの最小安全規則

- 片側だけが前回同期内容から変化した場合は、その変更を採用する。
- 両側が同一内容へ変化した場合は競合なしとして統合する。
- 両側が別内容へ変化した場合は自動上書きせず競合一覧へ出す。
- 削除と未変更が競合した場合は削除を採用する。
- 削除と編集が競合した場合は自動決定せず、削除版と編集版の両方を提示する。
- 競合が1件でも未解決なら、そのentityをlocalStorageへ上書きしない。
- 同期前バックアップから復旧可能にする。

### 9.3 最低限扱うケース

| 状況 | 処理 |
|---|---|
| PC編集、iPhone未変更 | PC版を採用 |
| iPhone編集、PC未変更 | iPhone版を採用 |
| 同じ日を別内容へ編集 | 競合として両方を保持 |
| PC削除、iPhone編集 | 削除対編集の競合 |
| iPhone削除、PC未変更 | tombstoneを採用 |
| 端末時計のずれ | revision基準のため時計だけで上書きしない |
| 同じ操作を再送 | 操作IDで冪等に処理 |
| オフライン中に複数回編集 | 端末内の最終ローカル内容を1候補とし、base revisionからの差分として送る |

### 9.4 将来の正式競合解決

- 競合一覧で日付、端末、更新日時、双方の本文を表示する。
- 「PC版を採用」「iPhone版を採用」「内容を編集して統合」を選べるようにする。
- 解決時は最新revisionをbaseとして新revisionを作成する。
- 競合解決履歴を監査可能にする。
- DayMemoは黙ってlast-write-winsにしない。

## 10. 削除とtombstone

- DBから同期レコードを即時物理削除しない。
- 削除はpayloadの空データ化ではなく`deleted_at`設定とrevision増加で表す。
- pullは通常レコードとtombstoneの両方を含む。
- 新しいtombstoneを受信した端末は同じentity_idのローカルDayMemoを削除する。
- 古い端末が削除前revisionを基に再送した場合は競合とし、復活させない。
- DayMemoの空文字保存による削除は、ローカルでは既存どおり配列から除外し、同期時には同じ日付entityのtombstoneとして送る。
- tombstoneの保持期間は最低90日を初期候補とし、全登録端末の同期状況を確認できるまでは物理削除しない。
- 期限後の物理削除は将来の保守処理とし、クライアントから直接実行しない。

## 11. RLS

- Supabaseの`authenticated` roleを使用する。匿名ログインユーザーも`auth.uid()`を持つ。
- workspace memberだけが所属workspaceをSELECTできる。
- workspace memberだけが、そのworkspaceの許可されたHootoDay同期レコードをINSERT・UPDATEできる。
- RLSは`workspace_id`、memberの`user_id = auth.uid()`、`app_id = hooto_day`を検証する。
- member追加の公開INSERT policyを作らない。
- ペアリングはsecurity definer RPC経由に限定する。
- workspace作成も安全なRPC、または作成者本人をownerにする原子的な処理で行う。
- ownerだけがペアリングコードを発行・失効できる。
- 他workspaceのUUIDを知っていても読み書きできない。
- 同期レコードのDELETE policyは原則作らず、`deleted_at`更新を使う。
- security definer関数は`search_path`を固定し、対象schemaを明示する。
- RPC内で`auth.uid()`、workspace所属、role、app_id、有効期限を必ず再検証する。
- service role keyを前提にしたブラウザ処理を作らない。

## 12. Supabaseテーブル候補

### 12.1 候補

- `app_workspaces`
- `app_workspace_members`
- `app_pairing_codes`
- `app_devices`
- `hooto_day_sync_records`

### 12.2 共通テーブルと専用テーブル

HootoPost・HootoSongですでに安全な`app_workspaces`、`app_workspace_members`、`app_pairing_codes`、`app_devices`相当が存在し、app_id分離と必要なRLSを満たす場合は共通利用を優先する。認証・ペアリングの重複実装を避けられるためである。

ただし、既存テーブルの列、制約、RLS、RPCが本設計を満たさない場合は勝手に変更せず、HootoDay専用名を検討する。同期payloadはアプリ固有であるため、`hooto_day_sync_records`を専用テーブルとする。

次のSQL Phaseでは、同名テーブル、RPC、RLS、schema、migration履歴を先に読み取り確認する。既存テーブルの削除、再作成、列変更、policy置換は事前バックアップと明示的な移行計画なしに行わない。

## 13. 同期Phase

### Sync Phase 1：接続基盤

実装範囲：Supabase client、匿名認証、workspace、member、device、ペアリング、RLS、同期設定画面。データ同期は行わない。

完了条件：

- service roleなしでPCとiPhoneが別の匿名user idを取得できる。
- PCがowner、iPhoneがmemberとして同じHootoDay workspaceへ所属できる。
- 他workspaceをSELECT/INSERT/UPDATEできないRLSテストが成功する。
- ペアリングコードが期限、1回限り、owner限定で機能する。
- 接続失敗時も既存localStorage操作が継続する。

### Sync Phase 2：DayMemo手動同期

実装範囲：DayMemo push/pull、初回同期保護、revision、tombstone、検証、エラー表示。

完了条件：

- 空のiPhoneがPCのDayMemoを消さない。
- PC/iPhone双方の新規・編集・削除が手動同期で反映される。
- 同時編集と削除対編集が自動上書きされず競合になる。
- 同期失敗時にlocalStorageが同期開始前の状態を保つ。
- 再送で重複レコードを作らない。

### Sync Phase 3：予定・実績

対象：`DailyAchievement`、`MonthlyAchievementSelection`、`CalendarEvent`。

完了条件：

- entity IDと参照関係を維持して同期できる。
- 月のベスト参照先を削除した場合を安全に処理できる。
- 予定の日付移動、編集、削除が復活や重複なしで同期できる。

### Sync Phase 4：健康記録

対象：`HealthProfile`、`WeightRecord`、`SleepRecord`、`MealRecord`、`MealTemplate`、`ExerciseSession`、`DailyConditionRecord`。

完了条件：

- 1日1件型、複数件型、singleton型を区別して同期できる。
- 食事定型の並び順競合を検出できる。
- 保存済みの推定値を勝手に再計算しない。
- 健康内容をログや不要な通知へ出さない。

### Sync Phase 5：在庫・販売

対象：`Product`、`InventoryMovement`、`EventSalesRecord`、`BoothSalesRecord`。

完了条件：

- 専用テーブルと在庫台帳のトランザクション設計が完了する。
- 同じ販売確定の再送が在庫を二重に減らさない。
- 売上修正、取消、サンプル配布を監査可能な差分として扱える。
- PC/iPhone同時操作で負在庫や二重計上を発生させない。

### Sync Phase 6：自動同期と保守

実装範囲：自動同期、オフラインキュー、Service Worker連携検討、競合解決UI、tombstone保守。

完了条件：

- 再接続時に安全に再送できる。
- バックグラウンド処理がlocalStorage単体動作を妨げない。
- 競合をユーザーが確認・解決できる。
- tombstone物理削除前に未同期端末を保護できる。

## 14. 同期設定UI

将来、既存設定画面へ次を追加する。

- 同期状態：未接続、接続済み、同期中、エラー、競合あり
- 端末役割：PC親機、iPhone子機
- workspace接続状態
- 最終同期日時
- 現在の同期対象データ
- 「今すぐ同期」
- ペアリングコード発行
- ペアリングコード入力
- 接続解除
- 同期エラー概要
- 競合件数と競合確認入口

安全原則：

- 接続解除でlocalStorageデータを削除しない。
- 端末の接続解除とworkspace削除を分ける。
- クラウド全削除は二重確認する。
- 初回同期前に方向を明示する。
- 「PCからクラウドへ送る」「クラウドからこの端末へ受け取る」を区別する。
- 自動推測だけで危険な全置換を実行しない。
- 同期対象と同期されないtheme・画面状態を表示する。

## 15. 環境変数

将来使用する変数名は次の2つだけとする。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

値は`.env.local`へ保存し、Git管理しない。`.env.example`には値を入れず変数名だけを記載する。anon keyは公開される前提でRLSを必須とする。service role用の環境変数は作らない。URLやkeyを`PROJECT_NOTES.md`やソースコードへ貼らない。今回は環境変数ファイルを作成しない。

## 16. 既存保存・バックアップとの互換

- localStorageの構造化データ15キーはすべて既存の`version: 1`を維持する。
- `hootoDay.theme`は同期対象外とし、端末ごとの設定を維持する。
- JSONバックアップの`formatVersion: 2`を変更しない。
- 旧`formatVersion: 1`の復元互換を維持する。
- 同期用候補キーは現行JSONバックアップ対象へ自動追加しない。
- JSON復元と全初期化をクラウド全置換・全削除へ直結させない。
- Supabase障害、未設定、未接続でも既存HookとlocalStorageだけで動作できる。

## 17. 実装前チェックリスト

- [ ] 既存Supabaseテーブルを確認した
- [ ] 既存RPCを確認した
- [ ] 既存RLS policyを確認した
- [ ] HootoPost・HootoSongとの名前衝突を確認した
- [ ] app識別子`hooto_day`を確定した
- [ ] 一般データは共通同期テーブル、在庫は後続専用設計と確定した
- [ ] 初回同期で空端末が既存データを消さない規則を確定した
- [ ] tombstoneの形式と保持期間を確定した
- [ ] revision、base revision、操作IDの方式を確定した
- [ ] pairing codeの文字数、hash、有効期限、試行制限を確定した
- [ ] 既存localStorageを変更しないことを確認した
- [ ] JSON formatVersion 2と旧v1互換を維持することを確認した
- [ ] 既存SQLのバックアップ方法を確認した
- [ ] rollback SQLを準備した
- [ ] PC側で最新JSONバックアップを取得した
- [ ] iPhone側に同期前データがあるか確認した
- [ ] RLSの他workspace拒否テストを準備した
- [ ] service roleをフロントエンドで使用しないことを確認した

## 18. 既存基盤調査後の決定

hooto-platformの既存構造を確認した結果、当初の共通同期設計を次の具体構成で実装する。

- `app_workspaces`、`app_workspace_members`、`app_pairing_codes`と既存workspace/pairing RPCは、署名と挙動を変更せず接続基盤として流用する。
- 既存RPCはauthenticated限定、SECURITY DEFINER、search_path固定、`auth.uid()`検証ありと確認した。
- `app_workspace_state`は全体JSON単位の競合と既存key衝突の危険があるため、HootoDay同期本体には使用しない。
- 一般同期データは新規`hooto_day_sync_records`へ保存し、初期は`entity_type = day_memo`だけを許可する。
- DayMemoは`entity_id = YYYY-MM-DD`とし、revision、base revision、tombstone、operation idによるレコード単位同期を行う。
- 同期レコードのSELECTはworkspace member限定とし、INSERT・UPDATE・削除はclientの直接操作ではなく専用RPC経由とする。
- `current_hooto_sync_key_hash()`はHootoPost系の旧方式候補であり、HootoDayでは使用せず変更しない。
- pairing codeはパイロットでは既存形式を維持し、`used_by`監査、app識別、試行制限、入力しやすいcode形式は後方互換なv2 RPCで後日改善する。
- `app_devices`はDayMemoパイロットの必須要素とせず後回しにする。
- app識別子が既存workspaceにないため、パイロットではHootoDay専用workspaceを新規作成して既存HootoSong workspaceを再利用しない。正式には追加metadataとv2 RPCによるapp key検証を候補とする。
- 在庫・販売は`hooto_day_sync_records`へ入れず、後続Phaseで専用トランザクションを設計する。
- 次のSQL Phaseでは既存オブジェクトを変更せず、新規HootoDay専用テーブル・RPC・policyとrollback SQLだけを作成する。

詳細な比較、リスク、停止条件は`SUPABASE_REUSE_DECISION.md`を正式判断書とする。

## 19. HootoDay専用同期SQLの確定構成（適用済み・構造検証済み）

専用同期SQLは`SUPABASE_HOOTO_DAY_SYNC_PRECHECK.sql`、`SUPABASE_HOOTO_DAY_SYNC_APPLY.sql`、`SUPABASE_HOOTO_DAY_SYNC_ROLLBACK.sql`、`SUPABASE_HOOTO_DAY_SYNC_VERIFY.sql`の4ファイルとする。2026年7月19日にJSONバックアップと適用前PRECHECKを保存したうえでAPPLYを実行し、構造VERIFYと適用後PRECHECK比較まで完了した。rollbackは未実行である。

- PRECHECKは明示的なread-only transactionで、共通4テーブルについて存在、詳細カラム属性、制約、index、RLS/policyの署名を、共通RPCについてsignatureとdefinition hashを取得する。適用前後で取得対象が一致することを確認する有力な比較資料だが、取得対象外を含む全DB要素の完全同一を数学的に証明するものではない。role継承を含む実効権限と外部依存はVERIFYおよび実際のanon/authenticated client操作で確認する。
- 同期本体は`hooto_day_sync_records`、冪等性履歴は`hooto_day_sync_operations`へ分離するB案を採用する。A案のcurrent row上のlast operationだけでは、後続更新後の古い再送、競合結果の再送、別entityへのID誤用を十分に判定できない。同じoperation IDの再送は適用・競合とも保存済みの同一結果を返す。workspace、entity、操作種別、user、base revision、schema version、正規化jsonb payload、client時刻、source device、operation IDから組み立てたrequestを組み込み`md5`でfingerprint化し、内容が異なる再利用を拒否する。MD5は同一性検査専用で、認証・認可・秘密情報保護には使用しない。
- `jsonb_build_object`ではSQL NULLがJSON nullになるため、fingerprint自体が両者を区別するわけではない。有効なupsertはSQL NULL payloadとJSON null payloadを事前に拒否し、deleteは固有の`operation_kind`と固定null入力で分離する。空文字とNULLも入力検証で混同させないため、現在許可する正当なrequest間でこの変換による同一化は起こさない。
- 同一結果を返すためoperation履歴は過去のresult payloadを保持し得る。無期限保存は前提とせず、当面の推奨保持期間は30日とする。今回は自動DELETE、cleanup RPC、pg_cronを追加しない。将来は`created_at`を基準に30日超を手動または定期cleanupするが、削除したoperation IDの冪等再送保証は失われる。現行recordsとtombstoneはcleanup対象にしない。
- RPC名は`hooto_day_upsert_sync_record`、`hooto_day_delete_sync_record`、`hooto_day_pull_sync_records`とする。新規作成のbase revisionは`0`、既存更新・削除・tombstoneからの明示復活は現在revisionとの完全一致を必須とする。
- DayMemo payloadはschema version 1、`date`・`content`・`updatedAt`の3キーだけを許可する。dateとentity IDの一致、実在日、content 1～2000文字、ISO日時をDB側でも検証する。contentは保存前trim済みを必須とし、ASCII空白・tab・CR/LFと一般的なUnicode空白の明示リストをDB側でも除去対象として照合する。JavaScript `trim()`とPostgreSQLのUnicode分類が将来も完全一致するとは断言せず、アプリ側検証も維持する。
- tombstoneではpayloadをNULLにし、削除済み本文をクラウドへ残し続けない。古いrevisionからの復活は許可しない。
- pullの正本cursorは専用`hooto_day_sync_change_seq`から採番する`change_sequence`とする。成功する新規・更新・tombstone・明示復活だけがRPC内で`nextval`を呼び、競合、同一operation再送、tombstone再削除は採番しない。sequenceはworkspace間で共通、欠番許容、1～500件、`change_sequence`昇順、tombstone込みとする。sequence採番順とcommit可視化順の逆転を防ぐため、成功mutationは専用transaction advisory lockでcommitまで直列化する。`server_updated_at`は表示・監査用に残しcursorには使わない。
- 取得・更新・削除はすべて専用RPCへ統一する。専用2テーブルはRLS有効・direct policyなし・direct table権限なしとし、SECURITY DEFINER RPC内で`auth.uid()`とworkspace memberを再検証する。
- 専用RPCはsearch_pathを`pg_catalog, public`へ固定し、PUBLIC/anonのEXECUTEを剥奪してauthenticatedだけへ許可する。service roleは使用しない。
- revision、server時刻、updated_byはtriggerではなく専用RPC内で管理し、不要な汎用triggerは追加しない。
- DBは空配列を削除と解釈せず、明示delete RPCだけがentity単位のtombstoneを作る。アプリ側もPC初回明示upload、空iPhone初回pull、JSON復元直後の自動push禁止、全初期化とcloud削除の分離を守る。
- rollbackは今回追加する専用3 RPC、2テーブル、sequence、戻り型、付随indexだけを依存順に削除し、既存共通基盤へ触れない。PRECHECKはオブジェクトを作らないためrollback対象外とする。
- verifyはSQL Editorでの構造・RLS・権限確認と、authenticated clientでのowner/member/非member、競合、冪等、tombstone、初回空端末保護の16ケースを分離する。
- APPLYのpostflightはCOMMIT前に、専用sequence属性とACL、2テーブルのRLS・policy 0件・直接権限なし、`change_sequence`の型・NOT NULL・CHECK・一意index、operation管理列・主キー・外部キー・CHECK、3 RPCのsignature・戻り型・SECURITY DEFINER・固定search_path・EXECUTE権限を検査する。不一致は例外でtransaction全体をrollbackする。role継承を含む最終的な実効権限はVERIFYとclient実操作でも確認する。
- app keyは今回追加しない。表示名で識別できるHootoDay専用workspaceを新規作成する暫定運用とし、名称をセキュリティ境界とは扱わない。

### 19.1 2026年7月19日の適用・構造検証結果

- 適用前に`HootoDay_backup_2026-07-19_11-29-50.json`を取得した。
- APPLY前PRECHECKを実行し、`HootoDay_Supabase_PRECHECK_before_APPLY_2026-07-19.csv`として保存した。
- `SUPABASE_HOOTO_DAY_SYNC_APPLY.sql`をSQL Editorで実行し、`Success. No rows returned`を確認した。
- VERIFYのA1～A10をセクション単位で確認した。必要object 13件はすべて存在し、専用2テーブル全28カラム、制約21件、index 4件、専用sequence属性、RLS・policy、専用RPC属性・権限、table・sequence直接権限、共通RPC hash、`app_workspace_state`構造署名が設計どおりであることを確認した。
- 専用3 RPCはSECURITY DEFINER、`search_path=pg_catalog, public`で、PUBLIC・anonはEXECUTE不可、authenticatedだけEXECUTE可能であることを確認した。
- 専用2テーブルはRLS有効・policy 0件で、PUBLIC・anon・authenticatedの直接table権限は全対象権限でfalseだった。専用sequenceの直接USAGE・SELECT・UPDATEもすべてfalseだった。
- APPLY後PRECHECKを`HootoDay_Supabase_PRECHECK_after_APPLY_2026-07-19.csv`として保存し、適用前後が26行・5列で完全一致した。これは取得対象の共通4テーブル構造署名と共通RPC 6件のdefinition hashが変化していないことを示す比較資料であり、DB全要素の完全同一を証明するものではない。
- 実データ、同期用workspace、テストデータは作成していない。共通HootoSong・HootoPost基盤への変更はPRECHECK取得対象の署名上確認されなかった。
- authenticated clientによるowner/member/非member、競合、冪等再送、tombstone、初回空端末保護など16ケースの実操作テストは未実施である。アプリコードへの同期実装も未着手である。

### 19.2 authenticated client実操作テスト結果（2026年7月19日）

リポジトリ外の一時Node.jsクライアント、`@supabase/supabase-js`、公開用anon key、anonymous sign-inしたowner・member・non-memberを使用し、専用W1・W2とDayMemoテストentityだけで16ケースを実施した。service role、既存HootoSong・HootoPost workspace、他アプリデータは使用していない。

RPC単体で次の設計保証を確認した。

- ownerによる新規作成、memberによるpull・revision一致更新が成功する。
- revision不一致は`conflict`となり、最新recordを返してクラウド本体を変更しない。
- 同一operation ID・同一requestは保存済み結果を返し、revision・change sequence・server時刻を増やさない。異内容再利用は例外で拒否する。
- deleteは物理削除ではなくpayload NULLのtombstoneを作り、既存tombstone再削除はno-opとなる。
- pullはtombstoneを含み、古いrevisionからの復活を拒否し、最新tombstone revisionによる明示復活だけを許可する。
- non-memberのW1 pull・upsert・deleteと、W1 memberのW2 pull・upsert・deleteをworkspace membershipエラーで拒否する。
- cursor 0と空ローカル配列による初回pullだけで2件の現行recordを取得し、upsert・delete・operation ID生成を行わないことを確認した。
- 許可外payloadキーはfingerprint・operation履歴追加・mutation・採番より前に拒否され、その後のpullでクラウドrecord不変を確認した。

pairing参加時、`consume_app_pairing_code`のDB処理は成功したが、テストクライアントがuuid単値の戻り形状を誤判定してローカルstateだけ保存できない事象が一度発生した。同じcodeやconsume RPCを再実行せず、`is_app_workspace_member`で参加済みを確認してstateを復旧した。アプリ実装ではRPC戻り型を実定義どおり扱い、DB成功後のローカル記録失敗から安全に復旧できる設計が必要である。

現在確認できた空端末・失敗時保護はRPC呼出順とクラウドDB不変までである。次はアプリ統合後に、実iPhone localStorageでの初回pull優先、初回自動push禁止、受信validator後だけの保存、失敗・conflict時のlocalStorage非変更、JSON復元直後の自動push禁止、全初期化とクラウド削除の分離、cursor・revision永続化、通信断・認証切れUIを再確認する。

テスト完了直後にはテスト用workspace、匿名ユーザー、pairing履歴、同期record、operation履歴を残し、対象を限定したcleanupを別途設計する状態だった。アプリ側同期実装と統合テスト、rollbackは未実施である。

### 19.3 実操作テストデータcleanup結果（2026年7月19日）

- cleanup PRECHECKは53行すべて`matched=true`、summaryは`expected_count=52`、`actual_count=52`、`matched=true`で、UUID完全一致のW1・W2だけを安全に削除できる状態を確認した。
- Database cleanupは1トランザクションで子データから明示削除し、operation履歴8件、sync records 2件、workspace state 0件、pairing code 1件、workspace member 3件、workspace 2件を削除した。全結果は`matched=true`だった。
- Database cleanupでは対象外workspace、既存HootoSong・HootoPostデータ、HootoDay同期テーブル・RPC・sequence・型・index・RLSを削除していない。
- Authentication Dashboardでは一度ユーザー0人に見えたが、UUID完全一致のSQL確認ではテスト匿名ユーザー3名が各1件残っていた。表示差の理由は断定せず、SQL確認を正本としてowner・member・non-memberの3 UUIDだけを`auth.users`から削除した。
- Auth cleanupは1トランザクションで正確に3件を削除し、全項目`matched=true`だった。`auth.identities`等の内部テーブルは直接操作せず、対象外Authユーザーを削除条件に含めていない。
- cleanup後VERIFYは49行すべて`matched=true`で、summaryは`Test cleanup verified; HootoDay sync infrastructure remains intact`だった。
- W1・W2関連の共通6テーブル行とテスト匿名Authユーザー3名がすべて0件であることを確認した。
- 共通4テーブル、共通workspace・pairing RPC、`app_workspace_state`構造、HootoDay専用2テーブル、sequence、result型、専用3 RPCが残存している。
- 専用2テーブルのRLS有効・policy 0件、専用RPCのSECURITY DEFINER・固定search_path、PUBLIC/anon実行不可・authenticated実行可、table・sequence直接権限なしも維持している。
- rollbackは未実行。アプリ側同期実装と統合テストは未着手であり、localStorage保護、空iPhone初回pull、初回自動push禁止、JSON復元後の自動push禁止、conflict、cursor、通信断等はアプリ実装後に検証する。
- リポジトリ外`HootoDay-Sync-Test`は文書記録のcommit・push完了まで保持しており、`.env`、state、テストスクリプト、依存関係、秘密SQLを含めて後からフォルダ全体を削除可能である。

### 19.4 アプリ統合 Phase A-1：Supabase client土台

- アプリ依存へ`@supabase/supabase-js`を追加した。
- client設定には`VITE_SUPABASE_URL`と`VITE_SUPABASE_PUBLISHABLE_KEY`を使用する。service roleは使用しない。
- 環境変数は未設定を許容し、両方が有効でURLがHTTPSとして解釈できる場合だけclientを生成する。未設定・片側設定・不正URLではclientを生成しない。
- clientモジュールのimportだけでは通信、匿名認証、session取得、workspace・pairing、RPCを開始しない。
- 認証情報の独自保存、同期metadata、既存localStorage、JSONバックアップ、UI、DayMemo処理は変更していない。
- Supabase実環境への接続確認は未実施である。
- 次のPhaseは設定画面の接続状態表示と、ユーザー操作による明示的な匿名認証とする。DayMemoのpull・upsert・deleteはまだ実装しない。

### 19.5 アプリ統合 Phase A-2：接続状態表示と明示的な匿名認証

- 設定画面へclient設定状態と匿名Auth session状態を表示する。URL、publishable key、user ID、tokenは表示しない。
- client設定済みの場合だけ、起動時に`auth.getSession()`で保存済みsessionを確認し、`onAuthStateChange`を購読する。新規匿名認証は自動実行しない。
- `signInAnonymously()`はユーザーが設定画面のボタンを押した場合だけ1回実行し、処理中の多重実行と自動再試行を防ぐ。
- 認証エラーは秘密値や原文を含まない一般メッセージへ変換し、既存HootoDayの起動・表示を止めない。
- 認証済みは匿名Auth sessionを取得できた状態だけを意味する。workspace作成、pairing、DayMemo同期、同期metadataは未実装である。
- Supabase Auth標準のsession保存へ任せ、JWT・refresh tokenをHootoDay独自stateやlocalStorageへ複製しない。
- 次はローカル実環境変数による匿名認証の実機確認を行い、その後workspace・pairing Phase Bへ進む。

### 19.6 アプリ統合 Phase B-1：PC親機workspaceの作成・復元

- 端末固有の接続metadataとして`hootoDay.syncConnection` version 1を追加する。このキーは通常JSONバックアップ、formatVersion 2、JSON復元の対象に含めない。
- metadataはworkspace ID、端末固有device ID、parent/child、owner/member、pairing状態、接続時刻だけを保持し、JWT、refresh token、pairing code、cursor、revision、pending operationは保存しない。
- device IDは初回だけ`crypto.randomUUID()`で生成し、正常なversion 1 metadataから再読み込み時に復元する。不正・version不一致のmetadataは自動修復・自動workspace作成せず、確認必要状態とする。
- PC親機workspaceは匿名認証済みユーザーの明示操作からだけ`create_app_workspace(workspace_name, device_label)`を1回呼び、scalar UUID戻り値と保存成功を確認した後だけ`parent`・`owner`として接続metadataへ反映する。
- RPC error、通信結果不明、想定外の戻り形状、localStorage保存失敗ではworkspaceが作成済みの可能性を考慮し、自動再実行を許可しない。
- workspace作成だけではiPhoneは未参加で、pairing、DayMemo送受信、自動同期、既存localStorageデータ変更は開始しない。
- 次のPhaseはpairing code発行とiPhone member参加とし、DayMemo同期はその後に分離する。

### 19.7 アプリ統合 Phase B-2a：親機からのpairing code発行

- pairing code発行は、Supabase設定済み・匿名認証済み・有効なworkspace IDを持つ`parent`・`owner`端末だけに許可する。
- 設定画面の明示操作から`create_app_pairing_code(target_workspace_id, valid_minutes)`を1回だけ呼び、`valid_minutes`は10とする。自動発行・自動再試行は行わない。
- 1行の戻り値または単一objectを安全に正規化し、非空のpairing code、有効な将来日時、UUID形式のcode IDを検証する。RPC errorや結果不明時は、発行済みの可能性を考慮して自動再発行しない。
- pairing codeと有効期限は設定画面コンポーネントのメモリ内だけで保持する。端末metadata、localStorage、sessionStorage、IndexedDB、URL、console、JSONバックアップへ保存・出力しない。
- 設定画面を閉じるとメモリ状態とタイマーを破棄し、再読み込みでも復元しない。有効期限到達時はcodeを消去し、再発行はユーザーの明示操作を必要とする。
- このPhaseでは`consume_app_pairing_code`、iPhone member参加、workspace再作成、DayMemo同期RPC、既存ユーザーデータ変更を行わない。
- 次は親機での実機発行確認後、iPhone側の明示的なcode入力とmember参加をPhase B-2bとして分離する。

### 19.8 アプリ統合 Phase B-2b：子機のpairing code消費とmember参加

- workspace未接続かつ匿名認証済みの端末だけに子機参加フォームを表示し、owner/memberとして接続済みの端末には誤操作可能な参加フォームを表示しない。
- 入力codeは送信直前に前後空白を除去し、空文字・長すぎる値・英数字以外を拒否する。大文字小文字は変換せず、RPCへ入力どおり渡す。
- `consume_app_pairing_code(input_code, device_label)`は明示ボタン操作時だけ1回呼ぶ。処理中の連打、自動実行、自動再試行、エラー後の自動再送は行わない。
- 戻り値は実定義のuuid単値を正本とする。Supabase clientの互換形状として単一objectまたは1要素配列も考慮するが、ちょうど1つのUUIDを安全に取得できない0件・複数件・想定外型は成功扱いにしない。
- RPC成功後だけ既存`hootoDay.syncConnection` version 1へworkspace ID、`child`、`member`、`pairingStatus: member`、参加時刻を保存する。新しいlocalStorageキーとJSONバックアップ項目は追加しない。
- RPCが成功した可能性がある状態で戻り値検証またはlocalStorage保存に失敗した場合は確認必要状態とし、使用済みcodeを自動再送しない。
- pairing codeとcode IDは永続保存せず、成功時に入力stateを消去する。Auth session・tokenは引き続きSupabase Auth標準保存へ任せる。
- owner端末は従来の発行・10分カウントダウンUIを維持し、member端末は子機接続済みとDayMemo同期未実装を表示する。
- SQL、DayMemo同期、リアルタイム同期、端末一覧、member削除、workspace切替は変更・実装しない。iPhone実機参加と再読み込み復元はユーザー確認待ちで、commit・pushは未実施である。

#### 19.8.1 LAN内HTTPでのdevice UUID生成fallback

- LAN内HTTPで開いたiPhone Safariでは、非セキュアコンテキストのため`crypto.randomUUID()`が利用できず、新規未接続端末の`hootoDay.syncConnection`初期化が失敗する場合がある。
- device ID生成は利用可能な`crypto.randomUUID()`を最優先し、利用不可・例外・UUID検証不合格の場合だけ`crypto.getRandomValues()`による16バイト乱数へfallbackする。
- fallback UUIDはbyte 6のversionを4、byte 8のvariantをRFC 4122形式へ設定し、文字列化後に既存UUID validatorを通過した場合だけ採用する。`Math.random()`、時刻、固定値、端末情報、連番は使用しない。
- `crypto`または`getRandomValues()`も利用できない場合は安全にUUID生成不可として停止し、UUID実値や内部例外を表示・記録しない。
- 既存storage値がある場合は新規生成処理へ進まず、そのdevice ID、workspace ID、device/workspace role、pairing状態、接続時刻を変更しない。
- localStorageキーとversion 1保存構造、JSONバックアップ形式は維持する。初期化結果はUUID生成不可、storage読み書き不可、metadata不正、原因不明へ区分し、安全な一般文言だけをUIへ渡す。
- この修正ではpairing RPC、Supabase接続、SQLを実行・変更しない。iPhone実機での再読み込みと子機参加は修正後に再確認し、commit・pushはユーザー確認後とする。

#### 19.8.2 pairing完了後の明示的なローカル復旧

- iPhone実機で`consume_app_pairing_code`がRPC errorなしで完了した後、戻り値検証または`hootoDay.syncConnection`保存段階で確認必要状態となった。member追加とcode消費済みの可能性が高いため、同じcodeとconsume RPCを再実行しない。
- consume戻り値は正式なuuid単値を最優先し、互換形状は1行配列または既知キーを持つobjectだけを許可する。空、複数、不明型、UUID不正を個別状態にし、成功扱いしない。
- ローカル保存は`saved`、`metadata_invalid`、`storage_unavailable`、`precondition_failed`、`unexpected_failure`を保持し、booleanへ情報を潰さない。
- 明示操作の復旧ではSupabase Authで現在の匿名ユーザーを確認し、既存RLS下で`app_workspace_members`を`user_id = 現在ユーザー`かつ`role = member`に限定してSELECTする。
- 1ユーザーは複数workspaceへ所属可能なため、復旧候補がちょうど1件でworkspace IDがUUID検証を通過した場合だけ、既存device IDを使って`child`・`member`接続をローカル保存する。0件・複数件・owner role・不正結果・RLS/通信エラーでは復旧しない。
- 復旧処理はSELECTとローカル保存だけで、consume RPC、DB INSERT・UPDATE・DELETE、自動復旧、自動再試行を行わない。pairing codeとcode IDも保存しない。
- SQL・RLS・policy、親機機能、JSONバックアップ、DayMemo同期は変更しない。iPhone実機確認待ちで、commit・pushは未実施である。
## 20. Phase B-3a：DayMemoアプリ統合前の確定設計（2026年7月19日）

### 20.1 現行ローカルモデル

- `DayMemo`の正本型は`{ date: string, content: string, updatedAt: string }`である。
- `date`は`YYYY-MM-DD`で、独立IDを追加せず1日1件のentity IDとして扱う。
- `content`は保存前にtrimし、空文字は保存しない。最大長は2000文字である。
- `updatedAt`は作成・更新時にISO 8601文字列として生成済みである。ローカルにはrevision、change sequence、deletedAt、operation IDは存在しない。
- `useDayMemos`が読み込み、state、作成・更新、削除、全置換を担当し、state変更後に`hootoDay.dayMemos`へ自動保存する。保存形式`{ version: 1, memos: DayMemo[] }`は変更しない。
- 同日重複は読み込み時に`updatedAt`が新しい1件へ正規化される。これはローカル破損・重複への復旧規則であり、端末間競合のlast-write-wins規則にはしない。

### 20.2 同期対象の境界

初期同期対象は独立したDayMemoだけとする。日記画面と予定編集画面内の「その日のメモ」は同じDayMemoを編集するため、どちらからの変更も対象になる。

次は対象外とする。

- `CalendarEvent`および予定固有の補足メモ
- 健康・体重・睡眠・食事・運動・体調・在庫・販売記録
- カレンダー表示用の派生データと入力途中のcomponent state
- テーマ設定
- `hootoDay.syncConnection`を含む端末・workspace接続metadata
- JSONバックアップ内のDayMemo以外のデータ

### 20.3 Supabase側との対応

`app_workspace_state`は複合主キー`workspace_id + key`、JSONB `value`、`updated_at`、`updated_by`、`updated_by_label`、`revision`を持つ既存の全体state基盤である。member向けSELECT・INSERT・UPDATE policyはあるがDELETE policyはない。DayMemo全体を1 JSONとして保存するとレコード単位競合を扱えず、既存Hootoシリーズとのkey衝突余地もあるため使用しない。

DayMemoは専用基盤へ次の対応で保存する。

| ローカル | Supabase |
|---|---|
| `date` | `entity_id`、`YYYY-MM-DD` |
| 固定値 | `entity_type = day_memo` |
| `{ date, content, updatedAt }` | schema version 1の`payload` |
| ローカルには未保持 | `revision`、`change_sequence`、`deleted_at`、`server_updated_at` |

操作はauthenticated workspace memberが専用SECURITY DEFINER RPCだけを使用する。

- upsert：`hooto_day_upsert_sync_record`。新規はbase revision 0、既存更新・復活は現在revision一致を必須とする。
- pull：`hooto_day_pull_sync_records`。cursorは`change_sequence`だけを使用し、`after_change_sequence`より大きい結果を昇順で取得する。limitは1～500である。
- delete：`hooto_day_delete_sync_record`。物理DELETEではなくpayload NULL・`deleted_at`ありのtombstoneを作る。

専用tableへの直接SELECT・INSERT・UPDATE・DELETEは行わない。owner/memberはいずれもRPCを利用でき、非memberと別workspaceはmembership検査で拒否される。

### 20.4 採用する同期単位

日付ごとに1レコードを正式採用する。

- 全体JSON方式は実装が一見短いが、1件変更で全体revisionが競合し、削除・復活・部分再試行が不明瞭になる。
- 日付単位は現行の1日1件モデル、Supabaseの複合主キー、revision、tombstone、pull cursorと一致する。
- 変更履歴追記方式は監査用途には有効だが、個人用アプリの現行表示・復元に不要なイベント再生処理とデータ量を増やすため採用しない。冪等性履歴は既存operation tableへ限定する。

### 20.5 pull・upsert・deleteの安全設計

- 初回PC uploadはユーザーの明示操作だけで開始し、非空DayMemoを日付ごとにpreviewしてから1件ずつupsertする。
- 空iPhoneはcursor 0からpullを先に行い、ローカル空配列をdelete要求へ変換しない。
- pull結果は戻り型、workspace、entity type、日付、payload、revision、change sequence、deletedAtを検証し、全検証と競合確認が終わるまで既存localStorageへ反映しない。
- 通信・認証・validator・RPC結果のいずれかが失敗した場合、既存DayMemo stateとlocalStorageを変更しない。自動再試行せず、operation IDを使う再送は同一requestであることを保証できる場合だけ許可する。
- 両端に異なる内容がある場合、revision不一致を競合として表示し、`updatedAt`だけで自動上書きしない。
- 現行のローカル削除は配列から除外するだけで削除履歴を残さない。この状態から安全なtombstone送信を判定できないため、初回uploadでは削除同期を行わない。後続Phaseで削除前revisionとpending deleteを別同期metadataへ保持してから実装する。
- JSON復元直後と全データ初期化直後は自動pushしない。復元・初期化をクラウド全削除へ変換しない。

### 20.6 更新時刻と同期metadata

`updatedAt`は既存payload互換とユーザー編集時刻として維持する。サーバー順序と競合の正本は`revision`と`change_sequence`であり、端末時計の前後だけで勝者を決めない。

同期metadataはユーザー本文と分離し、JSONバックアップへ含めない。後続実装で最低限、workspaceとの対応確認、pull cursor、日付ごとのrevision・change sequence・deletedAt、pending operation、最終成功時刻、初回upload状態、JSON復元直後のpush禁止状態を保持する。JWTとrefresh tokenはSupabase Auth標準保存に任せ、独自保存しない。metadata欠損・不正時は全件uploadや全件deleteを禁止する。

### 20.7 JSONバックアップとの関係

- formatVersion 2の`dayMemos`は現行3項目のまま維持し、旧formatVersion 1の復元互換も維持する。
- 復元処理は対象localStorageの旧値を先に保持し、途中失敗時にrollbackする既存方式を維持する。
- 復元成功後はAppの各stateを一括置換するが、その直後の自動pushは禁止する。
- revision、cursor、workspace、device、pending operationなど端末固有の同期metadataはバックアップへ混在させない。

### 20.8 実装Phase

1. **Phase B-3b：PC親機の明示的初回upload**
   既存DayMemoは変更せず、upload候補preview、明示ボタン、日付単位upsert、結果検証、成功結果metadata保存だけを実装する。pull、delete、自動同期、自動再試行は行わない。
2. **Phase B-3c：iPhone pull preview**
   cursor 0から取得し、validator後の候補を表示するがlocalStorageへ反映しない。
3. **Phase B-3d：確認後のローカル反映**
   競合がない候補だけを既存Hook経由で反映し、cursorとrevisionを保存する。失敗時は同期開始前stateを維持する。
4. **Phase B-3e：通常upsert**
   PC・iPhoneの明示的な変更送信、operation ID、pending operation、通信断・認証切れ時の安全な再送を実装する。
5. **Phase B-3f：delete・tombstone・競合**
   削除前revisionを伴う明示削除、tombstone pull、復活、競合表示を実装する。ローカル全初期化とは分離する。

### 20.9 次に実装する最小Phase

次はPhase B-3bだけを実装する。PC親機・owner・workspace接続済みを前提条件とし、既存DayMemoを読み取り専用でpreviewした後、ユーザーの明示操作でクラウドへ1件ずつ初回uploadする。既存DayMemo state、`hootoDay.dayMemos`、JSONバックアップ、予定・健康記録、`hootoDay.syncConnection`を変更しない。Supabase結果を勝手にローカルへ反映せず、自動実行・自動再試行・delete・pullを含めない。

Phase B-3b実装前に、専用同期metadataのキー名・version 1構造、複数件uploadの途中成功をどう記録して安全に再開するか、同じworkspaceに既存DayMemo recordがある場合の停止・preview条件を確定する必要がある。

## 21. Phase B-3b準備：初回upload安全仕様

### 21.1 SQLを正本とするRPC契約

専用tableは`hooto_day_sync_records`、冪等性履歴は`hooto_day_sync_operations`、採番sequenceは`hooto_day_sync_change_seq`、戻り型は`hooto_day_sync_result`である。

`hooto_day_sync_records`の主な列は、`workspace_id uuid`、`entity_type text`、`entity_id text`、`payload jsonb`、`schema_version integer`、`revision bigint`、`change_sequence bigint`、`deleted_at timestamptz`、`created_at timestamptz`、`server_updated_at timestamptz`、`client_updated_at timestamptz`、`updated_by uuid`、`source_device_id text`である。主キーはworkspace・entity type・entity IDの複合である。`updated_by`はRPC内の`auth.uid()`から設定され、device labelという列はなく、最大200文字のtrim済み`source_device_id`を受け取る。

| RPC | 引数 | 戻り値 |
|---|---|---|
| `hooto_day_upsert_sync_record` | `target_workspace_id uuid`, `target_entity_type text`, `target_entity_id text`, `target_payload jsonb`, `target_schema_version integer`, `base_revision bigint`, `operation_id uuid`, `client_updated_at timestamptz = null`, `source_device_id text = null` | `hooto_day_sync_result` 1件 |
| `hooto_day_delete_sync_record` | `target_workspace_id uuid`, `target_entity_type text`, `target_entity_id text`, `base_revision bigint`, `operation_id uuid`, `client_updated_at timestamptz = null`, `source_device_id text = null` | `hooto_day_sync_result` 1件 |
| `hooto_day_pull_sync_records` | `target_workspace_id uuid`, `after_change_sequence bigint = 0`, `limit_count integer = 200` | `SETOF hooto_day_sync_result` |

戻り型の列順は`status`、`workspace_id`、`entity_type`、`entity_id`、`revision`、`change_sequence`、`server_updated_at`、`deleted_at`、`payload`、`conflict`である。pullのstatusは`current`、mutationは`applied`または`conflict`である。

重要な制約は次のとおりである。

- `entity_type`は`day_memo`だけ、entity IDは実在する`YYYY-MM-DD`、schema versionは1だけを許可する。
- payloadはJSON objectで、`date`・`content`・`updatedAt`の3キーを過不足なく要求する。dateはentity IDと一致し、contentはtrim済み1～2000文字、updatedAtは有効なISO 8601とする。
- 新規作成時のbase revision 0は「現在rowが存在しない場合だけrevision 1として作成する」という意味である。rowが既にあれば、現行revisionを含むconflict結果を返して本体を変更しない。
- 成功mutationだけが`nextval()`を取得する。change sequenceはbigintで1以上、専用transaction advisory lockにより成功mutationのcommit可視化順を直列化する。sequence gapは許容する。
- tombstoneは同じrecords rowの`payload = NULL`かつ`deleted_at IS NOT NULL`で表す。物理DELETEではない。
- operation IDはoperation ledgerのuuid主キーである。同じoperation IDと同じfingerprintのrequestは保存済み結果を返し、record更新、revision増加、再採番を行わない。異なるrequestへの再利用は例外で拒否する。
- fingerprintにはworkspace、entity type・ID、operation kind、呼出Auth user、base revision、schema version、payload、client updated time、source device ID、operation IDが含まれる。
- operation履歴の推奨保持期間は30日で、cleanup後は過去operation IDの冪等再送保証がなくなる。
- 3 RPCはすべてauthenticatedだけがEXECUTE可能なSECURITY DEFINERで、固定search pathと`auth.uid()`・workspace membership検査を持つ。owner/memberでDayMemo RPC権限差はない。専用2 tableはRLS有効、policy 0件、direct table権限なしである。
- RPCは1件単位であり、複数DayMemoのatomic batch RPCは存在しない。

既存の設計記録とSQLに実装判断を変える差異はない。SQLのほうが具体的な点として、pull statusが`current`であること、source device IDの長さ・trim制約、operation fingerprintへ呼出Auth userと全request入力が含まれること、operation保持30日後の冪等保証喪失を本節で明文化した。

### 21.2 正式なローカルmetadata

正式キーは`hootoDay.dayMemoSync`、versionは1とする。workspace IDは別workspaceへ進捗を誤適用しないためのbindingとして意図的に重複保存する。device IDは重複保存せず、RPC直前に有効な`hootoDay.syncConnection`から取得する。

```ts
type DayMemoInitialUploadStatus =
  | 'not_started'
  | 'prepared'
  | 'uploading'
  | 'partial'
  | 'completed'
  | 'blocked'

type DayMemoUploadEntryStatus =
  | 'pending'
  | 'response_unknown'
  | 'applied'
  | 'conflict'

type DayMemoSyncErrorCode =
  | 'authentication_required'
  | 'membership_required'
  | 'remote_not_empty'
  | 'local_changed'
  | 'rpc_failed'
  | 'response_invalid'
  | 'storage_failed'
  | 'metadata_invalid'

interface DayMemoInitialUploadEntryV1 {
  status: DayMemoUploadEntryStatus
  operationId: string | null
  payloadUpdatedAt: string
  baseRevision: 0
  remoteRevision: number | null
  remoteChangeSequence: number | null
}

interface DayMemoSyncMetadataV1 {
  version: 1
  workspaceId: string
  initialUpload: {
    status: DayMemoInitialUploadStatus
    preparedAt: string | null
    completedAt: string | null
    targetDates: string[]
    entries: Record<string, DayMemoInitialUploadEntryV1>
  }
  lastPulledChangeSequence: number
  pushBlock: null | {
    reason: 'json_restore' | 'full_reset' | 'remote_not_empty' | 'metadata_invalid'
    blockedAt: string
  }
  lastSuccessfulSyncAt: string | null
  lastErrorCode: DayMemoSyncErrorCode | null
}
```

成功済み・未完了日付は`entries`から導出し、重複配列を持たない。開始済み・完了済みもstatusで表す。本文、content hash、pairing code、code ID、device ID、JWT、token、Auth session、エラー全文は保存しない。revisionとchange sequenceはJavaScript safe integerとして検証できる値だけ保存し、範囲外はfail-closedとする。

confirmed applied結果をmetadataへ保存できたentryはoperation IDをnullへ置換してよい。RPC後に応答不明または進捗保存失敗となったentryは事前保存済みoperation IDを残す。metadataの保存・読み込み・migrationはfail-closed validatorを持ち、version不一致を自動全件uploadへ変換しない。このmetadataは通常JSONバックアップと全ユーザーデータ初期化の対象外とする。

### 21.3 準備、途中成功、再開

1. owner・parent・workspace・匿名Auth状態を検証する。
2. 現在のDayMemoを既存validator相当で検証し、日付昇順の対象snapshotを作る。0件ならRPCを呼ばない。
3. remote空確認を行う。upload候補本文は表示せず、件数と日付だけpreviewする。
4. ユーザーがuploadを確定した時点で、全対象日付と各日付固有operation IDをmetadataへ一度に保存する。保存後のread-back検証に成功するまでupsertを開始しない。
5. 1件ずつ日付順にupsertし、各結果を厳格検証した直後にrevision・change sequence・状態をmetadataへ保存する。
6. 途中失敗では後続を呼ばず、成功件数・未完了件数・確認必要件数だけを表示する。自動再開しない。
7. 明示的な再開時はworkspace bindingと現在のlocal memoを再検証する。まだRPCを呼んでいないpending entryだけは、`payloadUpdatedAt`を含む準備済み条件が現在memoと一致する場合に保存済みoperation IDで開始できる。memoが消えた、updatedAtが変わった、Auth user・device IDが変わった可能性がある場合は呼ばない。
8. response unknownは、同じ画面内で初回request objectをメモリ保持しており、全fingerprint入力が同一と証明できる場合だけ、同一operation ID・同一requestで明示再送する。ページ再読み込み後は本文をmetadataへ複製していないため、updatedAt一致だけを根拠に同一payloadと断定しない。blind retryせずB-3cのpull previewでremote結果を確認する。新しいoperation IDも生成しない。
9. applied結果とmetadata保存が完了したentryはローカル進捗を正本としてskipできる。metadataだけでDB成功を推測するのではなく、applied結果を検証して保存した事実を正本とする。
10. 全entryがappliedになった場合だけinitial uploadをcompletedとし、最終成功時刻を保存する。

全10件中6件成功なら6件をapplied、残りをpendingまたはresponse unknownとして保持する。別operation ID・base revision 0で既存日付を再送するとconflictにはなるが、operation結果の同一性を保証できず不要なledger行も作るため禁止する。conflictは成功扱いせず、その時点で全体をblockedにしてB-3cへ進める。

### 21.4 remote既存データ確認と停止条件

payloadなしの件数・存在確認RPCは存在しない。B-3bではpull RPCを`after_change_sequence = 0`、`limit_count = 1`で1回呼ぶ。戻り配列が空なら、その確認時点で現行DayMemo rowとtombstoneが0件である。1件返ればremoteは非空であり、payload本文はUI、metadata、consoleへ保存・表示せず破棄する。

次のいずれかで初回uploadを開始または継続しない。

- pullが1件以上を返した。現行record、tombstone、同日・別日の区別なく停止する。
- pull結果のworkspace、entity type、revision、change sequence、deletedAt、payloadを安全に検証できない。
- membership、workspace、匿名認証を確認できない。
- 通信・RPC error、空確認結果の形状不正、metadata保存失敗がある。
- metadataのworkspace IDが現在のconnectionと一致しない。
- 既存進捗と現在の対象日付・updatedAtが一致せず、同一requestを再現できない。
- upsertがconflictを返した。base revision 0 conflictはremote rowが存在する証拠として扱う。
- pushBlockが設定されている。

remoteが非空なら自動マージ・上書きせず、B-3cのpull previewへ進める。pull limit 1は「空か非空か」の判定専用で、件数、全entity ID、全revisionの取得を目的としない。

remote空確認と最初のupsertは同一DB transactionではないため、その間のworkspace全体の同時書込みを完全には排除できない。現在はiPhone側DayMemo mutation未実装かつ自動同期なしであり、同日raceはbase revision 0 conflictで保護される。別日raceまで原子的に排除するには新規batch/preflight RPCが必要だが、今回はSQLを変更せず、発生時は以降を停止してB-3cで確認する。

### 21.5 operation ID

- operation IDは日付ごとに1つのUUID v4とし、upload session全体で共用しない。
- `crypto.randomUUID()`を優先し、LAN内HTTPで利用不可の場合は`crypto.getRandomValues()`でversion・variant bitを設定する既存方式を共通UUID utilityへ抽出して再利用する。`Math.random()`は使わない。
- 全operation IDを最初のRPCより前にmetadataへ永続化する。実値をUI・console・文書へ出さない。
- 応答不明時は同じ画面内に元request objectが残り、同じAuth userと全fingerprint入力を再利用できる場合だけ同じIDで再送する。payload、client updated time、source device ID、base revision等のどれかを変えて同じIDを使わない。再読み込み後はmetadataだけから同一requestを再構築したと見なさず、pull previewへ移る。
- confirmed appliedかつ進捗保存成功後はentryのoperation IDを破棄できる。response unknownでは破棄しない。
- workspace変更、metadata migration失敗、request再現不能、推奨30日を超えてledger cleanup済みの可能性がある場合は再利用しない。ただし新IDでblind retryもせず、remote pull previewへ移行する。

### 21.6 JSON復元・全初期化後のpush禁止

JSON復元の実行入口は`JsonBackupPanel.restore()`で、復元前backupを作成した後、`restoreBackupToStorage()`で16ユーザーデータキーをtransaction相当のrollback付きで置換し、成功後に`App.restoreBackupData()`がDayMemoを含むReact stateを置換する。全初期化は`FullDataResetSection.executeReset()`からbackup作成、`resetHootoDayDataStorage()`、成功後の`App.resetAllDataState()`へ進む。現状、同期向けイベントやpush禁止フラグは存在しない。

実装時は復元・初期化によるユーザーデータ書換えより前に、`hootoDay.dayMemoSync`へそれぞれ`json_restore`または`full_reset`のpushBlockを保存し、read-back検証する。pushBlockを保存できなければ復元・初期化を開始しない。処理自体が失敗して元データへ正常rollbackした場合だけ、直前のblock状態へ安全に戻せる設計とする。成功後はB-3c相当のremote pull previewとユーザーの明示確認が終わるまでuploadを禁止する。

- sync metadataとworkspace接続情報はJSONバックアップへ含めず、復元で上書きしない。
- local DayMemo 0件をremote全削除、tombstone一括作成、初回upload完了とは解釈しない。
- 初回upload済みworkspaceでローカルが空になった場合、原因が手動全削除、JSON復元、全初期化、storage破損のどれでも自動mutationしない。
- pushBlock解除はpull preview後の明示確認だけとし、起動・再読み込み・時間経過では自動解除しない。

### 21.7 Phase B-3bの最終実装範囲

- PC親機、device role parent、workspace role owner、pairing status owner、workspace接続済み、匿名認証済みだけに初回upload UIを表示する。
- DayMemo総件数を表示する。previewでは対象件数と日付だけを表示し、本文は一覧表示しない。
- preview操作時だけremote空確認pullを1回行う。自動pullしない。
- remote空確認とlocal snapshot検証後、明示的な確定ボタンでだけupload準備metadataを保存する。
- 日付ごとにoperation IDを固定し、base revision 0、schema version 1、payload 3キー、client updated timeはmemo.updatedAt、source device IDは現在のconnection device IDとして、1件ずつupsertする。
- 各RPC結果を検証して進捗を保存し、部分成功を件数で表示する。明示的再開だけを提供し、自動再試行・無限再送を行わない。
- upload成功で既存DayMemo stateと`hootoDay.dayMemos`を変更しない。remote結果をローカル本文へ反映しない。
- pull結果反映、delete、tombstone、通常更新、競合解決、iPhone/member upload、リアルタイム同期、DayMemo以外の送信は実装しない。

実装予定ファイルは、同期metadata型を置く`src/types/sync.ts`またはDayMemo専用型ファイル、新規`src/utils/dayMemoSyncStorage.ts`、共通UUID生成utility、RPCと進捗stateを扱う新規hook、設定画面を接続する`src/App.tsx`・`src/components/ThemeSettings.tsx`・`src/App.css`、復元・初期化前guardを扱う`src/components/JsonBackupPanel.tsx`・`src/components/FullDataResetSection.tsx`、記録用`PROJECT_NOTES.md`・`SYNC_DESIGN.md`を候補とする。既存DayMemo storageとHookはB-3bでは変更しない。

### 21.8 未確定事項

- 復元・全初期化前guardをB-3bと同時に実装するか、upload UIを先に実装しつつpushBlockが未設定でも既存workspaceではfail-closedにするか。安全上はB-3bと同時実装を推奨する。
- remote空確認後の別日raceをDB側で完全に排除するbatch/preflight RPCを将来追加するか。現段階ではSQL変更なしとし、race検出時停止で運用する。
- operation ledgerの30日cleanupを実際にいつ導入するか。B-3bではcleanupを追加せず、古いresponse unknownをblind retryしない。

## 22. Phase B-3b実装結果（実機確認前）

- 正式metadataキー`hootoDay.dayMemoSync` version 1を実装した。validator、読み込み、workspace binding、保存後read-back、不正metadataのfail-closed、pushBlock設定を専用utilityへ分離した。
- metadataは本文を複製せず、対象日付とpreparedUpdatedAtで通常Hook経路の変更を検出する。workspace IDは誤適用防止のbindingとして保持し、device IDは`hootoDay.syncConnection`からRPC直前に取得する。
- UUID生成は共通`createUuidV4()`へ統合した。native randomUUIDを優先し、安全なgetRandomValues fallbackだけを使用するため、既存のLAN内HTTP対応を維持する。
- 初回upload Hookはunavailable、idle、preview中・可能、remote非空、準備中・済み、upload中、部分完了、response unknown、conflict、完了、push blocked、復旧必要、errorを区分する。
- owner親機だけが設定画面からpreview、準備、upload、pending再開を明示実行できる。member子機には初回upload操作を表示しない。
- preview pullはcursor 0・limit 1の1回だけで、remoteが空の場合だけ次へ進める。remote payloadは存在判定と最低限の結果検証にのみ使い、保存・表示しない。
- 準備時に全日付のoperation IDを作成してmetadataへ保存し、read-back後にのみupload可能とした。日付・件数・updatedAtがpreview後に変われば停止する。
- uploadは日付順の直列処理で、各RPC直前にupload中状態を永続化する。これによりRPC中の画面終了は再読み込み後に復旧必要となり、pendingとしてblind retryされない。成功結果は日付ごとに保存し、全件applied時だけcompletedとする。
- RPC errorと結果不正はDB適用済みの可能性を除外できないためresponse unknownへ寄せる。conflict、response unknown、storage失敗では後続を停止し、自動再試行・自動再開を行わない。
- JSON復元・全初期化では、既存backup作成後かつlocalStorage変更前にAppの同期HookからpushBlockを保存する。workspace接続済みまたはmetadataありの場合は保存必須、未接続かつmetadataなしはno-opとする。block解除は未実装である。
- DayMemo本文、localStorage正本、JSONバックアップ形式、workspace接続metadataは変更しない。delete・pull反映・通常更新・競合解決・iPhone反映は後続Phaseである。
- SQL・RLS・policy・RPC・packageは変更していない。Supabase実操作は行わず、PC親機でのpreview・remote空確認・準備・初回upload・部分停止・再読み込み表示はユーザー実機確認待ちである。
## 23. Phase B-3c：iPhone子機のDayMemo pull preview

- 対象は匿名認証済み、workspace接続済み、`deviceRole = child`、`workspaceRole = member`、`pairingStatus = member`をすべて満たす端末だけとする。owner親機には子機用preview操作を表示しない。
- pullはユーザーが「DayMemoを確認」を押した場合だけ開始する。自動pull、自動再試行、並列pullは行わない。
- `hooto_day_pull_sync_records`を`after_change_sequence = 0`から開始し、1ページ100件で直列取得する。各ページの最大change sequenceを次cursorにし、全体で厳密な昇順、cursor前進、change sequence重複なし、entity ID重複なしを確認する。
- 安全上限は20ページ・2000件とする。上限ページが満杯、cursorが進まない、途中RPC失敗、戻り値不正のいずれかでは取得済み部分を完全previewとせず、メモリから破棄して停止する。
- pull RPCは現在のrecords rowだけを返すため、同日について複数revisionを推測・統合しない。tombstoneも現在行として返り、`deleted_at != null`かつ`payload = null`を必須とする。同一entityが複数返れば不正として停止する。
- 通常レコードはstatus `current`、workspace一致、entity type `day_memo`、実在日付のentity ID、safe integerのrevision/change sequence、ISO 8601日時、`conflict = false`を要求する。payloadはschema version 1相当として`date`・`content`・`updatedAt`の3キーだけを許可し、date一致、trim済み1～2000文字、有効なISO 8601を検証する。戻り型にschema version列はないため、payload契約によって互換性を確認する。
- preview中のremote payloadと本文比較はReactメモリ内だけで行う。本文、payload全体、UUID、token、内部エラー全文をUI・console・localStorage・sessionStorage・同期metadataへ保存または表示しない。
- 日付単位の分類はremoteのみ、localのみ、両方に存在して内容一致、両方に存在して内容相違、remote tombstoneかつlocalあり、remote tombstoneかつlocalなしとする。UIには件数、日付、分類、remote revision、必要なchange sequenceだけを表示する。
- previewはページ再読み込みで失われる。設定画面を閉じただけではApp内Hookのメモリに残るが、明示的な「確認結果を破棄」でremote payload、日付一覧、途中cursorをすべて消去する。preview後にlocal DayMemoが変化した場合も破棄して再確認を要求する。
- `hootoDay.dayMemoSync`は読み取り検査だけに使用する。workspace bindingが異なる場合やmetadataが不正・読込不能な場合は停止する。`json_restore`または`full_reset`のpushBlock中でも比較用pull previewは許可するが、pushBlock、lastPulledChangeSequence、lastSuccessfulSyncAt、初回upload進捗を変更しない。
- B-3cは読み取りpreviewだけであり、`hootoDay.dayMemos`への反映、pull cursor永続化、tombstone反映、競合解決、upsert、delete、通常同期、リアルタイム同期は後続Phaseとする。
- 親機の初回upload機能、完了状態復元、operation ID進捗、JSON復元・全初期化guard、pairing、既存保存形式は変更しない。SQL・RLS・policy・RPC定義も変更しない。

## Phase B-3d: pull previewからの安全なローカル反映

- 対象はchild／memberが明示的に取得した完全なpreviewのうち、同期先にだけ存在する通常DayMemo (`remote_only`) に限定する。
- 反映前に接続情報、workspace binding、pushBlock、preview分類、ローカルstate、永続化済みDayMemoの完全一致を再検証する。途中で変化を検出した場合は再pullを自動実行せず停止する。
- 適用順序は「専用バックアップ保存・読戻し確認 → version 1 DayMemo全体を1回保存 → 読戻し完全一致 → React state採用」とする。保存検証失敗時は元の保存値へ戻し、React stateを変更しない。
- React state採用後の既存自動保存は1回だけ抑止し、検証済みの保存値を重ねて書き直さない。
- `local_only`、`same`、`different`、tombstoneは変更しない。重複日付、不完全preview、ローカル変更、metadata不正では適用しない。
- 適用成功後はremote payloadを含むpreviewを破棄する。同期metadata、cursor、revision、change sequence、pushBlockは変更しない。
- `hootoDay.dayMemoBeforePullApply` は端末内の復旧用で本文を含むためJSONバックアップ対象外とし、workspace/device情報と同様に端末固有データとして扱う。
- このPhaseはローカル反映だけであり、Supabaseへのupsert／delete、通常同期、競合解決、tombstone反映は後続Phaseとする。

## Phase B-3e通常更新の事前設計

### 1. revisionとdirty判定

- 同期競合の正本はSupabase recordのrevisionである。端末時計や `updatedAt` の新旧だけで勝者を決めない。
- local dirtyは、日付別metadataに保存した「端末へ最後に採用したremote revision／remote payload updatedAt」と、現在のlocal DayMemoを比較して判定する。
- 通常の手入力保存はupdatedAtを必ず更新する。pull反映はremote updatedAtを保持する。JSON復元と全初期化はpushBlockへ移行するため、通常編集と混同しない。
- baseline updatedAtと同じなのにcontentだけ異なる場合は、安全な通常編集として扱わずmetadata不整合として停止する。本文や本文hashはmetadataへ永続化しない。通常操作ではupdatedAtが更新され、upload直前のfull pullでremote payloadとの一致・相違もmemory内検証できるため、永続content hashは不要とする。

### 2. version 2 metadata案

- version 1は初回upload専用の `targetDates`／`entries` と `baseRevision: 0`／revision 1固定validatorを持つため、通常同期へ流用しない。
- version 2は少なくとも次を持つ。
  - `version: 2`
  - `workspaceId`
  - 初回uploadの完了履歴またはmigration済み状態
  - `records[date]`: `remoteRevision`、`remoteChangeSequence`、`remoteUpdatedAt`、`baselineLocalUpdatedAt`、`deletedAt`
  - `lastPulledChangeSequence`
  - `pendingOperation`: 対象日、operation ID、base revision、preparedUpdatedAt、schema version、状態（本文は含めない）
  - `pushBlock`
  - `lastSuccessfulSyncAt`
- device IDは `hootoDay.syncConnection` からRPC直前に取得し、同期metadataへ重複保存しない。token、Auth session、pairing code、本文、operation結果payloadも保存しない。
- PCのversion 1 completed entriesは、applied entryのremoteRevision／remoteChangeSequence／preparedUpdatedAtを検証してrecordsへ移行できる。ただしcursorは0のままなので、migration後にfull pull baseline確認を必須とする。
- iPhoneには永続revisionがないため、version 1/absent状態から推測移行しない。full pullし、現在local 7件とremote 7件が完全一致した場合だけbaselineを作成する。不一致・tombstone・重複・不完全取得では保存しない。

### 3. remote確認

- 現行 `hooto_day_pull_sync_records(workspace, after_change_sequence, limit)` はentity ID指定を持たない。SQLを変更せず特定日の最新状態と「record自体がない」を確認するには、cursor 0からの完全page取得が最も確実である。
- B-3eの初期段階は明示操作ごとにfull pullし、change sequence昇順、重複なし、上限未到達、全page完了を検証する。取得内容はReact memory内だけで比較し、本文をmetadata・UI・consoleへ出さない。
- 将来、正しい `lastPulledChangeSequence` と日付別baselineを全端末が保持した後はincremental pullへ最適化できる。保存cursorより前の履歴を再取得できないことを考慮し、metadata欠落時は必ずcursor 0へ戻す。
- upsert RPCはentity lock下で現在revisionとbase revisionを比較するため、preview後にremoteが変化してもconflictとなりクラウドを上書きしない。preflight pullはUXと候補限定、RPC revision checkは最終整合性保証と位置付ける。

### 4. operation ID

- operation IDはpreview時ではなく、ユーザーが1件のuploadを確定した時点で1個生成する。RPC前にpendingOperationとして保存・read-backする。
- 1回の編集につき1個ではなく、1回の確定upload requestにつき1個とする。編集を続けて再previewした場合、未送信operationは破棄理由を明示して新requestを準備する。
- RPC errorやresponse unknownでは新しいoperation IDによるblind retryをしない。同一requestを完全再現できない場合も再送しない。明示pullでremote結果を確認する。
- conflict結果はoperation ledgerへ保存される。競合後に同じoperation IDを別内容へ使わず、新しいユーザー判断と新previewなしに次requestを作らない。
- applied確定後はpendingOperationを解消し、日付別remote revision/change sequence/updatedAtとlastSuccessfulSyncAtをread-back付きで保存する。

### 5. 共通フローと停止条件

- PC ownerとiPhone memberは、接続条件以外の「full pull → baseline/dirty判定 → 1件preview → operation事前保存 → 1件upsert → 結果検証 → metadata更新」を共通Hook/utilityで使う。
- 端末別の違いは初期baselineの由来だけである。PCは初回upload履歴をmigrationの補助に使え、iPhoneはB-3d反映だけではrevisionがないためfull pull完全一致が必須である。
- upload可能:
  - remote現行record、baseline revision既知、full pull時revision一致、localがbaselineから通常編集された1件
  - remote record/tombstone不在をfull pullで確認でき、過去remote履歴なしと判断できるlocal-only新規1件（B-3e4以降）
- upload禁止:
  - remote-only、same、revision不一致、remote tombstone、local削除、pushBlock、pending/response unknown、conflict、metadata/workspace不一致、不完全pull
- conflict時はlocal/remoteを変更せず、後続uploadを停止し、最新remote previewへ誘導する。自動解決、自動pull、自動再試行、ローカル自動上書きは行わない。

### 6. JSON復元・全初期化・pull反映

- JSON復元と全初期化は既存どおりpushBlockを先に保存し、通常dirty候補へ変換しない。
- pull反映はremote payloadと同時に日付別baselineをtransaction相当の順序で保存する必要がある。DayMemo保存だけ成功してmetadata保存が失敗する状態を避けるため、B-3e1でバックアップ・read-back・rollback方針を設計する。
- B-3dで既に反映済みのiPhoneはrevisionが欠落しているため、再pull完全一致でbaselineを再構成する。React state破棄後にpreview情報を復元できるとは仮定しない。
- pushBlock解除は独立Phaseとし、通常upload実装では解除しない。

### 7. 最小実装単位

- 次の実装はB-3e1のみとする。
- 変更範囲はversion 2型、validator、version 1 migration、full pull baseline preview/保存、文書と必要最小限UIに限定する。
- local DayMemoを変更せず、Supabaseへ書き込まず、upsert/deleteを呼ばず、cursorの差分pull最適化、dirty upload、conflict UI、pushBlock解除を含めない。

## Phase B-3e1: metadata version 2とfull pull baseline

- `hootoDay.dayMemoSync` version 2は、version 1の初回upload履歴を`initialUpload`へ保持し、`baselines`、`lastPulledChangeSequence`、`baselineStatus`、`baselineConfirmedAt`、`pendingOperation`、`pushBlock`、`lastSuccessfulSyncAt`、migration記録を分離して持つ。本文と認証・端末秘密値は持たない。
- version 1からのmigrationは明示baseline確認時だけ行う。旧JSONを検証し、同じworkspaceへだけ変換し、compare-and-writeとread-backを行う。書込み確認に失敗した場合は元の保存値を復元し、不明な状態で処理を続けない。
- PCの初回upload entryから作るbaselineは暫定値である。entryがapplied、revision/change sequenceが有効、local updatedAtがpreparedUpdatedAtと一致、pushBlockなしの場合だけ移すが、`baselineStatus`は`not_confirmed`のままとする。子機やmetadata不在端末ではrevisionを推測しない。
- baseline確認はowner/parentとmember/childの共通Hookから明示操作でのみ開始する。`hooto_day_pull_sync_records`をcursor 0、limit 100、最大20ページ・2000件で直列実行し、全ページ完了まで永続cursorを更新しない。
- 各remote rowはstatus、workspace、entity type/date、revision、change sequence、server timestamp、conflict、payloadまたはtombstoneを検証する。change sequenceの厳密昇順、entity/date重複なし、sequence重複なし、cursor前進を満たさなければ全結果を破棄する。
- confirmed条件は、remote active件数とlocal件数が一致し、日付集合が一致し、各content・updatedAtが一致し、remote-only/local-only/different/tombstoneが0件であること。条件成立時だけ日付別remote revision/change sequence/updatedAt、local baseline updatedAt、最大cursorを1回保存しread-backする。
- remoteとlocalがともに空の場合だけ`remote_empty`を記録する。差異は`mismatch`、中断・不完全取得・保存不明は`recovery_required`またはerrorとして停止し、partial baselineを成功扱いにしない。
- `pushBlock`はbaseline確認を妨げないが、確認後も同じ値を保持する。baseline確認はblock解除、upload許可、ローカル反映を意味しない。
- B-3e1ではpull以外のSupabase APIを呼ばない。upsert/delete、pending operation生成、dirty upload、conflict解決、tombstoneのlocal反映、incremental pull、自動同期は後続Phaseとする。

### B-3e1 migration validator修正

- PC実機の最初の明示確認で、version 1から移した暫定baselineのchange sequenceが1以上、未pull cursorが0となり、状態を問わずbaseline sequenceをcursor以下へ制限していたvalidatorによりfull pull前に停止することが判明した。
- `lastPulledChangeSequence`は完了済みfull pullの最大値であり、初回upload履歴由来の暫定baseline sequenceを包含する値ではない。したがって`not_confirmed`／`confirming`ではcursor 0と暫定baselineの併存を許可し、基本validatorとsequence重複拒否を維持する。
- `confirmed`へ移る場合だけ、全baseline sequenceがcursor以下、最大baseline sequenceがcursorと一致、確認日時・active row・local baselineが揃うことを必須とする。tombstone、不一致、不完全pullではconfirmedにしない。`remote_empty`はbaseline 0件かつcursor 0だけを許可する。
- migrationの順序は「v1検証 → v2 not_confirmed生成 → 保存前検証 → compare-and-write → read-back → confirming保存 → 明示full pull → 完全一致 → confirmed保存・read-back」とする。どの保存失敗でもUIだけを成功へ進めない。
- 保存utilityはmetadata不正、stale/保存不能、write失敗、read-back失敗、rollback失敗を内部で区別する。Hookもmigration、confirming、pull、比較、baseline保存、local変化、pending operationを区別し、秘密情報や内部例外全文を表示しない。
- version 1と初回upload履歴を保持し、local DayMemo、workspace、pushBlock、反映前バックアップ、JSON形式を変更しない。Supabase書込み、通常upload、pushBlock解除は含めない。

## Phase B-3e2: 通常更新候補のdirty preview

- owner/parentとmember/childは同じローカルpreview処理を使用する。Supabase設定、匿名認証、workspace接続、正しい端末・workspace role、version 2 metadata、workspace binding、confirmed baseline、pending operationなし、pushBlockなしを開始条件とする。
- previewは明示ボタン操作時だけ作る。metadataと`hootoDay.dayMemos`を再読込・検証し、React stateと保存値を日付・updatedAt・contentの順序非依存signatureで照合してから分類する。RPC、自動pull、自動再試行は行わない。
- 通常編集経路は本文をtrimし、保存時に`updatedAt`を更新する。B-3e2ではmetadata構造を変更せず、active baselineの`baselineLocalUpdatedAt`と現在local `updatedAt`が異なる場合をdirty候補とする。時刻の大小をremote勝敗判定には使わず、remote revisionは将来のbase revisionとして保持する。
- `modified_candidate`は、同日active baseline、revision/change sequence・日時が有効、localが存在、本文がtrim済み1～2000文字、local updatedAtがbaselineから変化、という条件をすべて満たす場合だけ作る。これはpreview候補でありupload確定ではない。
- 同じupdatedAtは`unchanged`、baselineなしlocalは`local_only`、baselineありlocalなしは`missing_local`、deletedAtありは`tombstone_baseline`、不正な組合せは`metadata_invalid`とする。modified以外は通常更新upload対象にしない。
- preview snapshotはworkspace、baseline確認日時、cursor、候補日・base revision・local updatedAt、local version 1保存値と本文をReactメモリだけに保持する。UIは本文を表示せず、分類件数、日付、base revision、baseline change sequenceだけを表示する。
- 明示破棄は候補本文、全local snapshot、日付一覧をメモリから消去する。localStorage、sync metadata、cursor、baseline、pending operation、pushBlockは変更しない。ページ再読み込みでもpreviewは復元しない。
- pushBlockまたはpending operationがある場合はpreviewを開始しない。通常upsert、operation ID生成、local-only upload、delete/tombstone、conflict解決、pushBlock解除は後続Phaseとする。

## Phase B-3e2.5設計: content同一時のbaseline rebase

- confirmed後の通常保存で本文を元へ戻しても`updatedAt`は更新される。この状態でB-3e1確認を再実行すると、現行比較はcontentとupdatedAtの双方一致を要求するためmismatchとなり、baselinesは空、確認日時はnullになる。旧cursor、初回upload履歴、workspace、migration、pending operation、pushBlock、最終成功時刻は維持される。
- mismatchは通常更新previewの開始条件を満たさない。旧baselineが空になっているため、updatedAt差分だけからbase revisionを推測したり、modified candidateへ自動変換したりしない。既存のbaseline確認を反復してもtimestamp差異は解消しない。
- 復旧は独立した明示操作`baseline rebase`とする。cursor 0から共通full pullを完全取得し、workspace・row・payload・sequence・ページングを検証したうえで、remote/localの日付集合とcontentをメモリ内比較する。Supabaseへの書込みとlocal DayMemo変更は行わない。
- rebase可能条件は、version 2・workspace一致・baselineStatus mismatch・pending operationなし・pushBlockなし・local保存値とReact state一致、remote/local件数と日付集合一致、content全件一致、tombstone／remote-only／local-only／content相違0件である。updatedAt同一または相違は分類して表示し、少なくともtimestamp差異だけならrebaseできる。
- rebase後baselineは各remote rowの`remoteRevision`、`remoteChangeSequence`、payload `updatedAt`を保持し、`baselineLocalUpdatedAt`へ対応localの現在updatedAtを保存する。`lastPulledChangeSequence`は取得最大値、statusはconfirmed、確認日時と最終成功時刻は今回時刻とする。remote payload updatedAtをlocal値で置換しない。
- 保存は元mismatch JSONをexpected valueとするcompare-and-write、完成metadata validator、read-back完全一致を必須とする。失敗時は元metadataへrollbackし、React stateだけをconfirmedへ進めず、自動再実行しない。
- content相違が1件でもある場合はrebaseしない。local/remoteを変更せずmismatchを維持し、日付・分類・revision等だけの差異previewとユーザー判断へ送る。content相違・updatedAt同一は通常編集経路外の疑いがあるため、特に安全停止する。
- 選択肢Aの不要なupsertはrevision/change sequenceを増やすため不採用、選択肢Bのremoteによるlocal上書きも不要なデータ変更のため不採用とする。content相違時だけ選択肢C相当の確認待ちとし、content同一時は選択肢Dのmetadata-only rebaseを正式方針とする。
- rebaseはPC端末内metadataだけを変更する。共通remoteとiPhoneのlocal metadata・更新候補には影響しない。iPhoneの実編集1件はB-3e3対象として維持し、upload前に改めてpreviewとremote revision防壁を確認する。
- Phase B-3e2.5を実装した。対象は有効なowner／parentまたはmember／child接続で、version 2 metadataが同一workspaceにbindされ、`baselineStatus = mismatch`、`pendingOperation = null`、`pushBlock = null`の場合だけである。
- 第1段階の明示previewは既存full pull utilityを再利用し、直列ページングと厳格validatorを通した完全取得後に日付単位で `content_and_updated_at_match`、`content_match_updated_at_diff`、`content_diff`、`remote_only`、`local_only`、`tombstone`、`invalid`、`incomplete`へ分類する。
- rebase可能条件は日付集合・件数・本文の完全一致、tombstone等の危険分類0件、updatedAt差異1件以上である。本文一致かつupdatedAtも全件一致の場合は不要なrebaseを実行しない。
- 第2段階の明示確定では新しいpullを行わず、接続、workspace binding、元mismatch metadataの完全一致、pending／pushBlock、localStorageとReact stateのsnapshot一致を再検証する。
- baselineはremote revision／change sequence／payload.updatedAtと現在local updatedAtを混同せず保存する。最大change sequenceをcursorとし、confirmed日時と成功日時を更新する。
- 保存はvalidator、expected raw比較、1回の書き込み、read-back、失敗時rollbackを備えた既存utilityを使用する。Supabase書き込み、ローカルDayMemo変更、operation ID／pending operation作成、pushBlock解除はない。
- iPhone側の編集状態・metadata・DayMemoには自動で触れず、既存の初回upload、baseline確認、更新候補preview、pull preview／ローカル反映を維持する。PC実機確認、commit、pushは未実施。
- Phase B-3e3では、Phase B-3e2のpreviewが安全なmodified candidateをちょうど1件返した場合だけ、既存remote recordの明示upsertを許可する。
- preflightは既存full pull utilityで完全取得し、全remote recordがconfirmed baselinesと対応し、対象のrevision・change sequence・remote updatedAtが一致することを確認する。不一致、tombstone、不完全取得、local／metadata変化では送信準備を作らない。
- operation IDはpreviewやpreflightでは生成せず、送信準備の明示操作時に既存UUID utilityで1個だけ作る。pendingOperationへdate、operation ID、base revision、local updatedAt、準備日時、statusだけを保存し、本文やdevice IDは保存しない。
- 送信は保存済みpending requestとlocal snapshotを再検証し、statusをsendingとしてread-backした後、`hooto_day_upsert_sync_record`を1回だけ呼ぶ。base revisionはbaselineのremote revisionを使用する。
- 成功結果は`hooto_day_sync_result`の全主要列とpayloadを厳格検証する。成功時だけ対象baselineをRPC結果で更新し、cursorを進め、pendingOperationをnullにする。他日付baseline、initialUpload、workspace binding、migration、pushBlockは維持する。
- conflictはpending statusをconflict、判定不能な応答はresponse_unknownとして維持し、自動解決・自動再送・operation ID再発行を行わない。RPC後のmetadata保存失敗ではsending状態へrollbackされるため、未送信には見せない。
- local DayMemo、PC local、JSONバックアップは変更しない。PCへの自動反映、delete、tombstone、local-only新規upload、競合解決は後続Phaseで扱う。
- iPhone実機確認待ち。SQL変更、commit、pushは未実施。
- iPhone子機・memberで、候補1件のpreview、full pull preflight、pending operation事前保存、明示upsert、厳格な結果検証、baseline更新まで成功した。再読み込み後は候補0件・変更なし7件となり、設計した1件送信フローを確認済み。
- 成功結果UIは対象日付・revision・change sequenceをそれぞれ独立した1行で明確化する余地がある。Phase B-3e3の機能上の問題ではないため、今回はコードを変更せず将来改善候補とする。

## Phase B-3e4準備: local-only新規作成の判定境界

### 定義と分類

- `local_only`はlocalにDayMemoが存在し、現在のconfirmed baselinesに同日がない状態である。remote不在を保証しないため、そのまま新規upsert候補にしてはならない。
- metadata単独では、完全な新規、remote tombstone、baseline欠落を区別できない。remoteの現在状態を正本としてtombstone込みfull pullを完了する必要がある。
- full pull後の正式分類は、`local_new_candidate`、`remote_deleted_candidate`、`unknown_local_only`とする。remote通常recordがあればlocal-only分類自体がstaleであり、新規候補から除外する。

### 新規候補preflight

- 利用条件はauthenticated workspace member、正しいdevice/workspace binding、metadata version 2、baselineStatus confirmed、pendingOperation null、pushBlock null、local DayMemo strict valid、React stateとlocalStorageの完全一致とする。
- cursor 0から既存full pull utilityで全recordを直列取得し、tombstoneを含む完全な現在状態を得る。対象日付についてbaselineなし、remote通常recordなし、tombstoneなしを同時に満たす場合だけ`local_new_candidate`とする。
- full pullがcancelled、limit reached、validation error、RPC error、重複、cursor停止、部分結果の場合は`unknown_local_only`としてfail-closedにする。取得結果をmetadataへ自動保存せず、自動再試行もしない。

### revision・tombstone境界

- remote rowが存在しない新規upsertは`base_revision = 0`、期待revisionは1である。
- tombstoneも物理的には既存rowである。現行SQLは既存revisionとbase revisionを比較するため、tombstoneへbase revision 0を送るとconflictになる。新規uploadからの復活は禁止し、最新tombstone revisionを使う将来の明示復活フローへ送る。
- `remote_deleted_candidate`をlocal newへ自動変換せず、localを削除するかremoteを復活するかの判断はB-3fで扱う。

### operation・既存処理との共通化

- operation IDは送信準備時だけ1日付につき1個生成し、pendingOperationの保存・read-back後にのみRPCを許可する。response unknownとconflictではoperation IDを保持し、blind retryや新ID発行を禁止する。
- B-3e3と、接続再検証、local snapshot、full pull、pending遷移、upsert引数、共通result validator、成功後baseline更新を共有できる。local-only固有部分は「baselineがない」「remote row/tombstoneがない」「base revision 0」「成功revision 1」の判定である。
- 初回uploadはremote全体が空であることを前提に複数初期データを扱い、initialUpload履歴を更新する。local-onlyは既存remote集合へ通常運用で追加するため、初回upload Hookを直接再利用せず、共通utilityだけを利用する。

### pushBlockと実装順

- `json_restore`／`full_reset` pushBlock中は書き込み禁止とする。read-only previewは許可できるが、解除後にfull pullから再判定し、以前のpreviewやoperation準備を再利用しない。
- Phase B-3e4aは分類previewのみ、B-3e4bは安全な1件新規upsert、B-3e4cは複数候補の1件ずつ逐次処理、B-3fはdelete・tombstone・復活判断とする。
- 次の最小実装はB-3e4aである。UIには日付と分類だけを出し、本文、operation ID、UUID、payloadは表示・永続化しない。upsert、pendingOperation作成、baseline更新はまだ行わない。

### Phase B-3e4a実装

- owner/parentとmember/childで共通の専用Hookを使い、version 2・workspace一致・confirmed baseline・pendingOperationなし・pushBlockなし・local storageとReact state一致の場合だけ明示previewを許可する。
- baselineに存在しない有効なローカル日付が0件ならfull pullを呼ばない。候補がある場合だけ、cursor 0、100件、最大20ページ、直列取得、重複・cursor停止・不完全取得拒否を備えた既存共通utilityを使用する。
- 完全取得後にremote行がなければ`local_new_candidate`、tombstoneなら`remote_deleted_candidate`、通常record存在または判定不能なら`unknown_local_only`とする。pull失敗時は全候補をunknownとしてfail-closedにする。
- 結果はReact memory内の日付と分類だけで、破棄時に消去する。DayMemo本文、remote payload、workspace/device UUIDをUI・console・metadataへ出さず、localStorage、baseline、cursor、初回upload履歴、成功日時、pendingOperation、pushBlockを変更しない。
- 本Phaseは読み取り専用であり、upsert/delete、直接テーブル操作、operation ID生成、pendingOperation作成、baseline更新、自動実行、自動再試行を行わない。

### Phase B-3e4b実装

- B-3e4aのmemory内snapshotが新規候補1件だけである場合に限り、明示preflightでcursor 0からfull pullを再実行する。既存baseline全件がremote current recordと一致し、対象日付にcurrent/tombstoneのどちらもない場合だけ準備可能とする。
- operation IDはpreflight後の明示準備時に共通UUID utilityで1個生成し、`kind: upsert`、対象日、base revision 0、local updatedAt、準備日時、prepared状態をpendingOperationへ保存・read-backする。本文はmetadataへ保存しない。
- 送信直前に接続、local snapshot、metadata raw、workspace、confirmed baseline、pending、pushBlock、対象baseline不在を再検証し、pendingをsendingへ保存してからupsert RPCを1回だけ呼ぶ。
- 共通result validatorでapplied、workspace/entity/payload一致、revision 1、preflight cursorより大きいchange sequence、deleted_at null、conflict falseを確認する。成功時だけ新baseline、cursor、確認・成功日時を保存しpendingを解消する。
- conflict、不明response、結果不一致、RPC後metadata保存失敗は未送信扱いへ戻さず、安全確認が必要な状態として自動再試行を禁止する。local DayMemo、初回upload、他baseline、workspace binding、migration、pushBlockは変更しない。

## Phase B-3e5準備: 危険状態の安全停止

### 現行処理とSQL契約

- 通常更新とlocal-only追加は、memory内preview、full pull preflight、UUID生成、pendingのcompare-and-write/read-back、`送信中`保存、1回upsert、共通result validator、成功後baseline保存の順で動く。RPC前の保存失敗はremote未変更、RPC開始後の例外・不正結果はremote状態不明として区別する。
- SQLはoperation ID単位とworkspace/entity単位のtransaction lockを取得する。同一operation ID・同一fingerprintならoperation履歴の保存済み結果を返し、record更新やsequence採番を繰り返さない。fingerprintはworkspace、entity type/id、kind、caller、base revision、schema version、payload、client timestamp、source device、operation IDを含む。
- 同一operation IDを異なるrequestへ使うと例外となる。これは`status = conflict`ではないため、クライアントはresponse unknown／recovery required側へ安全停止させ、エラー全文を表示・保存しない。
- revision不一致は`status = conflict`、`conflict = true`である。既存recordがあれば最新revision、change sequence、server updated time、deletedAt、payloadを返し、recordは更新せずnextvalも行わない。record不在かつbase revisionが0でない場合はrevision/change sequence 0、payload nullのconflictとなる。conflict結果はoperation履歴へ保存される。

### conflictの正式状態

- preflightでremote revision/change sequence/updatedAtや日付集合の変化を検出した場合はoperation IDとpendingを作らず停止する。preflight後のraceでRPC conflictになった場合は、同じoperation IDを含むpendingを`conflict`へ変更して保持する。
- local DayMemo、baseline、cursor、remoteを自動変更しない。自動解決、自動retry、新operation ID生成を禁止し、本文を表示しない競合通知と対象日付、remote再確認が必要な旨だけを示す。
- tombstoneに対する古いrevision upsertもconflictである。最新tombstone revisionによる復活、delete、local削除の扱いはB-3fの明示操作へ分離する。

### response unknownと保存失敗

- RPC前に通信処理へ到達しなかったと証明できる失敗だけはremote未変更である。ただし現行Hookはpendingを`送信中`へ保存してからRPCを開始し、catch内で送信前後を区別できないため、例外は一律response unknownとする。
- RPC送信後・結果受信前の通信断はpendingを`response_unknown`として保持する。新ID発行、blind retry、local変更は禁止し、read-only full pullを必須とする。
- RPC成功後、完成metadata保存前にブラウザが終了した場合はpendingが`送信中`で残る。再起動時は「送信中を再開」せずresponse unknown相当のrecovery requiredへルーティングする。
- 完成metadataのwrite/read-back失敗では保存utilityが直前の`送信中`metadataへrollbackする。remoteは既に更新済みの可能性があるためpendingを消さず、未送信扱いへ戻さない。rollback自体が失敗した場合はmetadata全体をrecovery requiredとして扱う。
- 復旧確認はcursor 0の完全full pullを用いる。対象remoteがcurrentで、entity/date/payloadが現在localと一致し、revisionがpending base + 1、change sequenceが有効で、他baselineも矛盾しない場合に限り、upsertを再実行せずbaseline・cursor・成功日時をmetadata-onlyで確定できる。remote不在、旧revision、tombstone、payload相違、より新しいrevision、不完全pullではpendingを維持する。
- SQL上は同一operation ID・完全同一requestの再送が冪等でも、現行pendingは本文や全fingerprint入力のsnapshotを永続保持しない。したがって復旧Phaseで一致を証明できるまでは同一IDの手動再送も実装せず、新ID再送は常に禁止する。

### pendingOperationとoperation IDの寿命

- `prepared`: 明示準備時に作成。local/metadata/preflight snapshotが一致する間だけRPCへ進める。RPC前なら明示取消設計を将来検討できるが、現行では自動削除しない。
- `sending`: RPC直前に永続化する。プロセス終了後に残っていればremote状態不明であり、自動送信を再開しない。
- `response_unknown`: 例外または結果validator不一致。read-only remote確認が完了するまで保持する。
- `conflict`: SQL conflict確認済み。同じoperation IDを保持し、ユーザーがremote状態を確認するまで削除しない。
- `recovery_required`: pending遷移保存、rollback、またはremote確認を安全に完了できない状態。復旧条件が満たされるまで保持する。
- `applied`: RPC結果検証後から完成metadata保存成功までの論理状態である。現行typeには永続値を追加せず、baseline・cursor・成功日時の保存とread-back成功をもってpendingをnullにする。

### 実装Phaseとテスト境界

- B-3e5a: update/local-only両Hookのconflict、response unknown、`送信中`残留、post-RPC保存失敗の表示と再起動時fail-closedを統一する。
- B-3e5b: pendingを変更せず、明示操作でfull pullしてremote状態を分類するread-only復旧previewを追加する。
- B-3e5c: remote appliedを厳格に確認できた場合だけupsertなしでmetadataを確定する。判断不能では何も変更しない。
- B-3e5d: 本文非表示の競合確認UIと、後続の明示方針選択への入口を追加する。競合解決そのものは別途設計する。
- B-3f: delete、tombstone作成・反映、最新revisionによる復活、local削除を扱う。B-3e5の安全停止から自動でB-3f操作を開始しない。
- 実機conflict試験は専用workspace・専用匿名端末・専用DayMemoを使う。端末Bでrevisionを進め、古いbaselineを持つ端末Aの1回送信がconflictとなり、remote本体とchange sequenceがBの状態から変わらないことを確認する。response unknown試験も専用データで通信遮断を制御し、再送せずfull pull確認する。通常利用データでは実施しない。

## Phase B-3e5a実装: fail-closed状態表示

- 共通安全判定utilityは保存済みmetadataを変更せず読み取り、workspace一致、version 2、confirmed baseline、pendingなし、pushBlockなしの場合だけ`normal`と`canStartUpload = true`を返す。
- pending statusは`conflict`、`response_unknown`、`sending`、`recovery_required`、`prepared`をそれぞれ競合、結果確認待ち、結果確認待ち、復旧待ち、未完了処理へ分類する。metadata不正・storage読取不能・workspace不一致はmetadata invalid、pushBlockまたはbaseline未確認はrecovery requiredとして閉じる。
- update/local-only upload Hookは再読み込み時に共通判定を使い、conflictとresponse unknownを対応する既存stateへ戻す。それ以外の危険状態はrecovery requiredとし、idleへ戻さない。
- 設定画面は安全状態と固定の安全文言だけを表示する。危険状態では新しいupdate/local-only送信preflightを開始できず、自動pull、自動retry、自動修復、operation ID生成、pending上書きを行わない。
- 同一画面で明示準備済みのoperationを送信する既存経路は、memory snapshot、metadata raw、pending、localStorageを再検証するため維持する。一方、再読み込みでmemory snapshotを失ったpendingは再開できず、表示だけで停止する。
- 本Phaseではmetadata型・保存形式、DayMemo、baseline、cursor、JSON backup、SQL/RPCを変更せず、競合解決、unknown remote確認、metadata-only復旧、delete/tombstoneを追加しない。

## Phase B-3e5b実装: read-only remote確認

- pending operationのstatusが`conflict`、`response_unknown`、`recovery_required`または結果未確定の`sending`の場合だけ、「同期先の状態を確認」の明示操作を許可する。
- 確認は既存のfull pull utilityだけを使用する。cursor 0、1ページ100件、最大20ページ、直列取得、重複・cursor停止・不完全取得拒否を維持する。
- `remote_applied`はremote revisionがbase revision + 1、change sequenceが保存済み基準より増加し、現在の正式ローカルDayMemoから安全に再構成できるrequest payloadと一致する場合に限る。
- `remote_not_applied`は、新規操作ならremote／baselineの双方に対象がない場合、既存更新ならremoteが保存済みbaselineのrevision・change sequence・updatedAtと一致する場合に限る。それ以外のremote差異は`conflict_detected`、検証不能・pull失敗・処理中の状態変化は`unknown`とする。
- 結果はReactメモリだけに保持する。pending operation、operation ID、baseline、cursor、local DayMemoは変更せず、upsert／delete、自動retry、自動復旧を行わない。

## Phase B-3e5c実装: remote_appliedのmetadata-only復旧

- remote_applied確認時に限り、workspace、対象日、remote revision／change sequence／payload、deletedAt、conflict、pending snapshot、metadata raw、local DayMemo snapshot、確認時刻をReactメモリへ保持する。payload本文は検証専用でUI・metadata・storageへ出さない。
- 復旧対象pendingはsending／response_unknown／recovery_requiredだけで、conflictを除外する。明示復旧時に確認snapshotと現在の認証、workspace、metadata raw、pending、operation ID、localStorage、React state、payloadを再照合する。
- revisionがbase + 1、change sequence増加、payload完全一致、deletedAt null、conflict false、pushBlockなしを再確認し、既存validator通過後だけ対象baselineをremote値へ更新する。
- lastPulledChangeSequenceは既存値とremote change sequenceの最大、baselineStatusはconfirmed、baselineConfirmedAtとlastSuccessfulSyncAtは復旧時刻、pendingOperationはnullとする。他baseline、initialUpload、migration、workspace、pushBlockは維持する。
- 既存のcompare-and-write／read-back／rollback utilityで1回保存する。失敗時はpending付きrawへrollbackし、rollback失敗を別状態にする。Supabase再送、新pull、自動復旧、remote_not_applied再送、conflict解決は行わない。
- 静的検査と通常状態の回帰確認は完了している。通常状態では復旧ボタンを表示せず、既存送信候補確認を維持する。remote_appliedの実判定、復旧ボタン実行、pendingのnull化、baseline・cursor復旧、normal復帰は未完了pendingを安全に用意できていないため実機未確認である。

## Phase B-3e5d実装: 本文非表示の競合概要

- pending conflictはmetadataから対象日、base revision、baseline change sequence、準備時刻だけを復元表示する。remote revision／change sequenceはread-only確認前には未確認とし、推測値を表示しない。
- 既存recovery checkが`conflict_detected`を返した場合だけ、対象remote recordのrevision／change sequenceと確認時刻をReact stateの競合概要へ追加する。remote payloadとlocal本文は比較処理の外へ出さない。
- 通常状態では競合概要を表示しない。競合中もpending、operation ID、baseline、cursor、local／remote DayMemoを維持し、解決・採用・上書き・retry・cancel操作を提供しない。
- remote再確認はB-3e5bの明示read-only full pullボタンを再利用し、重複pull処理、Supabase書き込み、自動実行を追加しない。
- 通常状態のiPhoneで競合概要が表示されず、既存のupdate／local-only候補確認が利用可能なことを回帰確認済み。conflict発生試験は禁止したままで、pending conflict／conflict_detected時の表示は実機未確認とする。
## Phase B-3f準備：delete／tombstone正式設計

### SQL契約

- 正式RPCは `public.hooto_day_delete_sync_record(target_workspace_id uuid, target_entity_type text, target_entity_id text, base_revision bigint, operation_id uuid, client_updated_at timestamptz default null, source_device_id text default null)` で、`hooto_day_sync_result`を返す。
- 成功結果は`status = applied`、`conflict = false`、`payload = null`、有効な`deleted_at`を持つ。active recordの削除ではrevisionを1増加し、新しいchange sequenceを採番する。
- recordがなくbase revision 0の場合、SQL自体はrevision 1のtombstoneを作成できる。ただしアプリの通常deleteではこの経路を使わず、active baselineが存在するrecordだけを対象にする。
- 現在revisionとbase revisionが一致しない場合は`status = conflict`、`conflict = true`を返し、record更新とsequence採番を行わない。現在recordがあればactive payloadまたはtombstoneを含む現在状態を返す。
- 既にtombstoneでbase revisionが一致する場合は冪等なapplied結果となり、revision・change sequence・deletedAtは増加しない。同一operation ID・同一fingerprintは保存済み結果を返し、異なるfingerprintへのID再利用は例外となる。

### deleteの正式定義とlocal削除意図

- アプリのdeleteは「remote上のactive DayMemoを、ユーザーの明示確認後にtombstoneへ変更する同期操作」であり、local配列からの物理除外そのものではない。
- 現在の`deleteDayMemo(date)`はlocal配列から対象を除くだけである。local不在だけでは、意図的削除、全初期化、JSON復元、保存破損、別端末との差異を区別できないため、full pullの`missing_local`だけからdelete要求を作らない。
- 安全な方式は、DayMemo本文とは分離した同期metadataに「明示的な削除意図」を永続化する方式とする。候補情報はdate、削除判断時のbaseline revision・change sequence・local updatedAt、確認時刻に限定し、本文・operation IDは含めない。
- operation IDをlocal削除時に即時生成してpending deleteを作る方式は採らない。候補previewとremote preflightが完了し、ユーザーが1件送信を準備した時点で初めてpendingへ昇格する。

### metadataとtombstone baseline

- remote tombstoneは`payload = null`、有効な`deletedAt`、revision、change sequence、server updated timeを持つ。pull validatorはこの形式を受理する。
- 現在の`DayMemoSyncMetadataV2.baselines`は`deletedAt`を保持できる一方、confirmed validatorは`deletedAt != null`および`baselineLocalUpdatedAt = null`を拒否する。またpending kindは`upsert`固定である。
- version 2の意味をその場で緩和すると既存端末の安全条件が変わるため、version 3へ安全にmigrationする。version 3ではactive baselineとtombstone baselineの不変条件を分離し、削除意図と`kind = delete`のpendingを正式に表現する。
- active baselineは`baselineLocalUpdatedAt`必須・`deletedAt = null`、tombstone baselineは`baselineLocalUpdatedAt = null`・`deletedAt`必須とする。tombstoneの`remoteUpdatedAt`にはremoteのserver updated timeを使用する。
- JSONバックアップへworkspace-boundなbaseline、削除意図、pendingを混ぜない。復元後はpushBlockの下でread-only full pullから再評価する。

### 分類とdelete preflight

- `local_deleted_candidate`: 明示的な削除意図あり、active baselineあり、localなし、完全full pullのremote active recordがbaselineのrevision・change sequence・updatedAtと一致。
- `local_missing_unconfirmed`: active baselineとlocal不在は確認できるが削除意図なし。deleteへ進めない。
- `remote_deleted_candidate`: remote tombstoneがありlocalも存在する。新規作成や自動local削除として扱わない。
- `remote_deleted_local_missing`: remote tombstoneがありlocalも不在。将来の明示的なmetadata受入候補であり、delete RPC対象ではない。
- `delete_conflict`: remote activeまたはtombstoneがbaselineから変化している。競合確認へ送る。
- `delete_unknown`: pull不完全、validation失敗、workspace不一致、storage／React state不一致などで判定不能。安全停止する。
- delete送信には、認証・workspace binding、version 3、confirmed baseline、明示的な削除意図、local不在、React stateとstorageの一致、pendingなし、pushBlockなし、cursor 0からの完全full pull、remote active状態のbaseline完全一致を必須とする。最初の実装は1日付だけに限定する。

### update／delete競合と復活

- 端末Aのupdateが先に確定し、古いbaselineを持つ端末Bがdeleteした場合、deleteはconflictとして停止する。端末Aの変更を自動削除しない。
- 端末Aのdeleteが先に確定し、古いbaselineを持つ端末Bがupdateした場合、updateはtombstoneとのconflictとして停止する。自動復活しない。
- 優先規則は「先にremoteへ確定したrevision」であり、update優先・delete優先という固定規則は置かない。競合時はlocal・remote・baseline・cursorを変更せずユーザー判断待ちとする。
- tombstone済みdateのlocal DayMemoは`local_new_candidate`ではなく復活候補である。復活upsertのbase revisionは0ではなく最新tombstone revisionとし、成功時に次revisionを作る。復活はB-3f5へ分離する。

### operation IDとpending

- previewではoperation IDを生成しない。完全full pullと明示確認後の送信準備時に、1日付につき1つのUUIDを生成する。
- version 3のpendingは`kind: upsert | delete`の判別可能なunionとする。delete pendingはoperation ID、date、base revision、client updated time、prepared time、statusを保持し、RPC fingerprintを再構成できる値を不変にする。
- 状態は`prepared`、`sending`、`response_unknown`、`conflict`、`recovery_required`を既存upsertと共通化する。`applied`はRPC成功からmetadata保存・read-back完了までの論理的な一時状態とし、完了後だけpendingをnullにする。
- conflict、response unknown、recovery requiredではoperation IDとpendingを保持し、新しいIDでblind retryしない。remote状態を読み取り専用で確認するまで再送しない。

### pushBlock・復元・全初期化

- `json_restore`または`full_reset`のpushBlock中は、削除意図の作成、pending deleteの作成、delete RPCを禁止する。read-only pull／previewは可能だが、tombstoneのlocal反映やmetadata確定は行わない。
- JSON復元後は復元データのlocal不在を削除意図に変換しない。将来の明示的なpushBlock解除後にfull pullし、候補を再分類する。
- 全初期化はlocal全削除をクラウド全削除へ連動させず、削除意図を一括生成しない。

### 実装Phase

1. B-3f1: metadata version 3と安全migrationを追加し、tombstone-aware baseline、削除意図、delete pendingを表現する。RPC・DayMemo変更は行わない。
2. B-3f2: read-only full pullによるdelete／tombstone候補previewと、1日付の明示的な削除意図確認を追加する。Supabase書き込みは行わない。
3. B-3f3: active remote record 1件だけを明示deleteし、結果検証後にtombstone baselineを保存する。
4. B-3f4: remote tombstoneのpull previewと、反映前backupを伴う明示的なlocal削除／metadata受入を追加する。
5. B-3f5: 明示的な復活とupdate／delete競合の判断UIを追加する。複数件直列処理はさらに後続へ分離する。

次に実装する最小PhaseはB-3f1とする。今回は調査と設計文書更新だけで、コード・SQL・RPC・localStorage・DayMemo・metadata・Supabaseを変更しない。

## Phase B-3f1：metadata version 3と安全migration

- version 3はactive baselineとtombstone baselineを同じdate mapで明示的な不変条件により区別する。activeは`deletedAt = null`かつ`baselineLocalUpdatedAt`必須、tombstoneは`deletedAt`必須かつ`baselineLocalUpdatedAt = null`とする。両者ともremote revision／change sequenceは1以上で、confirmedでは最大change sequenceとcursorを一致させる。混在を許可するが、tombstoneは通常upsert候補から除外する。
- `localDeleteIntents`はdate、baseline revision／change sequence、削除前local updatedAt、作成日時、状態だけを保持する。本文、payload、operation ID、device情報は保持しない。pushBlock中は既存意図が残っていても安全状態で送信を禁止し、新しい意図を作成しない。B-3f1では常に空objectから開始し、作成UIは追加しない。
- pending operationは既存upsert形を維持しつつdelete形を追加した判別可能なunionとする。deleteはbase revision 1以上、client deleted time、operation ID、prepared time、安全停止statusを厳格検証する。B-3f1ではdelete pendingを作成しない。
- v2→v3はv2 validator通過後、全既存情報を複製して`localDeleteIntents = {}`を加え、migration履歴を更新する。v1端末は既存v1→v2変換をメモリ上で経由してv3へ進む。不明なtombstoneや削除意図を推測せず、operation IDを生成しない。
- 保存は既存rawとのcompare、1回write、read-back、serialized完全一致、v3 validatorを必須とする。失敗時は元rawへrollbackしてread-backを確認し、旧metadataを空初期化しない。
- 設定画面の明示ボタンは端末内metadataだけを移行する。連打、自動再試行、Supabase通信を行わず、version、tombstone対応の土台、delete未実装、DayMemo本文とSupabaseを変更しないことだけを表示する。
- safety stateはv3 validator、confirmed、pending null、pushBlock null、local delete intentなしをnormal条件とする。delete pendingと未完了delete intentはfail-closedで新規送信を禁止する。tombstone baseline自体は危険状態にしない。
- 初回upload、pull preview、local反映、baseline、rebase、update/local-only upload、recovery、conflict view、JSON復元・全初期化guardはv3を維持するよう更新した。v3をv2へ戻す経路は作らない。
- 本PhaseではSQL・RPC・保存キー・DayMemo形式・JSONバックアップ形式を変更しない。Supabase書き込み、delete送信、tombstone反映、復活、pushBlock解除は未実装で、PC・iPhone実機確認待ちである。

## Phase B-3f2：明示削除意図とread-only delete preview

- 同期済みactive baselineの日付では、通常の確認ダイアログに加えて「端末から削除し同期候補へ記録」と明示する。v3、workspace一致、confirmed、pendingなし、pushBlockなし、同日intentなし、active baseline、React stateとstorage一致を満たす場合だけ実行する。
- 処理はmetadata rawとDayMemo rawを保持し、intent追加metadataのvalidator、compare-and-write、read-backを完了してから対象DayMemoだけをlocal配列から除外する。DayMemo保存・read-back失敗時はmetadataとDayMemoを元rawへrollbackし、React stateは成功後だけ更新する。
- intentには本文を含めず、date、baseline revision／change sequence、削除前local updatedAt、作成日時、`intent_recorded`だけを保存する。operation IDとpending deleteは作成しない。
- local不在だけでは削除意図としない。予定編集画面で本文を空にした従来経路はlocal-only削除のままとし、remote deleteへ昇格させない。
- delete previewはintentが存在する端末の明示操作だけでcursor 0・100件・最大20ページの共通full pullを実行する。完全取得後に`local_deleted_candidate`、`local_missing_unconfirmed`、`remote_deleted_candidate`、`remote_deleted_local_missing`、`delete_conflict`、`delete_unknown`へ分類する。
- previewには日付、baseline／remote revision、baseline／remote change sequenceだけを保持・表示する。本文、payload、UUID、operation IDは保持せず、「確認結果を破棄」でReact stateを消去する。
- intentが1件以上あればsafety stateはnormalにせず、既存update／local-only uploadを停止する。delete previewだけを許可し、自動pull、自動delete、自動retryは行わない。
- intent取消しは本文復元が必要なため未実装とする。delete RPC、tombstone作成・反映、復活、競合解決、pushBlock解除も未実装で、SQLとJSONバックアップ形式は変更しない。実機確認、stage、commit、pushは未実施である。
### Phase B-3f2 delete dialog state separation (2026-07-20)

- DayMemo削除UIは`local_delete`、`sync_delete_ready`、`sync_delete_blocked`を明示的に区別する。
- `local_delete`は同期baselineの対象外だけに通常削除を表示する。`sync_delete_ready`は既存の安全条件をすべて満たす場合だけ、端末削除と削除意図の記録を案内する。
- `sync_delete_blocked`はbaseline未確認・不一致、pending operation、pushBlock、metadata不正、React stateとstorageの不一致などをまとめて安全停止する。通常削除には見せず、無効表示と安全な案内を出し、削除handlerを呼ばない。
- 内部では従来からfail-closedだったが、PCのbaseline mismatch時に通常削除文言へ見えていたため表示を修正した。local DayMemo・metadata・Supabaseは変更せず、実機再確認後に確定する。commit・pushは未実施。
- mismatch保存では`baselines = {}`になるため、対象baselineの有無よりbaselineStatusを先に評価する。metadataを安全に読めない、workspace binding不一致、`not_confirmed`・`confirming`・`mismatch`・`recovery_required`、pending operation、pushBlockはすべて`sync_delete_blocked`へ倒す。
- 通常ローカル削除は、安全確認済みの`confirmed`で対象baselineがない場合、またはvalidator上remote全件空が保証される`remote_empty`でのみ許可する。active baselineがある場合は全条件一致時だけ`sync_delete_ready`とし、それ以外はblockedとする。
- Appの削除handlerも表示booleanではなくdelete modeを正本にする。`sync_delete_blocked`ではhandlerから削除処理へ進まず、local DayMemo、metadata、baseline、cursor、intent、Supabaseを変更しない。実機再確認待ちで、commit・pushは未実施。

## Phase B-3f3：明示deleteによるtombstone作成

- delete preflightはB-3f2の共通full pull結果を一時snapshotとして再利用する。metadata v3、workspace一致、confirmed、pendingなし、pushBlockなし、intent 1件、local不在、remote active、revision・change sequence・updatedAt一致、危険分類0件をすべて満たす場合だけ準備可能とする。
- 操作は「削除状態を確認」「この削除候補を同期」「削除を同期」の3段階に分ける。operation IDは2段階目だけで生成し、delete pendingのcompare-and-write・read-back完了前にはRPCを呼ばない。
- delete pendingは`kind = delete`、date、operation ID、base revision、preparedAt、clientDeletedAt、statusだけを保持する。本文・payloadは保存しない。preparedからsendingへ保存後、明示操作1回だけ`hooto_day_delete_sync_record`を呼ぶ。
- 成功結果は`status = applied`、`conflict = false`、workspace・entity一致、revisionがbase+1、change sequenceがpreflight cursorより増加、server/deleted timestamp有効、payload nullを必須とする。
- 成功後は対象baselineをtombstoneへ置換し、remote revision・change sequence・server updated time・deletedAtを保存する。`baselineLocalUpdatedAt = null`、対象intent削除、cursor・確認日時・最終成功日時更新、pending nullとし、他baseline・initialUpload・migration・pushBlockを維持する。
- conflictとresponse unknownではpending・operation IDを保持する。RPC成功後metadata保存失敗ではrecovery requiredへ安全停止し、未送信扱いへの巻戻し、再送、新ID生成、local DayMemo復元を行わない。
- 本Phaseでは複数delete、競合解決、復活、別端末へのtombstone反映を実装しない。SQL・RPC定義・DayMemo形式・JSONバックアップ形式は変更せず、実機確認、commit、pushは未実施とする。
## Phase B-3f4: tombstone pull application design

### Authoritative receive contract

- `hooto_day_pull_sync_records(workspace, after_change_sequence, limit)` returns the current row for each `day_memo`, ordered by `change_sequence`; it does not return historical revisions or operation IDs.
- An active row requires a validated payload and `deletedAt = null`. A tombstone requires `payload = null`, a valid `deletedAt`, positive revision/change sequence, a valid server-updated timestamp, matching workspace/entity/date, `status = current`, and `conflict = false`. Any mixed or incomplete shape is invalid and must fail closed.
- A complete pull can therefore establish that a date is remotely deleted and supply its deletion time, revision, and change sequence. It cannot identify the deleting device or prove an operation fingerprint.

### Local classification

1. `remote_deleted_local_active`: remote is a valid tombstone, local DayMemo exists and is unchanged from a valid active baseline, and the tombstone is the direct remote successor of that baseline.
2. `remote_deleted_local_modified`: remote is a valid tombstone, local DayMemo exists, but its `updatedAt` differs from `baselineLocalUpdatedAt`. This is a delete conflict even if the content happens to match.
3. `remote_deleted_local_missing`: remote is a valid tombstone and local DayMemo is absent. If the existing baseline is the same tombstone this is an idempotent no-op; if a matching active predecessor or delete intent exists it is a metadata-reconciliation candidate, not a second local deletion.
4. `remote_deleted_unknown`: the pull is incomplete, any validator/workspace/storage/state check fails, the baseline is absent or incompatible, the remote revision is not the expected successor, or the state cannot otherwise be proven. No local or metadata change is allowed.

`remote_deleted_local_active` is eligible for explicit application only when all of the following remain true immediately before writing:

- authenticated workspace connection and metadata workspace binding match;
- metadata version 3 is valid and `baselineStatus = confirmed`;
- a valid active baseline exists for the date, with `deletedAt = null` and non-null `baselineLocalUpdatedAt`;
- local storage and React state contain exactly one valid memo for the date and its `updatedAt` equals `baselineLocalUpdatedAt`;
- the complete full pull contains exactly one valid tombstone for the date, with `revision = baseline.remoteRevision + 1` and `changeSequence > baseline.remoteChangeSequence`;
- no pending operation, local delete intent, push block, conflict, duplicate row, incomplete pull, or concurrent state change exists.

The comparison uses exact revision/change-sequence lineage; merely seeing a tombstone or a later timestamp is insufficient. A locally modified memo is never auto-deleted and moves to user-decision handling without changing local data, remote data, baseline, or cursor.

### Explicit application and metadata

- Adopt preview-then-explicit-apply, not immediate or automatic deletion. Preview is read-only and displays only date/classification/revision/change sequence; it does not expose content or secrets and is not persisted.
- B-3f4b must create a verified pre-apply backup, revalidate the connection, metadata raw value, DayMemo raw value, preview snapshot, and complete remote result, then remove only the confirmed date from `hootoDay.dayMemos` in one verified write.
- Only after the DayMemo write succeeds and is read back may metadata replace the active baseline with a tombstone baseline: remote revision, remote change sequence, remote server-updated time, `baselineLocalUpdatedAt = null`, and remote `deletedAt`. `lastPulledChangeSequence`, baseline confirmation time, and last-success time may then advance consistently.
- If metadata save/read-back fails, restore both the original DayMemo raw value and original metadata raw value. A rollback failure enters `recovery_required`; it must never be reported as successful deletion or retried automatically.
- A matching tombstone baseline with no local memo is a stable normal state. A tombstone baseline with an unexplained local memo is not normal and must be classified for conflict/resurrection handling.

### Delete intent, safety state, and boundaries

- Pull results contain no operation ID or fingerprint, so `localDeleteIntent` cannot establish who performed the remote delete. It may be reconciled only when its recorded base revision/change sequence and the received direct-successor tombstone agree, after an explicit confirmation step. Preview never removes an intent.
- A `kind = delete` pending operation takes precedence over ordinary tombstone pull handling. Conflict, response-unknown, sending, or recovery-required pending state remains fail-closed and is handled by a delete-aware recovery phase; it is not cleared by B-3f4 preview/apply.
- A tombstone baseline by itself permits the normal safety state when metadata is valid and pending operation, local delete intent, push block, conflict, and unexplained local memo are all absent.
- During `json_restore` or `full_reset` push block, read-only tombstone preview is allowed, but local application, metadata/cursor update, intent clearing, upload/delete, and push-block release are prohibited.
- Resurrection, choosing local versus remote in a delete conflict, operation attribution, and update/delete conflict resolution remain B-3f5. No automatic resurrection is allowed.

### Implementation split

1. **B-3f4a — tombstone pull preview:** reuse the complete full-pull utility, classify all candidate dates read-only, retain results only in React memory, and make no local or metadata changes.
2. **B-3f4b — one explicit local application:** apply exactly one `remote_deleted_local_active` item with backup, compare-and-write, read-back, metadata tombstone conversion, and rollback.
3. **B-3f4c — multiple tombstones:** add bounded sequential handling only after the single-item path is verified; never treat a batch as an all-or-nothing cloud delete.
4. **B-3f5 — resurrection and delete conflicts:** provide user-decision flows without automatic merge, retry, or resurrection.

The next smallest implementation phase is B-3f4a. This design step changes documentation only and performs no Supabase call, RPC, localStorage/DayMemo/metadata mutation, commit, or push.
## Phase B-3f4a：tombstone pull preview実装

- owner/parentとmember/childの共通Hookから、設定画面の「削除状態を確認」を押した場合だけcursor 0・100件・最大20ページの既存full pull utilityを呼ぶ。自動実行・自動再試行は行わない。
- 開始条件は認証済み、workspace接続・binding一致、metadata version 3 validator通過、`baselineStatus = confirmed`、確認日時あり、pending operationなし、pushBlockなし、React stateとDayMemo storage一致である。
- 完全取得したremote tombstoneだけを対象とし、active baselineの直後revisionかつ新しいchange sequenceでlocal updatedAtがbaselineと一致すれば`remote_deleted_local_active`、local updatedAt相違なら`remote_deleted_local_modified`、localなしなら`remote_deleted_local_missing`、系譜・baselineを安全確認できなければ`remote_deleted_unknown`とする。
- pull失敗、不完全取得、metadata/local状態変化では部分結果を採用せず安全停止する。previewはReact stateだけに保持し、明示破棄または再読み込みで消去する。
- UIは件数、日付、分類、remote revision、change sequence、deletedAtだけを表示し、本文、payload、UUID、operation ID、token、内部例外全文は表示しない。
- 本Phaseは読み取り専用previewだけであり、DayMemo削除、tombstone baseline・cursor・intent・pending・safety state変更、upsert/delete RPC、復活、競合解決、pushBlock解除を行わない。B-3f4bの明示反映は実機preview確認後に分離する。
## Phase B-3f4b：tombstone 1件の明示local反映

- B-3f4aのReactメモリ内snapshotを一度だけ利用し、`remote_deleted_local_active`が1件だけで他分類0件の場合に限り明示反映する。preview破棄・再読み込み・local/metadata変化後は再previewを必須とする。
- 反映前にmetadata version 3、workspace binding、confirmed baseline、pending null、pushBlock null、localDeleteIntents空、metadata/DayMemo raw完全一致、local updatedAt一致、remote revisionがbaseline+1、change sequence前進を再検証する。
- DayMemo完成配列を1回verified write/read-backし、その後metadataをverified write/read-backする。成功metadataは対象baselineをpayloadなしのtombstone状態へ置換し、remote revision/change sequence/server updated time/deletedAt、`baselineLocalUpdatedAt = null`、cursor、確認日時、最終成功日時を保存する。他baseline、workspace、initialUpload、migration、pushBlockは維持する。
- DayMemo保存失敗は内部rollbackを確認する。metadata構築・保存失敗時は元DayMemo rawへ戻し、metadata保存utilityのrollbackも確認する。どちらかのrollbackを確認できなければ`recovery_required`として停止し、自動retryしない。
- remote modified/missing/unknown、intentあり、pendingあり、pushBlockありでは反映しない。Supabase RPC、operation ID、pending、intent変更、復活、競合解決、複数件処理は含めない。
## Phase B-3f5: resurrection and update/delete conflict design

### Resurrection definition and RPC contract

- Recreating a DayMemo for a date whose remote baseline is a tombstone is a **resurrection**, not a new entity. The date remains the same `entity_id`.
- Resurrection uses `hooto_day_upsert_sync_record` with the latest verified tombstone revision as `base_revision`. Base revision `0` is prohibited because the remote row already exists and the SQL contract returns a conflict for a mismatched base revision.
- When the tombstone revision matches, the current SQL upsert contract can write the new payload, increment revision by one, allocate a new change sequence, and clear `deleted_at`. No SQL/RPC change and no new operation kind are required.
- A complete full pull must confirm the same workspace, date, tombstone revision, change sequence, and deletion timestamp immediately before preparation. A historical or cached tombstone alone is insufficient.

### Eligibility and explicit UI

Resurrection is eligible only when all conditions below are proven:

- valid metadata version 3 and matching workspace binding;
- `baselineStatus = confirmed` and a valid tombstone baseline for the date;
- complete full pull with exactly the expected current tombstone;
- one valid local DayMemo for the same date, with valid content and `updatedAt`;
- React state and `hootoDay.dayMemos` storage are identical;
- no pending operation, push block, local delete intent, conflict, unknown result, or concurrent metadata/local change.

The UI must use a separate explicit action such as 「削除済みDayMemoを復活」. It may show only the date, baseline/remote revision, change sequence, and safe status. It must not show DayMemo content, payload, UUIDs, operation ID, credentials, or internal exception text. Automatic resurrection and treating the item as an ordinary local-only upload are prohibited.

### Pending operation and operation ID

- Read-only resurrection preview creates no UUID, operation ID, or pending operation.
- Explicit preparation generates one operation ID for one date and persists a `kind = upsert` pending operation before the RPC, using the existing verified write/read-back path. A distinct `restore` kind is unnecessary because the SQL operation and fingerprint are upsert; the preview/UI classification supplies the resurrection meaning.
- The base revision is the verified tombstone revision and the expected applied revision is `baseRevision + 1`.
- On success, baseline/cursor metadata is updated and read back before pending becomes null. On conflict, response unknown, or recovery required, pending and operation ID remain unchanged; no new ID, blind retry, automatic retry, or automatic cancellation is allowed.

### Update/delete conflict ordering

- Concurrent update and delete use optimistic revision control. Whichever valid operation is serialized first advances the remote revision; the operation using the now-stale base revision returns conflict without changing remote state.
- There is no permanent “delete wins” or “update wins” policy. Remote revision order is authoritative only for detecting which operation was applied first, not for automatically choosing user intent.
- If update succeeds before delete, the stale delete stops as conflict. If delete succeeds before update, the stale update stops as conflict and must not implicitly resurrect the tombstone.
- Conflict handling preserves local DayMemo, remote row/tombstone, baseline, cursor, pending operation, and operation ID. The UI may show date, baseline/remote revision, baseline/remote change sequence, status, and confirmation time only. Merge, retry, local adoption, remote adoption, and content display remain out of scope.

### Delete intent, safety state, and restore/reset boundaries

- A remaining `localDeleteIntent` blocks resurrection. Pull data cannot attribute the deleting operation, so intent reconciliation must be a separate explicit recovery step before resurrection can be prepared.
- A valid tombstone baseline with no local memo is normal. A local memo on a tombstone baseline is a resurrection candidate and must be excluded from ordinary update and local-only upload paths until the resurrection preview proves it safe.
- Pending, conflict, response unknown, recovery required, invalid metadata, incomplete pull, unknown lineage, or push block is fail-closed. Read-only inspection may remain available where already permitted, but no mutation is allowed.
- During `json_restore` or `full_reset` push block, resurrection and delete are prohibited. The block is never cleared automatically; after the dedicated unblock phase, full remote/local classification must run again.

### Implementation phases

1. **B-3f5a — resurrection candidate preview:** read-only full pull, classify tombstone-baseline/local-active dates, and retain results only in React memory.
2. **B-3f5b — one explicit resurrection:** prepare and submit one verified upsert using the latest tombstone revision, then update metadata only after validated success.
3. **B-3f5c — delete-aware conflict confirmation UI:** extend read-only recovery/conflict information for both upsert and delete pending operations without resolving either.
4. **B-3f5d — explicit conflict decision and recovery:** design and implement user-directed choices separately; automatic merge, retry, and resurrection remain prohibited.

The next smallest implementation phase is B-3f5a. This preparation changes documentation only and performs no source/package/SQL/RPC change, Supabase call, localStorage/DayMemo/metadata mutation, stage, commit, or push.
## Phase B-3f5a: resurrection candidate read-only preview

- Candidate discovery starts from valid local DayMemos whose dates have a version 3 tombstone baseline. If there are no such dates, no pull is performed.
- Only an explicit settings action starts the existing complete full-pull utility: cursor 0, page size 100, at most 20 sequential pages, ascending change sequence, duplicate/cursor-stall/limit/incomplete-result rejection, and no automatic retry.
- `resurrection_candidate` requires the current remote row to remain the exact tombstone recorded by the baseline: payload null, matching deletion timestamp, revision, and change sequence, with no local delete intent or pending operation.
- `resurrection_conflict` covers a remaining delete intent or a changed/missing/active remote row that no longer matches the tombstone lineage. `resurrection_unknown` covers state, metadata, workspace, storage, or validation conditions that cannot be proven safely.
- Results exist only in React memory and expose date, classification, tombstone revision, change sequence, and deletion time. Discard and page reload remove them. DayMemo content and remote payload are never displayed or persisted.
- This phase performs no upsert/delete, operation-ID generation, pending creation, resurrection, local DayMemo mutation, metadata/baseline/cursor update, intent change, or push-block release.
## Phase B-3f5b: one explicit tombstone resurrection upsert

- The write path is available only for exactly one `resurrection_candidate` with zero conflict/unknown classifications. It requires explicit preflight, explicit preparation, and a separate explicit upload action.
- Preflight reruns the complete full pull and requires every current remote row to match metadata baselines. The target must still be the exact tombstone from the preview and metadata/local raw snapshots must remain unchanged.
- Preparation alone creates one UUID v4 operation ID and verified-writes a `kind = upsert` pending operation. Its base revision is the tombstone revision, never zero; its prepared local timestamp is the existing local DayMemo `updatedAt`.
- The upload revalidates workspace, device, pending, operation ID, tombstone baseline, local snapshot, absence of local delete intent, and absence of push block before invoking `hooto_day_upsert_sync_record` once.
- Applied validation requires status applied, no conflict, matching workspace/entity/payload, revision `base + 1`, increased change sequence, and `deletedAt = null`. Only then is the tombstone baseline replaced with an active baseline and pending cleared after verified metadata save/read-back.
- Conflict and response unknown retain the same pending operation and operation ID. A post-RPC metadata failure is never converted back to unsent and never retried automatically. Local DayMemo content is not modified by resurrection.
## Phase B-3f5c preparation: delete-aware conflict inspection

### Authoritative conflict model

- Both mutation RPCs lock the entity and compare the current revision with `base_revision`. The first committed valid mutation advances revision/change sequence; a later stale mutation returns `status = conflict`, `conflict = true`, and the current remote row without changing it.
- There is no automatic delete-wins or update-wins rule. A conflict never changes local DayMemo, local delete intent, baseline, cursor, pending operation, operation ID, or remote state.
- The operation ID remains bound to its original request fingerprint. Conflict inspection must not retry it, generate a replacement ID, merge content, or choose local/remote automatically.

### Formal classifications

| Classification | Local evidence | Remote evidence from complete pull |
| --- | --- | --- |
| `local_update_remote_deleted` | `kind = upsert`, active baseline, base revision equals baseline revision, valid local memo matching `preparedLocalUpdatedAt` | tombstone with revision greater than base |
| `local_delete_remote_updated` | `kind = delete` and matching localDeleteIntent, or an intent-only delete candidate; active baseline/base lineage is valid | active record with revision greater than the delete base |
| `resurrection_remote_updated` | `kind = upsert`, tombstone baseline, base revision equals tombstone revision, valid recreated local memo | active record with revision greater than base |
| `resurrection_newer_tombstone` | same resurrection evidence | tombstone with revision greater than base |
| `local_create_remote_changed` | `kind = upsert`, base revision 0, no baseline | any current remote active row or tombstone; do not mislabel as update/resurrection |
| `remote_state_unknown` | locally coherent request may exist | pull incomplete/cancelled, row missing, duplicate, validation failure, invalid active/tombstone shape, or lineage cannot be proven |
| `pending_metadata_mismatch` | pending workspace/date/kind/base/status does not agree with baseline, local memo, delete intent, or storage/React snapshot | remote classification is not attempted or trusted |

An upsert pending does not contain an explicit update/resurrection subtype. The discriminator is authoritative baseline state: active baseline means update; tombstone baseline with the same base revision means resurrection; base zero with no baseline means local creation. A delete pending must agree with the active baseline and its localDeleteIntent. If these invariants do not hold, use `pending_metadata_mismatch` rather than guessing.

### Read-only inspection

- The user explicitly presses 「競合状態を確認」. Reuse `pullAllDayMemoSyncRecords` with cursor 0, page size 100, at most 20 sequential pages, ascending change sequence, duplicate rejection, cursor-stall rejection, hard-limit/incomplete-result rejection, and no automatic retry.
- Re-read metadata and local storage before and after pull. Require version 3, workspace binding, the same raw metadata, the same pending/intent/baseline, and the same React/storage local snapshot. A change during inspection produces `remote_state_unknown` or `pending_metadata_mismatch` and discards partial conclusions.
- The current recovery hook only accepts checkable `kind = upsert` pending operations. B-3f5c should extend or factor its read-only classifier to support `kind = delete` and a coherent intent-only delete candidate without duplicating the full-pull implementation.
- Inspection writes nothing: no metadata, baseline, pending, intent, local DayMemo, cursor, remote row, safety state, or operation ledger change.

### Presentation and retention

Allowed fields are date, conflict classification, local operation (`update`, `delete`, `resurrection`, or `create`), local base revision, remote revision, baseline and remote change sequences, remote state (`active`, `deleted`, `unknown`), pending status, inspection time, and a safe next-step label.

Forbidden fields are DayMemo content, payload or content comparison, workspace/device/user UUID, operation ID, credentials/session, internal exception text, and raw metadata. Payload may be validated internally only to distinguish a valid active row from a tombstone; its content must not be retained in the UI result.

Preview results live only in React memory and disappear on discard/reload. Discard never clears the underlying conflict pending, operation ID, baseline, localDeleteIntent, or safety state. Suggested next-step text is limited to re-run read-only inspection, run the existing recovery check where applicable, remain stopped, or wait for an explicit resolution phase.

### Safety and multiple conflicts

- Conflict remains fail-closed. Do not return safety to normal and do not enable update, delete, resurrection, or local-only upload. Only read-only pull/recovery inspection is allowed.
- Metadata currently permits one global pending operation, so a pending conflict is singular. The result model should nevertheless be an array so future multiple intents/candidate dates can be listed safely. Resolution remains one date at a time; no batch resolution.
- Intent-only delete inspection must preserve the intent. A pending delete conflict must preserve both pending and intent. Upsert conflicts preserve the local memo and pending. No inspection result is persisted.

### Follow-up phases and minimal B-3f5c files

1. **B-3f5c:** implement read-only delete-aware classification and UI only.
2. **B-3f5d1:** explicitly adopt one verified remote state, with separate active/tombstone safety rules.
3. **B-3f5d2a:** read-only eligibility check for abandoning the stale local operation and preparing a new request.
4. **B-3f5d2b:** one explicit new-operation preparation/send flow. This is not a retry; the stale pending must first be resolved through an audited transition.
5. **B-3f5d3:** verify baseline, pending, intent, cursor, and normal safety restoration after resolution.

The minimal B-3f5c implementation candidates are `src/hooks/useDayMemoSyncRecoveryCheck.ts` or a new focused `src/hooks/useDayMemoConflictPreview.ts`, `src/components/ThemeSettings.tsx`, `src/App.tsx` only if a new hook is introduced, and the two design documents. Reuse `src/utils/dayMemoSyncPull.ts`; avoid changing metadata types/storage, SQL, RPCs, upload hooks, or DayMemo storage.

## Phase B-3f5c implementation: delete-aware read-only conflict preview

- `useDayMemoConflictPreview` is enabled only for a validated version 3 workspace containing a conflict pending operation or a conflict-marked local delete intent. It never runs automatically.
- The hook reuses `pullAllDayMemoSyncRecords` and compares one immutable pre-pull metadata/local snapshot with the post-pull snapshot. A changed raw metadata value, changed DayMemo storage, cancelled/incomplete pull, or invalid lineage produces a safe unknown/mismatch result.
- Upsert intent is derived without changing metadata: active baseline means update, tombstone baseline means resurrection, and base revision zero without a baseline means local creation. Delete requires an active matching baseline, matching delete intent, and an already absent local memo.
- A newer tombstone during update becomes `local_update_remote_deleted`; a newer active row during delete becomes `local_delete_remote_updated`; resurrection distinguishes newer active and newer tombstone; local create with any current remote row becomes `local_create_remote_changed`.
- The rendered result contains only safe scalar facts. Remote payload is used transiently by the shared pull validator and is not copied into preview state or rendered.
- Discard invalidates the active generation and clears React state only. Pending operation, operation ID, localDeleteIntent, baseline, cursor, local DayMemo, remote records, and safety state remain unchanged.
- This phase adds no resolution, selection, retry, merge, metadata save, operation ID generation, mutation RPC, SQL change, or automatic action. Device testing remains pending; commit and push are not performed in the implementation phase.

### Display-condition verification

- Wiring from the hook through `App.tsx` to `ThemeSettings.tsx` is complete. The panel is intentionally eligible only for `pendingOperation.status = conflict` or a `localDeleteIntent.status = conflict`.
- A normal device does not show the conflict action. A baseline mismatch or recovery-required safety state without a conflict pending/intent also does not show it, because date, local operation, and base revision cannot be proven safely from mismatch alone.
- Response-unknown and recovery-required handling remains the responsibility of the existing read-only recovery check. The conflict preview remains narrowly responsible for explicit conflict evidence; its eligibility condition is unchanged.
- Verified on PC/iPhone: normal and mismatch-only states remain hidden, there is no automatic pull, retry, or resolution, and no pending, intent, baseline, or metadata mutation occurs from rendering.
- Not yet device-tested: actual conflict-pending visibility, conflict-intent visibility, execution of the read-only full pull, each classification presentation, and multiple-conflict listing. No artificial conflict was created; these cases remain for a dedicated safe test phase or a naturally occurring conflict.

## Phase B-3f5d1 preparation: explicit adoption of one remote state

### Eligibility and final preflight

- Adoption is an explicit one-item conflict-resolution operation, never an automatic consequence of preview. Require version 3 metadata, matching authenticated workspace connection, `baselineStatus = confirmed`, no push block, exactly one selected safe conflict item, and a proven active or tombstone remote row with valid revision/change sequence.
- Reject `remote_state_unknown`, `pending_metadata_mismatch`, zero/multiple selected items, missing remote rows, incomplete pull, invalid metadata/payload, workspace mismatch, or any change to local storage, metadata raw value, pending, intent, baseline, connection, revision, or change sequence since preview.
- Immediately before presenting the final apply action, run the shared complete full pull again. Reconcile every non-target date against its baseline/local state; do not resolve one target while silently skipping another remote/local/baseline difference.
- The preflight snapshot may retain the strictly validated target payload in an in-memory ref for active adoption, but the UI result must not expose or persist its content.

### Active and tombstone adoption

- **Remote active:** validate date/content/updatedAt with the authoritative DayMemo validator, replace the same-date local memo or add it if absent, preserve all other dates, reject duplicates, and store an active baseline whose local timestamp equals the adopted remote payload timestamp.
- **Remote tombstone:** remove the same-date local memo while preserving all others. If it is already absent and the immutable snapshots still prove the same conflict target, allow metadata-only completion. Store revision, change sequence, server updated time, `baselineLocalUpdatedAt = null`, and validated `deletedAt` in a tombstone baseline.
- A normal tombstone pull apply requires no pending and no intent. Conflict tombstone adoption is different: it consumes the explicitly selected conflict and clears only its associated pending/intent after the local and metadata result has been verified.
- Neither path calls upsert/delete RPCs, changes the remote row, generates an operation ID, retries the stale operation, or adopts a local payload remotely.

### Save order, rollback, and completion

1. Hold immutable metadata raw, local serialized snapshot, React signature, pending, intent, baseline, connection, and selected remote snapshot.
2. Optionally require the existing verified pre-apply backup to be saved/reused without changing its format; an unrelated existing backup blocks adoption rather than being overwritten.
3. Write the complete local DayMemo array once and verify strict read-back.
4. Build and validate completed metadata containing the adopted baseline, target pending cleared, target intent removed, safe cursor/timestamps, and preserved unrelated fields.
5. Save metadata with expected-raw compare-and-swap and verify read-back.
6. Adopt the verified local array into React state, then discard the preview.

Metadata-first is unsafe because it can clear fail-closed state while local content is still stale. Before metadata success, any local write/read-back or metadata validation/save failure must attempt verified local rollback. Metadata storage already rolls itself back; if either rollback cannot be proven, enter recovery-required UI and never retry automatically. After verified metadata success, a React update failure leaves storage authoritative and requires reload/recovery rather than reversing completed storage.

Pending becomes null and the target intent is removed only inside the fully validated completed metadata written after local read-back. The stale operation ID is discarded with its pending because explicit remote adoption will never resend that request; no new ID is generated. Active adoption abandons the local delete intent, while tombstone adoption completes the same intended result. Unrelated intents remain untouched.

### Baseline status and cursor

- Starting from mismatch is not eligible. Final full-pull preflight must prove that all non-target baselines/local records remain coherent. Only then can the completed metadata preserve/confirm the global baseline state.
- Metadata `confirmed` alone does not imply normal safety: any unrelated pending, intent, push block, or detected discrepancy keeps the device fail-closed. If another conflict exists, do not start this one-item adoption; resolve and re-preview sequentially.
- Set `lastPulledChangeSequence` to `max(existing cursor, adopted record change sequence)`. Never advance it to the full-pull maximum unless every intervening record is also represented by a verified baseline; otherwise later remote changes could be skipped.

### UI, discard, and phases

- UI stages are conflict inspection, one-item selection, final remote recheck, impact confirmation, and explicit apply. Use 「同期先の内容をこの端末へ反映」 for active and 「同期先の削除状態をこの端末へ反映」 for tombstone.
- Show date, remote state, revision/change sequence, local operation, and explicit effects on local memo/pending/intent. Never show content, payload, identifiers, credentials, raw metadata, or internal errors. Active adoption must warn: 「この端末の内容は同期先の内容へ置き換わります」 even though content remains hidden.
- Before persistence starts, discard clears React-only preparation. Once persistence starts, disable discard until success, verified rollback, or recovery-required termination. All uploads/deletes/resurrection/local-only actions remain disabled throughout.
- Multiple conflicts may be listed but never batch-adopted. After one adoption, discard stale snapshots and require a new full pull and conflict preview.

Split implementation into B-3f5d1a (read-only candidate selection/final preflight), B-3f5d1b (one active adoption), B-3f5d1c (one tombstone adoption), and B-3f5d1d (post-adoption pending/intent/baseline/safety verification). The next smallest phase is B-3f5d1a.

Minimal future files are a focused `useDayMemoRemoteAdoptionPreflight.ts`, the existing conflict-preview snapshot provider, `App.tsx`, `ThemeSettings.tsx`, and the design documents. Active/tombstone write phases can share a focused apply hook plus existing `dayMemoStorage`, `dayMemoSyncStorage`, full-pull, validators, and verified rollback utilities. Avoid SQL/RPC, metadata-schema, DayMemo-format, syncConnection-format, and JSON-backup-format changes.

## Phase B-3f5d1a implementation: remote adoption selection and final preflight

- `useDayMemoConflictPreview` now retains one cloned adoption snapshot per safe conflict item in React memory only: safe item fields, metadata raw, serialized/local memo snapshot, pending, intents, target baseline, workspace binding, and the validated remote record. Unsafe unknown/mismatch items never receive an adoption snapshot.
- `useDayMemoRemoteAdoptionPreflight` permits a single radio selection. Selection performs no pull and no write. Only the explicit final-check action runs the existing complete full-pull utility.
- Final preflight requires version 3 metadata, confirmed baseline, no push block, unchanged metadata raw/local serialization/React signature/pending/intents/target baseline, unchanged authenticated workspace, and an exactly matching remote record including revision, sequence, active/tombstone state, timestamps, and validated payload shape.
- Every non-target date is reconciled across full-pull records, baselines, and local memos. Remote-only, local-only, content/timestamp mismatch, tombstone mismatch, unrelated pending, or unrelated intent blocks readiness and is exposed only as a count.
- Active preflight builds a sorted, duplicate-free full local candidate array with the strict validated remote payload replacing/adding the target. Tombstone preflight builds the array without the target, including a metadata-only effect when the target is already absent. Candidate arrays and payload references remain in memory and are never rendered or persisted.
- Results are `ready_remote_active`, `ready_remote_tombstone`, `blocked_snapshot_changed`, `blocked_remote_changed`, `blocked_other_mismatch`, `blocked_invalid_remote`, or `blocked_unknown`. The UI shows safe scalar fields, impact text, and the next-Phase message only.
- Discard invalidates the pull generation and clears selection, snapshots, candidate array, result, and safe error state. It never changes localStorage, metadata, baseline, cursor, pending, intent, local DayMemo, or remote data. Reload does not restore preflight state.
- Conflict safety remains fail-closed. This phase has no adoption write, rollback implementation, operation ID generation, mutation RPC, retry, merge, or conflict resolution. B-3f5d1b/c remain unimplemented; device preflight cannot be exercised without a real safe conflict.

## Phase B-3f5d1b: explicit local adoption of one remote active record

- Only one `ready_remote_active` result from B-3f5d1a can be applied, and only through the explicit “同期先の内容をこの端末へ反映” action. A final read-only full pull revalidates the target remote row, every non-target date, metadata raw value, local snapshot, pending, intent, baseline, workspace, and React state immediately before persistence.
- The strictly validated remote payload replaces the same-date local DayMemo or is added when absent. Every other date is preserved, duplicate dates are rejected, and content is never rendered, logged, or stored in sync metadata.
- The existing verified pre-apply backup must be saved or safely reused before mutation. The complete local array is written once and read back before completed metadata is built, validated, saved, and read back; metadata-first completion is prohibited.
- Completion stores an active baseline using the remote revision, change sequence, and payload updated time. The cursor becomes `max(existing cursor, target change sequence)`. Only the target pending operation and target delete intent are resolved; unrelated metadata fields and other baselines remain unchanged.
- Local or metadata failure uses existing verified rollback behavior. If rollback or the final storage state cannot be proven, the flow stops as `recovery_required` without automatic retry or speculative reversal.
- This Phase does not call upsert/delete RPCs, generate or replace an operation ID, change remote data, apply tombstones, merge conflicts, or automatically resolve anything. B-3f5d1c remains responsible for remote tombstone adoption.
- Static validation and normal-state regression checks are pending at implementation handoff. A real `ready_remote_active` conflict and the explicit adoption action have not been device-tested. Commit and push have not been performed.

## Phase B-3f5d1c: explicit local adoption of one remote tombstone

- Only one `ready_remote_tombstone` result from B-3f5d1a is eligible, and only through the explicit “同期先の削除状態をこの端末へ反映” action. Immediately before persistence, a read-only complete full pull must prove the same tombstone and unchanged target/non-target, metadata, local, pending, intent, baseline, workspace, and authentication snapshots.
- If the target local DayMemo exists, remove only that date and preserve every other validated memo. If it is already absent, permit metadata-only completion only when the same pending or delete intent plus baseline lineage proves the selected conflict; do not perform a redundant localStorage write.
- For a local deletion, require the existing verified pre-apply backup and strict local write/read-back before metadata. For metadata-only adoption, revalidate absence and unchanged snapshots before metadata. Metadata-first clearing of fail-closed state is prohibited.
- Store a tombstone baseline with target revision/sequence, validated deleted time, `baselineLocalUpdatedAt = null`, and remote `serverUpdatedAt` as `remoteUpdatedAt` because the current metadata validator requires a valid timestamp. Advance the cursor only to `max(existing cursor, target sequence)`.
- Clear only the matching pending operation and target local delete intent inside completed metadata after every applicable local/metadata validation, save, and read-back succeeds. Preserve unrelated baselines/intents and all other metadata fields.
- Reuse verified rollback utilities. Failure to prove restored local and metadata state enters `recovery_required`; never retry automatically or reverse a verified completed metadata write speculatively.
- This Phase does not alter remote active adoption, call mutation RPCs, modify remote data, generate an operation ID, resend a local operation, merge, or batch-adopt conflicts.
- A real safe tombstone conflict, local deletion path, metadata-only path, rollback, and reload persistence remain device-untested. No Supabase operation, commit, or push has been performed during implementation.

## Phase B-3f5d1d: read-only post-adoption verification

- An explicit “remote採用後の状態を確認” action runs the shared complete full pull and compares current local DayMemos, version 3 metadata, pending, intents, baselines, cursor, workspace, and remote rows. Rendering and verification never write persistent state.
- When an active/tombstone adoption success result remains in React memory, verify its exact date, revision, and sequence. Active verification requires a strict remote payload equal to the one same-date local memo and matching active baseline timestamps. Tombstone and metadata-only verification require a valid remote tombstone, no same-date local memo, and a matching tombstone baseline.
- Reuse the preflight consistency comparison as a detailed summary for all non-target dates: remote-only, local-only, content mismatch, updatedAt mismatch, active/tombstone mismatch, missing baseline, and revision-lineage mismatch. Only counts and safe scalar fields reach the UI.
- Classify results as `adoption_verified_normal`, `adoption_verified_target_only`, `adoption_pending_remaining`, `adoption_target_mismatch`, `adoption_cursor_invalid`, or `adoption_state_unknown`. These are read-only presentation states and never force the persisted safety state to normal.
- A different-date global pending or intent prevents overall normal but is not mislabeled as an unresolved target operation. A target pending/intent remaining receives the dedicated pending classification. Cursor validity for a known target means the stored cursor is at least its adopted sequence; later remote rows alone do not invalidate it.
- After reload, if no safe in-memory adoption result exists, do not infer an adopted date. Run only an overall consistency check and label the scope accordingly. No new persistence field is introduced.
- Discard clears only React result/error/remote comparison state. No localStorage, DayMemo, metadata, baseline, cursor, pending, intent, remote, operation ID, automatic repair, retry, or merge is involved.
- B-3f5d1a through B-3f5d1c behavior remains unchanged. Real-conflict and real-post-adoption target verification are not device-tested; no Supabase operation, commit, or push has been performed.

## Phase B-3f5d2a: read-only preparation eligibility after remote adoption

### Input and freshness contract

- Accept only a current B-3f5d1d `adoption_verified_normal` result with a known adoption target. The verification Hook exposes a cloned in-memory snapshot containing workspace binding, metadata raw, serialized DayMemo storage, React-local signature, and the safe verification result.
- On explicit checking, reread and strictly validate version 3 metadata and DayMemo storage, then compare every snapshot field exactly. A reload, discard, workspace change, metadata/local change, or replaced verification result makes the evidence stale and requires B-3f5d1d verification again.
- This Hook does not call full pull or any Supabase API. It consumes completed verification evidence and current local state only.

### Active and tombstone rules

- Active adoption requires one valid same-date local DayMemo, an active baseline, matching adopted revision/change sequence, matching local/baseline/remote timestamps, cursor coverage, and no non-target mismatch. Edit, save, and delete preparation may then be reported ready.
- Tombstone or metadata-only adoption requires no same-date local DayMemo, a matching tombstone baseline, `baselineLocalUpdatedAt = null`, matching revision/sequence, and cursor coverage. Only edit/save preparation can be ready; delete preparation is a missing prerequisite.
- Every path requires the same workspace, valid version 3 metadata, `baselineStatus = confirmed`, no push block, no pending operation, no local delete intent, and zero outside inconsistency. Uncertainty is stopped rather than inferred as ready.

### Classification and UI

- Ready is `local_operation_prepare_ready`. Fail-closed results are `local_operation_prepare_target_only`, `local_operation_prepare_pending_remaining`, `local_operation_prepare_delete_intent_remaining`, `local_operation_prepare_push_blocked`, `local_operation_prepare_cursor_invalid`, `local_operation_prepare_state_changed`, `local_operation_prepare_target_mismatch`, `local_operation_prepare_verification_missing`, `local_operation_prepare_verification_stale`, `local_operation_prepare_unsupported_adoption`, `local_operation_prepare_prerequisite_missing`, and `local_operation_prepare_state_unknown`.
- The user selects `local_edit_prepare`, `local_save_prepare`, or `local_delete_prepare` and runs one explicit check. Results are safe scalar data in React memory only, are not restored after reload, and can be discarded without persistent changes.
- Display readiness, date, adopted kind, chosen operation, metadata/workspace/pending/intent/push-block/cursor/freshness checks, outside mismatch count, confirmation time, and next safe action. Never expose content, payload, UUIDs, operation IDs, credentials, internal exceptions, or raw storage.

### Safety boundary

- Do not create or modify pending operations, local delete intents, operation IDs, baselines, cursors, metadata, local DayMemos, localStorage, sessionStorage, or remote state. Do not automatically pull, retry, merge, repair, or resolve conflicts.
- A ready classification authorizes only proceeding to a future explicit preparation phase. Editing, saving, deletion, upload, and delete synchronization remain unimplemented until B-3f5d2b.

## Phase B-3f5d2b1: persistent preparation of one new local operation

### Phase split and input

- Split the former B-3f5d2b preparation/send flow into B-3f5d2b1 (persistent preparation only) and B-3f5d2b2 (one separate explicit remote send). B-3f5d2b1 never connects to Supabase and never invokes pull, upsert, or delete RPCs.
- Accept exactly one fresh B-3f5d2a `local_operation_prepare_ready` snapshot whose date and operation kind match the explicit action. Re-read and validate version 3 metadata and DayMemo storage and require unchanged raw metadata, serialized local data, React signature, adoption verification snapshot, workspace, baseline lineage, remote scalar timestamps, cursor, pending/intents, push block, and outside mismatch count.
- Any missing/stale snapshot, target/type mismatch, existing pending or intent, push block, invalid cursor, changed state, unsupported kind, missing prerequisite, persistence failure, or unknown condition is fail-closed and must occur before generating an operation ID whenever possible.

### Operation meanings

- `local_edit_prepare` remains read-only. It may report that editing can be entered, but creates no operation ID, pending, intent, or DayMemo change. A dedicated edit-start UI integration remains future work.
- `local_save_prepare` is the explicit DayMemo save action after the user finishes editing. Validate the proposed memo without exposing content, generate one new operation ID, verified-write the complete local array, then verified-write an existing-format `kind = upsert`, `status = prepared` pending bound to the current active or tombstone baseline revision and new local `updatedAt`.
- `local_delete_prepare` is an explicit confirmed delete preparation for an active local memo. Generate one operation ID, verified-write one existing-format delete pending and one same-date existing-format localDeleteIntent together, then verified-remove only the target local memo. The pending carries the operation ID/workspace binding through metadata; the intent format is unchanged.

### Ordering and failure

- Save ordering is local DayMemo write/read-back followed by metadata pending write/read-back. If metadata cannot be saved, verified-rollback the local array. Never report prepared unless both persistent results are proven.
- Delete ordering follows the established intent-first design: metadata containing intent and delete pending is saved/read back before local removal. If local removal fails, verified-rollback metadata. If rollback cannot be proven, retain fail-closed evidence and require recovery; never auto-retry or issue another ID.
- Baselines, cursor, push block, workspace binding, remote rows, and adoption verification results are not updated. Existing pending or intents are never overwritten or automatically resolved.

### Result, UI, and next phase

- Classify the result as `local_operation_prepared` or a dedicated missing/stale/target/type/pending/intent/push-block/cursor/state/prerequisite/persistence/unsupported/unknown failure. UI retains only safe scalar status: date, operation kind, booleans for ID/pending/intent/DayMemo effects, remote-unsent state, time, and next action.
- The settings flow distinguishes edit confirmation, opening the target DayMemo dialog for explicit save preparation, and explicit delete preparation with confirmation. No action runs on render. Discard clears only the B-3f5d2b1 React result and never cancels persistent preparation.
- B-3f5d2b2 remains responsible for a separate explicit upload/delete send and verified completion. Pending/intent completion, remote/baseline/cursor updates, persistent preparation cancellation, audited stale-operation resolution, batching, and automatic conflict resolution remain unimplemented.

## Phase B-3f5d2b1m: metadata v4 and explicit migration

- B-3f5d2b2 was stopped because version 3 localDeleteIntent has no operation ID. After reload, persistent data cannot prove that a delete pending and intent belong to the same operation.
- Version 4 preserves the version 3 workspace, upload history, baselines, cursor, pending, push block, success times, and migration history. Each localDeleteIntent additionally requires an existing UUID-v4 operation ID. Workspace binding remains at metadata root.
- The version 4 validator requires an intent to match the single delete pending by operation ID, date, baseline revision, and baseline change sequence. A same-date upsert pending and delete intent is invalid. Unknown top-level or intent fields are rejected.
- Valid version 3 metadata with no intent migrates only when it has no orphan delete pending. One intent migrates only when the sole pending is a matching delete operation and its active baseline lineage is exact. Intent without pending, delete pending without intent, multiple intents, upsert/intent combinations, or lineage mismatch remain blocked. Migration never guesses or generates an ID.
- Migration is never automatic. The user first runs a read-only eligibility check and then a separate explicit migration. Execution re-reads the exact raw metadata, validates a complete version 4 value, verified-writes it, and requires exact read-back. Failure uses the storage utility rollback; an unprovable rollback is fail-closed.
- Version 3 remains readable for eligibility and backup restoration but is not silently treated as version 4. The operational adoption, verification, preparation, update, delete, resurrection, recovery, and preview paths now require version 4. Existing version 1/2 to version 3 migration remains the compatibility entry point before explicit version 4 migration.
- B-3f5d2b1 now requires version 4. Delete preparation stores one pending and one intent with the same operation ID in a single validated metadata write; save preparation stores the unchanged upsert pending shape inside version 4 metadata.
- The legacy B-3f2 intent-only creation path remains a version 3 compatibility path and is fail-closed after version 4 migration; version 4 delete preparation must use the atomic B-3f5d2b1 pending-plus-intent path.
- JSON backup needs no outer format change: synchronization metadata is not added to the existing backup payload. Restored version 3 synchronization metadata, when present through existing local storage handling, remains version 3 until explicit migration.
- UI exposes only versions, counts, match booleans, classification, persistence/rollback flags, time, and safe next action. It never renders operation IDs, workspace IDs, content, payload, credentials, or raw metadata. Discard clears React state only.
- This phase performs no Supabase connection, authentication, pull, mutation RPC, SQL, remote update, send, retry, merge, repair, or conflict resolution. B-3f5d2b2, real upsert/delete tests, explicit remote preflight, post-remote local failure recovery, stale pending/intent resolution, migration cancellation, and batching remain unimplemented.
## B-3f5d2b2a prepared operation remote preflight

- The persisted metadata v4 `pendingOperation` is the source of truth after reload. Only one `prepared` upsert or delete is eligible; a delete additionally requires a same-date `localDeleteIntent` with the identical operation ID and baseline lineage.
- The user explicitly starts a read-only check. The existing strict full-pull utility starts at cursor 0, reads 100 rows per page for at most 20 sequential pages, and rejects duplicates, cursor stalls, invalid rows, incomplete results, and automatic retries.
- A result is sendable only when the target and every outside remote record exactly match the stored baselines, the pull maximum matches the stored cursor, and current local storage, metadata, workspace binding, pushBlock, pending, intent, and prepared local timestamp remain unchanged.
- `hooto_day_pull_sync_records` does not expose operation IDs. Therefore an advanced remote revision cannot prove that the prepared operation was already applied; it is classified as `local_operation_remote_check_duplicate_uncertain` and remains fail-closed. Exact baseline equality is sufficient only to prove that the remote is unchanged and the later send phase may continue.
- The public React result contains no operation ID, content, payload, UUID, token, or metadata JSON. The internal ready snapshot is non-persistent and becomes unusable when its metadata raw value, DayMemo storage raw value, or workspace changes.
- Discarding the result changes React state only. B-3f5d2b2 must repeat the remote preflight immediately before sending and must not treat this preview as permanent authorization.
## B-3f5d2b2b explicit single-operation send

- A send requires an in-memory B-3f5d2b2a sendable snapshot plus the identical persisted metadata v4 prepared pending. The final user confirmation occurs before any network call, and no new operation ID is generated.
- Immediately before mutation, repeat the strict read-only full pull and require the complete remote set, target record, active/tombstone kind, revision, change sequence, timestamps, payload, and maximum cursor to equal the snapshot and current baselines. Any change or duplicate uncertainty stops before mutation.
- Active baselines compare `remoteUpdatedAt` with payload `updatedAt`; tombstone baselines compare it with the server timestamp. The B-3f5d2b2a preflight uses the same state-specific timestamp contract.
- Persist the existing pending as `sending` with verified read-back before invoking exactly one existing upsert or delete RPC. Upsert uses the validated current DayMemo; delete requires the only same-date intent with the identical operation ID and lineage.
- Validate a single applied response using the existing strict result validators. On success, atomically construct metadata v4 with the new active/tombstone baseline, advanced cursor, cleared target pending, and—only for delete—cleared target intent, then save and read back once.
- Network/response uncertainty preserves the operation as `response_unknown`; conflict preserves `conflict`. If the remote applied but local metadata completion fails, never roll back the remote or return to an unsent state. Persist `recovery_required` when possible; otherwise the verified `sending` state remains fail-closed after restart.
- There is no automatic send, pull, retry, merge, repair, conflict resolution, batching, or new operation ID. UI and documents expose no content, payload, operation ID, UUID, credentials, raw metadata, or internal exception.

## B-3f5e1 read-only recovery plan for ordinary differences

- Keep B-3f5d1 scoped to conflicts backed by a pending operation or conflict delete intent. Ordinary content mismatch, remote-only, local-only, and missing-baseline states use this separate explicit read-only planning flow.
- On the explicit action only, reuse the complete full-pull utility and compare validated metadata v4, local storage, remote active/tombstone records, baselines, and cursor per date. Classify exact confirmed/missing baseline, body-only timestamp mismatch, body mismatch, local-only, remote-only active/tombstone, active-tombstone mismatch, revision-lineage mismatch, and unknown without exposing content.
- An exact active match with a missing baseline is only a future partial-baseline candidate. Because the current validator requires an empty baseline map for `mismatch`, a partial candidate is representable only as `recovery_required` with null confirmation time and an unchanged cursor, and only when the completed in-memory metadata passes the version 4 validator. This Phase never saves it.
- Resolve exact missing baselines first, then body mismatches by explicit user choice, remote-only active records by explicit local adoption, and local-only records through a new local operation. Re-run whole-workspace baseline/cursor verification before any final `confirmed` transition.
- Results and dates live in React state only. There is no automatic pull, retry, merge, repair, conflict resolution, persistence mutation, operation ID, upload/delete RPC, or Supabase write. Partial baseline apply, manual content choice, ordinary remote adoption, local-only preparation, and final confirmation remain future one-item phases.
- B-3f5e2の復旧checkpoint確認は、cursor不一致を無視せず、cursor更新と完全一致baseline候補を一体としてメモリ内に構築する。候補はversion 4、`recovery_required`、確認日時null、完全full pull最大cursorとし、未解決日付にはbaselineを追加しない。
- 候補metadataのvalidator通過後、同じlocal／remoteと候補baselineで再分類し、完全一致候補がconfirmedへ、本文相違・local-only・remote-onlyが元分類のまま再構築できることを必須とする。`recovery_required`により通常upload、local operation準備・preflight・sendは引き続きfail-closedとなる。
- checkpoint readyは通常同期readyではなく、sequence上限までのcurrent stateを完全pullで観測し、完全一致分だけ系譜を確立できるというread-only判定である。保存、自動処理、一括解決、remote採用、upsert、deleteは後続Phaseまで行わない。
- B-3f5e3はB-3f5e2 snapshotを無条件に信用せず、明示保存時にmetadata raw、DayMemo storage、workspace、cursor、pending、intent、pushBlockと完全full pullを再確認する。remote全件、最大sequence、exact候補、未解決日付・分類が変化した場合は保存しない。
- 候補metadataは最新確認済み状態から再検証し、exact match baselineだけを保持してcursorと同時保存する。statusは`recovery_required`、確認日時はnull、未解決日付のbaselineは欠落のままとし、仮適用後の再分類とversion 4 validatorを通す。
- 永続化は既存verified metadata utility、read-back validator、予定値との完全一致を必須とする。失敗時は元rawへのverified rollbackを確認し、証明不能ならfail-closedとする。通常同期ready、自動送信、remote変更、取消・一括処理は含まない。
- After a B-3f5e3 checkpoint has been saved, an equal metadata cursor and full-pull maximum is an expected saved state, not sufficient reason to skip per-date classification. Rebuild classifications from the union of local, remote, and baseline dates before handling a zero cursor difference.
- When metadata remains `recovery_required`, every saved baseline reclassifies as exact confirmed, no new exact-missing baseline exists, and unresolved differences are reproducible, report `normal_difference_checkpoint_unresolved_ready`. Keep normal sync unavailable, create no save snapshot, and require one-by-one recovery without another checkpoint save.
- B-3f5e4a handles only one `body_mismatch` date reconstructed by a saved checkpoint. An explicit comparison action repeats the complete read-only pull, validates the whole workspace and cursor, and shows local and remote content only inside a dedicated comparison UI; it never auto-merges content.
- Selecting and confirming local or remote creates only an in-memory candidate snapshot. Confirmation is not adoption: no DayMemo, metadata, baseline, cursor, pending, intent, operation ID, or remote state changes, and no mutation RPC is sent.
- B-3f5e4b and B-3f5e4c must re-read and revalidate metadata, workspace, local storage, classification, remote active state, revision, sequence, and updated timestamp before preparing local adoption or applying remote adoption. B-3f5e4d rechecks baselines and remaining differences. There is no automatic pull, retry, merge, repair, conflict resolution, or batch processing.

## Phase B-3f5e4m: metadata v5 and recovery-upsert format

- `DayMemoSyncMetadataV5` preserves the version 4 workspace, initial-upload history, baselines, delete intents, cursor, baseline state, push block, last-success time, and strict migration record. Its pending union is discriminated by operation kind and, for upsert, by `operationMode`.
- A normal upsert pending has `operationMode: normal` and the existing date, operation ID, base revision, prepared local timestamp, prepared time, and status fields. A delete pending is unchanged. A future body-mismatch recovery upsert has `operationMode: body_mismatch_recovery` plus `baseChangeSequence`, `baseRemoteUpdatedAt`, and `baseRemoteState: active`.
- Recovery-upsert validation requires recovery-required metadata, a null confirmation time, no target baseline, no delete intent, no push block, and base sequence not beyond the stored cursor. Unknown fields and invalid discriminator/field combinations are rejected.
- Version 4 migration maps every valid upsert pending to normal and preserves its operation ID and status. It preserves delete pending and matching intent unchanged. It never infers a recovery operation, invents lineage, or generates an operation ID.
- Migration runs only after the explicit condition-check action and a separate explicit migrate action. The migrate action compares the exact source raw snapshot, validates the v5 candidate, performs verified save/read-back, updates React metadata only after verification, and attempts verified rollback on failure.
- Existing normal-operation preparation creates only normal upsert pending. Normal remote preflight and explicit send reject recovery mode before any RPC. Recovery-mode preparation and transmission remain future phases.
- Version 5 is the current format for normal-difference planning, checkpoint checking/saving, body-mismatch candidate comparison, normal update/local-only/resurrection/delete flows, baseline state, and shared safety classification. Version 4 remains readable only for the explicit v5 migration boundary.
- This phase changes no DayMemo, syncConnection, pending status vocabulary, delete-intent structure, JSON backup envelope, Supabase SQL, RLS, policy, or RPC contract. It performs no migration execution, remote read/write, automatic retry, merge, repair, or conflict resolution.
## B-3f5e4b 本文相違local候補のrecovery upsert永続準備

B-3f5e4aのlocal candidate snapshotを正本とし、明示確認後の完全full pullで対象remote active recordと対象外を含む差異分類が不変の場合だけ準備する。operation IDはremote再確認後に1回生成し、metadata v5の`body_mismatch_recovery` pendingへ、remoteのrevision・change sequence・payload updatedAt・active stateと現在local updatedAtを保存する。metadata cursorをbase change sequenceの代用にしない。

永続変更はpendingOperation 1件だけとし、対象日のbaselineは作らず、既存baseline、cursor、`recovery_required`、`baselineConfirmedAt=null`、未解決差異を維持する。verified保存・read-backに失敗した場合は元metadataへverified rollbackし、証明不能ならfail-closedとする。通常upsert preflight/sendはrecovery modeを拒否し、後続専用Phaseだけが扱う。自動処理、Supabase書き込み、DayMemo再保存は行わない。
## B-3f5e4b2 prepared recovery upsertの送信前remote確認

`body_mismatch_recovery`かつ`prepared`のpending 1件だけを専用経路で扱う。明示ボタン1回につき完全full pullは最大1回で、pull前後にmetadata raw、local storage、workspace、pending、checkpointを再確認する。対象localのcanonical payloadと`preparedLocalUpdatedAt`、remote active recordのrevision・change sequence・payload updatedAt・payload、現在の`body_mismatch`分類が不変の場合だけ`normal_body_mismatch_recovery_preflight_ready`とする。

verification snapshotは次Phaseの再検証用にReact stateだけへ保持し、永続化しない。metadata、pending status、baseline、cursor、DayMemo、intent、pushBlock、remoteを変更せず、新しいoperation IDも生成しない。通常upsert preflight/sendへrecovery modeを通さず、B-3f5e4b3の明示送信までRPCを行わない。

実機で判明した循環を避けるため、B-3f5e4b2は通常checkpoint確認HookのReact resultを前提にしない。通常checkpoint経路のpending拒否は緩めず、専用preflightが永続metadata v5の`recovery_required`、nullのconfirmedAt、cursor、baseline群と、完全full pull 1回から再構築した対象`body_mismatch`を照合する。例外的に許可するpendingは確認対象と完全一致するprepared `body_mismatch_recovery` upsert 1件だけであり、他のpendingはfail-closedとする。

## B-3f5e4b3 prepared recovery upsertの明示送信

B-3f5e4b2の未消費verification snapshotと完全一致するprepared recovery pendingだけを、確認ダイアログ承認後に専用Hookで1回送信する。RPC直前は追加pullを行わず、metadata raw、pending全項目、workspace、recovery checkpoint、local fingerprint、remote snapshot、pushBlock・intent不在を再検証する。snapshotはRPC直前に消費し、成功・失敗・unknown・conflictのいずれでも再利用しない。

正式なupsert RPCへ保存済みoperation ID、対象canonical payload、base revisionを渡し、serverのrevision compare-and-setとidempotencyを利用する。戻り値は既存validatorでworkspace、entity、payload、revision=base+1、change sequence進行、active状態を検証する。成功後はpendingを`recovery_required`で保持してverified保存・read-backし、baseline、cursor、checkpoint、DayMemo、`recovery_required`のbaselineStatusを維持する。remote成功後にmetadata確定を証明できない場合は再送せず、B-3f5e4dのremote確認へ送る。

#### B-3f5e4d0s: saved operation result read-only RPC

既存upsert RPCはoperation履歴があれば保存結果を返すが、履歴がなければcurrent recordのmutation判定へ進む。このため、送信済み結果の回収にupsert RPCを再利用しない。専用`hooto_day_get_sync_operation_result(operation_id, workspace_id, entity_type, entity_id, operation_kind)`を追加し、`hooto_day_sync_operations`の既存行だけをSELECTする。

RPCは`auth.uid()`非nullと`is_app_workspace_member(workspace_id)`を必須とし、operation ID、workspace、entity type、対象日、operation kind、`requested_by = auth.uid()`がすべて一致する1行だけを返す。不在または照合不一致は単一の`found = false`結果で終了する。current record参照・更新、operation作成・更新・削除、revision変更、sequence採番、upsert/delete RPC呼出し、fallback、dynamic SQLを禁止する。

直接table権限は緩めず、operations tableのRLS有効・policyなしを維持する。関数は既存mutation RPCと同じowner、`SECURITY DEFINER`、固定`search_path = pg_catalog, public`、`STABLE`とし、PUBLIC／anonのEXECUTEを剥奪してauthenticatedだけへ付与する。APPLY、構造・権限・関数本文を確認するVERIFY、当該signatureだけを削除するROLLBACKを別SQLで管理する。

戻り値はfound、保存済みstatus、workspace、entity、kind、base revision、request fingerprint、result revision・change sequence・server updatedAt・deletedAt・payload、operation作成日時、conflictを含む。payloadとfingerprintは次Phaseの内部照合専用で、UI・console・文書へ実値を出さない。operation履歴cleanup後のnot_foundは再送許可を意味しないため、将来cleanupを導入する際は保持期間とfail-closed方針を同時に定義する。

SQL適用・VERIFYはユーザーの明示操作で行う。適用確認後のB-3f5e4d0aでread-only取得HookとUIを実装し、結果をReact snapshotだけへ保持する。metadata、pending、baseline、cursor、DayMemoは変更しない。
## B-3f5e4d0a: saved operation result read-only verification

The client may call `hooto_day_get_sync_operation_result(operation_id, workspace_id, entity_type, entity_id, operation_kind)` only after an explicit confirmation. The arguments come from the existing validated recovery pending; no user ID, payload, current remote data, or newly generated operation ID is supplied. An in-flight/run guard limits a button action to one read-only RPC and prevents concurrent or stale results from becoming current.

Before and after the RPC, the client revalidates configuration, authenticated identity, workspace binding, metadata v5 raw value, the complete recovery pending, recovery checkpoint, local storage versus React state, canonical local payload fingerprint, target date, baseline/cursor context, absence of delete intent, and absence of push block. Any change rejects the result and creates no snapshot.

`found = false` is a safe terminal read result, not evidence that the mutation was never applied. It triggers no fallback, full pull, resend, retry, operation-ID generation, or persistent change. A found result is accepted only when strict normalization succeeds and workspace, entity type/key, operation kind, base revision, applied status, conflict flag, post-send revision and sequence progression, server timestamp, active/deleted state, canonical payload, and payload fingerprint all match the saved request and current local candidate.

On success, a verification snapshot is retained only in React state for B-3f5e4d. It records the target and operation mode, internal operation/auth identifiers, pending/metadata/workspace/checkpoint/local/request fingerprints, post-send revision, change sequence, server timestamp, state, payload fingerprint, operation creation time, confirmation time, run ID, and snapshot token. Sensitive identifiers and payload values are never rendered or logged. Reload, discard, a newer run, or a change to authentication, configuration, workspace, metadata, pending/status, checkpoint, baseline/cursor, local DayMemo/fingerprint, intent, or push block invalidates the snapshot.

This phase is read-only. It does not modify DayMemo, metadata, pending status, operation ID, baseline, cursor, baseline status/time, recovery checkpoint, local delete intent, push block, remote records, or operation history. It does not automatically pull, retry, merge, repair, resolve, or send. B-3f5e4d must perform its own complete full-pull comparison before any later recovery decision.
## B-3f5e4d: post-send full-pull verification and recovery candidate

An unconsumed B-3f5e4d0a saved-operation-result snapshot is mandatory. After local fail-closed checks and explicit confirmation, the client consumes that snapshot token and performs exactly one complete `hooto_day_pull_sync_records` traversal. Success, failure, disconnect, or an unknown outcome never automatically reuses the token; a new attempt requires another explicit B-3f5e4d0a read.

The full pull is the single source for remote validation, target comparison, all-date classification, baseline candidate generation, and cursor candidate generation. Before and after it, the client proves that authenticated identity, configuration, workspace binding, metadata raw value, recovery pending/status/operation ID, checkpoint, baselines/cursor, local storage and React state, canonical local fingerprint, delete intents, and push block are unchanged.

The target remote record must be active and match the operation-result snapshot exactly in revision, change sequence, server updated time, and canonical payload fingerprint. Its payload must also match the current unchanged local DayMemo. Existing `classifyDayMemoNormalDifference` must classify the pre-candidate target as `exact_match_baseline_missing`; after adding only the target active baseline candidate, it must become `exact_match_baseline_confirmed`.

Every date in the union of local, remote, and saved baseline dates is reclassified with the existing formal classifier. Lineage mismatch, active/tombstone mismatch, unknown state, malformed/incomplete pull, duplicate state, cursor regression, or target mismatch is fail-closed. Remaining differences are retained verbatim in the React snapshot; no expected date or count is hard-coded.

The candidate preserves existing baselines and adds or replaces only the verified target entry using the current remote revision/change sequence and payload updated time plus the current local updated time. Its cursor is the complete pull maximum sequence, its baseline status remains `recovery_required`, its confirmation time is null, and normal-sync-ready remains false. Because metadata v5 forbids a target baseline beside a body-mismatch recovery pending, candidate validation uses the next atomic lifecycle (`pendingOperation: null`) and records `clear_after_atomic_save`; persistent pending state remains untouched in this phase.

The resulting verification snapshot is React-only and carries the source state fingerprints, internal operation linkage, operation-result linkage, current remote identity, full-pull identity, reconstructed differences, validated candidate metadata/baselines/cursor, and run/token identity. Sensitive IDs, fingerprints, content, payloads, credentials, and raw metadata are not displayed or logged. The next explicit persistence phase must revalidate all source and remote state and atomically save baseline/cursor plus pending lifecycle completion.
### B-3f5e4d checkpoint fingerprint correction

The initial B-3f5e4d implementation compared two structurally different checkpoint fingerprints. The operation-result reader encoded metadata version, workspace, baselines, cursor, baseline status, and confirmation time, while post-send verification omitted version and workspace. This made the comparison fail for every otherwise identical checkpoint before any full pull.

Recovery pending, baseline, and checkpoint identity now use shared canonical functions. Baseline keys are sorted, pending fields have a fixed explicit order, and checkpoint identity includes the stable metadata version/workspace plus canonical baselines, cursor, status, and confirmation time. UI timestamps, run IDs, snapshot tokens, function/object identity, and render-created references are excluded from persistent-state equality.

Post-send verification validates metadata v5 directly and does not require the React result of the normal checkpoint-check hook. Snapshot missing/stale/consumed/token mismatch and checkpoint missing/invalid/fingerprint mismatch are distinct fail-closed states with different user guidance. The source snapshot is consumed only after metadata, pending, checkpoint, workspace, local state, intent, push block, and confirmation all pass, immediately before the single complete read-only pull.

Rerendering or recreating equal objects does not invalidate a snapshot. Explicit discard, a new operation-result read, reload, authentication/configuration/workspace change, metadata/pending/checkpoint/baseline/cursor/local change, intent/push block, or actual consumption does. No persistent state, RPC history, or remote state is changed by this correction.
## B-3f5e4d1: explicit atomic recovery-checkpoint persistence

B-3f5e4d1 accepts only an unconsumed B-3f5e4d verification snapshot whose candidate metadata has already passed metadata v5 validation. A separate confirmation action is required. After approval, the client re-reads the local metadata and DayMemo storage and verifies authentication/configuration, workspace, source raw metadata, canonical recovery pending/checkpoint/baseline fingerprints, source cursor/counts, local canonical fingerprint, no intent, and no push block. It performs no new remote read.

The persisted candidate is the complete metadata v5 object from B-3f5e4d: verified target baseline plus existing baselines, complete-pull cursor candidate, `baselineStatus: recovery_required`, `baselineConfirmedAt: null`, and `pendingOperation: null`. It must exactly equal current metadata with only those intended fields changed. Pending removal, baseline update, cursor update, and recovery status are therefore one storage write; partial intermediate states are prohibited.

The existing expected-raw compare-and-write utility validates the complete candidate, refuses concurrent changes, writes once, reads back, and verifies rollback on write/read-back failure. A second explicit read-back confirms complete candidate equality, baseline fingerprint, cursor, status, confirmation time, null pending, workspace, and all other fields. Rollback is attempted only when storage still contains this phase's exact candidate; unrelated newer metadata is never overwritten.

The B-3f5e4d snapshot is consumed immediately before compare-and-write, after every precondition and candidate validation. Cancellation or any earlier fail-closed stop leaves it unconsumed. After write start it is not reusable regardless of success, failure, read-back failure, or rollback. React metadata changes only after verified success, and the prior verification result is then discarded.

Remaining differences keep recovery mode active and normal-sync-ready false. No DayMemo, remote state, operation history, intent, push block, auth, or workspace connection is changed. There is no full pull, mutation RPC, operation-ID generation, automatic retry, merge, repair, or automatic next-item processing. A following read-only phase must verify the saved baseline, cursor, null pending, and remaining classifications.
### B-3f5e4d1 save-control visibility correction

The save hook and App/ThemeSettings prop path were connected correctly, but the complete save panel was conditional on `canSave || saveResult`. A pre-save null result combined with any false `canSave` state removed the panel from the DOM, preventing both the control and fail-closed availability information from being shown despite a successful B-3f5e4d result.

Panel visibility and write eligibility are now separate responsibilities. A successful post-send verification result, a non-missing candidate availability state, or a save result displays the panel. The save button is rendered but disabled unless the existing save hook returns `canSave`; ThemeSettings does not reconstruct safety conditions or metadata candidates.

This UI correction does not change candidate generation, pending lifecycle, metadata v5 validation, expected-raw compare-and-write, read-back, rollback, snapshot consumption, or React metadata adoption. Merely rendering the panel, scrolling, rerendering, or computing disabled state performs no storage or Supabase operation.

### B-3f5e4d1 fresh-candidate identity correction

The post-send snapshot previously serialized its pending operation with the object's incidental property order, while the subsequent availability check used the shared fixed-field pending fingerprint. This representation mismatch made an unchanged, newly created candidate stale. Snapshot creation and all later checks now use the same canonical pending representation.

Freshness and candidate integrity have separate identities. The source fingerprint represents the persistent metadata before saving, including the existing pending, five source baselines, and source cursor. The candidate fingerprint represents the already validated metadata to save, including the cleared pending, added baseline, and advanced cursor. Current persistent state is never compared directly with candidate state.

Canonical recursive metadata comparison sorts object keys and is independent of React object identity or reconstruction. Snapshot token continuity still links the exact post-send verification snapshot, but token inspection does not regenerate or consume it. Run IDs remain limited to asynchronous-result adoption and do not define persistent-state identity.

A candidate is ready only when authentication/configuration, workspace, operation-result token, source metadata, canonical pending, source baselines/count, source cursor, checkpoint, local storage/React state, no push block, no intent, candidate metadata v5 validation, candidate baseline fingerprint, and candidate fingerprint all remain valid. Any genuine change remains fail-closed with a reason-specific availability result. Compare-and-write and snapshot consumption timing are unchanged.

## HootoDay個人利用同期基盤の完成基準

HootoDay同期は本人一人がPC親機とiPhone子機で利用する個人用基盤である。多数ユーザー・多数端末・高負荷・完全自動競合解決を完成条件にしない。完成の目的は、重大なデータ消失、古い状態による誤上書き、二重適用、削除済みデータの意図しない復活、不明または失敗状態の成功扱い、復旧材料の消失を防ぐことである。

完成前に満たす必須安全条件は次のとおりとする。

1. 保存失敗で保存前のlocalデータを失わない。失敗時はverified rollbackまたは復旧材料を保持したfail-closed状態にする。
2. revision、change sequence、baseline、完全full pull、workspace、local snapshotの鮮度を確認し、古い状態で新しいremoteまたはlocalを上書きしない。
3. operation ID、request fingerprint、operation履歴、pending、in-flight／snapshot guardにより同じ操作の二重送信・二重保存を防ぐ。
4. PC・iPhone・Supabaseの状態を一意に判断できない場合は自動選択、merge、retry、repairを行わず停止する。
5. deleteは明示tombstoneとし、tombstone revisionを確認した明示復活以外で削除済みDayMemoをactiveへ戻さない。
6. 通信切断、認証切れ、workspace不一致、validator失敗、不明なRPC戻り値を成功扱いしない。
7. 失敗後も元データ、pending、operation ID、保存前metadata、operation履歴などread-only再確認と復旧に必要な永続情報を失わない。一時verification snapshotは再読み込みで消えてよい。
8. 成功後はmetadata、baseline、revision、change sequence、cursor、pending／intent lifecycleを同じ確認済み結果へ整合させ、read-backで証明する。
9. コードはGitから戻せる状態を維持し、データ保存はJSONバックアップ、保存前snapshot、compare-and-write、verified rollbackなど対象に適した復旧手段を持つ。
10. UIは正常終了、安全停止、失敗、確認必要を区別し、本文、payload、UUID、operation ID、credential、fingerprint実値を安全状態表示へ出さない。

既存fail-closed経路で重大事故を防げる場合、より細かな理由表示だけを目的に専用Hook、分類、画面を追加しない。エラー文の詳細化、低頻度異常の専用表示、ログ・装飾、手順短縮、確認回数削減、batch処理、理論上の全タイミング再現は完成後の改善Phaseへ分離できる。

完成を止めるのは、データ消失、stale overwrite、duplicate application、unintended resurrection、unknown/failure success、recovery evidence loss、別workspaceへの処理、未解決差異がある状態でのnormal化、またはrollback不能を成功扱いする問題である。文言が粗い、操作が長い、既存安全停止に専用説明がない、低頻度表示が不十分という問題だけでは完成を止めない。

同期基盤は、必須条件の正常系と代表的失敗系をPC・iPhoneで確認し、重大リスクが未解決でなく、判断不能時にfail-closedとなり、復旧材料が残り、Gitがcleanかつmainとorigin/mainが一致し、PROJECT_NOTES.mdと本設計が実装に一致した時点で完成扱いとする。

### B-3f5e4d2: recovery checkpoint保存後のread-only総合確認

- B-3f5e4d1の実機保存で2026-07-12のactive baseline、cursor 17、null pendingをmetadata v5へ同時保存し、`recovery_required`とnull確認日時を維持した。保存前後のvalidator、compare-and-write、read-backが成功し、DayMemo・remote変更とrollbackはなかった。
- B-3f5e4d2は専用ボタンでだけ実行するread-only adapterである。metadata v5、workspace、React/storage同一性、null pending、recovery checkpoint、target local/baseline、intent・push block不在をpull前に確認し、不成立ならRPC前に停止する。
- 既存の完全full pull utilityを1操作につき最大1回だけ使用する。同じ完全結果でcursor一致、2026-07-12のactive remoteと保存済みbaseline、local/remote payload分類、local・remote・baselineの日付unionを検証する。run IDとin-flight guardにより並列実行と古い結果採用を拒否する。
- 差異は既存`classifyDayMemoNormalDifference`だけで再構築する。2026-07-12は`exact_match_baseline_confirmed`でなければ成功にせず、その他の日付と件数は期待値へ強制しない。既知の現在状態では2026-07-15 `body_mismatch`、2026-07-18 `local_only`、2026-07-19 `remote_only_active`の3件が残り、次は既存body-mismatch経路を再利用する。
- 成功分類は`normal_difference_checkpoint_saved_state_ready`であり、通常同期readyはfalseのまま、未解決差異を1件ずつ処理可能とする。metadata不正、pending残存、workspace不一致、pull失敗／不正、cursor不一致、baseline／target不一致、再構築不能、push block、intent、途中状態変化、unknownはfail-closedとする。
- 結果はReact stateだけに保持し、破棄しても永続状態を変更しない。metadata、baseline、cursor、DayMemo、pending、intent、push block、operation履歴、remote、workspace、認証を変更せず、mutation RPC、自動retry、自動次項目処理、normal／confirmed化を行わない。
## Phase B-3f5e8b: confirmed normal-difference routing

- Integrated navigation MUST use validated persistent metadata v5 `baselineStatus` as its top-level routing source.
  - `confirmed` with a valid `baselineConfirmedAt`: normal-sync route.
  - `recovery_required`: recovery-only route.
  - any other or invalid state: fail closed.
- A derived current comparison of `mismatch` MUST NOT by itself select a recovery checkpoint route while persistent metadata remains `confirmed`.
- The first normal-route action after reload is the existing explicit read-only pull preview. It MUST verify the complete current remote set and MUST NOT write metadata, baselines, cursor, DayMemo, pending operations, or intents.
- The normal route may proceed to the existing local-only preview only when exactly one `local_only` item exists and all persisted baseline dates are exact matches, with no remote-only, body mismatch, active/tombstone mismatch, or tombstone item.
- The normal local-only lifecycle remains `operationMode = normal`; its existing candidate preview, remote preflight, persistent preparation, and explicit one-item send are reused unchanged.
- A recovery saved-state result, checkpoint result, or earlier candidate result MUST NOT select a current stage after formal metadata becomes `confirmed`. Recovery-only diagnostics are actionable only while formal metadata is `recovery_required`.
- Re-running baseline comparison from a confirmed state is read-only with respect to sync metadata. A normal local edit or create may produce a derived mismatch display, but MUST NOT erase confirmed baselines or persist `baselineStatus = mismatch`.
- UI MUST display persistent `metadata baselineStatus` separately from the derived current baseline comparison, and call the panel sync work for confirmed metadata and recovery work only for recovery-required metadata.
- No new automatic pull, automatic retry, automatic repair, operation ID generation, RPC write, SQL change, or storage-format change is introduced by this phase.
## Phase B-3f5e8c: explicit repair of legacy mismatch metadata

- This path exists only for validated metadata v5 whose persistent `baselineStatus` is `mismatch`. It MUST NOT run for `confirmed`, `recovery_required`, pending, push-blocked, intent-bearing, invalid, or workspace-mismatched metadata.
- Read-only verification and metadata persistence are separate explicit user actions. No effect may pull, save, retry, merge, repair, create an operation ID, or send an RPC automatically.
- One complete full pull is the sole remote snapshot for validation, classification, baseline construction, cursor validation, and candidate construction. A second pull is not performed before save; any local or metadata change invalidates the snapshot.
- Current local and remote date unions are classified with `classifyDayMemoNormalDifference` and no old baseline. Only `exact_match_baseline_missing` dates become active baselines. Exactly one `local_only` date is allowed for this repair case and it MUST remain outside baselines.
- Any body/timestamp mismatch, remote-only active, remote tombstone, active/tombstone mismatch, revision-lineage mismatch, unknown record, malformed pull, duplicate, or cursor mismatch fails closed without a candidate.
- The candidate preserves metadata v5 workspace, history, migration, push block, intents, and other fields; replaces baselines with current verified exact matches; uses the observed cursor; sets `baselineStatus = confirmed`; sets a fresh `baselineConfirmedAt`; and keeps `pendingOperation = null`.
- The in-memory snapshot contains source raw identity, local identity, remote identity, baseline/candidate fingerprints, workspace binding, cursor, local-only dates, checked time through the result, run identity, and an unexposed token. It is not persisted and is invalid after reload or discard.
- Save revalidates source raw, React/storage DayMemo identity, workspace/auth/configuration, pending/intent/pushBlock absence, candidate validator and fingerprints, and local-only exclusion without another pull.
- Persistence uses the existing compare-and-write utility for one whole metadata candidate. Verified read-back must equal the candidate. Read-back failure rolls back only when the current raw is the candidate; rollback failure remains fail-closed.
- After success the integrated UI routes formal `confirmed` metadata to the existing explicit normal pull preview, then to the normal local-only lifecycle with `operationMode = normal`. Recovery saved-state checks are not used.
- No Supabase write, SQL/RPC/RLS change, DayMemo write, storage-format change, operation ID, or pending creation belongs to this phase.
## Phase B-3f5e8d: start conditions for normal read-only state check

- The B-3f5e8c repair was verified on device with metadata v5 `confirmed`, nine baselines, cursor 19, one remaining local-only memo, and no pending, push block, or intent.
- `normal_state_check` was incorrectly disabled on the PC owner device because the integrated UI used `useDayMemoPullPreview.memberReady`, which represented only the child/member role. No prior result or repair snapshot was actually required; the shared fallback text incorrectly suggested snapshot unavailability.
- The existing pull-preview Hook now separates pull-capable connections (parent/owner or child/member) from child-only local apply capability. This does not broaden local apply permissions.
- `canStartNormalStateCheck` requires configuration, authentication, an eligible bound workspace, validated metadata v5, persistent `confirmed`, non-null confirmedAt, no pending/pushBlock/intent, matching React/storage DayMemo state, and no pull in flight. It never requires a prior result or snapshot.
- The integrated handler calls the existing pull preview once with `requireConfirmedMetadata: true`. The Hook rechecks formal metadata immediately before the pull. ThemeSettings does not pull or mutate metadata itself.
- Result and snapshot requirements remain post-execution concerns: a successful result drives the existing local-only candidate stage; reload or relevant metadata/local/workspace changes require a new explicit check.
- Disabled messages for the entry stage describe the actual prerequisite category instead of the generic snapshot message.
- No new Hook, automatic pull, retry, send, metadata/DayMemo mutation, SQL/RPC/RLS change, storage-format change, or operation ID is introduced.
## Phase B-3f5e9: read-only review after an unrepairable valid mismatch

- An iPhone child successfully migrated V3→V4→V5 and remained in valid persistent `mismatch`. Its restricted B-3f5e8c repair correctly produced no candidate because multiple difference classes were present.
- The missing transition was caused by integrated routing treating `metadataRepairStage = blocked` as terminal while `useDayMemoNormalDifferenceRecoveryPlan` accepted only `recovery_required` metadata.
- The existing recovery-plan classifier is reused read-only for validated metadata v5 `mismatch`; no new Hook or persistence format is introduced. Eligibility still requires a valid bound parent/owner or child/member connection, and the check fails closed on metadata/local/workspace/pending/intent/push-block changes.
- After a failed restricted repair, the integrated stage becomes `normal_mismatch_difference_check`. One explicit click performs at most one complete pull and classifies the union of current local and remote dates.
- With no baseline, exact local/remote payload and timestamp matches remain `exact_match_baseline_missing`, never `exact_match_baseline_confirmed`. Other classes retain the existing body mismatch, local-only, remote-only active/tombstone, timestamp mismatch, state/lineage mismatch, and unknown semantics.
- The React-only result includes all classified items, current cursor, observed full-pull maximum sequence, checked time, and the Hook's current metadata/local generation. A metadata raw, local signature, or eligibility change discards the result; V3/V4 and pre-migration results are not reused.
- The integrated UI displays summary counts and permits an explicit one-date selection. Selection does not invoke any adoption, upload, merge, checkpoint save, or metadata mutation.
- Existing body-mismatch, recovery local-only, and recovery remote-only handlers require confirmed or recovery checkpoint prerequisites that are absent in a baseline-empty mismatch. They are intentionally not called from this phase; minimal adapters or a safe checkpoint decision remain follow-up work.
- Cursor mismatch may be displayed for diagnosis but makes one-by-one continuation unsafe. No cursor update occurs automatically.
- Child/member read-only pull is allowed without granting owner management or broader local-apply permissions. No automatic pull/retry, SQL/RPC/RLS change, write RPC, operation ID, pending, or storage mutation is added.
# B-3f5e10 — mismatchからのrecovery checkpoint確定

metadata v5かつ`baselineStatus = mismatch`で、workspace binding、validator、React/storage、pending、localDeleteIntent、pushBlockを安全に確認できる場合に限り、ユーザーの明示操作で完全full pullを1回実行する。

日付ごとの正式分類後、`exact_match_baseline_missing`だけを既存のactive baseline生成処理で候補化する。`body_mismatch`、`local_only`、`remote_only_active`、`remote_only_tombstone`はbaselineを作らず、現在のlocal・remote・baselineから同一分類を再構築できることを候補条件とする。revision系譜不一致、active/tombstone矛盾、unknown、不正record、重複dateはfail-closedとする。

候補metadataはversion 5とworkspaceその他の履歴を維持し、`lastPulledChangeSequence`を完全full pullの最大change sequence、`baselineStatus`を`recovery_required`、`baselineConfirmedAt`を`null`とする。pendingOperationは作成せず、既存値がnullであることを要求する。

保存は候補確認とは別の明示操作で行う。mismatch起点では確認済みsnapshotを再利用し、保存時の追加pullは行わない。source metadata raw、local storage snapshot、workspace、cursor、pending、intent、pushBlock、candidate全体と未解決分類の不変を確認してから、既存compare-and-writeでcandidate全体を1回保存する。完全read-backに失敗した場合は、storageが当該candidateと一致することを確認した場合だけ元rawへverified rollbackする。rollback不能は成功扱いにしない。

保存後は自動full pullを行わず、既存`useDayMemoSavedRecoveryStateCheck`をユーザーが明示実行する。cursorとfull pull最大sequence、完全一致baseline、未解決差異の再構築を確認後、既存の1件ずつの復旧経路へ進む。通常同期readyはfalseのままであり、confirmed復帰は最終確認Phaseだけが扱う。
# B-3f5eUI2 — child/member同期チェック案内モード

`metadata.version = 5`かつ`baselineStatus = recovery_required`のchild/memberでは、設定画面上部に単一の同期チェック案内を表示する。案内はReact derived stateであり、metadata、pending、operation lifecycle、safety分類には保存しない。通常表示は現在の推奨1件と次の明示操作だけとし、内部分類、revision、sequence、snapshot詳細は既存の詳細・診断へ残す。

saved recovery stateがreadyで次分類がbody mismatchでも、本文比較用checkpoint resultがない場合は、既存checkpoint確認handlerを「本文比較の準備を確認」として案内へ接続する。確認成功後も比較は自動実行せず、次の明示操作で対象日を選択して比較する。

body mismatchのremote候補は既存candidate snapshotを正本とする。反映直前にmetadata raw、local raw、workspace、baselineStatus、pending、intent、pushBlock、対象local/remoteを再確認し、backup後に対象日だけをlocalへverified保存する。別の明示操作で完全full pullを行い、対象remoteと対象外分類の不変を確認してから対象active baselineを候補化する。さらに別の明示操作でmetadata v5全体をcompare-and-writeし、完全read-backを確認する。失敗時は既存verified rollback規則に従い、自動再試行しない。remote write、operation ID、pendingは不要である。

結果コピーは安全な状態、日付、操作、残件数、baselineStatus、cursor、pending有無、自動retryなしだけを含む。本文、payload、UUID、operation ID、fingerprint、URL/key/token/Auth sessionは含めない。clipboard失敗は表示上の補助機能失敗として扱い、同期状態を変更しない。

local候補、recovery local-only、recovery remote-onlyは既存handlerを呼び、ThemeSettings内で同期処理を再実装しない。既存remote-only handlerが他差異を許可しない場合は安全停止を表示する。tombstoneは既存経路へ安全に接続できるまで自動削除・復活を行わない。PC owner UI、migration、checkpoint形式、SQL/RPC/RLS、metadata/pending形式は変更しない。

## B-3f5eUI2 — iPhone guide transition correction

The first guide action is explicitly a saved-state read-only check, not a difference-selection action. Before a successful result it is labelled `保存状態を確認`; a failed safety result remains visible with a safe Japanese reason and an explicit recheck action. A successful `normal_difference_checkpoint_saved_state_ready` result immediately derives the recommended unresolved date from the current result, then advances to checkpoint confirmation or content comparison for a body mismatch. No date is hard-coded in the guide and no result is persisted by the guide.

The guide always renders `結果をコピー`, including before any result, after a blocked check, with zero differences, and during later stages. Its summary contains only state, selected date or unselected, safe problem label, current stage, remaining count, next action, baseline status, cursor, pending presence, and the absence of automatic retry. It never includes memo content, payload, identifiers, fingerprints, credentials, or raw metadata. Clipboard failure is UI-only and does not alter sync state.

This correction changes only guide routing and presentation. It does not change saved-state or checkpoint validators, snapshot freshness, confirmation, read-back, rollback, pending/operation lifecycle, full-pull limits, persistence formats, RPC/SQL/RLS, automatic processing, or the PC owner workflow.

## B-3f5eUI2b — saved checkpoint target alignment

The saved recovery state check is checkpoint-wide and must not accept a target date input. Its source of truth is the current validated metadata v5, bound workspace, current local storage/React state, absence of pending/intent/push block, `recovery_required` status, cursor, and one explicit complete full pull. Every persisted baseline date must reclassify as `exact_match_baseline_confirmed`; all other dates are then rebuilt as unresolved classifications.

Only a successful current result may produce `nextRecommendedDate`. The guide may use that date or a date explicitly selected from the same result. Starting a new saved-state check clears React-only selected date, checkpoint comparison, and body-mismatch candidate state, so a historical device-specific target or candidate snapshot cannot be reused. A body mismatch proceeds through explicit checkpoint confirmation and then explicit content comparison.

Clipboard support is progressive: use the secure Clipboard API when available, try a user-gesture legacy copy fallback, and otherwise display the already-safe summary in a selectable textarea. The fallback contains no memo content, payload, raw metadata, identifier, fingerprint, or credential, and clipboard failure never changes sync safety or persistent state.

This phase changes no metadata/checkpoint validator contract, persistence format, pending/operation lifecycle, full-pull limit, confirmation, read-back, rollback, RPC/SQL/RLS, automatic retry, adoption, or send behavior.

## B-3f5eUI2c — explicit remote choice local apply

After explicit confirmation, the remote-choice apply handler enters an in-flight state, yields once so the processing state can render, and executes the existing local apply exactly once. It revalidates the current candidate snapshot, metadata raw, local raw, workspace, recovery status, pending, intent, push block, baseline absence, local target, and canonical remote payload before any DayMemo write.

The pre-apply backup keeps its existing version and key. For this path only, an existing valid backup for the same workspace may be replaced with the current pre-apply snapshot using write/read-back verification; a failed replacement restores and verifies the prior raw backup. Invalid or other-workspace backups remain fail-closed.

The local write replaces only the target date with the canonical remote DayMemo and preserves every other date. Verified storage replacement and complete read-back are mandatory. Success updates React state from the verified value, consumes the candidate snapshot, records `local_saved`, and exposes only the explicit post-adoption read-only check. Metadata is not changed until that later verification and separate explicit metadata save.

Every blocked result is rendered ahead of the candidate UI. The result distinguishes unchanged, rolled-back, saved, and uncertain local state; it never silently returns to the apply button. A stale or blocked candidate is consumed and must be rebuilt from the saved-state/checkpoint flow. There is no automatic retry, remote write, operation ID, pending creation, SQL/RPC/RLS change, or persistence-format change.

## B-3f5eUI2d — local-only discard contract

`local_only` means the selected date has exactly one valid local DayMemo and no active or tombstone remote record or baseline. The iPhone guide may offer an explicit local discard alongside the existing upload and hold choices. Discard is never automatic or batched.

Before the local write, the handler revalidates metadata v5 and workspace binding, `recovery_required`, null pending/push block, empty delete intents, React/storage equality, baseline absence, the current saved unresolved-classification snapshot, cursor equality, and one complete read-only full pull with no remote record for the target. It then stores a verified backup and replaces the DayMemo array once with only the target date removed. Storage read-back must exactly match; otherwise verified rollback is required and rollback uncertainty remains fail-closed.

The discard is a local data decision, not a synchronized delete. It creates no tombstone, operation ID, pending operation, or local-delete intent and performs no remote write. Metadata, baselines, and cursor remain unchanged. After success, the user explicitly reruns the saved-state read-only check; the removed date disappears from the union classification while other unresolved differences remain. Normal readiness and confirmed restoration remain in their existing later phases.

## B-3f5eUI2e — remote-only active one-item adoption adapter

A selected `remote_only_active` item may be adopted while other unresolved differences remain. Eligibility no longer requires every outside date to be `exact_match_baseline_confirmed`; it requires the selected date to be present in the current saved-state result as `remote_only_active` and all outside differences to be reproducible without change.

The candidate check records the complete unresolved-classification map, the outside-date subset, and an internal fingerprint of the complete full-pull records. Before the confirmed local write, a second complete pull must reproduce the same remote fingerprint, target active record, target classification, and outside classifications while metadata/local raw values, workspace, cursor, pending, intents, and push block remain unchanged. The post-adoption check repeats the remote and outside-difference checks. Any change stops fail-closed; outside differences are never adopted or resolved implicitly.

The local apply adds only the validated target payload and uses the existing backup, verified replacement/read-back, and rollback contract. The later metadata candidate adds only the target active baseline, keeps the cursor at the verified full-pull maximum, and preserves `recovery_required` with null `baselineConfirmedAt`. Other unresolved differences remain unbaselined. No remote write, operation ID, pending operation, automatic retry, bulk adoption, merge, or automatic confirmed restoration is introduced.

## B-3f5eUI2f — remote-only candidate snapshot lifecycle

The remote-only candidate snapshot remains Hook-owned React memory. Its availability is `ready` only when it exists, is not consumed, matches the expected target date and current result date, and the Hook stage is `candidate_ready`, `local_saved`, or `post_adoption_ready`. A normal rerender does not consume or replace it.

The integrated navigation must not interpret `blocked` as a new `remote_only_check`. A blocked result, missing/consumed/stale snapshot, target mismatch, or stage/result mismatch routes to an explicit saved-state recheck. That action first clears the remote-only Hook result and in-memory snapshot, then rebuilds current unresolved differences read-only. A valid ready snapshot routes to the matching adopt, post-adoption check, or metadata-save handler without creating a second candidate.

This lifecycle adapter does not relax the target or freshness validators. Workspace, metadata/local raw values, target date, remote/full-pull fingerprint, outside classifications, remote active state, local absence, backup, verified read-back, rollback, and metadata compare-and-write remain mandatory at their existing stages. Other differences and `recovery_required` remain; there is no remote write, pending/operation ID, automatic retry, or automatic confirmed restoration.

## B-3f5eUI2g — candidate check observable outcome contract

The explicit remote-only candidate check must always produce an observable state after a user click: `checking`, `candidate_ready`, `blocked`, or `failed`. It must never clear `running` in `finally` and return to `idle` without a result.

The prior snapshot constructor called `crypto.randomUUID()` for an unused in-memory token. On iPhone Safari accessing a LAN HTTP development server, that API may be unavailable. The resulting exception bypassed all result writes because the check had no catch; `finally` then restored `running=false`, creating a visible no-op. The unused token is removed. It was not an operation ID, was never persisted or displayed, and was not part of snapshot freshness.

Candidate checking now catches unexpected failures into a `failed` result and converts an invalid start target/prerequisite into a `blocked` result. The UI maps candidate safety classifications to safe Japanese messages and routes both outcomes to an explicit saved-state recheck. A valid result remains `candidate_ready` and exposes the existing one-item local adoption action. In-flight guard prevents duplicate/parallel checks; there is no automatic retry, persistence, remote write, operation ID, pending state, RPC/SQL/RLS, or format change.
## B-3f5eUI2h final verification observable lifecycle

- A zero-difference saved recovery result permits an explicit final read-only verification on both owner/parent and member/child connections. The action must expose exactly one observable lifecycle: `checking`, `confirmation_ready`, `blocked`, or `failed`; an exception must never return silently to idle.
- The final snapshot binds the source metadata raw value, local DayMemo raw value, workspace, validated metadata v5 candidate, baselines, cursor, and confirmation candidate. It does not require a random token or `crypto.randomUUID()`.
- Verification re-reads metadata and local storage, performs one explicit complete pull, requires cursor equality and `exact_match_baseline_confirmed` for the union of local, remote, and baseline dates, and rejects pending, intent, push block, workspace mismatch, stale source state, malformed pull, or invalid candidate.
- `blocked` and `failed` retain no reusable snapshot. A user-triggered recheck clears the old result and reconstructs from persisted state; there is no automatic pull, retry, save, confirmed transition, or remote write.
- `confirmation_ready` is still read-only. Only the separate explicit “同期状態を確認済みにする” action may invoke the existing atomic metadata save, read-back, and rollback path. Its safety conditions and all SQL/RPC/RLS and persisted formats remain unchanged.
## B-3f5eUI2i confirmed-state result invalidation

- A successful recovery finalization save updates persisted metadata and the React metadata source through verified read-back. That metadata transition is an invalidation boundary for every normal update/pull preview created under recovery_required; old errors, summaries, candidates, and remote snapshots are not evidence about the new confirmed state.
- The integrated router gives an in-progress recovery finalization lifecycle priority over the generic confirmed path. In particular, confirmed_saved must expose the separate explicit post-save full-pull verification, and normal_sync_ready must expose completion. Neither state is inferred from the confirmed flag alone.
- A fresh normal pull is ready with zero differences only when its maximum sequence equals the metadata cursor, its same count equals the baseline count, and every local-only, remote-only, content difference, and active/tombstone mismatch count is zero. Zero differences must not enter the one-local-only blocked branch.
- Before that explicit read-only verification, confirmed metadata is shown as normal-sync “unverified”, not as a baseline inconsistency. A verified result may show ready; a real classified difference remains non-ready and is never auto-selected, uploaded, or repaired.
- These lifecycle changes do not regenerate baselines, mutate metadata or DayMemo, perform automatic pulls/retries, or change SQL, RPC, RLS, validators, persisted formats, read-back, or rollback behavior.
## B-3f5eUI2j confirmed normal local-only route

- After recovery completion, a fresh normal-state pull may classify exactly one baseline-free local memo as local-only. The dedicated local-only preview then requires no active remote record, no tombstone, confirmed metadata v5, a non-null confirmation time, workspace binding, no pending/intent/push block, unchanged local and metadata snapshots, and no other candidate classification.
- Preview and remote preflight are read-only. The preparation action alone creates one UUID v4 through the existing secure utility and persists one base-revision-zero normal upsert pending with verified read-back. The explicit send revalidates the prepared metadata and local snapshot and uses the saved operation ID exactly once.
- The existing RPC response validator proves applied active payload, revision, change-sequence advance, timestamps, workspace, and target date. Conflict and response-unknown retain pending state and forbid automatic retry. An applied response is followed by the existing atomic metadata save of the target active baseline, cursor, confirmed status/time, and null pending.
- After that verified save, the same metadata object is adopted into React state so normal eligibility is recalculated without reload. The integrated route then requires a separate explicit normal-state full pull; zero differences returns normal-sync-ready, while any real difference remains classified and unsent.
- Preflight and send have separate in-flight guards. There is no automatic send/pull/retry, batch operation, fixed test date, remote delete, schema/RPC/RLS change, or persisted-format change.
## B-3f5eUI2k shareable sync status

- Sync and recovery UI exposes a stable stage ID beside the Japanese presentation and builds a fixed-key status report from the same navigation object and button label used by the visible UI. Missing values remain explicit as unknown, none, or unverified.
- Copy is a read-only UI action. Its click-time snapshot contains only safe scalar presentation data: device role label, screen mode, stage, target, classification, safety, baseline status/count, cursor, readiness, visible action/disabled reason, difference counts, pending/intent counts, write/persistence indication, final-check state, and display time.
- The shared clipboard utility first uses Clipboard API only in a secure context and accepts success only after the promise resolves. It then uses a focused, selected, off-screen 16px textarea attached to document.body and accepts success only when execCommand returns true. Selection and prior focus are restored.
- If neither automatic route proves success, the UI shows the complete snapshot in a selectable textarea with explicit select-all and close controls. It never reports success speculatively. The manual surface supports long-press selection, text user-select, focus restoration, and Escape close on keyboard browsers.
- Blocked and failed states additionally expose a safe stop report. No report includes UUIDs, operation IDs, fingerprints, credentials, raw localStorage, payloads, DayMemo content, stack traces, or Supabase configuration. Copying performs no pull, retry, save, stage transition, RPC, SQL, or persisted-format change.

## B-3f5eUI2k-1 short and manual sharing

- Clipboard success inside Safari does not prove that a downstream LINE paste will work. The primary sharing surface therefore separates a short fixed report, an always-available manual text surface, and the existing detailed diagnostic copy.
- `buildSyncShareText` is a pure presentation function. It receives only the currently displayed stage ID, state, target, classification, difference count, baseline status, cursor, ready flag, primary action, disabled reason, and safe stop reason. It performs no pull, storage access, mutation, or stage transition.
- The manual sharing control opens the same click-time short report in a readonly, selectable textarea with select-all and close actions. Automatic copy failure opens the same fallback and never claims success without a proven Clipboard API or execCommand result.
- Short and detailed reports exclude content, payloads, UUIDs, operation IDs, fingerprints, credentials, user identifiers, and Supabase configuration. Sync, recovery, metadata v5, baseline, cursor, pending, SQL, RPC, and RLS behavior remain unchanged.

## B-3f5eUI2k-2 manual-first sharing

- iPhone testing confirmed that a resolved Clipboard API or true execCommand result does not prove a later paste into LINE. The share panel therefore presents the manual text button first and keeps automatic copy as a secondary convenience.
- Manual sharing opens a titled readonly textarea without attempting clipboard access. The user can long-press the text or use select-all, then close the surface. Automatic failure opens the same surface.
- A proven browser copy now reports only that the copy operation ran; it does not claim that another application can paste the text. Clipboard result validation and all short-report fields remain unchanged. Sharing stays read-only and does not affect sync stages or persisted state.

## B-3f5eUI2l visible normal-sync checks

- The normal pull Hook already retained its preview state and result correctly; its `pulling` state simply ended as soon as the read-only request completed. The integrated UI had no separate presentation result, so fast checks produced only a brief flash and no durable completion card.
- A UI-only state distinguishes idle, checking, success, blocked, and failed. It observes the existing Hook, keeps checking visible for at least 700ms, disables repeat clicks, and retains the final presentation until the next explicit navigation action. Synchronous fail-closed returns are also retained as blocked or failed rather than leaving the UI in checking.
- The share report reads this same presentation snapshot for stage, result state, difference count, readiness, next action, and safe failure reason. No pull behavior, validation, classification, metadata, baseline, cursor, pending, RPC, SQL, or persisted state changes.

## B-3f5eUI2m difference presentation

- The integrated sync surface renders a read-only difference card before its primary action. Recovery uses saved-state `unresolvedClassifications`, mismatch recovery uses the existing plan `items`, and confirmed normal sync uses existing pull-preview `items`; no classification is recalculated.
- A shared presentation mapping converts internal classifications into Japanese titles and short type labels. Each vertical card shows date and an action label backed by an existing route; unsupported or unsafe classifications explicitly say that safety confirmation is required.
- Short sharing includes localized classification counts and per-date action lines. Detailed copy includes the same safe date, title, type, and action data. Content, payloads, identifiers, credentials, and Supabase configuration remain excluded, and all sync and persistence behavior remains unchanged.

## 通常差異から復旧準備へ進むBridge設計

- `normal_sync_check`が返す`remote_only_active`、`local_only`、`body_mismatch`等は、現在のlocal・remote差異を表示・確認するための通常差異である。この分類だけではrecovery operationのcandidateではなく、remote adoption、upload、delete、local反映の開始根拠にしてはならない。
- candidateは、明示的な復旧checkpoint保存後にmetadataが`recovery_required`となり、さらにsaved recovery stateの完全full pull確認が`normal_difference_checkpoint_saved_state_ready`を返した場合だけ、その`unresolvedClassifications`から生成する。個別preflightはこの保存済み・再確認済みcandidateだけを対象とする。
- confirmed通常同期で差異を検出した場合の正式な遷移は、`通常同期 → 差異検出 → 復旧準備開始（明示操作） → 全差異のcheckpoint確認 → checkpoint保存 → recovery_required → saved recovery state ready → candidate生成 → 個別preflight → 個別明示実行`とする。
- checkpointは個別の採用・送信判断ではなく、観測した現在状態の安全な基準を作る処理である。そのため復旧準備開始時に表示されている全差異をcheckpoint確認対象とし、完全一致分のbaseline、最新cursor、未解決分類を一体として検証する。個別差異だけを抜き出してcheckpointやcandidateを手動生成しない。
- checkpoint保存後も、remote採用、local upload、discard、delete、本文選択等は分類ごとの既存経路で1件ずつ明示実行する。他差異を自動解決、一括処理、暗黙採用しない。
- confirmed状態を自動で`recovery_required`へ変更しない。通常差異カードの`remote_only_active`表示だけでadoption可能にせず、自動同期、自動採用、自動retryを追加しない。
- 現状はmismatchからcheckpoint確認・保存へ進む既存経路と、recovery_required保存後のsaved-state確認経路は存在する。一方、confirmed通常差異からcheckpoint作成へ入る明示Bridge UIは未実装であり、通常差異から直接`useDayMemoRecoveryRemoteOnlyAdoption`へ渡すと`candidateDates`が存在せずfail-closedとなる。
- 次の実装は既存のnormal difference plan、checkpoint check/save、saved recovery state checkを再利用する薄いBridgeとする。新しい分類、RPC、SQL、metadata形式、手動candidate生成は追加しない。

### confirmed通常差異Bridgeの入口とstatus-only checkpoint

- 現在、`baselineStatus = confirmed`で`normal_sync_check`が差異を検出した場合、通常差異の表示までは可能だが、既存checkpoint経路は`mismatch`または`recovery_required`を開始条件としており、正式な復旧準備入口は存在しない。
- 今後は通常差異表示に、ユーザー明示操作の「復旧準備を開始」を追加する。正式フローは、`normal_sync_check → 通常差異表示 → 復旧準備を開始 → Bridge安全確認 → checkpoint確認 → checkpoint保存 → recovery_required → saved recovery state確認 → unresolvedClassifications生成 → candidate生成 → 個別preflight → 個別明示実行`とする。
- Bridgeは通常差異をcandidateへ直接変換しない。最新の通常差異resultの鮮度、metadata v5とconfirmed状態、workspace binding、pending、localDeleteIntent、pushBlock、local・remote・baseline・cursorの不変性を確認し、既存checkpoint check/saveへ接続する役割だけを持つ。
- checkpoint確認対象は、選択中の1件ではなく表示中の全差異とする。checkpointは個別採用判断ではなく、後続の復旧判断に使う安全な基準を作る処理である。採用、送信、削除、local反映はsaved-state確認後に既存経路で1件ずつ明示実行する。
- confirmedから復旧準備へ進む際、完全一致baselineの追加もcursor更新も不要な場合がある。この場合は、baselineとcursorを維持し、既存validator、完全full pull、snapshot鮮度確認、verified保存、read-back、rollbackを満たした上で、`baselineStatus = recovery_required`、`baselineConfirmedAt = null`への明示的な状態遷移だけを行うstatus-only checkpointとして扱う。
- status-only checkpointも自動保存しない。confirmedからの自動`recovery_required`化、candidateの手動生成、saved recovery state確認の省略、通常差異表示からの直接adoption、自動同期、自動採用、自動retryは禁止する。
- candidateはcheckpoint保存済みかつsaved recovery state確認成功後に再構築された`unresolvedClassifications`からのみ生成する。通常差異の`remote_only_active`、`local_only`、`body_mismatch`等は、Bridge完了前には処理候補として扱わない。
- 実装は`useDayMemoNormalDifferenceRecoveryPlan`、`useDayMemoNormalDifferenceRecoveryCheckpointCheck`、`useDayMemoNormalDifferenceRecoveryCheckpointSave`、`useDayMemoSavedRecoveryStateCheck`と既存recovery/adoption Hookを再利用する。新規checkpoint分類ロジックや別の永続形式は作成しない。

## Phase3-5後半 実機検証結果と安全境界

- 実機検証では、checkpoint確認・明示保存、`recovery_required`への遷移、Saved Recovery State確認が成功し、保存済みmetadataを正本として未解決差異を再構築できた。
- remote-onlyは、candidate生成、明示adoption、反映後確認、metadata保存を分離した既存経路で成功した。candidate生成だけではlocal・remote・metadataを変更せず、adoption後も別の確認と保存を必要とした。
- local-onlyは、candidate準備、preflight、明示送信、operation結果確認、metadata保存を分離した既存経路で成功した。準備だけでは送信せず、保存済みoperation情報を後続確認に使用した。
- 全個別復旧後に未解決差異0件を確認し、明示的な最終確認とconfirmed保存を経た後、別の通常同期確認で`normal_sync_ready`へ到達した。
- 自動同期、自動candidate生成、自動採用、自動削除、自動送信、自動retryは禁止したままであり、全工程をユーザーの明示操作で進めた。
- 各境界でfail-closed、snapshot鮮度確認、完全full pull再確認、verified read-back、rollbackを維持した。
- candidate確認、local反映、反映後確認、metadata保存は独立したstageであり、前段成功から後段処理を自動実行しない。
- recovery完了またはconfirmed保存だけで通常同期readyを推測せず、別の明示的な通常同期確認成功を`normal_sync_ready`の条件として維持する。

## 通常差異だがcandidate未成立となるcleanup境界

- 通常同期でremote-only等の差異が表示されても、その表示結果だけではrecovery/adoption candidateではない。
- 正式なcandidateには、Recovery Bridge、全差異のcheckpoint確認と明示保存、Saved Recovery State確認、`unresolvedClassifications`の再構築が必要である。
- `remote_only_candidate_start_prerequisite_invalid`は、これらの前提を満たさない通常差異から採用処理へ進ませない正常なfail-closedである。
- candidate未成立のremote-onlyを直接remote削除しない。通常削除もlocal DayMemoと整合するactive baseline等を前提とするため、この状態では条件を満たさない。
- 過去テストや復旧途中に残った同種の状態については、対象日を限定し、workspace、metadata、完全full pull、snapshot鮮度、pending、localDeleteIntent、pushBlockを再確認するcleanup専用Phaseを将来検討する。
- UIでは「現在の復旧候補として確認できません」「保存済み復旧状態の確認が必要です」「最新状態を再確認してください」と案内し、採用・削除・retryを自動実行しない。

## 2026-07-23 Sync Audit後の同期工程・表示原則

- 同じverified snapshotで安全に判断できる連続したread-only工程は統合する。過去のUI結果やtransient previewを根拠にせず、metadata、workspace、local signature、remote fingerprint、baseline、cursor、対象外差異を束ねた操作時snapshotだけを再利用する。
- verified snapshotを再利用できるのは、対象日・分類・workspace・metadata fingerprint・local signature・cursor・baselineおよび対象外差異が一致し、snapshotの用途と次の操作が同一lifecycle内に限定される場合だけとする。境界を越えた状態変化や鮮度切れはfail-closedとする。
- local置換、remote送信、削除等の破壊操作の直前には最新状態を再確認する。変更後はverified read-backを行い、必要なread-only full pull、差異解消確認、cleanup candidate、metadata compare-and-write／read-backを別の明示操作で完了する。
- full pullは安全境界ごとに必要な最小回数へ抑える。同じ状態を説明するためだけの重複full pullを追加せず、比較snapshot生成、破壊操作直前確認、変更後確定の責務を明確に分ける。
- 次操作のlabel、eligibility、handlerは同一action descriptorから生成する。handlerのない説明専用nextActionを表示せず、PCの`ThemeSettings`とiPhoneの`DayMemoSyncGuide`は同じaction model、実行関数、ボタン名を使用する。
- checking中は処理中であることだけを示して連打を禁止する。blocked／failed時だけ安全な停止理由と再確認操作を保持し、一時的なsnapshot失効風メッセージや古い中間結果を縦に積み上げない。
- 失敗後の再確認はユーザーの明示操作とし、失効した候補・preflight snapshotを破棄して、候補確認または通常同期確認から再開する。自動full pull、自動retry、自動送信、自動採用は行わない。
- active baselineとconfirmed tombstoneは種別ごとに厳格比較する。confirmed tombstoneもrevision、sequence、deletedAt、server timestamp、payload状態、`baselineLocalUpdatedAt = null`の全一致を必要とし、不明・不一致tombstoneは許可しない。
- 同期パネルは現在状態、現在の対象、直近結果、実行可能な主操作を中心に表示する。過去工程をカードとして累積せず、外側containerと主要カードの役割を分け、説明文・箇条書き・stage ID・共有・診断の余白を抑える。
- 個人利用アプリとして、同じ安全証拠を繰り返し確認させる過剰な工程は避ける。ただし明示操作、破壊操作直前確認、変更後read-back、rollback、fail-closed、confirmed tombstone比較、自動retry禁止は省略しない。

## Sync Stabilization Audit完成基準と保守モード

- 完成基準は、主要正常経路の実機完走、既知再現不具合なし、破壊操作直前のverified確認、書込み後read-back、rollback、対象外不変確認、通常同期復帰、未接続nextActionなしとする。理論上の全競合を専用実装することは完成条件にしない。
- 正式経路は、通常同期確認、新規local-only候補確認／preflight／明示送信／cleanup、body mismatch remote採用4操作、body mismatch local採用4操作、通常削除V5 lifecycle、Recovery Bridge／checkpoint明示保存、Saved Recovery State確認、各operationのmetadata cleanupである。
- body mismatchのchoice正本はHookのcandidate snapshot＋resultだけである。requested choice、snapshot choice、result choice、safetyが一致しない場合は`candidate_choice_mismatch`でfail-closedとし、UI choice、default choice、remote fallbackを正本にしない。
- verified snapshotは同じlifecycleの次工程でだけ再利用する。metadata、workspace、local signature、cursor、baseline、remote identity、対象外差異のいずれかが変化した場合は破棄する。
- local／remote反映、remote送信、削除の直前にread-only full pullまたは同等のverified確認を行う。変更後はread-backし、永続metadataはcompare-and-writeとverified read-backで確定し、失敗時はrollbackまたはrecovery_requiredで停止する。
- 通常操作のnextActionは`recoveryNavigation`または同一action descriptorのlabel・eligibility・handlerから生成する。handlerのないnextAction説明を通常UIへ表示しない。
- 失敗後導線は「現在段階を再確認」「保存済み状態からやり直す」「復旧作業を閉じる」を基本とする。内部Hook単位の操作を通常UIへ積み上げない。
- metadata V3／V4読込、V4／V5 migration、保存データvalidatorの互換投影は既存データ読込のため残す。通常運用の正本はmetadata V5であり、旧UIや未接続Hookは互換処理として扱わない。
- completeでは成功結果だけを表示する。checkingは処理中表示、disabledは操作不可理由、blocked／failedは停止理由とし、completeと共通disabled文言を併記しない。
- 保守モードでは、metadata version、同期方式、SQL、新しい細分化stageや確認ボタンを追加しない。実利用で再現した問題だけを既存の明示操作、fail-closed、read-back、rollback境界内で最小修正する。

## Sync Final Reconciliation：安全工程対応表

| 正式経路 | 明示操作／入口 | verified確認 | 永続変更・検証 | cleanup／完了 | 再読み込み後 |
|---|---|---|---|---|---|
| 通常同期 | 通常同期状態を確認 | pull previewのfull pull、metadata・workspace・local・cursor・baseline、正式差異分類 | なし | 差異0、confirmed、pending／intent／pushBlockなし | metadataから再確認 |
| 新規local-only | 候補 → preflight → 準備 → 送信 | 対象baseline/remoteなし、対象外active/confirmed tombstone厳格比較 | ID 1回、pending、upsert RPC validation、verified metadata save | baseline追加、cursor、pending解消、confirmed | normal upsert recovery check/apply |
| body mismatch remote | 比較 → remote候補 → local反映 → 確定 | candidate一致、破壊直前full pull、metadata/workspace/local/remote/baseline/cursor/対象外 | 対象local 1件compare-and-write、local read-back、rollback | 反映後full pull、metadata read-back、差異0ならconfirmed | 永続local＋recovery metadataから再分類 |
| body mismatch local | 比較 → local候補 → remote反映 → 確定 | choice/snapshot/result/safety、Saved Recovery State、preflight | ID 1回、pending、upsert RPC validation、二重送信guard | operation result、remote read-back、cleanup、pending解消、confirmed | recovery pending＋保存済みoperation result |
| 通常削除 | V5候補 → 準備 → metadata → local削除 → remote確認 → delete → cleanup | verified delete snapshot、対象外active/tombstone、pending/intent同一ID | local read-back、delete RPC validation、cleanup compare-and-write/read-back/rollback | tombstone baseline、cursor、pending/intent解消、confirmed | delete pending/intent＋保存済みoperation result＋remote tombstone |
| Bridge/checkpoint | 復旧準備 → 候補確認 → 明示保存 | 全差異、V5、workspace、local、pending/intent/pushBlock、full pull、cursor、baseline | status-onlyはbaseline/cursor不変、normalも検証候補だけ保存、read-back/rollback | candidateは自動生成せずSaved Recovery State待ち | `recovery_required` metadata |
| Saved Recovery State | 保存後状態を確認 | metadata、workspace、local、full pull、cursor、全baseline | なし | unresolved classifications再構築 | 保存済みmetadataから再確認 |
| cleanup／通常復帰 | 結果確定、最終確認、通常同期確認 | operation result、post-send pull、current state鮮度 | V5 validator、compare-and-write、read-back、rollback | baseline/cursor/pending/intent整理後に別の通常同期確認 | 永続pending/checkpointまたはconfirmed metadata |

共通順序は`最新状態確認 → 対象／対象外確認 → 明示承認 → 1件の書込み → 結果検証 → fail-closed／rollback → metadata cleanup → 通常同期再確認`である。read-only確認と保存、candidate生成と採用、RPC成功とcleanupを混同しない。

### 過去工程の3分類

- **統合済み**：remote採用内容確認、準備、実行前確認は独立ボタンではなく`verifyAndApplyRemote()`から実行する`prepareRemote()`と`applyRemote()`に統合した。local採用のprepare／preflight／sendも1つの明示操作内で順序と結果を検証する。安全確認、full pull、対象外不変、read-backは残す。
- **意図的に削除**：同一snapshotの説明目的の重複full pull、handlerのないnextAction、旧同期ガイド、重複candidate state、通常UIへ積み上がる旧詳細操作、未使用local-only discard。
- **欠落**：監査開始時はnormal delete RPC成功後の再読み込み回収が欠落していた。既存復旧Hookへdelete operation resultとtombstone検証を追加して解消した。修正後は0件。

### candidate choice、表示、途中再開

- choice正本は`useDayMemoNormalBodyMismatchCandidate`のcandidate snapshot＋resultだけである。requested choice、snapshot、result、safetyが不一致なら`candidate_choice_mismatch`で停止し、choice省略、remote fallback、local／remote同時readyを許可しない。
- remote候補の次操作labelは実handlerと同じ「remote本文をこの端末へ反映」とする。completeは成功結果だけ、checkingは処理中、blocked／failedだけ停止理由を表示する。
- checkpoint保存後はV5 `recovery_required`、local採用送信後はrecovery pending＋operation result、remote採用local反映後は永続local＋recovery metadata、delete RPC後はdelete pending＋intent＋保存済みdelete result＋tombstone、cleanup後はconfirmed metadataを再開根拠とする。
- React refだけを再開根拠にしない。保存済み状態と新しいread-only取得から再構築し、自動retry、自動送信、自動採用、自動cleanupは行わない。

### V3／V4互換境界と完成基準

- V3／V4は旧保存データの読込、validator投影、V4/V5明示migration、rollbackのために残す。通常運用の正本はV5で、通常削除入口もV5 lifecycleを優先する。互換データが利用対象からなくなりmigration/rollback不要を確認できた時だけ削除可能とする。
- confirmed tombstoneはpayloadなし、deletedAt、revision、sequence、server timestamp、`baselineLocalUpdatedAt = null`の厳格一致時だけ正常とする。
- 欠落0、正式経路一致、途中再開、choice正本一本化、V5 validator、read-back、rollback、fail-closed、自動retry／自動送信なしを満たし、型・lint・build・diff check成功後に完成・保守モードとする。

### 保守モードの恒久境界

- 正式経路、安全工程対応表、途中再開、candidate choice、nextAction descriptor、表示状態、V3／V4互換境界は本節までを完成時の正本とする。通常運用はmetadata V5を使用し、互換処理を新機能の入口にしない。
- 同期工程の追加は実利用で再現した欠落または不具合がある場合に限る。静的監査で確認できる事項を新しい人間向けボタンへ変換せず、同一snapshotの重複full pull、説明だけのnextAction、内部Hook単位のstageを再導入しない。
- 保守修正でも、破壊操作直前のverified確認、対象外不変、RPC結果検証、verified read-back、compare-and-write、rollback、confirmed tombstone厳格比較、自動retry／自動送信禁止を維持する。
- candidate未成立の古いテストデータcleanup、理論上の全競合・全通信失敗専用UIは完成条件に含めない。実利用で必要性が確認されるまでは追加せず、HootoDay本体機能を優先する。

## 販売・在庫同期との境界

- DayMemo同期は完成済み・保守モードを維持し、販売・在庫同期の追加によってmetadata V5、日付baseline、candidate、Recovery Bridge、既存RPCを変更しない。
- 販売・在庫は既存のHootoDay workspace、認証、pairing、operation ID、CAS、read-back、rollback、fail-closedの原則を共有する。一方、payload validator、local metadata、Supabase table／RPCは販売・在庫専用とする。
- 現行7配列を別々にremoteへ保存すると販売記録とmovementが部分成功し得る。個人利用と小規模データを前提に、workspace単位の検証済み完全snapshotを1 revisionとして保存する方式を第一候補とする。
- 販売・在庫同期の正式な静的棚卸し、Supabase方式比較、初回／通常同期、競合、削除、migration、Phase分割は`INVENTORY_SYNC_ROADMAP.md`を正本とする。
