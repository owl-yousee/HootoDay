# HootoDay 販売・在庫同期ロードマップ

## 1. 文書の位置づけ

この文書は、HootoDayの販売・在庫データをPCとiPhoneで安全に共有するための正本ロードマップである。

- Sync Phase S-1では静的棚卸しと設計判断だけを行う。
- 同期実装、Supabase変更、SQL実行、UI変更、localStorage変更は行わない。
- 調査基準は2026-07-24時点の`main`、commit `074c1b1fa3eb16e79d6114b433c0caf0c35b4d94`とする。
- DayMemo同期の完成済み実装を無条件に複製しない。再利用できる基盤と、販売・在庫専用に必要な処理を分離する。
- 本文書の実装Phaseと保留項目は、途中で別の修正が入った場合の戻り先とする。

## 2. 同期が必要な理由と個人利用前提

販売実績は会場でiPhoneから入力し、PCでも同じ商品、販売、在庫を確認・編集する。端末別localStorageのままでは、両端末で現在庫と販売実績が一致せず、在庫の二重減算や削除済み記録の復活が起こり得る。

HootoDayは本人だけが使う個人用アプリである。

- 配布、一般公開、複数ユーザー権限、大規模アクセス、企業向け監査ログは対象外とする。
- PCを主な編集・管理端末、iPhoneを会場入力端末として想定する。
- 2端末のどちらかを暗黙に正本と推測しない。
- 通信はユーザーの明示操作で開始し、自動送信、自動merge、自動retryは行わない。
- 正常時の操作数は少なくし、異常時の安全停止はアプリ内診断へ集約する。

## 3. 現在の販売・在庫保存構造

### 3.1 保存versionと7つの配列

`src/utils/inventoryStorage.ts`の`INVENTORY_STORAGE_VERSION`は`2`である。次の7配列を別々のlocalStorage keyへ保存する。

| 対象 | 型 | localStorage key |
| --- | --- | --- |
| 商品 | `Product[]` | `hootoDay.products` |
| 在庫移動 | `InventoryMovement[]` | `hootoDay.inventoryMovements` |
| イベント販売 | `EventSalesRecord[]` | `hootoDay.eventSalesRecords` |
| BOOTH家発送 | `BoothSalesRecord[]` | `hootoDay.boothSalesRecords` |
| BOOTH倉庫 | `BoothWarehouseSaleRecord[]` | `hootoDay.boothWarehouseSalesRecords` |
| 周年記念campaign | `AnniversaryCampaign[]` | `hootoDay.anniversaryCampaigns` |
| 周年記念発送対象 | `AnniversaryShipment[]` | `hootoDay.anniversaryShipments` |

各keyは`{ version: 2, records: [...] }`で保存される。読込時は型validatorを全件通し、同一IDがあれば`updatedAt`が新しい方を残す。`InventoryMovement`には`updatedAt`がないため、同一ID重複時の比較時刻を持たない。

### 3.2 型ごとの識別子・時刻・revision相当情報

| 型 | ID | 作成時刻 | 更新時刻 | revision | deletedAt |
| --- | --- | --- | --- | --- | --- |
| `Product` | `id` | `createdAt` | `updatedAt` | なし | なし |
| `InventoryMovement` | `id` | `createdAt` | なし | なし | なし |
| `EventSalesRecord` | `id` | なし | `updatedAt` | なし | なし |
| `BoothSalesRecord` | `id` | `createdAt` | `updatedAt` | なし | なし |
| `BoothWarehouseSaleRecord` | `id` | `createdAt` | `updatedAt` | なし | なし |
| `AnniversaryCampaign` | `id` | `createdAt` | `updatedAt` | なし | なし |
| `AnniversaryShipment` | `id` | `createdAt` | `updatedAt` | なし | なし |

現行validatorはIDを「空でない文字列」として検証する。新規UIでは主に`crypto.randomUUID()`を使うが、型・storage層はUUID形式を要求しない。

### 3.3 React stateと永続化

`src/hooks/useInventory.ts`は7配列を7個のReact stateとして保持し、それぞれ別の`useEffect`でlocalStorageへ保存する。

- 7配列をまとめた原子的なlocal保存ではない。
- React更新が同じ操作内で行われても、localStorage writeは別々に実行される。
- タブ終了、quota、storage例外などがwrite間に起きると、販売記録だけ、または在庫移動だけが残る可能性がある。
- `inventoryStorage.ts`は不正なkeyをwrite-blockするが、7配列全体の整合性を判定する仕組みはない。

### 3.4 JSONバックアップ

`src/utils/jsonBackup.ts`の`HOOTODAY_BACKUP_FORMAT_VERSION`は`3`である。

- 7配列はすべてバックアップ対象である。
- restoreは全keyの旧値を保持して順番に書き込み、失敗時に全keyのrollbackを試みる。
- 在庫同期を追加する際も、現行backup format 3を直ちに壊す必要はない。
- 新しい同期metadataや統合local snapshotを永続化する場合は、バックアップ対象とするかをS-2で決定する。

## 4. 現在庫の正本

現在庫そのものを保存するフィールドはない。`src/utils/inventoryCalculation.ts`の`calculateCurrentStock()`が次で再計算する。

`Product.initialStock + 増加movement合計 - 減少movement合計`

増加は`restock`、`boothCancellation`、`return`、`adjustmentIncrease`、減少はその他のmovement typeである。

### 正式判断

- 現在庫を独立した同期対象へ追加しない。
- `Product.initialStock`と`InventoryMovement[]`を正本とし、同期後も現在庫を再計算する。
- 現在庫の計算結果だけを同期すると、販売記録由来movementとの二重反映や不一致を隠すため採用しない。
- 同期後は、販売記録と対応movementの参照整合、および両端末の再計算結果一致を検証する。

## 5. 販売記録と在庫移動の対応

### 5.1 イベント販売

`EventSalesRecord.status === 'completed'`のとき、同じ販売記録IDを参照する次のmovementを生成する。

- 販売数：`eventSale`
- サンプル数：`eventSample`

編集時は同じ`EventSalesRecord.id`を維持し、`eventSalesRecordId`が一致する既存movementを除外して再生成する。準備中へ戻す、または記録を削除すると対応movementを除外する。

### 5.2 BOOTH家発送

`pending`と`shipped`は有効販売、`cancelled`は売上・在庫対象外である。

- 有効販売は`boothSale` movementを1件生成する。
- 編集時は同じ`BoothSalesRecord.id`を維持し、`boothSalesRecordId`が一致するmovementを置換する。
- キャンセルまたは削除時は対応movementを除外する。

### 5.3 BOOTH倉庫

型と`boothWarehouseSale` movement参照欄は存在するが、S-1時点で入力・編集・削除UIとhook操作は未実装である。将来実装では`BoothWarehouseSaleRecord.id`と`InventoryMovement.boothWarehouseSalesRecordId`を同じ論理操作で保存・置換・削除する必要がある。

### 5.4 周年記念

型と保存配列は存在するが、操作UIは空画面である。通常在庫との連携は未確定であり、S-2で「在庫連携なし」を初期値とし、必要性が確認された場合だけ別Phaseで追加する。

## 6. 現行削除方式と復活リスク

販売・在庫データの削除は物理削除である。

- イベント販売削除：販売記録配列と対応movement配列から対象IDを除外する。
- BOOTH家発送削除：販売記録配列と対応movement配列から対象IDを除外する。
- 商品、手動movement、BOOTH倉庫、周年記念にはS-1時点で共通の同期削除表現がない。
- 各recordに`deletedAt`はなく、削除専用記録やtombstoneもない。

端末Aで削除し、古いrecordを保持する端末Bが後から同期すると、単純な配列和集合やupdatedAt優先では削除情報が存在しないためrecordが復活する。

### 正式判断

個別record方式を採用する場合はtombstoneが必須である。ただし本ロードマップの推奨方式では、workspace単位の完全snapshotをCAS更新し、「snapshot内に存在しない」ことを最新revisionの正式状態として扱う。これにより、個別recordへ`deletedAt`を追加せず削除を表現できる。

## 7. 現行編集・保存の不整合リスク

### 7.1 部分保存

販売記録とmovementは別state、別localStorage keyである。現行ローカル操作はUI上では一操作でも永続化は原子的ではない。

- 販売記録だけ保存：売上に加算されるが在庫が減らない。
- movementだけ保存：販売一覧に記録がないのに在庫だけ減る。
- 削除時に片方だけ成功：削除済み売上または孤立movementが残る。

### 7.2 編集競合

多くのrecordには`updatedAt`があるがrevision、baseline、端末識別、compare-and-writeがない。

- 同一recordをPCとiPhoneで編集した場合、単純な最終時刻優先は時計ずれに弱い。
- `InventoryMovement`には`updatedAt`がなく、編集系譜を時刻で比較できない。
- 販売recordとmovementを別々に競合解決すると、同じ論理操作の片方だけを採用し得る。

### 7.3 二重在庫減算

同じ販売を別IDで両端末が登録すると、内容が同じでも別recordとして扱われ、対応movementも2組になる。record IDだけでは、実際に同一販売か別販売かを安全に推測できない。

- 同一operationの再送は同じoperation IDで冪等化する。
- 別operation、別record IDの同内容は自動で統合しない。
- 重複入力の可能性は差異として表示し、ユーザーが記録単位で判断する。

## 8. 初回同期で起こり得る差異

PCとiPhoneに別々のlocalStorageが存在する可能性がある。

- 同じID・同じ内容
- 同じID・異なる内容
- PCだけの商品、販売記録、movement
- iPhoneだけの商品、販売記録、movement
- 販売記録だけ存在し、対応movementが欠落
- movementだけ存在し、参照先販売記録が欠落
- 同一販売を別IDで両端末が登録
- 削除済み端末と古いrecordを保持する端末
- 空のiPhoneとデータを持つPC

初回同期で端末を自動的に正本と推測しない。現在の運用ではPCが主端末であるため、最初の正式導入は「PCの検証済み完全snapshotを明示送信し、空または明示破棄を確認したiPhoneが取得する」方式を推奨する。

両端末に有効データがある場合は、ID単位の静的比較と参照整合診断を先に行う。自動和集合は行わない。

## 9. 既存DayMemo同期からの再利用分類

