# HootoDay Supabase既存基盤 流用判断書

## 1. 文書の目的

この文書は、hooto-platformに存在する同期基盤をHootoDayでどこまで流用し、何を新規追加し、何を変更しないかを定める正式な設計判断書である。

HootoSongの同期開発が途中であり、HootoPostも同じプロジェクトを利用している可能性がある。そのため、既存オブジェクトの置換や破壊的変更を避け、HootoDayのDayMemo同期パイロットを独立して安全に追加することを最優先とする。

## 2. 調査済みの既存基盤

### 2.1 テーブル

#### app_workspaces

- 列：`id`、`name`、`created_by`、`created_at`、`updated_at`
- `id`が主キー
- `created_by`は`auth.users(id)`を参照
- RLS有効

#### app_workspace_members

- 列：`workspace_id`、`user_id`、`role`、`device_label`、`joined_at`
- `workspace_id + user_id`が複合主キー
- `workspace_id`と`user_id`に外部キーあり
- roleは`owner`または`member`に限定するCHECKあり
- `user_id`検索indexあり
- RLS有効

#### app_pairing_codes

- 列：`id`、`workspace_id`、`code_hash`、`created_by`、`expires_at`、`used_at`、`used_by`、`created_at`
- `id`が主キー
- `workspace_id`、`created_by`、`used_by`に外部キーあり
- `code_hash`と`workspace_id`の検索indexあり
- `code_hash`はUNIQUEではない
- RLS有効だが直接policyなし
- security definer RPC経由の利用を想定した構造

#### app_workspace_state

- 列：`workspace_id`、`key`、`value`、`updated_at`、`updated_by`、`updated_by_label`、`revision`
- `workspace_id + key`が複合主キー
- `workspace_id`と`updated_by`に外部キーあり
- `workspace_id`検索indexあり
- RLS有効
- workspace memberだけがSELECT・INSERT・UPDATE可能
- DELETE policyなし

#### 未作成

- `app_devices`
- `hooto_day_sync_records`

### 2.2 extension

- `pgcrypto 1.3`
- `uuid-ossp 1.1`

### 2.3 RLS・policy

- 既存4テーブルはすべてRLS有効
- policyはanonymous sign-in後の`authenticated` roleを対象とする
- `app_workspaces`はmemberだけSELECT、ownerだけUPDATE可能
- `app_workspace_members`はmemberだけSELECT可能
- `app_workspace_state`はmemberだけSELECT・INSERT・UPDATE可能
- state更新時の`updated_by`はNULLまたは`auth.uid()`に制限
- DELETE policyなし
- `app_pairing_codes`に直接policyなし

この構成は、匿名ログイン後に`auth.uid()`を持つauthenticated userをowner/memberとして扱う方針と整合する。少なくともworkspace閲覧とstateアクセスの基本RLSは流用可能である。

### 2.4 RPC・関数

確認済みの主要関数：

- `create_app_workspace(workspace_name, device_label)`
- `create_app_pairing_code(target_workspace_id, valid_minutes)`
- `consume_app_pairing_code(input_code, device_label)`
- `is_app_workspace_member(target_workspace_id)`
- `is_app_workspace_owner(target_workspace_id)`
- `current_hooto_sync_key_hash()`

主要5関数はauthenticatedだけがEXECUTE可能で、SECURITY DEFINER、search_path固定、`auth.uid()`検証ありと確認した。

- workspace作成RPCは未認証を拒否し、workspaceとowner memberを作成する。
- pairing code発行RPCはowner限定で、有効期限を1～30分に制限し、hashだけを保存する。
- pairing code利用RPCは未使用・期限内のcodeだけを受け付け、memberを追加して`used_at`を更新する。
- `used_by`は現在更新していない可能性がある。
- member/owner判定関数は`auth.uid()`を基準にする。
- `current_hooto_sync_key_hash()`はPUBLIC EXECUTEで、HootoPost系の旧同期方式と推定される。

## 3. 既存基盤の完成度評価

既存基盤は、匿名認証、workspace作成、owner/member所属、短期pairing、基本RLSという接続基盤としては流用可能である。一方、次の点から「完成済みの汎用同期基盤」とは判断しない。

- workspaceに明示的なapp識別子がない。
- `app_pairing_codes.code_hash`がUNIQUEではない。
- `used_by`監査が未完成の可能性がある。
- pairingの総当たり対策は十分か未確認。
- `app_devices`がない。
- レコード単位revision、tombstone、operation idを持つ同期テーブルがない。
- `app_workspace_state`は全体state向けで、DayMemoのレコード競合には不向き。

