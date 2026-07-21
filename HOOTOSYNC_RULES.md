# HootoSync Rules

Hootoシリーズで同期機能を実装・運用する際の共通ルールを定める。

本書は、アプリや保存先に依存しない同期規範、安全原則、状態モデル、復旧境界、実装時の確認事項を扱う。アプリ固有のデータ形式、通信手段、関数名、画面構成、実装履歴は、それぞれの設計文書および作業記録で管理する。

## 1. 基本概念

### 1.1 差異

差異とは、local、remote、baselineのいずれかが一致せず、現在状態を同一と安全に判断できない状態を指す。

- 差異の検出は、採用、送信、削除、mergeの許可を意味しない。
- 差異は対象単位で分類し、判定できない状態を推測で既知の分類へ変換しない。
- 複数の差異がある場合も、個別の処理判断は1件ずつ行う。

### 1.2 baseline

baselineとは、端末が検証済みとして保持する同期状態の基準である。

- remoteの現在値そのものではなく、過去に安全確認した状態を表す。
- local、remote、revision、sequenceなどの系譜確認に使用する。
- 不完全な取得結果や推測値から作成しない。
- baselineが存在することと、現在も一致していることを区別する。

### 1.3 checkpoint

checkpointとは、現在の同期状態と未解決差異を、後続の復旧判断に利用できる形で検証・保存した基準点である。

- 個別の採用、送信、削除を決定するものではない。
- checkpointの確認と保存を分離する。
- 保存後も状態を再確認し、保存済みcheckpointを正本として復旧候補を再構築する。
- 差異が残る場合は、差異を消さずに未解決として保持する。

### 1.4 candidate

candidateとは、保存済みcheckpointと現在状態の再確認に基づいて特定された、個別処理の候補である。

- 差異一覧に表示されたことだけではcandidateにならない。
- candidate一覧の派生と、処理用snapshotの生成を区別する。
- candidate確認だけではlocal、remote、baseline、metadataを変更しない。
- candidateは対象、分類、前提状態、snapshotの鮮度を再確認してから使用する。

### 1.5 adoption

adoptionとは、検証済みのremote状態を、ユーザーの明示操作によってlocalへ反映する処理である。

- remoteへの書き込みではない。
- candidate確認、local反映、反映後確認、metadata保存を分離する。
- 対象外のデータや未解決差異を変更しない。
- adoption成功だけで同期完了や通常同期readyと判断しない。

## 2. 同期状態モデル

### 2.1 normal

同期処理を開始していない通常状態。normalは、現在のlocalとremoteが一致していることを自動的には保証しない。

### 2.2 difference detected

明示的なread-only確認により差異を検出した状態。

- 差異の内容と安全な次操作を表示する。
- 自動で復旧状態へ遷移しない。
- candidate、採用、送信、削除を自動開始しない。

### 2.3 recovery_required

未解決差異を保持したまま、個別の復旧を必要とする状態。

- 通常同期readyとして扱わない。
- 未解決差異を1件ずつ明示的に処理する。
- 一部の復旧成功だけで自動的にconfirmedへ戻さない。

### 2.4 candidate_ready

対象1件のcandidate snapshotと実行前提を確認済みの状態。

- 採用、送信、削除、保存の完了状態ではない。
- snapshotまたは前提が変化した場合は無効とする。
- 次工程は別の明示操作で開始する。

### 2.5 adopted

検証済みremote状態をlocalへ反映済みの状態。

- 反映後のread-backと整合確認を必要とする。
- metadata保存や同期完了とは区別する。
- 反映後確認に失敗した場合はfail-closedを維持する。

### 2.6 confirmed

local、remote、baseline、cursorなどの必要な同期情報が、明示確認によって整合している状態。

- confirmedへの遷移は検証済み保存とread-backを必要とする。
- confirmed後に状態が変化した場合、過去の確認結果を再利用しない。

### 2.7 normal_sync_ready

confirmed状態への復帰後、別の明示的な通常同期確認で差異がないことを確認した状態。

- 復旧完了やconfirmed保存だけから推測しない。
- 最新の完全な取得結果と現在のlocal状態を基準に判定する。

## 3. 操作原則