| 要素 | 分類 | 判断 |
| --- | --- | --- |
| Supabase client、匿名認証 | A：そのまま再利用 | 接続基盤は共通で使える |
| workspace、owner/member、parent/child、pairing | A：そのまま再利用 | 同じHootoDay workspaceへ在庫snapshotを紐づける |
| `SyncConnection`と接続localStorage | A：そのまま再利用 | 新しい在庫専用接続情報を重複保存しない |
| UUID v4生成utility | A：そのまま再利用 | operation ID生成に利用できる |
| 明示操作、fail-closed、read-back、rollback原則 | A：そのまま再利用 | `HOOTOSYNC_RULES.md`を共通規範とする |
| compare-and-write、local snapshot fingerprint | B：共通utility化後に再利用 | DayMemo metadata型へ固定された部分は分離する |
| RPC戻り値normalizerの単一行・厳格検証パターン | B：共通utility化後に再利用 | inventory専用result型とvalidatorが必要 |
| full pullのpagination、重複・sequence検証パターン | B：共通utility化後に再利用 | 現関数は`day_memo` payloadと日付IDへ固定されている |
| operation ledger、revision、CAS、idempotencyの概念 | C：概念だけ再利用 | inventory専用table/RPCが必要 |
| DayMemo metadata V5 | E：再利用しない | 日付baseline、delete intent、body mismatch状態は在庫snapshotに不適合 |
| DayMemo candidate／adoption／Recovery Bridgeの細分UI | E：再利用しない | 個人用在庫同期には過剰で、正常操作を複雑化する |
| DayMemo本文validator、日付entity ID、tombstone比較 | D：在庫では不要 | inventory snapshot validatorへ置き換える |

DayMemo同期の安全原則は再利用するが、非常に細かいstageと確認ボタンをそのまま持ち込まない。

## 10. Supabase既存構造の確認

リポジトリ内のSQLと現行コードから確認できる範囲は次のとおりである。

- `app_workspaces`、`app_workspace_members`とmembership helperを共有する設計である。
- `hooto_day_sync_records`と`hooto_day_sync_operations`がある。
- 現行recordとRPCは`entity_type = 'day_memo'`へ固定されている。
- upsert/delete/pull RPC、operation ID、revision、change sequence、operation result read-backが存在する。
- RLSを有効化し、直接table accessを許可せず、認証済みRPCからworkspace membershipを検証する。
- current recordとoperation履歴を分離し、CASと冪等再送を行う。

これらのSQLファイルはDayMemo専用であり、inventoryをそのまま書き込めない。S-1ではSupabaseへ接続せず、実環境の適用状態や行データは確認していない。S-3前にinspection SQLで実環境を再確認する。

## 11. Supabase保存方式の比較

### 案A：種類ごとの専用table

商品、movement、各販売、周年記念を別tableにする。

- 長所：DB制約、検索、record単位競合、将来の集計に強い。
- 短所：table、RPC、RLS、validator、tombstoneが多く、販売recordとmovementのtransaction設計も種類ごとに必要。
- 個人用としては実装量と保守量が大きい。

### 案B：record共通table

`record_type`、`record_id`、`payload`、`revision`、`deleted_at`を持つ。

- 長所：DayMemoに近いCAS、tombstone、pullを共通化しやすい。
- 短所：record typeごとの厳格payload validatorが必要。販売recordと複数movementを一つのtransactionに束ねる専用RPCも必要。
- 7種類を単純に別々にupsertすると、部分成功と二重減算を防げない。

### 案C：workspace単位の販売・在庫全体snapshot

7配列を検証済みの一つのpayloadとして、workspaceごとに1行保存する。

- 長所：販売recordとmovementを常に同じrevisionで保存できる。削除は最新snapshotからの欠落として確定し、個別tombstone不要。RPC、operation、read-back、rollbackが最小で済む。
- 短所：異なるrecordの同時編集でもworkspace snapshot競合になる。payload全体を送受信する。大規模データには向かない。

### 推奨

個人利用、PC＋iPhoneの2端末、現在のデータ量、月次締めなし、record間参照と在庫原子性を優先し、**案Cのworkspace単位snapshot**を推奨する。

異なるrecordの同時編集はrevision競合として検出し、最新remoteとlocal baselineを使って「互いに変更していないrecordだけ」をCodex側fixtureで検証可能な純粋関数により再構成する。自動保存はせず、差異概要を確認してから明示送信する。同一record変更、削除対変更、参照不整合は自動mergeしない。

## 12. 推奨table構造

実名はS-3のSQL reviewで確定する。概念構造は次とする。

### `hooto_day_inventory_snapshots`

- `workspace_id uuid primary key`
- `payload jsonb not null`
- `schema_version integer not null`
- `revision bigint not null`
- `change_sequence bigint not null`
- `server_updated_at timestamptz not null`
- `client_updated_at timestamptz`
- `updated_by uuid`
- `source_device_id text`

payloadは7配列とpayload自身のformat versionを含む。validatorは各recordの既存storage validator相当、ID一意性、参照整合、販売recordとmovementの一致、現在庫非負を一括検証する。

### `hooto_day_inventory_sync_operations`

- `operation_id uuid primary key`
- `workspace_id uuid not null`
- `operation_kind text`（初期は`snapshot_upsert`のみ）
- `requested_by uuid`
- `request_base_revision bigint`
- `request_fingerprint text`
- `result_status text`（`applied`または`conflict`）
- result revision、change sequence、server updated time
- `created_at timestamptz`

operation IDを同じpayload、同じbase revisionへ束縛し、同一IDの別request利用を拒否する。

## 13. 推奨RPC構造

### inventory snapshot取得

- workspace membershipを確認する。
- 現在のsnapshotを最大1行返す。
- payload、schema version、revision、change sequence、server updated timeを返す。
- 読取だけでoperationを作らない。

### inventory snapshot保存

- 認証、workspace membership、payload schema、全参照整合を検証する。
- `base_revision`によるcompare-and-setを行う。
- `operation_id`を必須にする。
- snapshot更新とoperation result保存を同一transactionで行う。
- conflictではremoteを変更しない。
- 成功時だけrevisionとchange sequenceを進める。
- 再送は同じoperation resultを返し、二重適用しない。

### operation result取得

- operation ID、workspace、kind、request userを照合する。
- 保存済み結果だけをread-onlyで返す。
- 結果不存在時にsnapshotを更新しない。

個別の販売追加RPC、movement追加RPC、削除RPCは初期実装では作らない。全payloadを一つのCASで保存するためである。

## 14. operation ID、revision、updatedAt

- operation IDはremote保存直前の明示操作時に1回だけ生成する。
- 確認・preview・pullだけでは生成しない。
- 結果不明時の再確認と冪等再送は同じoperation IDを使う。
- 新しい送信試行で同じoperation IDを別payloadへ使わない。
- remote revisionを競合判定の正本とする。
- local recordの`updatedAt`は差異説明と非競合merge判定に利用できるが、remote CASの代替にはしない。
- `InventoryMovement`は`updatedAt`を持たないため、ID＋全内容のcanonical fingerprintで比較する。
- 端末時計だけで勝者を決めない。

## 15. 削除表現

推奨snapshot方式では個別record tombstoneを追加しない。

- 最新remote snapshotにrecordがないことが削除の正本である。
- 送信前baselineに存在し、local snapshotから除外されたIDを削除差異として表示する。
- 別端末が古いsnapshotを送る場合はbase revision不一致で停止するため、削除済みrecordを上書き復活させない。
- rebase時にremoteで削除、localで未変更なら削除を維持する。
- remote削除後にlocal内容を編集していた場合は削除対変更競合として明示判断を求める。
- snapshot全体を消す「全削除」は通常同期操作として用意しない。

## 16. 初回同期方式

### 推奨する最初の導入

1. PCでJSONバックアップを取得する。
2. PCの7配列、ID一意性、参照整合、現在庫をread-only検証する。
3. iPhone側の販売・在庫が空であることを明示確認する。
4. PC snapshotの件数と現在庫概要を表示する。
5. ユーザーの明示操作でPC snapshotをrevision 0から送信する。
6. RPC結果を検証し、remote snapshotをread-backする。
7. iPhoneで明示取得し、local保存前後のread-backを行う。
8. 両端末の7配列signature、参照整合、商品別現在庫を比較する。

PCまたはiPhoneのどちらかを自動で正本と推測しない。両端末にデータがある場合は初回送信を停止し、差異診断へ分岐する。

## 17. 通常同期方式

正常時は細かい確認ボタンを増やさず、次の2操作を基本とする。

1. **同期状態を確認**：remote snapshotをread-only取得し、local、baseline、remoteを比較する。
2. **変更を同期**：差異概要の確認後、最新remote revisionとlocal鮮度を再確認して1回送信し、read-backする。

### 差異の扱い

- localのみ変更：local snapshot送信候補。
- remoteのみ変更：remote snapshotのlocal反映候補。
- 別recordを双方が変更：baselineを基準に非競合merge候補を純粋関数で作るが、自動保存しない。
- 同一recordを双方が変更：競合として対象型、ID、更新時刻、差異分類を表示し、local／remoteを明示選択する。
- 販売recordと対応movementは別々に選択しない。同じ論理record群として整合後の完全snapshotを作る。
- 参照切れ、現在庫負数、record重複、validator失敗はfail-closed。

## 18. 同一record競合と別record同時追加

### 同一record

- IDが同じでbaselineからlocal・remote双方が変化した場合は自動mergeしない。
- 商品、販売記録、周年記念などrecord単位でlocal／remoteを選択する。
- 販売記録を選択した場合は、対応movementを選択結果から再構築・検証し、片方の端末の孤立movementを混ぜない。

### 別record同時追加

- IDが異なり、双方のrecordと参照がvalidで、既存IDと衝突しない場合だけmerge候補へ含められる。
- 内容が似ていても同一販売と推測しない。
- 商品IDが片側にしかない販売・movementは、商品を含む完全な参照集合としてのみ採用する。
- merge後の全ID一意性、販売とmovement、在庫非負を一括検証する。

## 19. offlineと再送

- offlineではlocal編集を許可するが、remote成功扱いにしない。
- 同期確認または送信が失敗した場合はlocalデータを維持する。
- 自動retryしない。
- RPC結果不明時は同じoperation IDを保持し、operation result読取を優先する。
- 同一operationの再送は同じID、同じfingerprint、同じbase revisionに限定する。
- remote適用済みを推測して新operationで送り直さない。
- pending operationはlocalの在庫同期metadataへ永続化し、再読み込み後も結果確認できるようにする。

