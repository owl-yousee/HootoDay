import { useEffect, useState } from 'react'
import type {
  AnniversaryCampaign,
  AnniversaryShipment,
  BoothSalesRecord,
  BoothWarehouseSaleRecord,
  EventSalesRecord,
  InventoryMovement,
  Product,
} from '../types/inventory'
import { calculateCurrentStock } from '../utils/inventoryCalculation'
import { createInventorySyncSnapshot } from '../utils/inventorySyncSnapshot'
import { applyInventorySyncSnapshotToStorage } from '../utils/inventorySyncApply'
import type { InventorySyncSnapshot } from '../types/inventorySync'
import {
  loadAnniversaryCampaigns,
  loadAnniversaryShipments,
  loadBoothSalesRecords,
  loadBoothWarehouseSalesRecords,
  loadEventSalesRecords,
  loadInventoryMovements,
  loadProducts,
  hasInventoryStorageWriteBlock,
  saveAnniversaryCampaigns,
  saveAnniversaryShipments,
  saveBoothSalesRecords,
  saveBoothWarehouseSalesRecords,
  saveBoothWarehouseSalesAtomically,
  saveEventSalesRecords,
  saveEventSalesBatchAtomically,
  saveInventoryMovements,
  saveProducts,
} from '../utils/inventoryStorage'
import { prepareEventSalesBatch, type EventSalesBatchDraftRow } from '../utils/inventoryEventSalesBatch'
import type { EventSalesStatus } from '../types/inventory'
import { createUuidV4 } from '../utils/uuid'