- 永続変更を伴う操作は、ユーザーの明示操作でのみ開始する。
- 自動同期を行わない。
- 自動candidate生成を行わない。
- 自動採用を行わない。
- 自動削除を行わない。
- 自動送信を行わない。
- 自動retryを行わない。
- 確認、準備、実行、反映後確認、metadata保存を独立した工程に分ける。
- 前工程の成功を根拠に、次工程を自動実行しない。
- 複数の差異を一括処理せず、1件ずつ対象と操作を確認する。
- 実行可能条件とUIの表示条件を分け、安全停止理由を確認できるようにする。
- read-only確認結果は、永続化が必要と明示された場合を除き、一時状態として保持する。
- 不明状態、古いsnapshot、不完全取得、検証失敗は成功扱いしない。

## 4. 復旧ルール

### 4.1 remote-only

remote-onlyは、remoteに有効な対象が存在し、localに対応する対象が存在しない差異である。

- remote active、local不存在、削除状態との矛盾がないことを確認する。
- candidate確認とadoptionを別の明示操作にする。
- adoptionは対象1件だけをlocalへ反映し、remoteを変更しない。
- 対象外差異のsnapshotが変化していないことを実行直前に確認する。
- local保存後にread-backを行い、反映後確認とmetadata保存を別工程にする。
- 他の未解決差異を維持し、自動処理しない。

### 4.2 local-only

local-onlyは、localに有効な対象が存在し、remoteに対応するactiveまたは削除状態が存在しない差異である。

- remoteへの送信と、localからの破棄を別の選択肢として扱う。
- 送信はcandidate準備、remote preflight、明示送信、operation結果確認、metadata保存を分離する。
- local破棄はremote削除ではなく、remoteへ書き込まない。
- local破棄は対象1件、確認ダイアログ、保存前snapshot、read-back、rollbackを必須とする。
- 送信に必要な識別子やpending情報は、送信準備の明示操作より前に生成しない。
- 保留を許可し、未選択状態を暗黙の送信または削除として扱わない。

### 4.3 body mismatch

body mismatchは、同一対象についてlocalとremoteの内容が一致しない差異である。

- localとremoteの内容をread-onlyで比較する。
- 本文の差異をtimestampだけで暗黙解決しない。
- 自動mergeしない。
- local側またはremote側の採用候補をユーザーが明示選択する。
- 候補選択と候補確定だけでは、local保存、remote送信、metadata保存を行わない。
- 選択後もpreflight、明示実行、結果確認、metadata保存を分離する。

## 5. 安全確認

### 5.1 Full pull

- ユーザーの明示操作時だけ実行する。
- 全ページの完全取得を必須とする。
- 取得件数、重複、順序、sequence、cursor前進、対象範囲、payloadを検証する。
- 不完全取得、重複、停止したcursor、上限到達、validation失敗を成功扱いしない。
- 自動retryしない。
- 不完全な結果からbaseline、cursor、candidateを作成しない。

### 5.2 Snapshot鮮度確認

- snapshotに対象、分類、workspace、metadata、local、remote、baseline、cursorなど必要な前提を束縛する。
- 実行直前に永続状態と現在状態を再取得し、snapshotとの一致を確認する。
- 対象外差異を含む状態の不変性が必要な処理では、その一覧または安全なfingerprintを検証する。
- snapshot欠落、対象違い、分類違い、状態変化、期限切れを安全停止とする。
- 古い結果や別端末の結果を処理根拠にしない。

### 5.3 Read-back

- 永続保存後は保存先から値を再読込する。
- 期待する完成状態との完全一致を確認する。
- read-back成功前にReact stateや表示上の状態を成功へ進めない。
- 一部項目だけの一致を全体成功としない。

### 5.4 Rollback

- 書き込み前のsnapshotを保持する。
- 部分失敗時は元の状態へ戻し、復元結果をread-backで検証する。
- rollback成功、rollback失敗、rollback不能を区別する。
- rollbackを証明できない場合は、未変更や成功と表示せず、復旧が必要な状態として停止する。
- remote側で成立した変更を、local metadataだけ元へ戻して未送信扱いにしない。

### 5.5 Fail-closed

