# HootoDay 同期設計

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