export function useInventory() {
 const [products,setProducts]=useState<Product[]>(loadProducts); const [inventoryMovements,setInventoryMovements]=useState<InventoryMovement[]>(loadInventoryMovements); const [eventSalesRecords,setEventSalesRecords]=useState<EventSalesRecord[]>(loadEventSalesRecords); const [boothSalesRecords,setBoothSalesRecords]=useState<BoothSalesRecord[]>(loadBoothSalesRecords)
 const [boothWarehouseSalesRecords,setBoothWarehouseSalesRecords]=useState<BoothWarehouseSaleRecord[]>(loadBoothWarehouseSalesRecords); const [anniversaryCampaigns,setAnniversaryCampaigns]=useState<AnniversaryCampaign[]>(loadAnniversaryCampaigns); const [anniversaryShipments,setAnniversaryShipments]=useState<AnniversaryShipment[]>(loadAnniversaryShipments)
 useEffect(()=>saveProducts(products),[products]); useEffect(()=>saveInventoryMovements(inventoryMovements),[inventoryMovements]); useEffect(()=>saveEventSalesRecords(eventSalesRecords),[eventSalesRecords]); useEffect(()=>saveBoothSalesRecords(boothSalesRecords),[boothSalesRecords])
 useEffect(()=>saveBoothWarehouseSalesRecords(boothWarehouseSalesRecords),[boothWarehouseSalesRecords]); useEffect(()=>saveAnniversaryCampaigns(anniversaryCampaigns),[anniversaryCampaigns]); useEffect(()=>saveAnniversaryShipments(anniversaryShipments),[anniversaryShipments])
 const saveProduct=(v:Product)=>setProducts(c=>c.some(x=>x.id===v.id)?c.map(x=>x.id===v.id?v:x):[...c,v])
 const addMovement=(v:InventoryMovement)=>setInventoryMovements(c=>[...c,v])
 const saveEventSale=(record:EventSalesRecord,movementDate:string):string|null=>{
  const result=saveEventSalesBatch({eventId:record.eventId,eventDate:movementDate,status:record.status,rows:[{
   rowId:`record:${record.id}`,existingRecordId:eventSalesRecords.some(item=>item.id===record.id)?record.id:null,
   productId:record.productId,broughtQuantity:String(record.broughtQuantity),
   soldQuantity:String(record.soldQuantity??0),sampleQuantity:String(record.sampleQuantity??0),
   unitPrice:String(record.unitPriceSnapshot),memo:record.memo,
  }]})
  if(result.status==='saved')return null
  if(result.status==='invalid')return Object.values(result.errors).flatMap(error=>Object.values(error)).find(Boolean)??'入力内容を確認してください。'
  return '保存に失敗しました。入力内容は変更されていません。'
 }
 const saveEventSalesBatch=(input:{eventId:string;eventDate:string;status:EventSalesStatus;rows:EventSalesBatchDraftRow[];requirePlannedRecords?:boolean})=>{
  const prepared=prepareEventSalesBatch({...input,products,records:eventSalesRecords,movements:inventoryMovements,now:new Date().toISOString(),createId:createUuidV4})
  if(prepared.status!=='ready')return prepared
  const storageStatus=saveEventSalesBatchAtomically(prepared.records,prepared.movements)
  if(storageStatus!=='saved')return {status:'storage_error' as const,storageStatus}
  setEventSalesRecords(prepared.records);setInventoryMovements(prepared.movements)
  return {status:'saved' as const}
 }
 const deleteEventSale=(id:string)=>{setEventSalesRecords(c=>c.filter(record=>record.id!==id));setInventoryMovements(c=>c.filter(movement=>movement.eventSalesRecordId!==id))}
 const saveBoothSale=(record:BoothSalesRecord,expectedExistingId:string|null=null):string|null=>{ const product=products.find(x=>x.id===record.productId); if(!product)return '商品が見つかりません。'; const old=boothSalesRecords.find(x=>x.id===record.id); if(expectedExistingId&&(record.id!==expectedExistingId||!old))return '編集対象のBOOTH販売記録が見つかりません。画面を閉じて再確認してください。'; const oldUsed=old&&old.status!=='cancelled'?old.quantity:0; const needed=record.status==='cancelled'?0:record.quantity; const available=calculateCurrentStock(product,inventoryMovements)+oldUsed; if(needed>available)return `在庫が不足しています（販売可能 ${available}個）。`; setBoothSalesRecords(c=>old?c.map(x=>x.id===record.id?record:x):[...c,record]); setInventoryMovements(c=>[...c.filter(x=>x.boothSalesRecordId!==record.id),...(needed?[{id:crypto.randomUUID(),productId:record.productId,date:record.date,type:'boothSale' as const,quantity:needed,eventSalesRecordId:null,boothSalesRecordId:record.id,boothWarehouseSalesRecordId:null,memo:'',createdAt:new Date().toISOString()}]:[])]); return null }
 const deleteBoothSale=(id:string)=>{setBoothSalesRecords(c=>c.filter(record=>record.id!==id));setInventoryMovements(c=>c.filter(movement=>movement.boothSalesRecordId!==id))}
 const saveBoothWarehouseSale=(record:BoothWarehouseSaleRecord,expectedExistingId:string|null=null):string|null=>{
  const product=products.find(item=>item.id===record.productId)
  if(!product)return '商品が見つかりません。'
  const old=boothWarehouseSalesRecords.find(item=>item.id===record.id)
  if(expectedExistingId&&(record.id!==expectedExistingId||!old))return '編集対象のBOOTH倉庫販売記録が見つかりません。画面を閉じて再確認してください。'
  if(old&&old.productId!==record.productId)return '編集中の商品は変更できません。'
  const available=calculateCurrentStock(product,inventoryMovements)+(old?.quantity??0)
  if(record.quantity>available)return `在庫が不足しています（販売可能 ${available}個）。`
  const movementId=createUuidV4()
  if(!movementId)return '保存に必要なIDを作成できませんでした。入力内容は変更されていません。'
  const nextRecords=old
   ? boothWarehouseSalesRecords.map(item=>item.id===record.id?record:item)
   : [...boothWarehouseSalesRecords,record]
  const nextMovements=[
   ...inventoryMovements.filter(item=>item.boothWarehouseSalesRecordId!==record.id),
   {id:movementId,productId:record.productId,date:record.date,type:'boothWarehouseSale' as const,quantity:record.quantity,eventSalesRecordId:null,boothSalesRecordId:null,boothWarehouseSalesRecordId:record.id,memo:record.memo,createdAt:new Date().toISOString()},
  ]
  const storageStatus=saveBoothWarehouseSalesAtomically(nextRecords,nextMovements)
  if(storageStatus!=='saved')return storageStatus==='blocked'?'在庫データの保存状態を確認できないため保存できません。':'保存に失敗しました。入力内容は変更されていません。'
  setBoothWarehouseSalesRecords(nextRecords);setInventoryMovements(nextMovements)
  return null
 }
 const deleteBoothWarehouseSale=(id:string):string|null=>{
  if(!boothWarehouseSalesRecords.some(record=>record.id===id))return '削除対象のBOOTH倉庫販売記録が見つかりません。'
  const nextRecords=boothWarehouseSalesRecords.filter(record=>record.id!==id)
  const nextMovements=inventoryMovements.filter(movement=>movement.boothWarehouseSalesRecordId!==id)
  const storageStatus=saveBoothWarehouseSalesAtomically(nextRecords,nextMovements)
  if(storageStatus!=='saved')return storageStatus==='blocked'?'在庫データの保存状態を確認できないため削除できません。':'削除に失敗しました。データは変更されていません。'
  setBoothWarehouseSalesRecords(nextRecords);setInventoryMovements(nextMovements)
  return null
 }
 const getSyncSnapshot=(workspaceId:string,revision:number)=>createInventorySyncSnapshot({workspaceId,revision,products,inventoryMovements,eventSalesRecords,boothSalesRecords,boothWarehouseSalesRecords,anniversaryCampaigns,anniversaryShipments})
 const getStoredSyncSnapshot=(workspaceId:string,revision:number)=>hasInventoryStorageWriteBlock()?null:createInventorySyncSnapshot({workspaceId,revision,products:loadProducts(),inventoryMovements:loadInventoryMovements(),eventSalesRecords:loadEventSalesRecords(),boothSalesRecords:loadBoothSalesRecords(),boothWarehouseSalesRecords:loadBoothWarehouseSalesRecords(),anniversaryCampaigns:loadAnniversaryCampaigns(),anniversaryShipments:loadAnniversaryShipments()})
 const applySyncSnapshot=(snapshot:InventorySyncSnapshot)=>{
  const result=applyInventorySyncSnapshotToStorage(localStorage,snapshot)
  if(result.status!=='applied')return result
  setProducts(snapshot.products);setInventoryMovements(snapshot.inventoryMovements);setEventSalesRecords(snapshot.eventSalesRecords);setBoothSalesRecords(snapshot.boothSalesRecords);setBoothWarehouseSalesRecords(snapshot.boothWarehouseSalesRecords);setAnniversaryCampaigns(snapshot.anniversaryCampaigns);setAnniversaryShipments(snapshot.anniversaryShipments)
  return result
 }
 return {products,inventoryMovements,eventSalesRecords,boothSalesRecords,boothWarehouseSalesRecords,anniversaryCampaigns,anniversaryShipments,saveProduct,addMovement,saveEventSale,saveEventSalesBatch,deleteEventSale,saveBoothSale,deleteBoothSale,saveBoothWarehouseSale,deleteBoothWarehouseSale,getSyncSnapshot,getStoredSyncSnapshot,applySyncSnapshot,replaceProducts:setProducts,replaceInventoryMovements:setInventoryMovements,replaceEventSalesRecords:setEventSalesRecords,replaceBoothSalesRecords:setBoothSalesRecords,replaceBoothWarehouseSalesRecords:setBoothWarehouseSalesRecords,replaceAnniversaryCampaigns:setAnniversaryCampaigns,replaceAnniversaryShipments:setAnniversaryShipments}
}