## 20. 必要なlocal型・保存変更

S-1では変更しない。S-2で次を設計・実装する。

- 7配列を一括検証する`InventoryDataSnapshot`型。
- canonical serializeとfingerprint。
- ID一意性、参照整合、販売recordとmovement一致、現在庫非負のvalidator。
- local baseline snapshotまたはbaseline fingerprint。
- remote revision、change sequence、server updated time。
- pending inventory sync operation。
- push blockとlast successful sync time。
- 7つの既存keyから一括snapshotを構築するread-only adapter。

localStorageの原子性を改善する場合は、既存7keyを即削除せず、統合snapshot keyを正本へ移す明示migrationとverified rollbackを別Phaseにする。

## 21. migrationとbackup方針

- S-1では`INVENTORY_STORAGE_VERSION = 2`とbackup format 3を変更しない。
- S-2で新しい同期metadataだけを追加する案と、統合local snapshotへ移行する案を比較する。
- 既存7配列は読込可能なまま維持し、migration前にJSONバックアップを必須とする。
- migrationはread-only診断と明示実行を分離する。
- 書込み後read-backし、失敗時は7keyと新keyの両方をrollbackする。
- 古いbackup format 3は引き続き読めるようにする。
- 新しい同期metadataはremote内容を再取得できるため、通常バックアップへ含めるかはS-2で判断する。local pendingがある場合は復旧に必要なので無条件除外しない。

## 22. 安全条件

- workspace binding、認証、membershipを確認する。
- 7配列すべての型、ID一意性、参照整合を確認する。
- 販売recordとmovementを同じ論理操作として検証する。
- 現在庫を両端末で再計算し、負数を許可しない。
- remote保存直前に最新revisionを再取得する。
- local snapshotが確認時から変化していないことを確認する。
- operation IDは1回だけ生成する。
- RPC戻り値を厳格検証する。
- remote read-backとlocal read-backを行う。
- 結果不明、競合、validator失敗、参照切れはfail-closed。
- 自動同期、自動送信、自動retry、自動merge、自動削除を行わない。
- UIには件数、対象型、状態、revisionなど安全な情報だけを表示し、raw payload、UUID、operation ID、tokenを表示しない。

## 23. Sync Phase

### 完了済み

- Phase I-1：型、inventory storage version 2、migration、backup format 3基盤。
- Phase I-2：商品、イベント、BOOTH、周年記念、在庫履歴の5タブ化。
- Phase I-3：商品カード再編とBOOTH倉庫価格設定。
- Sync Phase S-1：販売・在庫同期の静的棚卸しと正式ロードマップ。
- Sync Phase S-2：完全snapshot、validator、canonical fingerprint、local baseline／pending／metadata基盤。
- Sync Phase S-3：workspace単位snapshot table、RLS、CAS RPC、TypeScript remote境界。

### 今後

#### Sync Phase S-4：初回同期と通常同期

- PC snapshot明示送信。
- iPhone明示取得。
- read-backと両端末signature／現在庫一致。
- 通常の確認、local送信、remote反映。
- 同一record競合と非競合record merge候補。

#### Sync Phase S-5：往復実機確認と在庫固有安全確認

- PCから1件追加しiPhoneへ反映。
- iPhoneで1件変更しPCへ反映。
- 1件削除し両端末から消える。
- 販売recordとmovementの対応一致。
- 商品別現在庫一致。
- offline、結果不明、冪等再送、revision conflict。

### 同期完了後の本体Phase

- Phase E-1：イベント複数商品一括入力。
- Phase I-4：BOOTH倉庫。
- Phase I-5：BOOTH家発送拡張。
- Phase I-6：周年記念基本管理。
- Phase I-7：周年記念完了と商品タブ上部カード。
- Phase I-8：必要な場合のみ周年記念と通常在庫の連携。
- Phase E-2：イベント会計アプリ連動基盤（I-7完了後を基本候補として再判断）。

## 24. 各PhaseでCodexが行う自動検証

- 型validatorの正常・異常fixture。
- 7配列canonical serializationの順序安定性。
- ID重複、参照切れ、販売recordとmovement不一致の拒否。
- 商品別現在庫再計算。
- 同一operationの冪等性。
- stale revision conflict。
- 同一record競合、別record同時追加、削除対変更。
- partial local writeとrollback。
- RPC response normalizer。
- read-back完全一致。
- offlineとresponse unknown。
- migrationと旧backup読込。

ユーザーによる実機確認は、初回同期基盤完成時の「PC送信 → iPhone表示 → iPhone変更 → PC反映 → 削除 → 両端末消去 → 現在庫一致」に限定する。途中Phaseで大量のスクリーンショットや細かな確認を要求しない。

## 25. 確定済み本体仕様と保留

### 確定済み

- 商品、イベント販売、BOOTH家発送の現行保存形式。
- BOOTH倉庫と周年記念の型・保存配列。
- イベント販売はplanned／completed。
- completedだけが販売・サンプルmovementを持つ。
- BOOTH家発送はpending／shippedが有効、cancelledは在庫・売上対象外。
- 編集は既存record IDを維持する。
- 削除は対応movementも除外する。
- 現在庫はinitialStockとmovementから再計算する。
- BOOTH倉庫は数量と受取単価snapshotを保持する。
- 周年記念は販売・売上へ含めず、個人情報を保存しない。

### 保留

- BOOTH倉庫の入力・編集・削除UI。
- 周年記念の操作UIと完了処理。
- 周年記念発送で通常商品在庫を減らすか。
- local統合snapshot keyへのmigration時期。
- inventory sync metadataをJSONバックアップへ含める範囲。
- 非競合merge候補をどこまで自動構築し、どの概要を表示するか。
- operation履歴の保持期間。

## 26. 枝分かれ作業の記録規則

同期実装中に不具合修正やUI変更が必要になった場合は、次を記録する。

- 現在の本線Phase。
- 割り込み作業名と理由。
- 割り込み前の未完了条件。
- 割り込み完了条件。
- 本線へ戻るPhaseと再開条件。

Phaseを完了していない場合は「完了」と記録せず、「保留」と「戻り先」を残す。

## 27. S-1の完了条件

- 現行7配列、保存version、backup formatを確認済み。
- 現在庫の正本をmovement再計算と確定。
- 販売recordとmovementの原子性不足を特定。
- 物理削除と削除復活リスクを特定。
- 同一record競合、別record追加、初回同期差異を整理。
- DayMemo同期の再利用範囲をA〜Eで分類。
- Supabase 3案を比較し、workspace単位snapshotを推奨。
- S-2〜S-5と本体Phaseへの戻り先を記録。
- コード、UI、localStorage、Supabase、SQL、実機データを変更していない。

## 28. S-1で確認した実在ファイル

### 販売・在庫

- `src/components/InventoryPage.tsx`
- `src/hooks/useInventory.ts`
- `src/utils/inventoryCalculation.ts`
- `src/utils/inventoryStorage.ts`
- `src/types/inventory.ts`
- `src/types/backup.ts`
- `src/utils/jsonBackup.ts`
- `src/App.tsx`

### 接続・DayMemo同期

- `src/types/sync.ts`
- `src/types/dayMemoSync.ts`
- `src/utils/syncConnectionStorage.ts`
- `src/utils/uuid.ts`
- `src/utils/dayMemoSyncPull.ts`
- `src/utils/dayMemoSyncStorage.ts`
- `src/utils/dayMemoSyncUpsertResult.ts`
- `src/utils/dayMemoSyncOperationResult.ts`
- `src/hooks/useSupabaseWorkspace.ts`
- `src/hooks/useDayMemoInitialUpload.ts`
- `src/hooks/useDayMemoUpdateUpload.ts`
- `src/hooks/useDayMemoLocalOperationSend.ts`
- `src/hooks/useDayMemoSyncRecoveryCheck.ts`
- `src/hooks/useDayMemoSyncRecoveryApply.ts`
- `src/lib/supabaseClient.ts`

### SQL・正式文書

- `SUPABASE_HOOTO_DAY_SYNC_PRECHECK.sql`
- `SUPABASE_HOOTO_DAY_SYNC_APPLY.sql`
- `SUPABASE_HOOTO_DAY_SYNC_VERIFY.sql`
- `SUPABASE_HOOTO_DAY_SYNC_ROLLBACK.sql`
- `SUPABASE_HOOTO_DAY_OPERATION_RESULT_READ_APPLY.sql`
- `PROJECT_NOTES.md`
- `SYNC_DESIGN.md`
- `HOOTOSYNC_RULES.md`

`HOOTOSYNC_RULES.md`の明示操作、read-back、rollback、fail-closed、自動処理禁止は在庫同期にも十分適用できるため、S-1では重複追記していない。

## 29. Sync Phase S-2 実装結果

### 現在地と戻り先

- Sync Phase S-2を完了した。
- 割り込み作業はない。
- S-2完了時の戻り先はSync Phase S-3（Supabase table／SQL／RPC基盤）であり、現在はS-3のrepository実装まで完了している。

### 固定したlocal基盤

- snapshot schema version 1として、既存の7配列だけを含む`InventorySyncSnapshot`を追加した。
- 現在庫、タブ、検索、フォームdraftなどの派生・UI stateはsnapshotへ含めない。
- snapshot生成はrevisionを引数で受け取り、増加させず、元配列を変更しない。
- canonical化では各配列をrecord ID順に並べ、object key順を固定し、`undefined`を除外する。
- content fingerprintはschema version、workspace ID、7配列を対象とし、revisionとgeneratedAtを除外する。
- envelope fingerprintはcontent fingerprintとrevisionを対象とし、generatedAtを除外する。
- fingerprintはブラウザ同期処理で使える決定的な非暗号学的hashとし、remote認証用途には使用しない。

### validatorと販売・movement整合

- 既存inventory validatorを全件へ再利用し、未知schema version、重複ID、参照切れ、不正workspace／revision／日時を拒否する。
- Event、BOOTH家発送、BOOTH倉庫のproduct参照と、周年記念発送のcampaign参照を検証する。
- movementのsource type、source ID、product IDを販売recordと照合する。
- completed eventは正数の販売数・サンプル数ごとに対応movementを1件要求し、0はmovementなしとする。plannedは販売movementを許可しない。
- BOOTH家発送のpending／shippedは数量一致の`boothSale`を1件要求し、cancelledは有効`boothSale`を許可しない。
- BOOTH倉庫recordは数量一致の`boothWarehouseSale`を1件要求する。
- `boothCancellation`は現行計算上の増加movementとして型を維持する。販売参照なし、または同一商品のcancelled家発送record参照だけを許可し、有効`boothSale`の代用にはしない。
- `Product.initialStock + InventoryMovement`の符号付き再計算が負になるsnapshotを拒否する。

