import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PawPrint } from '@phosphor-icons/react';
import type { CalendarEvent } from '../types/calendar';
import type { BoothSalesRecord, BoothWarehouseSaleRecord, EventSalesRecord, InventoryMovement, Product } from '../types/inventory';
import { calculateAllProductStocks, calculateCurrentStock, calculateProductSalesSummary, canDecreaseStock } from '../utils/inventoryCalculation';
import { toDateKey } from '../utils/date';
import { createUuidV4 } from '../utils/uuid';
import { EventQuickCreateFields, type QuickEventDraft } from './EventQuickCreateFields';
import { EventSalesBatchDialog } from './EventSalesBatchDialog';
import type { EventSalesBatchDraftRow, EventSalesBatchRowErrors } from '../utils/inventoryEventSalesBatch';
type Tab = 'products' | 'events' | 'booth' | 'anniversaries' | 'history';
type Mode = 'product' | 'movement' | 'event' | 'booth';
type FirstSaleMode = 'none' | 'existing' | 'new';
type EventFieldKey = 'product' | 'event' | 'brought' | 'price' | 'sold' | 'sample' | 'quantities';
type MovementFieldErrors = { quantity?: string; memo?: string };
const eventFieldSelectors: Record<EventFieldKey, string> = {
    product: '[name="productId"]',
    event: 'select:not([name])',
    brought: '[name="broughtQuantity"]',
    price: '[name="unitPrice"]',
    sold: '[name="soldQuantity"]',
    sample: '[name="sampleQuantity"]',
    quantities: '[name="soldQuantity"]',
};
type EditableEventSalesRecord = Omit<EventSalesRecord, 'soldQuantity' | 'sampleQuantity'> & {
    soldQuantity: number | undefined;
    sampleQuantity: number | undefined;
};
const emptyQuickEvent = (): QuickEventDraft => ({ title: '', date: '', startTime: '', memo: '' });
interface Props {
    products: Product[];
    movements: InventoryMovement[];
    eventSales: EventSalesRecord[];
    boothSales: BoothSalesRecord[];
    boothWarehouseSales: BoothWarehouseSaleRecord[];
    events: CalendarEvent[];
    initialEventId?: string | null;
    onSaveProduct: (value: Product) => void;
    onAddMovement: (value: InventoryMovement) => void;
    onSaveEvent: (value: EventSalesRecord, movementDate: string) => string | null;
    onSaveEventBatch: (input: { eventId: string; eventDate: string; status: EventSalesRecord['status']; rows: EventSalesBatchDraftRow[]; requirePlannedRecords?: boolean }) =>
      { status: 'saved' } | { status: 'invalid'; errors: Record<string, EventSalesBatchRowErrors> } | { status: 'storage_error'; storageStatus: string };
    onSaveBooth: (value: BoothSalesRecord, expectedExistingId?: string | null) => string | null;
    onDeleteBooth: (id: string) => void;
    onDeleteEvent: (id: string) => void;
    onSaveCalendarEvent: (value: CalendarEvent) => void;
    syncCard?: ReactNode;
    onEditingStateChange?: (editing: boolean) => void;
}
const money = (value: number | null) => value === null ? '未設定' : value < 0 ? '未確定' : `${value.toLocaleString('ja-JP')}円`;
const boothSalesMethod = (product: Product) => {
    const hasWarehouse = product.boothWarehouseCustomerUnitPrice !== null || product.boothWarehouseReceiptUnitPrice !== null;
    const hasHomeShipping = product.boothEnabled;
    return hasWarehouse && hasHomeShipping ? '倉庫・家発送' : hasWarehouse ? '倉庫' : hasHomeShipping ? '家発送' : '未設定';
};
const eventLabel = (event: CalendarEvent) => `${event.date} ${event.startTime ?? (event.isAllDay ? '終日' : '')} ${event.title}［${event.category}］`;
export function InventoryPage(props: Props) {
    const onEditingStateChange = props.onEditingStateChange;
    const [tab, setTab] = useState<Tab>(props.initialEventId ? 'events' : 'products');
    const [query, setQuery] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [mode, setMode] = useState<Mode>('product');
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const product = editingProduct!;
    const [editingEvent, setEditingEvent] = useState<EditableEventSalesRecord | null>(null);
    const [editingBooth, setEditingBooth] = useState<BoothSalesRecord | null>(null);
    const [firstSaleMode, setFirstSaleMode] = useState<FirstSaleMode>('none');
    const [firstSaleEventId, setFirstSaleEventId] = useState('');
    const [quickEvent, setQuickEvent] = useState<QuickEventDraft>(emptyQuickEvent);
    const [selectedEventId, setSelectedEventId] = useState(props.initialEventId ?? '');
    const [eventStatus, setEventStatus] = useState<'planned' | 'completed'>('planned');
    const [movementType, setMovementType] = useState<InventoryMovement['type']>('restock');
    const [movementFieldErrors, setMovementFieldErrors] = useState<MovementFieldErrors>({});
    const [isMovementSubmitting, setIsMovementSubmitting] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isEventBatchOpen, setIsEventBatchOpen] = useState(false);
    const [eventBatchMode, setEventBatchMode] = useState<'create' | 'complete'>('create');
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [eventFieldErrors, setEventFieldErrors] = useState<Partial<Record<EventFieldKey, string>>>({});
    const [error, setError] = useState('');
    const dialogRef = useRef<HTMLDialogElement>(null);
    const editingBoothIdRef = useRef<string | null>(null);
    const movementSubmitInProgressRef = useRef(false);
    const lockedScrollYRef = useRef(0);
    useEffect(() => () => onEditingStateChange?.(false), [onEditingStateChange]);
    useEffect(() => {
        if (!isDialogOpen)
            return;
        const body = document.body;
        const root = document.documentElement;
        const previous = {
            bodyPosition: body.style.position,
            bodyTop: body.style.top,
            bodyWidth: body.style.width,
            bodyOverflow: body.style.overflow,
            rootOverflow: root.style.overflow,
            rootOverscroll: root.style.overscrollBehavior,
        };
        lockedScrollYRef.current = window.scrollY;
        body.style.position = 'fixed';
        body.style.top = `-${lockedScrollYRef.current}px`;
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        root.style.overflow = 'hidden';
        root.style.overscrollBehavior = 'none';
        return () => {
            body.style.position = previous.bodyPosition;
            body.style.top = previous.bodyTop;
            body.style.width = previous.bodyWidth;
            body.style.overflow = previous.bodyOverflow;
            root.style.overflow = previous.rootOverflow;
            root.style.overscrollBehavior = previous.rootOverscroll;
            window.scrollTo({ top: lockedScrollYRef.current, behavior: 'auto' });
        };
    }, [isDialogOpen]);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog)
            return;
        dialog.querySelectorAll<HTMLElement>('[data-field-error]').forEach((label) => label.removeAttribute('data-field-error'));
        dialog.querySelectorAll<HTMLElement>('[aria-invalid="true"][data-event-validation]').forEach((field) => {
            field.removeAttribute('aria-invalid');
            field.removeAttribute('aria-describedby');
            field.removeAttribute('data-event-validation');
        });
        const summary = dialog.querySelector<HTMLElement>('form > .form-error');
        if (summary)
            summary.id = 'inventory-event-error-summary';
        Object.entries(eventFieldErrors).forEach(([key, message]) => {
            const field = dialog.querySelector<HTMLElement>(eventFieldSelectors[key as EventFieldKey]);
            const label = field?.closest<HTMLElement>('label');
            if (!field || !label || !message)
                return;
            label.dataset.fieldError = message;
            field.dataset.eventValidation = 'true';
            field.setAttribute('aria-invalid', 'true');
            field.setAttribute('aria-describedby', 'inventory-event-error-summary');
        });
    }, [eventFieldErrors]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog)
            return;
        const clearChangedError = (event: Event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement))
                return;
            const key = (Object.keys(eventFieldSelectors) as EventFieldKey[]).find((item) => target.matches(eventFieldSelectors[item]));
            if (!key)
                return;
            setEventFieldErrors((current) => {
                if (!current[key] && !(key === 'sold' || key === 'sample') && !current.quantities)
                    return current;
                const next = { ...current };
                delete next[key];
                if (key === 'sold' || key === 'sample')
                    delete next.quantities;
                if (Object.keys(next).length === 0)
                    setError('');
                return next;
            });
        };
        dialog.addEventListener('input', clearChangedError);
        dialog.addEventListener('change', clearChangedError);
        return () => {
            dialog.removeEventListener('input', clearChangedError);
            dialog.removeEventListener('change', clearChangedError);
        };
    }, []);
    const stocks = calculateAllProductStocks(props.products, props.movements);
    const salesSummaries = useMemo(() => new Map(props.products.map((product) => [
        product.id,
        calculateProductSalesSummary(product.id, props.eventSales, props.boothSales, props.boothWarehouseSales),
    ])), [props.products, props.eventSales, props.boothSales, props.boothWarehouseSales]);
    const nowKey = toDateKey(new Date());
    const sortedEvents = useMemo(() => [...props.events].sort((a, b) => {
        const aPast = a.date < nowKey ? 1 : 0;
        const bPast = b.date < nowKey ? 1 : 0;
        return aPast - bPast || a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title);
    }), [props.events, nowKey]);
    const filteredProducts = props.products.filter((product) => (showInactive || product.isActive) && `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase()));
    const open = (next: Mode, product: Product | null = null, event: EventSalesRecord | null = null, booth: BoothSalesRecord | null = null) => {
        onEditingStateChange?.(true);
        setMode(next);
        setEditingProduct(product);
        setEditingEvent(event ? { ...event, soldQuantity: event.soldQuantity ?? undefined, sampleQuantity: event.sampleQuantity ?? undefined } : null);
        setEditingBooth(booth);
        editingBoothIdRef.current = next === 'booth' ? booth?.id ?? null : null;
        setError('');
        setEventFieldErrors({});
        setMovementFieldErrors({});
        setMovementType('restock');
        movementSubmitInProgressRef.current = false;
        setIsMovementSubmitting(false);
        setQuickEvent(emptyQuickEvent());
        if (next === 'product') {
            const exists = product?.firstSaleEventId && props.events.some((item) => item.id === product.firstSaleEventId);
            setFirstSaleMode(exists ? 'existing' : 'none');
            setFirstSaleEventId(exists ? product?.firstSaleEventId ?? '' : '');
        }
        if (next === 'event') {
            setSelectedEventId(event?.eventId ?? props.initialEventId ?? '');
            setEventStatus(event?.status ?? 'planned');
        }
        requestAnimationFrame(() => {
            if (dialogRef.current && !dialogRef.current.open)
                dialogRef.current.showModal();
            setIsDialogOpen(true);
        });
    };
    const close = () => { dialogRef.current?.close(); setIsDialogOpen(false); onEditingStateChange?.(false); setEditingEvent(null); setEditingBooth(null); editingBoothIdRef.current = null; movementSubmitInProgressRef.current = false; setIsMovementSubmitting(false); setError(''); setEventFieldErrors({}); setMovementFieldErrors({}); };
    const buildQuickEvent = (draft: QuickEventDraft, id = crypto.randomUUID()): CalendarEvent | null => {
        if (!draft.title.trim() || !draft.date)
            return null;
        return { id, title: draft.title.trim(), date: draft.date, category: '即売会', isAllDay: !draft.startTime, startTime: draft.startTime || null, endTime: null, memo: draft.memo.trim() };
    };
    const createEventForSale = () => {
        const event = buildQuickEvent(quickEvent);
        if (!event) {
            setError('イベント名と開催日を入力してください。');
            return;
        }
        props.onSaveCalendarEvent(event);
        setSelectedEventId(event.id);
        setQuickEvent(emptyQuickEvent());
        setError('');
    };
    const showEventErrors = (errors: Partial<Record<EventFieldKey, string>>) => {
        setEventFieldErrors(errors);
        setError('入力内容を確認してください。');
        const firstKey = (['product', 'event', 'brought', 'price', 'sold', 'sample', 'quantities'] as const).find((key) => errors[key]);
        if (!firstKey)
            return;
        requestAnimationFrame(() => {
            const field = dialogRef.current?.querySelector<HTMLElement>(eventFieldSelectors[firstKey]);
            field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            field?.focus();
        });
    };
    const submit = (submitEvent: React.FormEvent<HTMLFormElement>) => {
        submitEvent.preventDefault();
        const data = new FormData(submitEvent.currentTarget);
        const now = new Date().toISOString();
        const nullableNumber = (key: string) => { const value = String(data.get(key) ?? ''); return value === '' ? null : Number(value); };
        const nullableWholeNumber = (key: string) => {
            const value = String(data.get(key) ?? '').trim();
            return value === '' ? null : /^\d+$/.test(value) ? Number(value) : Number.NaN;
        };
        const productId = String(data.get('productId') || editingProduct?.id || '');
        const product = props.products.find((item) => item.id === productId);
        if (mode === 'product') {
            const name = String(data.get('name') ?? '').trim();
            const boothUrl = String(data.get('boothUrl') ?? '').trim();
            if (!name) {
                setError('商品名を入力してください。');
                return;
            }
            if (boothUrl && !/^https?:\/\//.test(boothUrl)) {
                setError('BOOTH URLはhttpまたはhttpsで入力してください。');
                return;
            }
            let nextEventId: string | null = null;
            let newEvent: CalendarEvent | null = null;
            if (firstSaleMode === 'existing') {
                if (!props.events.some((event) => event.id === firstSaleEventId)) {
                    setError('初売りに設定する予定を選択してください。');
                    return;
                }
                nextEventId = firstSaleEventId;
            }
            else if (firstSaleMode === 'new') {
                newEvent = buildQuickEvent({ title: String(data.get('product-eventTitle') ?? ''), date: String(data.get('product-eventDate') ?? ''), startTime: String(data.get('product-eventTime') ?? ''), memo: String(data.get('product-eventMemo') ?? '') });
                if (!newEvent) {
                    setError('初売りイベントのイベント名と開催日を入力してください。');
                    return;
                }
                nextEventId = newEvent.id;
            }
            const value: Product = { id: editingProduct?.id ?? crypto.randomUUID(), name, initialStock: editingProduct?.initialStock ?? Number(data.get('initialStock') ?? 0), defaultPrice: nullableNumber('defaultPrice'), category: String(data.get('category') ?? '').trim(), memo: String(data.get('memo') ?? '').trim(), isActive: data.get('isActive') === 'on', firstSaleEventId: nextEventId, boothEnabled: data.get('boothEnabled') === 'on', boothDisplayName: String(data.get('boothDisplayName') ?? '').trim(), boothDefaultPrice: nullableNumber('boothDefaultPrice'), boothListingQuantity: nullableNumber('boothListingQuantity'), boothWarehouseCustomerUnitPrice: nullableWholeNumber('boothWarehouseCustomerUnitPrice'), boothWarehouseReceiptUnitPrice: nullableWholeNumber('boothWarehouseReceiptUnitPrice'), boothUrl, createdAt: editingProduct?.createdAt ?? now, updatedAt: now };
            if ([value.initialStock, value.defaultPrice, value.boothDefaultPrice, value.boothListingQuantity, value.boothWarehouseCustomerUnitPrice, value.boothWarehouseReceiptUnitPrice].some((item) => item !== null && (!Number.isInteger(item) || item < 0))) {
                setError('在庫と価格は0以上の整数で入力してください。');
                return;
            }
            if (newEvent)
                props.onSaveCalendarEvent(newEvent);
            props.onSaveProduct(value);
            close();
            return;
        }
        if (mode === 'event' && !product) {
            showEventErrors({ product: '商品を選択してください。' });
            return;
        }
        if (!product) {
            setError('商品を選択してください。');
            return;
        }
        if (mode === 'movement') {
            const quantityRaw = String(data.get('quantity') ?? '').trim();
            const quantity = quantityRaw === '' ? Number.NaN : Number(quantityRaw);
            const type = String(data.get('movementType')) as InventoryMovement['type'];
            const memo = String(data.get('memo') ?? '').trim();
            const fieldErrors: MovementFieldErrors = {};
            if (!/^\d+$/.test(quantityRaw) || !Number.isSafeInteger(quantity) || quantity < 1) {
                fieldErrors.quantity = '数量は1以上の整数で入力してください。減らす場合も「1」のように正数で入力します。';
            }
            else if (type === 'adjustmentDecrease' && !canDecreaseStock(product, props.movements, quantity)) {
                fieldErrors.quantity = `現在庫 ${calculateCurrentStock(product, props.movements)}個を超えて減らすことはできません。`;
            }
            if (!memo) {
                fieldErrors.memo = '理由・メモを入力してください。';
            }
            if (Object.keys(fieldErrors).length > 0) {
                movementSubmitInProgressRef.current = false;
                setIsMovementSubmitting(false);
                setMovementFieldErrors(fieldErrors);
                return;
            }
            if (movementSubmitInProgressRef.current)
                return;
            const movementId = createUuidV4();
            if (!movementId) {
                setError('保存に必要なIDを作成できませんでした。入力内容は変更されていません。');
                requestAnimationFrame(() => dialogRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
                return;
            }
            movementSubmitInProgressRef.current = true;
            setIsMovementSubmitting(true);
            try {
                props.onAddMovement({ id: movementId, productId, date: String(data.get('date')), type, quantity, eventSalesRecordId: null, boothSalesRecordId: null, boothWarehouseSalesRecordId: null, memo, createdAt: now });
                close();
            }
            catch {
                setError('保存に失敗しました。入力内容は変更されていません。もう一度お試しください。');
                requestAnimationFrame(() => dialogRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
            }
            finally {
                movementSubmitInProgressRef.current = false;
                setIsMovementSubmitting(false);
            }
            return;
        }
        if (mode === 'event') {
            const soldRaw = String(data.get('soldQuantity') ?? ''), sampleRaw = String(data.get('sampleQuantity') ?? ''), broughtRaw = String(data.get('broughtQuantity') ?? ''), priceRaw = String(data.get('unitPrice') ?? '');
            const brought = broughtRaw === '' ? Number.NaN : Number(broughtRaw), price = priceRaw === '' ? Number.NaN : Number(priceRaw);
            const sold = eventStatus === 'planned' ? null : soldRaw === '' ? null : Number(soldRaw);
            const sample = eventStatus === 'planned' ? null : sampleRaw === '' ? null : Number(sampleRaw);
            const eventId = selectedEventId;
            if (!props.events.some((event) => event.id === eventId)) {
                showEventErrors({ event: 'イベント予定を選択するか、新しい予定を作成してください。' });
                return;
            }
            const numericErrors: Partial<Record<EventFieldKey, string>> = {};
            if (!Number.isInteger(brought) || brought < 0)
                numericErrors.brought = '持込数は0以上の整数で入力してください。';
            if (!Number.isInteger(price) || price < 0)
                numericErrors.price = '単価は0以上の整数で入力してください。';
            if (Object.keys(numericErrors).length > 0) {
                showEventErrors(numericErrors);
                return;
            }
            if (eventStatus === 'completed') {
                const resultErrors: Partial<Record<EventFieldKey, string>> = {};
                if (sold === null || !Number.isInteger(sold) || sold < 0)
                    resultErrors.sold = '販売数は0以上の整数で入力してください。';
                if (sample === null || !Number.isInteger(sample) || sample < 0)
                    resultErrors.sample = 'サンプル数は0以上の整数で入力してください。';
                if (sold !== null && sample !== null && Number.isInteger(sold) && Number.isInteger(sample) && sold + sample > brought)
                    resultErrors.quantities = '販売数とサンプル数の合計は持込数以下にしてください。';
                if (Object.keys(resultErrors).length > 0) {
                    showEventErrors(resultErrors);
                    return;
                }
            }
            const movementDate = props.events.find((item) => item.id === eventId)?.date ?? nowKey;
            const eventRecordId = editingEvent?.id ?? createUuidV4();
            if (!eventRecordId) {
                setError('保存に必要なIDを作成できませんでした。');
                return;
            }
            const result = props.onSaveEvent({ id: eventRecordId, eventId, productId, productNameSnapshot: editingEvent?.productNameSnapshot ?? product.name, unitPriceSnapshot: price, broughtQuantity: brought, soldQuantity: sold, sampleQuantity: sample, status: eventStatus, memo: String(data.get('memo') ?? '').trim(), updatedAt: now }, movementDate);
            if (result) {
                showEventErrors({ quantities: result });
                return;
            }
            close();
            return;
        }
        const quantity = Number(data.get('quantity')), price = Number(data.get('unitPrice'));
        if (!Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(price) || price < 0) {
            setError('数量は1以上、単価は0以上の整数で入力してください。');
            return;
        }
        const editingBoothId = editingBoothIdRef.current;
        const existingBooth = editingBoothId ? props.boothSales.find((record) => record.id === editingBoothId) : null;
        if (editingBoothId && !existingBooth) {
            setError('編集対象のBOOTH販売記録が見つかりません。画面を閉じて再確認してください。');
            return;
        }
        const result = props.onSaveBooth({ id: existingBooth?.id ?? crypto.randomUUID(), date: String(data.get('date')), productId: existingBooth?.productId ?? productId, productNameSnapshot: existingBooth?.productNameSnapshot ?? (product.boothDisplayName || product.name), unitPriceSnapshot: price, quantity, orderReference: String(data.get('orderReference') ?? '').trim(), status: String(data.get('status')) as BoothSalesRecord['status'], shippingFee: existingBooth?.shippingFee ?? null, shippedAt: existingBooth?.shippedAt ?? null, memo: String(data.get('memo') ?? '').trim(), createdAt: existingBooth?.createdAt ?? now, updatedAt: now }, editingBoothId);
        if (result) {
            setError(result);
            return;
        }
        close();
    };
    const eventSalesGroups = [...new Set(props.eventSales.map((record) => record.eventId))].map((eventId) => ({
        eventId,
        event: props.events.find((event) => event.id === eventId),
        planned: props.eventSales.filter((record) => record.eventId === eventId && record.status === 'planned'),
        completed: props.eventSales.filter((record) => record.eventId === eventId && record.status === 'completed'),
    }));
    const totalBooth = props.boothSales.filter((item) => item.status !== 'cancelled').reduce((sum, item) => sum + item.quantity * item.unitPriceSnapshot, 0);
    const selectedFirstSaleProducts = props.products.filter((product) => product.firstSaleEventId === selectedEventId);
    return <div className="inventory-page">
    <header className="content-heading"><div><p className="eyebrow">Inventory</p><h1>販売・在庫</h1><p>商品・即売会・BOOTHを共通の実在庫で管理します。</p></div></header>
    <nav className="inventory-tabs" aria-label="販売・在庫画面">{([['products', '商品'], ['events', 'イベント'], ['booth', 'BOOTH'], ['anniversaries', '周年記念'], ['history', '在庫履歴']] as [
            Tab,
            string
        ][]).map(([value, label]) => <button key={value} type="button" className={value === 'history' ? 'inventory-tab-history' : undefined} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {props.syncCard}
    {tab === 'products' && <><div className="inventory-toolbar"><label>商品検索<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名・カテゴリ"/></label><label className="inventory-check"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)}/>販売終了も表示</label><button className="health-primary-button" onClick={() => open('product')}>商品を登録</button></div><div className="inventory-grid">{filteredProducts.map(product => {
        const first = props.events.find(event => event.id === product.firstSaleEventId);
        const summary = salesSummaries.get(product.id);
        if (!summary)
            return null;
        return <article className="inventory-card" key={product.id}>
          <header className="inventory-card-header"><div><span className={`inventory-status ${product.isActive ? 'active' : 'inactive'}`}>{product.isActive ? '販売中' : '販売終了'}</span><h2>{product.name}</h2><p>{product.category || 'カテゴリなし'}</p></div><div className="inventory-stock-summary"><span>現在庫</span><strong className="inventory-stock">{stocks.get(product.id) ?? 0}<small>個</small></strong></div></header>
          <div className="inventory-sales-paths">
            <section className="inventory-sales-path"><h3>イベント</h3><dl><div><dt>価格</dt><dd>{money(product.defaultPrice)}</dd></div><div><dt>累計販売</dt><dd>{summary.eventSoldQuantity.toLocaleString('ja-JP')}個</dd></div><div><dt>累計売上</dt><dd>{money(summary.eventSalesAmount)}</dd></div></dl></section>
            <section className="inventory-sales-path"><h3>BOOTH</h3><dl><div><dt>販売方式</dt><dd>{boothSalesMethod(product)}</dd></div><div><dt>家発送価格</dt><dd>{money(product.boothDefaultPrice)}</dd></div><div><dt>倉庫販売価格</dt><dd>{money(product.boothWarehouseCustomerUnitPrice)}</dd></div><div><dt>倉庫受取単価</dt><dd>{money(product.boothWarehouseReceiptUnitPrice)}</dd></div><div><dt>累計販売</dt><dd>{summary.boothTotalSoldQuantity.toLocaleString('ja-JP')}個</dd></div><div><dt>倉庫受取総額</dt><dd>{money(summary.boothWarehouseReceiptAmount)}</dd></div><div><dt>家発送売上</dt><dd>{money(summary.boothHomeShippingSalesAmount)}</dd></div><div><dt>BOOTH販売枠</dt><dd>{product.boothListingQuantity === null ? '未設定' : `${product.boothListingQuantity.toLocaleString('ja-JP')}個`}</dd></div></dl></section>
          </div>
          {first ? <p className="inventory-first-sale">初売り：{first.date} {first.title}［{first.category}］</p> : product.firstSaleEventId ? <p className="form-error">初売りイベントの予定が見つかりません</p> : null}
          <div className="inventory-card-actions"><button onClick={() => open('movement', product)}>在庫を調整</button><button onClick={() => open('product', product)}>編集</button></div>
        </article>;
    })}{!filteredProducts.length && <p className="inventory-empty">登録済みの商品はありません。</p>}</div></>}
    {tab === 'events' && <><section className="inventory-event-registration" aria-label="イベント商品の登録"><div className="inventory-actions inventory-event-registration-actions"><button className="health-primary-button inventory-event-registration-button" disabled={!props.products.some(item => item.isActive)} onClick={() => { onEditingStateChange?.(true); setEventBatchMode('create'); setIsEventBatchOpen(true); }}>イベント商品の登録</button><button className="inventory-event-registration-button" disabled={!props.products.some(item => item.isActive)} onClick={() => open('event')}>追加で登録</button></div></section><div className="inventory-event-groups">{eventSalesGroups.map((group) => {
                const records = [...group.planned, ...group.completed];
                const productCount = new Set(records.map((item) => item.productId)).size;
                const broughtTotal = records.reduce((sum, item) => sum + item.broughtQuantity, 0);
                const completedSold = group.completed.reduce((sum, item) => sum + (item.soldQuantity ?? 0), 0);
                const completedSales = group.completed.reduce((sum, item) => sum + (item.soldQuantity ?? 0) * item.unitPriceSnapshot, 0);
                const isMixed = group.planned.length > 0 && group.completed.length > 0;
                const stateLabel = isMixed ? '一部売上未入力' : group.planned.length > 0 ? '売上未入力' : '売上入力済み';
                const actionsExpanded = expandedEventId === group.eventId;
                return <article key={group.eventId} className="inventory-event-group">
                  <header className="inventory-event-group-heading"><div><strong>{group.event?.title ?? '予定が見つからないイベント'}</strong><span>{group.event?.date ?? ''}</span></div>{group.planned.length > 0 && <span className="inventory-status planned">{stateLabel}</span>}</header>
                  <div className="inventory-event-group-summary">
                    <span>商品 <strong>{productCount}種類</strong></span><span>持込予定 <strong>{broughtTotal}個</strong></span><span>販売総数 <strong>{completedSold}個</strong></span><span>売上 <strong>{money(completedSales)}</strong></span>
                  </div>
                  {group.planned.length > 0 && <button className="health-primary-button inventory-event-primary-action" onClick={() => {
                          setSelectedEventId(group.eventId);
                          setEventBatchMode('complete');
                          onEditingStateChange?.(true);
                          setIsEventBatchOpen(true);
                  }}>{isMixed ? '売上未入力の商品を入力' : '売上をまとめて入力'}</button>}
                  <button className="inventory-event-secondary-action" aria-expanded={actionsExpanded} onClick={() => setExpandedEventId(actionsExpanded ? null : group.eventId)}>{actionsExpanded ? '編集を閉じる' : '商品を編集'}</button>
                  <div className="inventory-event-products" aria-label="商品別の売上">
                    {records.map((item) => {
                        const completed = item.status === 'completed';
                        const sold = item.soldQuantity ?? 0;
                        const sample = item.sampleQuantity ?? 0;
                        return <section className="inventory-event-product" key={item.id}>
                          <div className="inventory-event-product-info"><div className="inventory-event-product-name"><strong>{item.productNameSnapshot}</strong></div></div>
                          <div className="inventory-event-product-values"><span>持込 {item.broughtQuantity}個</span>{completed ? <><span>販売 {sold}個</span><span>サンプル {sample}個</span><span>残数 {item.broughtQuantity - sold - sample}個</span><span>売上 {money(sold * item.unitPriceSnapshot)}</span></> : null}</div>
                          {actionsExpanded && <div className="inventory-event-product-actions"><button onClick={() => open('event', props.products.find(product => product.id === item.productId) ?? null, item)}>{completed ? '売上を修正' : '売上を入力'}</button><button className="danger" onClick={() => {
                              if (window.confirm('このイベント販売記録を削除しますか？'))
                                  props.onDeleteEvent(item.id);
                          }}>削除</button></div>}
                          {completed && <span className="inventory-event-completed-stamp" aria-label="売上入力済み" title="売上入力済み"><PawPrint aria-hidden="true" weight="fill"/></span>}
                        </section>;
                    })}
                  </div>
                </article>;
            })}</div></>}
    {tab === 'booth' && <section className="inventory-section"><div className="inventory-section-heading"><div><h2>BOOTH販売</h2><p>手動入力です。購入者名・住所・メールは保存しません。</p></div><button className="health-primary-button" disabled={!props.products.some(item => item.isActive && item.boothEnabled)} onClick={() => open('booth')}>BOOTH販売を記録</button></div><p className="inventory-total">有効売上：{money(totalBooth)}</p>{props.boothSales.map(item => <article className="inventory-row inventory-booth-row" key={item.id}><strong>{item.productNameSnapshot}</strong><div className="inventory-booth-detail"><span>{item.status === 'pending' ? '未発送' : item.status === 'shipped' ? '発送済み' : 'キャンセル'}・{item.quantity}個</span>{item.orderReference && <small>注文番号：{item.orderReference}</small>}</div><span>{item.status === 'cancelled' ? '売上対象外' : money(item.quantity * item.unitPriceSnapshot)}</span><div className="inventory-row-actions"><button onClick={() => open('booth', props.products.find(product => product.id === item.productId) ?? null, null, item)}>編集</button><button className="inventory-danger-button" onClick={() => { if (window.confirm('このBOOTH販売記録を削除しますか？在庫と売上も再計算されます。')) props.onDeleteBooth(item.id); }}>削除</button></div></article>)}</section>}
    {tab === 'anniversaries' && <section className="inventory-section"><h2>周年記念</h2><p>FANBOX周年特典などの発送準備と発送状況を管理します。</p><div className="inventory-empty"><strong>周年記念の登録はまだありません</strong><p>氏名や住所は保存せず、宛先番号で管理します。</p></div></section>}
    {tab === 'history' && <section className="inventory-section"><h2>在庫履歴</h2>{[...props.movements].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map(item => <article className="inventory-row" key={item.id}><strong>{props.products.find(product => product.id === item.productId)?.name ?? '不明な商品'}</strong><span>{item.date}・{item.type}</span><span>{['restock', 'return', 'adjustmentIncrease', 'boothCancellation'].includes(item.type) ? '+' : '-'}{item.quantity}</span><small>{item.memo}</small></article>)}</section>}
    <EventSalesBatchDialog open={isEventBatchOpen} mode={eventBatchMode} products={props.products} events={sortedEvents} records={props.eventSales} initialEventId={selectedEventId} onClose={() => { setIsEventBatchOpen(false); onEditingStateChange?.(false); }} onSave={props.onSaveEventBatch}/>
    <dialog ref={dialogRef} className="inventory-dialog" onCancel={(event) => { event.preventDefault(); close(); }}><form key={`${mode}:${editingProduct?.id ?? ''}:${editingEvent?.id ?? ''}:${editingBooth?.id ?? ''}`} onSubmit={submit} noValidate><header><div><p className="eyebrow">Inventory</p><h2>{mode === 'product' ? (editingProduct ? '商品を編集' : '商品を登録') : mode === 'movement' ? '在庫を調整' : mode === 'event' ? (editingEvent ? 'イベント販売を編集' : 'イベント販売を記録') : (editingBooth ? 'BOOTH販売を編集' : 'BOOTH販売を記録')}</h2></div><button type="button" aria-label="ダイアログを閉じる" onClick={close}>×</button></header>{error && <p className="form-error" role="alert">{error}</p>}{mode === 'event' && <fieldset className="inventory-fieldset inventory-status-choice"><legend>記録状態</legend><label className="inventory-check"><input type="radio" checked={eventStatus === 'planned'} onChange={() => setEventStatus('planned')}/>{editingEvent?.status === 'completed' ? '売上入力を取り消す' : '売上未入力として保存'}</label><label className="inventory-check"><input type="radio" checked={eventStatus === 'completed'} onChange={() => setEventStatus('completed')}/>売上入力済みとして保存</label>{eventStatus === 'planned' && <p>売上未入力では販売数・サンプル数を保存せず、在庫を減らしません。</p>}{editingEvent?.status === 'completed' && eventStatus === 'planned' && <p className="inventory-warning">この商品の売上入力を取り消すと、販売数とサンプル数に対応する在庫が戻り、状態は「売上未入力」になります。</p>}</fieldset>}
      {mode === 'product' ? <div className="inventory-form-grid"><label>商品名<input name="name" required maxLength={100} defaultValue={editingProduct?.name}/></label><label>初期在庫<input key={editingProduct?.id ?? 'new-product'} name="initialStock" type="number" min="0" step="1" disabled={Boolean(editingProduct)} defaultValue={editingProduct?.initialStock ?? 0}/></label><label>通常価格<input name="defaultPrice" type="number" min="0" step="1" defaultValue={editingProduct?.defaultPrice ?? ''}/></label><label>カテゴリ<input name="category" maxLength={100} defaultValue={editingProduct?.category}/></label><label className="inventory-check"><input name="isActive" type="checkbox" defaultChecked={editingProduct?.isActive ?? true}/>販売中・使用中</label><label className="inventory-wide">商品メモ<textarea name="memo" maxLength={1000} defaultValue={editingProduct?.memo}/></label><fieldset className="inventory-wide inventory-fieldset"><legend>初売りイベント</legend>{editingProduct?.firstSaleEventId && !props.events.some(event => event.id === product.firstSaleEventId) && <p className="form-error">参照先の予定が見つかりません。再設定してください。</p>}{(['none', 'existing', 'new'] as FirstSaleMode[]).map(value => <label className="inventory-check" key={value}><input type="radio" name="firstSaleMode" checked={firstSaleMode === value} onChange={() => setFirstSaleMode(value)}/>{value === 'none' ? '設定しない' : value === 'existing' ? '登録済みの予定から選ぶ' : '新しいイベント予定を作る'}</label>)}{firstSaleMode === 'existing' && (sortedEvents.length ? <label>予定<select value={firstSaleEventId} onChange={(event) => setFirstSaleEventId(event.target.value)}><option value="">選択してください</option>{sortedEvents.map(event => <option key={event.id} value={event.id}>{eventLabel(event)}</option>)}</select></label> : <p>選択できる予定がありません。新しいイベント予定を作成してください。</p>)}{firstSaleMode === 'new' && <EventQuickCreateFields prefix="product-event" value={quickEvent} onChange={setQuickEvent}/>}</fieldset><fieldset className="inventory-wide inventory-fieldset"><legend>BOOTH設定</legend><label className="inventory-check"><input name="boothEnabled" type="checkbox" defaultChecked={editingProduct?.boothEnabled}/>BOOTHで販売中</label><label>BOOTH表示名<input name="boothDisplayName" maxLength={100} defaultValue={editingProduct?.boothDisplayName}/></label><label>BOOTH価格<input name="boothDefaultPrice" type="number" min="0" step="1" defaultValue={editingProduct?.boothDefaultPrice ?? ''}/></label><label>BOOTH販売枠<input name="boothListingQuantity" type="number" min="0" step="1" defaultValue={editingProduct?.boothListingQuantity ?? ''}/></label><label>BOOTH URL<input name="boothUrl" type="url" maxLength={500} defaultValue={editingProduct?.boothUrl}/></label></fieldset></div> : <div className="inventory-form-grid"><label>商品<select name="productId" required defaultValue={editingProduct?.id ?? ''}><option value="">選択してください</option>{props.products.filter(item => item.isActive && (mode !== 'booth' || item.boothEnabled)).map(item => <option key={item.id} value={item.id}>{item.name}（在庫 {stocks.get(item.id) ?? 0}）</option>)}</select></label>{mode === 'movement' ? <><label>調整方法<select name="movementType" value={movementType} onChange={(event) => setMovementType(event.target.value as InventoryMovement['type'])}><option value="restock">増やす（入荷・追加製造）</option><option value="adjustmentIncrease">増やす（その他）</option><option value="adjustmentDecrease">減らす（その他）</option></select></label><label>日付<input name="date" type="date" required defaultValue={nowKey}/></label><label data-field-error={movementFieldErrors.quantity}>数量（正の整数）<input name="quantity" type="text" inputMode="numeric" pattern="[0-9]*" required aria-invalid={Boolean(movementFieldErrors.quantity)} onInput={() => setMovementFieldErrors(current => ({ ...current, quantity: undefined }))}/>{movementType === 'adjustmentDecrease' && <small>減らす数を正数で入力します（1個減らす場合は「1」）。</small>}</label></> : mode === 'event' ? <><label className="inventory-wide">予定<select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)} required><option value="">選択してください</option>{sortedEvents.map(event => <option value={event.id} key={event.id}>{eventLabel(event)}</option>)}</select></label><div className="inventory-wide"><EventQuickCreateFields prefix="sale-event" value={quickEvent} onChange={setQuickEvent}/><button type="button" className="event-action-button secondary" onClick={createEventForSale}>新しいイベント予定を作る</button></div>{selectedFirstSaleProducts.length > 0 && <div className="inventory-wide inventory-recommendations"><strong>このイベントを初売りに設定した商品</strong>{selectedFirstSaleProducts.map(item => <button type="button" key={item.id} onClick={() => setEditingProduct(item)}>{item.name}（在庫 {stocks.get(item.id) ?? 0}）を選択</button>)}</div>}<label>持込数<input name="broughtQuantity" type="number" min="0" step="1" autoComplete="off" required defaultValue={editingEvent?.broughtQuantity}/></label><label>販売数<input name="soldQuantity" type="number" min="0" step="1" autoComplete="off" required defaultValue={editingEvent?.soldQuantity}/></label><label>サンプル数<input name="sampleQuantity" type="number" min="0" step="1" autoComplete="off" required defaultValue={editingEvent?.sampleQuantity}/></label><label>単価<input name="unitPrice" type="number" min="0" step="1" autoComplete="off" required defaultValue={editingEvent?.unitPriceSnapshot ?? editingProduct?.defaultPrice ?? ''}/></label></> : <><label>日付<input name="date" type="date" required defaultValue={editingBooth?.date ?? nowKey}/></label><label>状態<select name="status" defaultValue={editingBooth?.status ?? 'pending'}><option value="pending">未発送</option><option value="shipped">発送済み</option><option value="cancelled">キャンセル</option></select></label><label>数量<input name="quantity" type="number" min="1" step="1" required defaultValue={editingBooth?.quantity}/></label><label>単価<input name="unitPrice" type="number" min="0" step="1" required defaultValue={editingBooth?.unitPriceSnapshot ?? editingProduct?.boothDefaultPrice ?? ''}/></label><label>注文番号（任意）<input name="orderReference" maxLength={100} defaultValue={editingBooth?.orderReference}/></label></>}<label className="inventory-wide" data-field-error={mode === 'movement' ? movementFieldErrors.memo : undefined}>理由・メモ<textarea name="memo" maxLength={500} defaultValue={editingEvent?.memo ?? editingBooth?.memo} aria-invalid={mode === 'movement' && Boolean(movementFieldErrors.memo)} onInput={() => mode === 'movement' && setMovementFieldErrors(current => ({ ...current, memo: undefined }))}/></label></div>}
      {mode === 'product' && <div className="inventory-form-grid inventory-warehouse-price-fields"><label>BOOTH倉庫・購入者向け価格<input name="boothWarehouseCustomerUnitPrice" type="number" min="0" step="1" inputMode="numeric" defaultValue={editingProduct?.boothWarehouseCustomerUnitPrice ?? ''}/></label><label>BOOTH倉庫・受取単価<input name="boothWarehouseReceiptUnitPrice" type="number" min="0" step="1" inputMode="numeric" defaultValue={editingProduct?.boothWarehouseReceiptUnitPrice ?? ''}/></label></div>}
      <footer><button type="button" onClick={close}>キャンセル</button><button className="health-primary-button" type="submit" disabled={mode === 'movement' && isMovementSubmitting}>{mode === 'movement' && isMovementSubmitting ? '保存中…' : mode === 'event' ? eventStatus === 'planned' ? editingEvent?.status === 'completed' ? '売上入力を取り消す' : '売上未入力として保存' : editingEvent ? '売上を修正' : '売上を保存' : '保存'}</button></footer></form></dialog>
  </div>;
}