したがって、接続基盤は「一部完成」、HootoDayの同期本体は「未実装」と評価する。

## 4. 3案の比較

| 比較項目 | A. 全面流用 | B. 共通基盤を流用し専用同期を追加 | C. 完全新設 |
|---|---|---|---|
| HootoSongを壊さない | 既存stateやRPC利用方法の衝突リスク | 既存を変更しなければ低リスク | 低リスクだが重複が大きい |
| HootoPostへの影響 | 旧関数との混在リスク | `current_hooto_sync_key_hash`を触らず回避 | 影響は小さい |
| DayMemo試験への速さ | 一見速いがstate競合対策が不足 | 接続基盤を再利用でき最短 | 認証・pairing再実装で遅い |
| 安全性 | 全体JSON上書きが危険 | レコード単位revisionで高い | 高くできるが検証量が多い |
| RLS分離 | state key依存 | 専用テーブルpolicyで明確 | 完全分離 |
| デバッグ | state全体単位で難しい | entity単位で追跡可能 | 可能だが基盤が二重化 |
| 15種類以上への拡張 | value巨大化・競合増大 | 共通同期レコードで拡張可能 | 可能だがSQL量が多い |
| revision/tombstone | state revisionだけでは不足 | 専用構造で対応可能 | 対応可能 |
| 在庫の独立性 | state利用は不適切 | Phase 5で専用設計へ分離 | 分離可能 |
| 無料枠 | テーブル追加なし | 専用1テーブル中心で軽量 | テーブル・RPCが重複 |
| SQLの複雑さ | 初期は小、競合対応で複雑化 | 中程度 | 大きい |
| rollback | stateへ混在すると難しい | 新規専用オブジェクトだけ戻せる | 戻しやすいが作業量大 |

## 5. 採用案

**B. 既存workspace・member・pairing基盤を変更せず流用し、HootoDay専用同期テーブルと専用同期RPCを追加する。**

### 採用理由

- 認証・workspace・pairingを再実装せず、DayMemo試験へ最短で進める。
- 既存RPCを置換しないため、作りかけのHootoSongへの後方互換リスクを抑えられる。
- HootoDayデータを専用テーブルへ分離し、state key衝突や全体JSON上書きを避けられる。
- revision、base revision、tombstone、operation idをレコード単位で実装できる。
- 専用テーブル・RPC・policyだけをrollback対象にできる。

### Aを採用しない理由

- `app_workspace_state`へDayMemo全体を保存すると、1件変更でも全JSON更新になる。
- 空端末による全体上書き、レコード単位競合、tombstone、15種類以上への拡張に弱い。
- HootoSongのkey命名や利用状況が未確認で、既存stateへHootoDayデータを混在させるのは危険である。

### Cを採用しない理由

- anonymous auth、workspace、member、pairing、RLSを重複実装する必要がある。
- 今日のDayMemoパイロットまでのSQL・テスト範囲が大きくなる。
- 個人利用かつ同一hooto-platform内で、検証済みの接続基盤を捨てる合理性が低い。

## 6. 流用する既存要素

### テーブル

- `app_workspaces`
- `app_workspace_members`
- `app_pairing_codes`

### RPC・関数

- `create_app_workspace`
- `create_app_pairing_code`
- `consume_app_pairing_code`
- `is_app_workspace_member`
- `is_app_workspace_owner`

DayMemoパイロットでは、引数、戻り値、code形式を変更せず利用する。

## 7. app_workspace_stateの扱い

### 使用案

`key = hooto_day.day_memos`、`value = DayMemo[]`として全体JSONを保存すれば、既存revisionとpolicyをすぐ利用できる。

しかし次の問題がある。

- 1件の変更でもDayMemo全体を更新する。
- 競合単位が1日ではなく全配列になる。
- tombstoneが扱いにくい。
- 空iPhoneの空配列で全体を上書きする危険がある。
- データ種別が増えるほど巨大なvalueと多数のstate keyになる。
- HootoSongの未確認keyと衝突する可能性がある。

### 正式判断

`app_workspace_state`はHootoDay同期本体には使用しない。HootoSong側の利用状況が判明するまで、HootoDayのkeyも書き込まない。接続状態などの小さな共有設定へ将来利用する場合も、key予約と既存利用調査を別途行う。