### local保存境界

- `hootoDay.inventorySync.metadata`
- `hootoDay.inventorySync.baseline`
- `hootoDay.inventorySync.pending`

上記3keyを既存7key、DayMemo metadata、ユーザー向けJSONバックアップから分離した。保存前validator、保存後read-back、不一致時の旧値rollbackを実装した。baseline破損、pending破損、workspace不一致は利用可能扱いにせず、実データを変更しない。

pending operationはremote書込み用の`initial_upload`、`push_snapshot`、`resolve_conflict`だけとする。read-only pullにはoperation IDを生成しない。push系はtarget content fingerprintを必須とし、初回だけbase revisionをnullとする。自動retry、remote送信、operation ID自動生成はS-2に含めない。

### backup、全初期化、revision

- inventory storage version 2とJSON backup format 3を維持する。
- 同期metadata、baseline、pendingはユーザー向けJSONバックアップへ含めない。
- JSON復元が本体keyへ書き込めた後、baselineとpendingを消し、既存workspaceが判明する場合はmetadataを`unconfirmed`へ戻す。reset失敗時は既存restore rollbackへ合流する。
- 全データ初期化では同期専用3keyも削除し、失敗時は既存rollbackへ合流する。
- local snapshot生成ではrevisionを増やさない。S-3以降のremote CAS成功revisionだけを新baselineへ使用する。

### S-3／S-4へ残すもの

- S-3で実際のSupabase table、RLS、SQL、RPC、response normalizerを設計する。S-2ではTypeScript request／response型と厳格validatorだけを準備した。
- S-4で明示pull／push、operation ID生成、remote read-back、UIを接続する。
- record ID単位indexと非競合merge候補生成はS-4へ保留する。自動mergeは行わない。
- local統合snapshot keyへのmigrationは行わず、既存7keyを正本のまま維持する。
- 周年記念と通常商品在庫の参照・減算は引き続き保留する。

## 30. Sync Phase S-3 実装結果

### 現在地と戻り先

- Sync Phase S-3のrepository実装と静的検証を完了した。
- Supabase実環境にはSQLを実行していない。
- 次のユーザー作業は、レビュー済みSQLをSupabase SQL Editorで明示実行することである。
- SQL適用確認後の本線と戻り先はSync Phase S-4（初回同期・通常同期）である。

### remote tableと権限

- remote正本は`public.app_inventory_snapshots`とし、`public.app_workspaces(id)`を参照するworkspaceごと1行の完全snapshot方式を採用した。
- columnは`workspace_id`、`revision`、`schema_version`、`snapshot`、`content_fingerprint`、`last_operation_id`、`created_at`、`updated_at`である。
- 7配列、販売record、movementを1つのjsonb snapshotとして同一transactionで保存する。現在庫、売上、販売数などの派生値は保存しない。
- workspace削除時は既存workspace方針に合わせて`ON DELETE CASCADE`とする。
- tableはRLSを有効にし、直接table policyを作らず、PUBLIC／anon／authenticatedの直接table権限をrevokeする。
- 読書きは`SECURITY DEFINER`、固定`search_path`のRPCだけに限定し、各RPC内で`auth.uid()`と既存`public.is_app_workspace_member(uuid)`を確認する。

### RPCとrevision

- read-only RPCは`public.get_app_inventory_snapshot(uuid)`である。未作成時はworkspace ID、revision 0、snapshot null、content fingerprint nullを返す。
- CAS RPCは`public.save_app_inventory_snapshot(uuid, uuid, bigint, jsonb, text)`である。
- remote未作成かつbase revision null、request snapshot revision 0の場合だけrevision 1で初回作成する。
- remote作成済みでbase revisionがremote revisionと一致する場合だけrevisionをremote側で1増加する。
- base revision不一致、または作成済みremoteへのbase null送信は`conflict`を返し、remoteを変更しない。
- `last_operation_id`が一致し、base revision、content fingerprint、snapshot内容も同一の場合は`replayed`を返し、revisionを増やさない。異なるrequestへのoperation ID再利用は拒否する。
- SQLは`jsonb_set`で保存snapshot内のrevisionをremote決定revisionへ置換し、table columnとJSON内revisionを一致させる。
- content fingerprintはrevisionとgeneratedAtを対象外としているため、remote revision置換後も同じ値を維持する。SQLは形式を検証し、TypeScript clientは保存前と取得後にsnapshotから再計算して照合する。

### 削除、競合、read-back

- record削除は次revisionの完全snapshotからrecordが欠落した状態をCAS保存することで確定する。
- 初期版では個別tombstone tableを作らない。workspace snapshot CASにより、古いrevisionのsnapshotは保存できず、削除済みrecordの古い端末からの復活を停止できるためである。
- remoteの過去revision履歴は保持しない。rollbackはlocal baselineとユーザーJSONバックアップを使用する。
- RPCは自動mergeしない。競合時はremoteを変更せず、S-4でlocal／baseline／remoteをrecord ID単位に比較する。
- TypeScript側へ低レベルfetch、低レベルsave、read-back照合関数を分離して追加した。S-4で明示操作としてsave後fetchを接続する。
- operation ID生成、自動retry、pending再送、起動時通信、localStorage更新、baseline更新、UIはS-3に含めない。

### SQL適用方針

- SQLは`SUPABASE_INVENTORY_SYNC_APPLY.sql`へ記録した。
- preflightは共有workspace table、membership helper、Supabase role、専用object名の衝突を確認する。
- 専用objectが既にある場合は推測上書きせずtransactionを停止するため、再実行で破壊的変更を起こさない。
- postflightはtable、RPC、RLS、直接policyなし、column構造を静的確認する。
- APPLY、remote insert／select、RPC呼出し、初回uploadは未実行である。

## 31. Sync Phase S-4 実装結果

### 状態分類と明示操作

- 未確認、初回送信可能、初回取得可能、同期済み、local変更、remote変更、競合、pending確認、同一operation再送可能、要確認を分類する。
- PC親機はremote未作成・baselineなし・pendingなしの場合だけ初回送信できる。
- iPhone子機はremote作成済み・baselineなし・7配列が実質空の場合だけ初回取得できる。既存localデータがあればfail-closedで停止する。
- 通常同期はlocalだけの変更を明示送信、remoteだけの変更を明示取得とする。両側変更はrecord ID単位の論理グループで分類し、自動mergeしない。

### pending、read-back、baseline

- push前にoperation IDを一度だけ生成し、pendingとmetadataをverified保存する。
- saved／replayed後はremoteを再取得し、workspace、revision、fingerprint、snapshot validatorを確認してからconfirmed baselineへ更新する。
- pending targetとremoteが一致した場合は再送せずcleanupする。remoteがbaseと一致する場合だけ同じoperation IDで明示再送できる。
- 不明なRPC結果、壊れたpending、read-back不一致ではpendingを保持し、自動retryしない。

### local一括適用と競合境界

- 7配列は既存localStorage keyへ一括適用し、全件read-back後だけReact stateを更新する。
- 一括適用失敗は旧7配列へrollbackする。baseline確定失敗時も旧local snapshotへ戻し、rollback不能は要確認として停止する。
- 編集フォームが開いている間はremote取得結果をlocalへ適用しない。
- イベント販売、BOOTH家発送、BOOTH倉庫は販売recordと対応movementを同じ論理グループとして3-way比較する。
- 非競合mergeは分類まで実装し、実際のmerge適用はS-4bへ保留する。自動mergeは行わない。

### 現在地と次工程

- `SUPABASE_INVENTORY_SYNC_APPLY.sql` は実環境へ適用済み。
- Codexから実データの初回送信・取得は実行していない。
- 次はSync Phase S-5でPC／iPhone初回同期、通常送受信、削除、offline、replay、競合、現在庫一致を実機確認する。
- 同期実機確認完了後はPhase E-1へ戻る。Phase E-2の会計アプリ連動方針は維持する。

## 32. Sync Phase S-5 割り込み：iPhone販売・在庫フォーム操作性

- 現在の本線はSync Phase S-5のPC／iPhone復旧・削除・現在庫一致の実機確認である。
- iPhone Safariで在庫調整フォームの入力時拡大、背景scroll／overscroll、減少数量へ`-1`を入力した際の保存失敗が確認されたため、操作性修正を割り込み実施した。
- iPhone幅では在庫ダイアログ内のinput／select／textareaを16px以上とし、viewportの拡大操作は禁止しない。
- ダイアログ表示中は背景scroll位置を保持して固定し、ダイアログ内部だけを縦scroll可能とする。終了時は元のscroll位置へ戻す。
- 在庫減少は既存形式どおり`adjustmentDecrease`と正の数量で保持する。UIを「減らす（その他）」＋「数量（正の整数）」へ明確化し、1個減らす場合は数量`1`とする。
- 0、空欄、小数、指数表記、数字以外、安全な整数範囲外、現在庫超過、理由空欄をfield近傍で拒否し、失敗時は在庫と履歴を変更しない。
- 二重submitを防止する。同期snapshot、baseline、pending、revision、RPC、SQL、inventory storage version 2、backup format 3は変更しない。
- 実機で保存ボタンが無反応となる追加事象を確認した。二重submit guardを保存処理中だけ有効にし、validation停止、保存例外、dialog終了・再表示の全経路で解除する。保存例外はdialog内へ表示し、無言で停止しない。
- submit無反応の解消後、iPhoneのLAN内HTTP環境ではmovement ID生成時の`crypto.randomUUID()`が利用できず、保存callback到達前に例外停止することを確認した。既存の`createUuidV4()`へ接続し、`getRandomValues` fallbackを利用する。ID生成不能時はデータを変更せず画面内で停止する。実機再確認待ち。
- 割り込み完了後はSync Phase S-5の削除復旧確認へ戻る。S-1、S-4、I-8、E-2の保留項目は維持する。

## 33. Sync Phase S-5 完了