- 安全性を証明できない場合は処理しない。
- 不明な状態を一致、成功、適用済み、削除済みと推測しない。
- validation失敗、workspace不一致、snapshot不一致、系譜不明、通信結果不明では停止する。
- 安全停止後に自動修復、自動再試行、自動採用を行わない。
- 停止理由と永続変更の有無を、安全な情報だけでユーザーへ示す。

## 6. 禁止事項

- 差異表示だけを根拠にcandidateを生成すること。
- candidateを手動構築し、安全確認を省略すること。
- candidate確認から採用、送信、削除を自動実行すること。
- recovery状態への自動遷移、またはconfirmedへの自動復帰を行うこと。
- remoteの変化を同一operationの適用結果と推測すること。
- 不完全な取得結果からbaselineやcursorを更新すること。
- cursorだけを単独で進め、未処理のremote変更を飛ばすこと。
- local保存の成功確認より先にmetadataを完成状態として保存すること。
- 未解決差異を消去、暗黙解決、または別分類へ推測変換すること。
- 複数差異を一括採用、一括送信、一括削除すること。
- 自動merge、自動repair、自動retryを追加すること。
- rollbackを確認できない失敗を通常失敗または成功として扱うこと。
- 本文、payload全文、metadata全文、UUID、operation ID、fingerprint、token、認証情報、秘密情報を通常の状態表示やログへ出すこと。

## 7. 実装時チェックリスト

### 7.1 Read-only確認

- [ ] ユーザーの明示操作からのみ開始する。
- [ ] metadataのversion、形式、validator結果を確認する。
- [ ] workspace bindingを確認する。
- [ ] pending、delete intent、push blockなどの停止条件を確認する。
- [ ] localの永続値と画面上の状態が一致していることを確認する。
- [ ] Full pullの完全性と順序を確認する。
- [ ] local、remote、baseline、cursorを対象単位で比較する。
- [ ] 判定不能な対象をunknownとしてfail-closedにする。
- [ ] 結果だけで永続状態を変更しない。
- [ ] 自動実行や自動retryがない。

### 7.2 Candidate確認

- [ ] 保存済みcheckpointを正本として再確認している。
- [ ] candidate一覧の派生とsnapshot生成を分離している。
- [ ] 対象日または対象キーをユーザーが明示選択している。
- [ ] 対象とclassificationが一致している。
- [ ] snapshotに必要な前提状態を束縛している。
- [ ] candidate確認だけでlocal、remote、metadataを変更しない。
- [ ] candidate_readyから次工程を自動実行しない。

### 7.3 永続変更

- [ ] 対象が1件に限定されている。
- [ ] 実行前に確認ダイアログを表示する。
- [ ] 実行前snapshotを保持する。
- [ ] 実行直前にsnapshot鮮度を再確認する。
- [ ] 保存順序が定義されている。
- [ ] 保存後read-backを行う。
- [ ] 完成状態との完全一致を確認する。
- [ ] 部分失敗時のrollback経路がある。
- [ ] rollback結果をread-backで検証する。
- [ ] rollback不能時にfail-closedを維持する。
- [ ] 対象外データと未解決差異を維持する。

### 7.4 操作境界

- [ ] 確認、準備、実行、結果確認、metadata保存が分離されている。
- [ ] 前工程の成功から後工程を自動実行しない。
- [ ] candidate生成と採用を分離している。
- [ ] local反映と反映後確認を分離している。
- [ ] operation結果確認とmetadata保存を分離している。
- [ ] recovery完了後に別の通常同期確認を要求している。

### 7.5 自動処理防止

- [ ] 初期表示や再レンダーで通信・保存を開始しない。
- [ ] 自動同期がない。
- [ ] 自動candidate生成がない。
- [ ] 自動採用がない。
- [ ] 自動削除がない。
- [ ] 自動送信がない。
- [ ] 自動retryがない。
- [ ] 自動mergeや自動repairがない。

### 7.6 情報保護

- [ ] 本文やpayload全文を通常UI、共有文、ログへ出さない。
- [ ] UUID、operation ID、fingerprintの実値を表示しない。
- [ ] URL、key、token、Auth sessionを表示しない。
- [ ] metadata全文や内部例外全文を表示しない。
- [ ] 件数、日付、分類、revision、sequence、状態など必要最小限の安全な情報だけを表示する。