DayMemoパイロットは最初から`hooto_day_sync_records`を使用する。

## 8. app識別子

### パイロット時の暫定方針

- HootoDay用に新しいworkspaceを作成し、既存HootoSong workspaceを再利用しない。
- workspace名へ`HootoDay`を明示し、PC親機画面でworkspace名を確認してからcodeを発行する。
- HootoDayデータは専用の`hooto_day_sync_records`だけへ保存する。
- current workspace IDは端末の同期metadataとして保持する。
- 現行schemaではDBによるapp識別が不十分なため、別アプリのcodeを入力した疑いがあれば同期を開始しない。

workspace名はセキュリティ境界ではなく、暫定的な誤接続防止表示にすぎない。

### 正式な将来方針

既存`app_workspaces`へ直ちに`app_key`を追加せず、後方互換を保つ追加metadataテーブルを第一候補とする。例：`app_workspace_apps(workspace_id, app_key)`。v2 workspace/pairing RPCが`app_key = hooto_day`を原子的に検証する。

既存HootoSongの期待を確認できた場合だけ、既存テーブルへのnullableな`app_key`追加と段階移行を比較する。

## 9. pairing code

### 既存方式

- 10桁の16進文字形式の可能性
- hash保存
- 1～30分の有効期限
- 1回使用
- owner限定発行

### 設計案との比較

8文字の紛らわしい文字を除く形式は入力しやすいが、既存RPCの生成・検証・UIとの互換性を壊す可能性がある。短期パイロットではcode形式変更は同期安全性の必須条件ではない。

### 正式判断

- DayMemoパイロットでは既存code形式を維持する。
- UIで読みやすく表示し、貼り付け入力を許可する。
- code形式変更、試行制限強化、app識別検証はv2 RPCで後日導入する。
- 既存RPCを置換しない。

## 10. 既存RPCの変更判断

### used_by

`consume_app_pairing_code`が`used_at`を更新する一方、`used_by`を保存していない可能性がある。1回使用の安全性は`used_at`で確保できるため、個人利用の短期パイロットを止める必須問題とはしない。監査改善として後日v2 RPCで`used_by = auth.uid()`を同一トランザクション内に保存する。

### code_hashのUNIQUEとexpires_at index

code hash衝突と検索性能の改善候補だが、既存データとRPCの挙動を確認せず制約を追加しない。短い有効期限とowner限定を維持し、衝突時のRPC動作をSQL Phase前に確認する。

### 総当たり対策とapp識別子

既存RPCに引数追加やcode形式変更を行わない。必要なら次を新規追加する。

- `create_app_pairing_code_v2`
- `consume_app_pairing_code_v2`

v2ではapp key、used_by、試行制限、監査を追加し、既存呼び出しとの後方互換を保つ。

### current_hooto_sync_key_hash

HootoPost系の旧同期方式と推定され、PUBLIC EXECUTEである。HootoDayでは不使用とし、呼び出さず、権限も定義も変更しない。用途と依存元の調査を別Phaseで行う。

## 11. HootoDay専用同期テーブル

`hooto_day_sync_records`は一般データのレコード単位同期を担う。初期Phaseでは`entity_type = day_memo`だけを許可する。

### 候補列

| 列 | 方針 |
|---|---|
| `workspace_id uuid` | `app_workspaces.id`を参照。RLS境界 |
| `entity_type text` | 初期は`day_memo`のみCHECKで許可 |
| `entity_id text` | DayMemoでは`YYYY-MM-DD` |
| `payload jsonb` | 既存DayMemo本体。validator必須 |
| `schema_version integer` | payload形式。初期値1 |
| `revision bigint` | DB/RPCだけが増加。1以上 |
| `deleted_at timestamptz` | tombstone。物理削除しない |
| `created_at timestamptz` | 初回作成時刻 |
| `server_updated_at timestamptz` | DB側設定 |
| `client_updated_at timestamptz` | 端末申告時刻。競合の勝敗には単独使用しない |
| `updated_by uuid` | `auth.users.id`を参照 |
| `source_device_id text` | 監査用。権限には使わない |
| `operation_id uuid` | 再送の冪等性確認 |

### 制約・更新方式