- PC正本の初回送信（remote revision 1）とiPhone初回取得、iPhoneの商品メモ変更送信（remote revision 2）とPC取得を実機確認した。
- PCの在庫調整`+1`、iPhoneの在庫調整`-1`を往復し、両端末の現在庫15、履歴、理由が一致した。
- BOOTH家発送の未発送記録をPCからiPhoneへ取得し、iPhoneで削除後にPCへ反映して、両端末からrecordとmovementが消え、現在庫15、BOOTH累計0個・0円へ戻ることを実機確認した。
- iPhoneの入力拡大、modal背景移動、在庫調整submit、LAN内HTTPのUUID生成を修正した。
- 同一record競合、offline後送信、pending手動再送は安全fixture確認、非競合merge適用は必要時のS-4b保留とする。主要往復と重大事故防止条件が確認できたため、同期基盤は個人利用の通常運用可能としてS-5を完了する。

## 34. Phase E-1 イベント複数商品一括入力

- 準備中の複数商品登録は実装済みだが、実機確認で商品別の旧単品操作だけが主導線となり、イベント単位の一括実績入力が不足していることを確認した。E-1は完了扱いにせず補完中とする。
- イベント単位で複数商品を1画面へ並べ、準備中／実績確定済みをまとめて保存する。
- UI draftは保存せず、内部形式は既存`EventSalesRecord`を商品ごとに1件ずつ維持する。取引型、transaction ID、新配列は追加しない。
- 全行を純粋関数で検証し、商品未選択、重複、整数、持込超過、在庫不足、既存record消失、ID生成不能を行別に表示する。
- completedはrecordごとの既存movementを除外して利用可能在庫を確認し、`eventSale`／`eventSample`を対象record ID単位で置換する。plannedはmovementを作らず現在庫を変更しない。
- 保存後のrecord配列とmovement配列をメモリ上で構築し、両storage keyを一括write、read-backする。失敗時は両keyを旧値へrollbackし、React stateは成功後だけ更新する。
- 既存単品の編集、確定取消し、削除導線は維持する。未保存行は削除可能とし、保存済み行の一括削除は誤操作防止のためE-1bへ保留する。
- 保存成功後は既存inventory snapshot差異として`local_changed`になり、自動送信しない。
- E-2へ向けてdraft検証・record／movement生成を純粋関数へ分離した。E-1では会計取引、支払方法、取消し履歴、snapshot schema変更を行わない。
- E-1完了後の戻り先はPhase I-4 BOOTH倉庫とする。I-4〜I-8、E-2の保留順序を維持する。
- 補完ではイベント別カードへ「販売実績をまとめて入力」を追加し、同一eventIdのplanned recordだけを既存IDのままcompletedへ一括確定する。持込数は読み取り専用、販売数・サンプル数・単価・残数・合計を同一画面へ表示する。
- 保存直前にplanned状態、eventId／productId、持込数、movement不在・整合、在庫、UUIDを再確認し、既存の2-key原子的保存へ接続する。実機再確認が通るまではE-1補完中とする。
- completed複数商品の一括編集はE-1bへ保留する。既存単品編集・確定取消し・削除は維持する。

## 35. Phase E-1c イベント販売の用語・表示整理

- ユーザー向けの状態語を`売上未入力`／`売上入力済み`へ統一し、操作語を`売上を入力`／`売上を修正`／`売上入力を取り消す`へ整理する。内部の`planned`／`completed`、保存形式、集計、在庫計算は変更しない。
- イベント単位カードを主表示とし、未入力だけ、入力済みだけ、混在の3状態を区別する。未入力では登録商品数と持込合計、入力済みでは販売数と売上、混在では入力済み／未入力件数と入力済み分の販売数・売上を表示する。
- planned商品の一括入力を主操作とし、既存の単品入力・修正・取消し・削除は商品内訳の補助操作として維持する。completed複数商品の一括編集はE-1bの保留を維持し、存在しない一括編集操作は表示しない。
- Phase I-4へ進む前の追加UI整理として、イベント上部集計を`商品`／`持込予定`／`販売総数`／`売上`へ変更し、売上入力済み件数を削除する。販売総数と売上はcompletedだけを対象としてサンプルを含めず、対象がない場合も`0個`／`0円`と表示する。
- 追加の実機確認用UI整理としてページ全体集計を削除し、新規登録エリアを独立させる。イベント名をカード見出しとし、商品／持込予定／販売総数／売上は各イベントカード内だけへ集約する。
- 登録主操作を`イベント商品の登録`、補助操作を`追加で登録`とする。曖昧な`商品別の操作を表示`は、既存の商品別編集操作を開く`商品を編集`へ変更する。イベント数量・単価入力にはIDカード番号等への誤認を抑える`autocomplete="off"`を個別指定する。
- この見た目を実機確認後、Phase I-4へ戻る。E-1b、I-4〜I-8、E-2、必要時のS-4bという保留順序は変更しない。
- completed商品の状態は商品行右端の猫の足跡スタンプ（Phosphor Icons `PawPrint`、オレンジ系）で商品単位に表示し、イベント上部の`売上入力済み`文言は削除する。PCでは専用右端列、iPhoneでは商品名上段右端に配置し、`aria-label`と`title`は`売上入力済み`とする。mixed／plannedの`一部売上未入力`／`売上未入力`は維持し、機能・status・保存形式は変更しない。
- E-1c完了後の本線と戻り先はPhase I-4 BOOTH倉庫である。I-4〜I-8、E-2、必要時のS-4bという保留順序は変更しない。

### 販売・在庫の現在地（2026-07-24）

- 完了済みはPhase I-1（型・migration・backup基盤）、I-2（商品／イベント／BOOTH／周年記念／在庫履歴の5タブ化）、I-3（商品カードのイベント／BOOTH 2ブロック化）、Sync Phase S-1〜S-5、Phase E-1（一括登録）、E-1補完（売上一括入力）、E-1c（用語・情報階層・見た目整理）である。
- 現在の本線はPhase I-4 BOOTH倉庫。新規作成、編集、削除、在庫連動、購入者向け販売価格、受取単価、受取総額を扱い、常時入力可能、月次固定なし、同月複数入力可能、注文番号・発送status不要とする。完了後はPhase I-5へ戻る。
- 保留はE-1b（売上入力済み複数商品の一括修正、保存済み商品行の一括削除）、I-5（BOOTH家発送拡張）、I-6（周年記念基本管理）、I-7（周年完了と商品タブ上部カード）、I-8（必要時のみ周年記念と通常在庫連携）、E-2（イベント会計アプリ連動）、S-4b（非競合merge適用）である。未完了を完了扱いせず、順序を変更しない。
- イベント登録操作カードと各イベントカードは薄緑の画面背景上の独立した白背景兄弟要素である。登録ボタンは同幅・高さ64pxで、PC 2列、560px以下1列。主操作は緑背景／白文字の`イベント商品の登録`、補助操作は白背景／緑枠の`追加で登録`とする。
- イベントカードはイベント名、日付、plannedの`売上未入力`またはmixedの`一部売上未入力`、商品種類数、持込予定、販売総数、売上、商品内訳、商品別操作を表示する。completedだけのイベントは上部状態文言を表示しない。
- 商品種類数は同一eventId内のproductId重複なし件数、持込予定は全recordの`broughtQuantity`合計、販売総数はcompletedの`soldQuantity`合計、売上はcompletedの`soldQuantity × unitPriceSnapshot`合計とし、サンプルは販売総数・売上へ含めない。
- 一括登録／売上一括入力は全件事前検証し、1件でもエラーなら全件保存しない。`EventSalesRecord`は商品ごとに1件、既存record IDを維持し、movementを商品ごとに生成する。部分保存は禁止し、保存成功後は`local_changed`として明示同期対象にする。
- iPhoneでは入力欄16px以上、背景scroll固定、modal内scroll、safe-areaを維持する。LAN内HTTPで`crypto.randomUUID()`が利用できない場合は`createUuidV4()`へfallbackし、数量・価格入力は`autocomplete="off"`でIDカード保存誤認を抑制する。
- 販売・在庫同期はPC正本の初回送信、iPhone初回取得、双方向変更、在庫調整履歴、BOOTH家発送削除、削除後在庫復元、商品・価格・在庫・販売累計一致を実機確認済み。個人利用の通常運用可能とし、常に明示操作のみで、自動送信・自動取得・自動retryは行わない。
- 同期の保留詳細はS-4b非競合merge、同一record競合の詳細解決UI、offline後送信の実機再現、pending手動再送の実機再現である。
- E-2ではHootoDayを商品・持込・サンプル・在庫調整・残数・売上・将来の会計取引履歴の正本とする。会計アプリは当日の複数商品会計、合計、確定、取消し／訂正、支払方法、offline後送信を担う。販売数の直接上書きを避け、transaction ID付き取引と明細を分離し、再送の二重計上を防ぎ、会計アプリは現在庫を直接変更せず、取引と在庫移動を同じ論理操作として扱う。
- 本記録時点のコードHEADは`a22babc9e3184aca95abcc52577890b75f49529e`（`style: align orange event completion stamps`）。登録操作カード確定は`0099126bf5edc32dd9d0b26c02ab41543d10814c`（`style: finalize event registration actions`）である。
- 今後の割り込みは、現在の本線、割り込み作業、割り込み理由、完了条件、完了後の戻り先を必ず記録し、本書を判断の正本とする。

## 36. Phase E-2 イベント会計アプリ連動基盤

### 位置づけ

- 実施時期はPhase I-7完了後を基本候補とし、その時点で再判断する。
- Phase E-1のイベント複数商品一括入力は、会計アプリ連動の簡易先行版に近い。
- E-1実装前に、現在の`EventSalesRecord`へ商品別集計だけを保存するか、将来の取引履歴へ移行しやすい一時構造にするかを再確認する。

### 役割分担

HootoDayは商品、イベント持込数、サンプル配布、在庫調整、残数、売上、会計アプリから受信した取引履歴の正本を管理する。

イベント会計アプリは、当日の商品選択、複数商品の一括会計、合計金額、会計確定、取消し、訂正、支払方法、通信不安定時の後送信を担当する。

### 固定方針

