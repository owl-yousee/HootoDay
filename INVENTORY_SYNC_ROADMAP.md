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
- E-1c完了後の本線と戻り先はPhase I-4 BOOTH倉庫である。I-4〜I-8、E-2、必要時のS-4bという保留順序は変更しない。

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