- 一意制約：`workspace_id + entity_type + entity_id`
- `base_revision`は保存列にせず、更新RPCの引数とする。
- clientからrevision、server時刻、updated_byを自由設定させない。
- 過去案のmember向け直接SELECT policyは不採用とする。SELECTもpull RPCだけに限定する。
- direct SELECT・INSERT・UPDATE・DELETE policyは作らず、取得・更新は専用SECURITY DEFINER RPCだけにする。
- RPCはworkspace member、entity type、payload、base revision、operation idを検証する。
- revision不一致は上書きせず競合情報を返す。
- conflict metadataは初期テーブルへ常設せず、RPC結果と端末同期stateで保持する。正式競合履歴が必要になった時点で専用テーブルを検討する。
- 在庫・販売系はこのテーブルへ入れない。

## 12. DayMemo同期の最小安全構成

### 今日必須

- anonymous sign-in後のauthenticated user
- 新規HootoDay workspaceとowner member
- 既存pairing RPCによるiPhone member追加
- `hooto_day_sync_records`
- DayMemoだけを許可するentity type制約
- workspace member確認付きpull RPC
- 専用revision付きupsert/tombstone RPC
- PCからの初回アップロード
- クラウドが存在するiPhoneは初回pullのみ
- 空端末はpushしない初回同期保護
- revision不一致検出
- tombstone pull
- 手動同期だけ
- 同期失敗時はlocalStorageを変更しない
- localStorage本体は既存`version: 1`のまま
- 同期cursor・base revision等は別metadataキー

### 後回し可能

- `app_devices`
- `used_by`監査改善
- pairing code v2
- app metadataの正式導入
- 自動同期
- オフラインキュー
- Service Worker
- 詳細な競合解決UI
- DayMemo以外のデータ同期
- 在庫・販売同期

## 13. 次のSQL Phaseの変更原則

- 既存オブジェクトをDROPしない。
- 既存テーブルを再作成しない。
- 既存RPCを置換しない。
- 既存policyを削除・置換しない。
- HootoSong・HootoPostの動作を変更しない。
- 新規HootoDay専用テーブル、関数、policyだけを追加する。
- 共通RPCを現状の署名のまま再利用する。
- 共通基盤の改善が必要なら後方互換なv2関数として追加する。
- 適用SQLとrollback SQLを同時に作成する。
- `IF NOT EXISTS`で不明な既存同名オブジェクトを黙って受け入れない。同名があれば停止して定義を比較する。
- migration前にPCのJSONバックアップを取得する。
- SQL適用後にowner/member/非memberのRLS拒否テストを行う。

## 14. リスク一覧

| リスク | 重大度 | 今日の対応 | 後日の対応 |
|---|---|---|---|
| 作りかけHootoSong基盤との衝突 | 高 | 既存オブジェクトを変更せず専用名を使う | 依存元とmigration履歴を調査 |
| app識別子不足 | 高 | HootoDay専用workspace名と専用同期テーブルを使う | app metadataとv2 RPCでDB検証 |
| 複数Hootoアプリで同じworkspaceを誤利用 | 高 | 既存workspaceを再利用せず新規作成 | app key必須化 |
| app_workspace_stateのkey衝突 | 高 | HootoDayデータを書かない | key registryまたは用途分離 |
| 空iPhoneによるデータ消去 | 最高 | 初回はPC push、空iPhoneはpullのみ | 初回同期プレビューを正式UI化 |
| tombstoneなしで削除復活 | 最高 | deleted_atとrevisionを必須化 | tombstone保守処理 |
| revision不一致上書き | 最高 | base revision一致時だけRPC更新 | 競合解決UIと履歴 |
| code_hash非UNIQUE | 中 | 既存RPCを変えず短期codeを使用 | 既存データ確認後にv2・制約検討 |
| pairing code総当たり | 高 | authenticated、短期、owner発行を維持 | 試行制限・監査・v2 RPC |
| used_by未保存 | 中 | used_atによる1回使用を確認 | v2でauth.uid()を保存 |
| PUBLICなcurrent_hooto_sync_key_hash | 高 | HootoDayから呼ばず変更しない | 依存元調査後に権限見直し |
| 既存RPC変更による互換破壊 | 高 | 既存RPCを変更しない | v2追加と段階移行 |
| JSON復元直後の全上書き | 最高 | 自動push禁止 | 差分プレビューと明示反映 |
| 全初期化とクラウド削除の混同 | 最高 | ローカル初期化をクラウド削除にしない | クラウド削除専用の二重確認UI |

## 15. 最終判断

### 【採用方針】

既存workspace/member/pairing基盤を変更せず流用し、HootoDay専用同期テーブルと専用同期RPCを追加する。`app_workspace_state`へHootoDay同期データを保存しない。