- 販売数を直接上書きせず、取引ID付き販売履歴を保存する。
- 会計取引と商品明細を分離し、有効な取引明細の数量合計から販売数を算出する。
- 取消しは取引を削除せずcancelled相当へ変更する。
- 同じtransaction IDの再送を二重計上しない。
- operation IDで通信再送を冪等化する。
- 会計アプリは現在庫を直接書き換えない。
- 販売取引と在庫移動を同じ論理操作として扱う。
- 支払方法別集計、イベント終了後の売上集計へ拡張可能な構造とする。
- 将来候補型は`EventCheckoutTransaction`と`EventCheckoutLine`だが、S-3では追加しない。
- inventory snapshot schema version 1には会計取引配列を含めない。E-2で追加する場合はschema versionを上げ、旧snapshot migrationを追加する。
# Phase I-4 BOOTH倉庫 実装記録（2026-07-24）

- BOOTHタブ内を「倉庫」「家発送」に分け、初期表示を「倉庫」とした。既存BOOTH販売は「家発送」としてUI・保存処理を維持する。
- BOOTH倉庫販売は日付、商品、数量、購入者向け販売価格、受取単価、受取総額、メモを扱う。注文番号、発送状態、月次締め、月内件数制限は設けない。
- 新規作成時は`BoothWarehouseSaleRecord`と数量一致の`boothWarehouseSale` movementを同じ論理操作として保存する。
- 編集時はrecord IDと`createdAt`を維持し、同じrecord IDに紐づくmovementだけを置換する。商品は編集時に変更不可とする。
- 削除時は確認後、対象recordと対応movementだけを同時に削除し、数量分の在庫を復元する。
- record配列とmovement配列は既存の別localStorage keyへ、validator、2-key write、read-back、rollbackを伴う原子的保存で反映する。成功read-back後だけReact stateを更新する。
- 倉庫累計販売数と`数量 × 受取単価`の累計受取総額を表示する。商品カードの既存集計も同じ正式recordを参照する。
- inventory storage version 2、backup format 3、`InventorySyncSnapshot`、Supabase、SQL、RPCは変更していない。保存成功後は既存snapshot差分により`local_changed`となる。
- Phase I-4の実装は完了。実機では新規作成、編集、削除、在庫減算・復元、PC／iPhone表示、PC・iPhone同期を確認する。
- 現在の本線はPhase I-4の実機確認。完了後の戻り先はPhase I-5「BOOTH家発送拡張」。
- 保留中のPhase E-1b、Phase I-5〜I-8、Phase E-2、Sync Phase S-4bは維持する。

# Phase I-5 BOOTH家発送拡張 実装記録（2026-07-24）

- Phase I-4は倉庫販売の新規作成、数量編集、削除、在庫減算・復元、受取集計の実機確認完了とする。
- BOOTH内の「家発送」は既存`BoothSalesRecord`を正本とし、送料`shippingFee`と発送日`shippedAt`をフォーム・一覧へ接続した。
- 送料は購入者から受け取った送料であり、商品売上とは分離する。`null`は未設定、`0`は0円として区別し、家発送画面の送料集計では`null`を0円として扱う。
- 発送日は`shipped`でのみ任意入力できる。`pending`または`cancelled`で保存すると`shippedAt`を`null`へ戻す。
- 新規作成時は`createUuidV4()`でIDを生成し、編集時はrecord IDと`createdAt`を維持する。商品は編集中に変更不可とする。
- `pending`／`shipped`は数量一致の`boothSale` movementを1件保持し、相互変更で二重減算しない。`cancelled`はmovementを持たず、再開時に1件を再生成する。
- 新規・編集・削除は家発送record配列とmovement配列をvalidator、2-key write、read-back、rollback付きで原子的に保存し、成功後だけReact stateを更新する。
- 一覧は日付の新しい順とし、日付、商品、状態、数量、商品売上、送料、注文番号、発送日、メモを表示する。キャンセル記録は一覧へ残すが販売数・商品売上・送料集計から除外する。
- 家発送上部は有効販売数、商品売上、送料を分離表示する。商品カードの家発送売上には送料を含めない。
- 在庫履歴では`boothSale`を「BOOTH家発送販売」、`boothWarehouseSale`を「BOOTH倉庫販売」と区別する。
- inventory storage version 2、backup format 3、snapshot schemaVersion 1、Supabase、SQL、RPC、同期状態分類は変更していない。保存成功後は既存同期経路で`local_changed`となる。
- 現在の本線はPhase I-5の実機確認。完了後の戻り先はPhase I-6「周年記念基本管理」。
- Phase E-1b、Phase I-6〜I-8、Phase E-2、Sync Phase S-4b、同期詳細異常系の実機確認は保留のまま維持する。

# Phase I-4／I-5 BOOTH販売 実機確認完了（2026-07-24）

## Phase I-4 BOOTH倉庫

- 実機開始時の「在庫テスト商品」は現在庫11個。初期・調整後在庫15個から、イベント販売3個とサンプル1個を反映した値である。
- 新規登録では、数量3、購入者向け販売価格1,200円、受取単価900円、メモ`BOOTH倉庫テスト`を保存した。倉庫販売recordは1件、累計販売3個、累計受取2,700円となり、対応するBOOTH倉庫販売movementが追加され、現在庫は11個から8個へ減少した。
- 数量を3個から5個へ編集した。record件数は1件、record IDは維持され、累計販売5個、累計受取4,500円となった。対応movementは同じrecord ID単位で1件へ置換され、現在庫は8個から6個となり、二重減算は発生しなかった。
- 倉庫販売recordを削除した。record、対応movement、累計販売、累計受取はそれぞれ0件／0個／0円となり、現在庫は6個から11個へ復元した。
- 新規、編集、削除、在庫減算・復元、record ID維持、movement置換、受取総額を主要実機確認済みとし、Phase I-4を完了する。

## Phase I-5 BOOTH家発送拡張

- 実機開始時の「在庫テスト商品」は現在庫11個。
- 未発送の新規登録では、数量2、販売価格1,000円、送料370円、注文番号`HOME-SHIPPING-TEST`、メモ`家発送実機確認`を保存した。家発送recordは1件、販売数2個、商品売上2,000円、送料370円となり、発送日は未設定、現在庫は11個から9個へ減少した。
- 同じrecordを未発送から発送済みへ変更し、発送日を入力して保存した。record件数は1件のまま、販売数2個、商品売上2,000円、送料370円、現在庫9個を維持し、二重減算は発生しなかった。
- 同じrecordを発送済みからキャンセルへ変更した。recordはキャンセル状態で1件残り、販売数、商品売上、送料の集計対象外となって0個／0円／0円を表示した。対応movementは削除され、現在庫は9個から11個へ復元した。
- キャンセルは記録を残したまま集計と在庫消費から除外する操作である。削除は誤登録などのrecordを完全に除去する操作であり、役割を分けて維持する。
- 未発送、発送済み、キャンセルの主要状態遷移、record ID維持、在庫減算・復元、商品売上と送料の分離を主要実機確認済みとし、Phase I-5を完了する。

## BOOTHの現行仕様

- BOOTHタブ内は「倉庫」と「家発送」に分かれ、初期表示は「倉庫」である。
- 倉庫は日付、商品、数量、購入者向け販売価格、受取単価、受取総額、メモを扱い、新規、編集、削除が可能である。注文番号と発送状態は持たず、月次固定や同月1件制限は設けない。
- 家発送は日付、商品、数量、販売価格、送料、注文番号、状態、発送日、メモを扱い、新規、編集、キャンセル、再開、削除が可能である。状態は未発送、発送済み、キャンセルの3種類である。
- 倉庫は販売数と受取総額を集計する。家発送は販売数、商品売上、送料を分離して集計し、送料を商品売上および商品カードの家発送売上へ含めない。

## 同期との関係と現在地

- BOOTH倉庫と家発送は既存の販売・在庫同期snapshotへ含まれる。保存後は`local_changed`となり、自動送信せず、ユーザーが同期カードから明示送信する。
- inventory snapshot schemaVersion、RPC、Supabase、SQL、同期状態分類は変更していない。
- Phase I-4とPhase I-5は完了。現在の本線はPhase I-6「周年記念基本管理」である。
- Phase I-6では周年記念キャンペーン、対象年、周年名、FANBOXプラン、宛先番号、発送物、数量、状態、発送日、メモを扱う。氏名、住所、メールアドレス、電話番号は保存せず、初期実装では通常在庫と連動しない。
- Phase I-6完了後の戻り先はPhase I-7「周年完了と商品タブ上部カード」とする。
- 保留はPhase E-1b（completed複数商品の一括編集）、Phase I-7、Phase I-8（必要時のみ周年記念と通常在庫連携）、Phase E-2（イベント会計アプリ連動）、Sync Phase S-4b（非競合merge）、同期の詳細異常系実機確認である。未完了項目を完了扱いしない。
- 今後の割り込みでは、現在の本線、割り込み作業、割り込み理由、割り込み完了条件、割り込み完了後の戻り先を必ず記録し、本書を判断の正本とする。
- 本記録作業開始時のコードHEADは`172c9d29b6ebd16fa122fcdeffd6ecd67e1f0b09`（`feat: extend BOOTH home shipping`）である。

# 将来保留Phase：BOOTH価格判断と保管場所別在庫（2026-07-24）

## Phase I-5b BOOTH価格・利益シミュレーター

### 目的と利用条件

- BOOTH倉庫通販の商品について、原価、手数料、倉庫関連経費、希望利益を手入力し、販売価格を判断するための補助計算を行う。
- BOOTH APIとは連携せず、BOOTHの価格を自動変更しない。BOOTH管理画面の値を確認しながら本人が利用する、一般会計機能ではないシミュレーターとする。
- UIはPC版のBOOTH内に「倉庫」「家発送」と並ぶ「価格計算」として追加する候補とし、iPhone版では表示しない。画面幅だけを理由に保存データを削除・変更しない。
- PC専用UIで扱うデータをバックアップ・同期対象へ含めるかは実装前に再判断する。現時点では型、保存配列、snapshot配列を追加しない。
- 機能は、商品ごとの価格設定、月ごとの販売率・経費記録、価格シミュレーターの3区分を想定する。

### 商品ごとの価格設定候補

- 商品原価
- 現在のBOOTH販売価格
- 1個あたり確保したい利益
- 商品ごとの補足経費
- 利用するBOOTH手数料設定
- メモ

実装前に、現在の`Product`へ直接追加するか価格計算専用設定型へ分離するかを棚卸しする。既存の`boothWarehouseCustomerUnitPrice`、`boothWarehouseReceiptUnitPrice`、`boothDefaultPrice`と意味を重複させず、既存値を暗黙に上書きしない。