### 【今日使用する既存要素】

- anonymous sign-in後のauthenticated role
- `app_workspaces`
- `app_workspace_members`
- `app_pairing_codes`
- `create_app_workspace`
- `create_app_pairing_code`
- `consume_app_pairing_code`
- `is_app_workspace_member`
- `is_app_workspace_owner`
- 既存owner/member RLS

### 【今日追加する新規要素】

- `hooto_day_sync_records`
- DayMemo専用payload制約・validator方針
- member確認付きpull RPC（直接SELECT policyは作らない）
- revision付きupsert/tombstone専用RPC
- operation idによる再送保護
- 適用SQLとrollback SQL
- RLS拒否テストSQL

### 【今日変更しない既存要素】

- 既存4テーブルとその列・制約・index
- 既存workspace/member/state policy
- 既存workspace/pairing RPCの署名・戻り値・code形式
- `app_workspace_state`の既存データ
- `current_hooto_sync_key_hash()`
- HootoPost・HootoSong関連オブジェクト

### 【後日改善する要素】

- app metadataまたはapp key
- pairing code v2
- `used_by`監査
- code hash一意性と`expires_at` index
- 総当たり対策
- `app_devices`
- 自動同期、Service Worker、競合解決UI
- 全データ同期と在庫専用同期

### 【DayMemo同期へ進む条件】

- 新規オブジェクト名が既存と衝突しない。
- 適用SQLとrollback SQLのレビューが完了する。
- PC JSONバックアップを取得する。
- HootoDay専用workspaceを新規作成する方針を確認する。
- 非memberが同期レコードを取得・更新できない。
- memberでもrevisionを直接書き換えられない。
- 空iPhoneがpushしない初回同期ガードを実装する。
- tombstoneとrevision不一致をテストできる。

### 【SQL Phaseの停止条件】

- `hooto_day_sync_records`または専用RPCと同名のオブジェクトが存在する。
- 既存RPCの引数・戻り値・権限が調査結果と異なる。
- HootoDay専用workspaceであることを確認できない。
- RLS拒否テストが失敗する。
- 非memberまたは別workspaceからデータを取得・変更できる。
- revision不一致で更新が成功してしまう。
- rollback SQLで新規要素だけを安全に戻せない。
- HootoPost・HootoSongへの依存影響が判明する。
- PC JSONバックアップが未取得である。

次工程は、HootoDay専用オブジェクトの適用SQL、その新規要素だけを戻すrollback SQL、RLS・revision・tombstone・再送を確認する検証SQLの作成とする。

## 16. B案の専用SQL具体化（設計時点・適用前）

既存workspace/member/pairing基盤を変更しないB案をPRECHECK・APPLY・ROLLBACK・VERIFYの4つのSQLへ具体化した。適用前検査で専用テーブル、専用sequence、専用戻り型、専用RPC、専用policy名の衝突が1件でもあれば停止し、共通テーブルまたはmember/owner helperが不足している場合も停止する。`IF NOT EXISTS`で不明な既存定義を黙って採用しない。

- 新規追加対象は`hooto_day_sync_records`、`hooto_day_sync_operations`、`hooto_day_sync_result`、専用upsert/delete/pull RPCと付随indexだけとする。
- operation IDは別履歴テーブル方式を採用する。current rowのlast operationだけを使うA案では後続更新後の古い再送、競合結果、別entityへのID誤用を十分に扱えないため、B案で適用・競合の結果を保存する。同一IDの同時再送はtransaction advisory lockで直列化し、正規化request全体のMD5 fingerprintが一致する場合だけ冪等再送とする。MD5は同一性検査専用である。
- 同一結果再送のためoperation履歴は過去payloadを保持し得る。無期限保存せず推奨30日とし、`created_at`を将来cleanupの基準にする。今回は自動削除を追加せず、cleanup後は該当operation IDの冪等保証が失われることを前提とする。records・tombstoneはcleanupしない。
- `hooto_day_sync_records`はDayMemo限定、revision一致更新、payload NULLのtombstone、専用sequenceの`change_sequence`を正本cursorとするpullを提供する。採番とcommit順は専用transaction advisory lockで直列化する。在庫・販売は許可しない。
- 同期操作はすべてRPC限定とし、専用テーブルはRLS有効・policyなし・direct table権限なしとする。専用RPCだけをauthenticatedへ許可する。
- `app_workspaces`、`app_workspace_members`、`app_pairing_codes`、既存RPC、既存policy/index/trigger、`app_workspace_state`、`current_hooto_sync_key_hash()`は変更しない。
- rollback対象は上記のHootoDay専用新規オブジェクトだけで、共通基盤とHootoSong・HootoPostへ触れない。
- 適用SQL、rollback SQL、verify SQLを作成し、2026年7月19日にJSONバックアップ・適用前PRECHECK保存後、APPLYと構造VERIFYを完了した。rollbackは未実行である。
- PRECHECKはread-only transactionとして適用前に実行し、共通4テーブルの取得対象構造署名と共通RPCのsignature・definition hashをCSV保存する。APPLY後に同じPRECHECKを再実行してCSVを比較する。一致は取得対象が変わっていないことを示す有力な資料であり、未取得の全属性、role継承を含む実効権限、外部依存まで完全同一と証明するものではない。
- APPLY内postflightは専用sequence、table、column、constraint、index、RLS/policy、直接ACL、専用RPCの属性・戻り型・固定search_path・EXECUTE権限をCOMMIT前にfail-closedで検査する。VERIFYは適用後の読み取り専用構造確認、PRECHECK再比較、実際のanon/authenticated clientによる実効権限・同期挙動確認を担当する。
- fingerprintのcanonical JSONBではSQL NULLがJSON nullへ変換される。両者そのものをhash内で区別する方式ではないが、有効なupsertのnull payloadは事前拒否し、deleteは`operation_kind`と固定入力で分離するため、許可済みrequest間の曖昧性は作らない。

## 17. 適用後の再利用判断確認（2026年7月19日）

- APPLY前後のPRECHECKは26行・5列で完全一致し、取得対象の共通4テーブル構造署名と共通RPC 6件のdefinition hashに変更がないことを確認した。
- VERIFY A1～A10で専用object、全28カラム、制約21件、index 4件、sequence属性、RLS・policy 0件、専用RPCのSECURITY DEFINER・固定search_path・EXECUTE権限、table・sequence直接権限なしを確認した。
- この比較はPRECHECK取得対象が一致したことを示すもので、DB全要素の完全同一証明ではない。共通HootoSong・HootoPost基盤への変更は取得対象の署名上確認されなかった。
- 実データやworkspaceは作成しておらず、既存workspace/member/pairing基盤を流用してHootoDay専用objectだけを追加するB案を維持する。
- authenticated clientによる16ケースの同期実操作テストとアプリ同期実装は未着手であり、次工程で分離して実施する。

## 18. 既存共通基盤を利用した実操作確認（2026年7月19日）

- 既存`app_workspaces`、`app_workspace_members`、pairing RPCを変更せず、anon keyとanonymous authenticated clientでowner・member・non-memberの接続・認可を確認した。
- HootoDay専用W1と別workspace拒否用W2だけを新規利用し、既存HootoSong・HootoPost workspaceおよび他アプリデータは使用していない。
- ownerのworkspace作成、pairing code発行、member参加、owner/memberのHootoDay RPC正常操作が成功した。
- non-memberからW1、W1 memberからW2へのpull・upsert・deleteはすべてworkspace membershipエラーで拒否された。
- pairing consume成功後にclient側の戻り値形状誤判定でローカルstateだけ未保存となったが、consumeを再実行せずmembership RPCでDB成功を確認して安全に復旧した。
- 以上により、既存接続基盤を非破壊で流用し、HootoDay専用同期テーブル・RPCを分離するB案のRPC単体動作を確認した。アプリ統合後のlocalStorage保護と実端末同期は未確認である。

## 19. 実操作テストデータcleanup後の再利用判断（2026年7月19日）

- UUID完全一致のテスト用W1・W2と子データ、テスト匿名Authユーザー3名だけを段階的にcleanupした。
- cleanup後VERIFYは49行すべて`matched=true`で、テストDatabase行とAuthユーザーが0件であることを確認した。
- 共通4テーブル、共通workspace・pairing RPC、`app_workspace_state`構造は残存し、既存HootoSong・HootoPostデータを削除対象に含めていない。
- HootoDay専用2テーブル、sequence、result型、専用3 RPC、RLS・policy 0件、RPC属性・ACL、table・sequence直接権限なしも維持している。
- 以上により、既存接続基盤を変更せずHootoDay専用同期基盤を分離するB案は、テストデータcleanup後も維持できている。rollbackは未実行で、アプリ統合後のlocalStorage保護と実端末同期は未確認である。