### 月ごとの倉庫記録候補

- 対象月
- 商品
- 月初倉庫在庫数
- 当月入荷数
- 当月販売・発送完了数
- 月末倉庫在庫数
- 倉庫への納品送料
- 保管料
- その他関連経費
- メモ

計算上の月末在庫は「月初倉庫在庫数＋当月入荷数－当月販売・発送完了数」とする候補である。実際のBOOTH倉庫在庫とは分け、将来は計算値、実数、差異を別表示できる構造を検討する。月次締めや入力回数制限は設けず、同月の修正・再入力方法は実装前に決定する。

### BOOTH共通設定候補

- サービス利用料率
- 決済手数料率
- 固定手数料
- 商品1個あたり手数料
- 注文単位手数料
- 倉庫保管料
- 保管料発生条件
- その他固定費
- 端数処理方法
- 価格の丸め単位

BOOTHの制度変更へ対応できるよう、特定時点の手数料率や保管ルールを計算式へハードコードしない。実装時点の正式ルールをユーザーが確認して設定できる構造を優先する。

### 自動計算候補

- 月間販売率
- 保管料発生の可能性
- BOOTH手数料見込み
- 倉庫送料、保管料、その他経費の1個あたり負担額
- 推定手取り
- 1個あたり利益
- 利益率
- 赤字にならない最低販売価格
- 希望利益を確保できる販売価格

月間販売率は「当月販売数÷（月初倉庫在庫数＋当月入荷数）」を候補とする。分母が0の場合は0%ではなく計算不能の`—`を表示する。

推定手取りは「販売価格－BOOTH関連手数料－1個あたりへ配分した倉庫関連経費」、利益は「推定手取り－商品原価」、利益率は「利益÷販売価格」とする候補である。赤字回避価格は利益が0円以上となる最低販売価格、希望利益価格は指定した1個あたり利益を確保できる最低販売価格とする。

価格候補の丸めは1円単位、10円、50円、100円単位の切り上げを候補とし、端数処理を設定値として保持する案を実装前に検討する。現在価格、推定手取り、原価、経費負担、利益、利益率、赤字回避価格、希望利益価格は意味を分けて表示し、異なる金額を一つの「売上」へ統合しない。

### 保管料と警告

- 初期実装ではBOOTH倉庫の保管料ルールを完全自動判定しない。
- 保管料見込みは「なし」「あり」「不明」、見込額、判定対象月、判定条件メモを分けて扱う候補とする。
- 現在価格では赤字、希望利益未達、保管料発生の可能性、必要設定不足、販売率計算不能を安全な警告候補とする。
- BOOTH側の制度変更時にコード変更せず設定を調整できることを優先する。

### 現在庫との関係

- Phase I-9実装までは、HootoDayの現在庫を商品全体の総在庫、価格計算へ入力するBOOTH倉庫在庫を月次計算用の参考手入力値として明確に分離する。
- 価格計算用の倉庫在庫数を、現在の`Product.initialStock + InventoryMovement`による総在庫計算やmovementへ混在させない。

## Phase I-9 保管場所別在庫管理

### 目的と候補

- 商品全体の在庫を、BOOTH倉庫在庫、家発送在庫、イベント在庫、その他保管在庫など、保管場所ごとに分けて管理する。
- `InventoryLocation`、`InventoryTransfer`、movementの`locationFrom`／`locationTo`、商品ごとの総在庫と場所別在庫、場所間移動、イベント終了後の返却、BOOTH倉庫への納品、家発送在庫への移動を候補として検討する。
- 現時点では型追加、migration、保存形式、在庫計算、snapshotを変更せず、実装前に静的棚卸しを行う。

### 独立Phaseとする理由

- 現在庫は`Product.initialStock + InventoryMovement`から商品全体で再計算している。
- 保管場所別へ拡張すると、総在庫、場所別在庫、場所間移動、イベント持込・返却、BOOTH倉庫納品、家発送用在庫、履歴、同期snapshot、削除・取消し、二重減算防止へ広く影響する。
- 価格判断だけを行うPhase I-5bへ混在させず、在庫設計を扱う独立した大きなPhaseとして保留する。

## ロードマップ順序と保留

- 現在の本線はPhase I-6「周年記念基本管理」のまま変更しない。
- 基本候補は、Phase I-6、Phase I-7「周年完了と商品タブ上部カード」、Phase I-8の必要性判断、Phase I-5b、Phase I-9の順とする。
- 価格設定を早く必要とする場合は、Phase I-7完了後にPhase I-5bを先行する可能性がある。Phase I-9は在庫設計への影響が大きいため、Phase I-5bより後を基本とする。
- Phase I-5bとPhase I-9はいずれも実施時期を再判断可能な保留Phaseであり、今回の文書追加を実装開始や完了として扱わない。
- 既存保留のPhase E-1b（completed複数商品の一括編集）、Phase I-7、Phase I-8、Phase E-2、Sync Phase S-4b、同期の詳細異常系実機確認を維持する。
- 今後の割り込みでは、現在の本線、割り込み作業、割り込み理由、割り込み完了条件、割り込み完了後の戻り先を必ず記録する。

# Phase I-6 周年記念基本管理 実装記録（2026-07-24）

## 既存基盤とデータ構造

- Phase I-1で`AnniversaryCampaign`、`AnniversaryShipment`、専用localStorage key、JSONバックアップ／復元、販売・在庫同期snapshot、同期取得時の一括適用まで実装済みだった。
- Phase I-6では新しい重複型、保存key、配列、同期schemaを作らず、この親子構造へ管理UIと明示的な保存操作を接続した。
- 親`AnniversaryCampaign`は対象年`year`、周年名`name`、将来I-7で使用する`completedAt`、`createdAt`、`updatedAt`を保持する。
- 子`AnniversaryShipment`は親ID、FANBOXプラン、宛先番号、発送物、数量、状態、発送日、メモ、`createdAt`、`updatedAt`を保持する。
- 状態は既存定義の`unprepared`、`preparing`、`prepared`、`not_shipped`、`shipped`を維持し、画面では「未準備」「準備中」「準備済み」「未発送」「発送済み」と表示する。

## 管理UIと保存

- 独立した「周年記念」タブで、新規登録、編集、確認付き削除、一覧表示を行う。
- 一覧は対象年の新しい順、同一年はshipmentの更新日時が新しい順とし、対象年、周年名、FANBOXプラン、宛先番号、発送物、数量、状態、発送日を表示する。長いメモはカード内で3行に制限する。
- 対象年は1900〜9999の4桁、周年名、宛先番号、発送物は空欄不可、数量は1以上の安全な整数とする。FANBOXプラン、発送日、メモは任意で、前後の空白を除去する。
- 宛先番号は文字列として扱い、先頭ゼロを保持する。発送日を状態から自動入力せず、ユーザーが明示した値だけを保存する。
- 新規IDは既存`createUuidV4()`を使用し、iPhone Safariの非secure contextでも既存fallbackを利用する。
- campaignとshipmentは2-keyの検証、write、read-back、rollbackを伴う原子的保存で更新する。編集ではshipment IDと作成日時を維持し、削除では対象shipmentだけを除き、子がなくなった親campaignだけを同時に除去する。
- 保存成功後だけReact stateを更新し、二重submitを防止する。validation失敗、ID生成不能、保存・read-back失敗では部分保存せず、入力画面に安全なエラーを表示する。
- PCではカードを2列、820px以下では1列にする。入力dialogは既存の背景scroll固定、内部scroll、safe-area、16px入力欄、44px以上の操作領域を再利用する。

## 個人情報・通常在庫・同期の境界

- 保存する宛先情報は宛先番号だけである。氏名、住所、郵便番号、電話番号、メールアドレス、SNSアカウント、FANBOXユーザーIDの入力欄・型・保存フィールドは追加しない。
- 周年記念は通常の商品在庫と非連動である。新規、数量編集、状態変更、発送済みへの変更、削除のいずれでも`InventoryMovement`を追加・更新・削除せず、商品在庫を増減しない。
- 周年記念管理データはPhase I-1で既に販売・在庫同期snapshotへ組み込み済みであり、PC・iPhone間の既存明示送信／明示取得の対象である。
- 新しい同期経路は作らない。既存operation ID、revision、fingerprint、validator、差異分類、CAS、read-backを利用し、自動送信、自動取得、自動retryを追加しない。
- inventory storage version 2、backup format 3、inventory snapshot schemaVersion 1を変更しない。古いstorageで周年配列がなければ空配列、backup format 1／2からの復元でも空配列として扱う既存互換を維持する。

## 完了条件と次工程

- 静的完了条件は、型チェック、lint、production build、diff check、親子validator、2-key保存、backup format 1／2互換、既存snapshot接続、在庫・movement非連動の確認である。
- 実機ではPCとiPhoneそれぞれで新規、編集、状態変更、発送日、削除、先頭ゼロ付き宛先番号、長文折返しを確認する。さらにPCからiPhone、iPhoneからPCへの明示同期と、商品在庫・履歴が変化しないことを確認する。
- Phase I-6の実装と静的確認は完了とし、主要実機確認待ちとする。実機確認完了後の戻り先はPhase I-7「周年完了と商品タブ上部カード」である。
- Phase I-7の周年全体の完了／完了取消し、商品タブ上部カード、自動非表示は今回実装しない。Phase I-8の通常在庫連携も保留を維持する。

## Phase I-6 実機フィードバック：年・プラン・個人カード構造

- 現在の本線はPhase I-6。割り込み作業は周年記念UI・運用構造の再設計であり、年1回のFANBOXプレゼント発送を平坦な個人記録では扱いにくかったため実施した。完了後はPhase I-6のiPhone表示・登録・編集・削除・同期実機確認へ戻る。
- `AnniversaryCampaign`を対象年＋周年名の親として作成し、その中へ`AnniversaryShipment`の個人発送カードを表示する。campaign作成直後から、shipmentが0件でも「うさぎ」「きのこ」「ねこ」の固定3プラン枠を表示する。
- 新規shipmentの`fanboxPlan`は選択中の固定プランから自動設定し、自由入力しない。既存の3プラン以外の値は「その他の既存プラン」として保持・表示し、読込・編集だけで削除や変換を行わない。
- プラン選択はcampaign IDごとにReact stateへ保持し、初期値は「うさぎ」とする。PC・iPhoneとも3プランを横3列とし、選択中プランの個人カードだけを一段下へ表示する。
- campaign上部は全件数と発送完了件数、各プランは全件、未着手、準備中、発送待ち、発送完了を集計する。旧`prepared`と`not_shipped`はどちらも表示・集計上「発送待ち」とする。
- 新規保存の4状態は`unprepared`（未着手）、`preparing`（準備中）、`not_shipped`（発送待ち）、`shipped`（発送完了）とする。旧`prepared`はvalidatorとsnapshot互換のため残し、表示は発送待ち、編集時もユーザーが明示変更しない限り保存値を維持する。
- 個人カードは状態順（未着手、準備中、発送待ち、発送完了）、同一状態では宛先番号順とする。状態、宛先番号、内容物、発送日、メモを表示し、メモは3行へ制限する。
- 新規shipmentの`quantity`は常に1を保存し、入力欄を表示しない。既存quantityが1以外の場合は互換表示を行い、編集保存でも元の値を維持する。
- campaign編集は対象年と周年名だけを変更し、IDと配下shipmentを維持する。個人カード削除ではcampaignを残し、周年全体の確認付き削除ではcampaignと配下shipmentを2-key原子的保存で同時に削除する。
- 通常商品在庫、`InventoryMovement`、イベント、BOOTH、販売・送料集計とは非連動である。周年データは既存の販売・在庫同期snapshotと明示送受信の対象であり、新しい同期経路、自動送受信、自動retry、schemaVersion、RPC、SQLは追加しない。
- 実機ではPCの3列プラン、campaign作成・編集・全体削除、各プランへの追加、4状態、旧値互換、個人カード編集・削除を確認後、iPhoneの3列表示と同操作、双方向明示同期、在庫・履歴不変を確認する。
- Phase I-7へ周年全体の完了／完了取消し、商品タブ上部カード、全件発送済み後の表示制御を持ち越す。Phase I-8の通常在庫連携も未実装のまま維持する。

## Phase I-6 プラン別標準内容物とUI調整

- `AnniversaryCampaign`へoptionalな`planItemDescriptions`を追加し、`rabbit`（うさぎ）、`mushroom`（きのこ）、`cat`（ねこ）の標準内容物を保存する。3項目は任意で、前後の空白を除去する。
- 旧campaignでfieldが欠損している場合は3項目とも空文字として画面表示する。読込だけではstorageへ書き戻さず、campaignを編集保存した時点で新構造を保存する。
- campaign作成・編集dialogで対象年、周年名、3プランの標準内容物を編集できる。campaign IDと配下shipmentは維持する。
- 固定プランへの新規個人カード追加時だけ、対応する標準内容物を`itemDescription`の初期値へ入れる。標準が空なら入力欄も空とし、個人カード保存時は従来どおり内容物を必須検証する。
- 個人カードでは内容物を自由に上書きでき、保存後はshipmentの個別内容を正本とする。既存shipmentの編集では保存済み`itemDescription`を初期表示し、campaignの標準内容物変更を既存shipmentへ自動反映しない。個別内容や準備済み記録を破壊しないため、一括更新や継承状態の追跡は行わない。
- optional fieldを受け入れるstorage validatorへ後方互換な最小拡張を行う。inventory storage version 2、backup format 3、snapshot schemaVersion 1は変更せず、既存backup／snapshotのfield欠損と、新field付きcampaignの両方を受理する。
- 新fieldは既存のJSON backup複製とinventory snapshotのdeep clone／fingerprintへ自動的に含まれ、PC・iPhone間の既存明示同期対象となる。RPC、SQL、自動送受信、自動retryは変更しない。
- 作成ボタンはGiftアイコンの1.3emを維持し、専用inline-flexと1pxの位置補正で文字と中央揃えにする。個人カード一覧はgridの縦stretchを止め、情報と操作間の余白を縮め、44px以上の操作領域とメモ3行制限を維持する。
- 通常在庫と`InventoryMovement`には引き続き非連動である。実機では新旧campaign表示、3標準内容物の保存・編集、個人追加時の初期値、個別上書き保護、PC／iPhone dialog、Gift位置、短いカードの余白、双方向同期を確認する。

## Phase I-6 内容物の複数行入力と明示保存

### 個人発送カードの余白再調整（実機再確認待ち）

- 個人発送カードは内容量に応じた高さとし、PCの2列表示でも短いカードを隣の長いカードに合わせて引き伸ばさない。
- カード内の上下paddingと項目間gapを縮め、編集・削除操作を内容の直下へ配置する。操作ボタンの44px以上の領域、内容物最大4行、メモ最大3行は維持する。
- PCの2列表示とiPhoneの1列表示を維持する。長い内容物・メモ、操作領域、横overflowはPC・iPhone実機で再確認する。

- うさぎ、きのこ、ねこの標準内容物と、個人カードの内容物を4行のtextareaへ変更する。500文字上限、前後空白の除去、標準内容物は任意、個人内容物は必須という検証を維持する。
- textarea内のEnter／Shift+Enter／Ctrl+Enter／Command+Enterは保存に使用せず、通常の改行として扱う。IME変換中のEnterとkeyCode 229も暗黙submitへ接続しない。
- dialogの保存は、明示的な「保存」ボタンから`requestSubmit()`した場合だけ処理する。フォームの暗黙submitは保存処理へ進めず、既存の二重submit guard、2-key保存、read-back、rollbackを維持する。
- 改行を含む個人内容物はカード上で`pre-wrap`相当を維持しつつ最大4行へ制限し、カードを過度に縦長にしない。
- PCでは標準内容物の2列＋ねこ全幅、iPhoneでは1列を維持する。実機では各textareaのEnter、Shift+Enter、IME確定、明示保存、標準内容物の初期反映、個人上書き、dialog scroll、横overflowを確認する。

# Phase I-6 周年記念基本管理 主要実機確認完了（2026-07-24）

## 確定構造と表示

- 年単位の`AnniversaryCampaign`を親とし、うさぎ、きのこ、ねこの固定3プラン配下へ`AnniversaryShipment`の個人発送カードを保持する。初期選択はうさぎで、プラン別集計と周年全体集計を表示し、下段には選択中プランのカードだけを表示する。
- 個人カードは状態、宛先番号、内容物、発送日、メモの順で表示する。新規時の`quantity`は内部で1に固定して画面表示せず、既存の1以外の値は互換表示を維持する。
- 画面上の4状態は未着手、準備中、発送待ち、発送完了とする。`unprepared`は未着手、`preparing`は準備中、`prepared`と`not_shipped`は発送待ち、`shipped`は発送完了として表示・集計する。旧値は破壊的変換しない。
- `AnniversaryCampaign.planItemDescriptions`は`rabbit`、`mushroom`、`cat`の標準内容物を後方互換に保持する。個人カード追加時は選択中プランの標準内容物を初期入力し、保存後は`AnniversaryShipment.itemDescription`を正本とする。標準内容物の変更は既存shipmentへ自動反映せず、以後の新規カードだけへ使用する。
- 標準内容物と個人内容物は約4行のtextarea、メモは複数行入力とする。Enter、Shift+Enter、IME確定Enterは改行・変換確定に使用し、Ctrl+Enter／Command+Enterを含めキー操作では保存しない。保存は明示的な保存ボタンだけで行う。
- 一覧では内容物の改行を維持して最大4行、メモを最大3行に制限する。個人カードは内容量に応じた高さで、PCは高さを揃えない2列、iPhoneは1列とする。固定3プランはiPhoneでも横3列を維持し、操作領域は44px以上とする。

## 主要実機確認結果

- PCでは周年記念作成、固定3プラン、プラン切替、個人カード追加・編集・削除、周年全体削除確認、4状態、プラン別・周年全体集計、複数行入力、Enter／IMEによる意図しない保存がないことを確認した。
- PCでは標準内容物の自動入力、個人内容物の上書き、標準内容物変更後も既存カードが不変であること、新規カードだけに新しい標準内容物が反映されること、個人カードの余白と高さを確認した。
- iPhoneでは固定3プランの横3列、横スクロールなし、個人カード1列、カード追加・編集、複数行内容物・メモ、Enter改行、入力時のSafari自動拡大なし、状態・発送日・メモ更新、プラン別集計反映を確認した。
- iPhoneから状態・発送日・複数行メモを編集して明示送信し、PCで明示取得して内容と集計が一致することを確認した。PCからメモを編集して明示送信し、iPhoneで明示取得して内容が一致することも確認した。自動送信、自動取得、自動retryは追加していない。
- 周年記念の登録、個人カード編集、状態変更、発送完了、削除、PC・iPhone間同期のいずれでも通常在庫は変化せず、在庫調整履歴は追加されず、`InventoryMovement`も変更されないことを実機確認した。
- 氏名、住所、郵便番号、電話番号、メールアドレス、SNSアカウント、FANBOXユーザーIDの入力欄・型・保存fieldは追加していない。
- 以上により、Phase I-6「周年記念基本管理」は主要実機確認完了とする。

## 次の本線：Phase I-6b 周年記念発送QR管理

- 現在の本線はPhase I-6b「周年記念発送QR管理」とする。割り込み作業はない。
- 目的は、個人発送カードごとに匿名配送用QRコード画像1枚を登録し、iPhoneから郵便局端末へ読み取りやすく表示できるようにすることである。
- 基本候補は、PCの画像ファイル登録、iPhoneの写真ライブラリまたはカメラ登録、白背景と十分な余白を持つ拡大表示、差し替え、削除である。QR内容は解析せず画像として扱う。
- 画像本体をlocalStorageや同期snapshotへ直接格納せず、Supabase Storageを第一候補とする。`AnniversaryShipment`には保存先情報だけを保持する候補とし、外部公開用共有リンクは作らない。通常在庫と`InventoryMovement`には連動しない。
- 最初の作業は実装ではなく、Storage構造、匿名認証とworkspace単位アクセス制御、画像pathの保存場所、PC・iPhone同期、差し替え・個人カード削除・周年全体削除時の旧画像削除、失敗時rollback、backup境界、復元時に画像がない場合の扱い、画像形式・サイズ・圧縮・トリミング、郵便局端末向け表示方法の設計とする。
- Phase I-7の周年完了・完了取消しと商品タブ上部カード、Phase I-8の通常在庫連携、Phase E-1b、Phase E-2、Sync Phase S-4bおよび同期詳細異常系の保留は維持し、未完了を完了扱いしない。
