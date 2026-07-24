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
  saveAnniversaryDataAtomically,
  saveAnniversaryShipments,
  saveBoothSalesRecords,
  saveBoothSalesAtomically,
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
 const saveBoothSale=(record:BoothSalesRecord,expectedExistingId:string|null=null):string|null=>{
  const product=products.find(item=>item.id===record.productId)
  if(!product)return '商品が見つかりません。'
  const old=boothSalesRecords.find(item=>item.id===record.id)
  if(expectedExistingId&&(record.id!==expectedExistingId||!old))return '編集対象のBOOTH家発送記録が見つかりません。画面を閉じて再確認してください。'
  if(old&&old.productId!==record.productId)return '編集中の商品は変更できません。'
  const oldUsed=old&&old.status!=='cancelled'?old.quantity:0
  const needed=record.status==='cancelled'?0:record.quantity
  const available=calculateCurrentStock(product,inventoryMovements)+oldUsed
  if(needed>available)return `在庫が不足しています（販売可能 ${available}個）。`
  const nextRecords=old?boothSalesRecords.map(item=>item.id===record.id?record:item):[...boothSalesRecords,record]
  const movementId=needed?createUuidV4():null
  if(needed&&!movementId)return '保存に必要なIDを作成できませんでした。入力内容は変更されていません。'
  const nextMovements=[
   ...inventoryMovements.filter(item=>item.boothSalesRecordId!==record.id),
   ...(needed?[{id:movementId!,productId:record.productId,date:record.date,type:'boothSale' as const,quantity:needed,eventSalesRecordId:null,boothSalesRecordId:record.id,boothWarehouseSalesRecordId:null,memo:record.memo,createdAt:new Date().toISOString()}]:[]),
  ]
  const storageStatus=saveBoothSalesAtomically(nextRecords,nextMovements)
  if(storageStatus!=='saved')return storageStatus==='blocked'?'在庫データの保存状態を確認できないため保存できません。':'保存に失敗しました。入力内容は変更されていません。'
  setBoothSalesRecords(nextRecords);setInventoryMovements(nextMovements)
  return null
 }
 const deleteBoothSale=(id:string):string|null=>{
  if(!boothSalesRecords.some(record=>record.id===id))return '削除対象のBOOTH家発送記録が見つかりません。'
  const nextRecords=boothSalesRecords.filter(record=>record.id!==id)
  const nextMovements=inventoryMovements.filter(movement=>movement.boothSalesRecordId!==id)
  const storageStatus=saveBoothSalesAtomically(nextRecords,nextMovements)
  if(storageStatus!=='saved')return storageStatus==='blocked'?'在庫データの保存状態を確認できないため削除できません。':'削除に失敗しました。データは変更されていません。'
  setBoothSalesRecords(nextRecords);setInventoryMovements(nextMovements)
  return null
 }
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
 const anniversaryStorageError=(status:string,action:'保存'|'削除')=>status==='blocked'
  ?`周年記念データの保存状態を確認できないため${action}できません。`
  :`${action}に失敗しました。データは変更されていません。`
 const saveAnniversaryCampaign=(campaign:AnniversaryCampaign,expectedCampaignId:string|null=null):string|null=>{
  const oldCampaign=anniversaryCampaigns.find(item=>item.id===campaign.id)
  if(expectedCampaignId&&(campaign.id!==expectedCampaignId||!oldCampaign))return '編集対象の周年記念が見つかりません。画面を閉じて再確認してください。'
  const nextCampaigns=oldCampaign
   ?anniversaryCampaigns.map(item=>item.id===campaign.id?campaign:item)
   :[...anniversaryCampaigns,campaign]
  const storageStatus=saveAnniversaryDataAtomically(nextCampaigns,anniversaryShipments)
  if(storageStatus!=='saved')return anniversaryStorageError(storageStatus,'保存')
  setAnniversaryCampaigns(nextCampaigns)
  return null
 }
 const saveAnniversaryShipment=(shipment:AnniversaryShipment,expectedShipmentId:string|null=null):string|null=>{
  if(!anniversaryCampaigns.some(item=>item.id===shipment.campaignId))return '対象の周年記念が見つかりません。画面を閉じて再確認してください。'
  const oldShipment=anniversaryShipments.find(item=>item.id===shipment.id)
  if(expectedShipmentId&&(shipment.id!==expectedShipmentId||!oldShipment))return '編集対象の発送記録が見つかりません。画面を閉じて再確認してください。'
  if(oldShipment&&oldShipment.campaignId!==shipment.campaignId)return '編集中の周年記念との対応を変更できません。'
  const nextShipments=oldShipment
   ?anniversaryShipments.map(item=>item.id===shipment.id?shipment:item)
   :[...anniversaryShipments,shipment]
  const nextCampaigns=anniversaryCampaigns.map(item=>item.id===shipment.campaignId?{...item,updatedAt:shipment.updatedAt}:item)
  const storageStatus=saveAnniversaryDataAtomically(nextCampaigns,nextShipments)
  if(storageStatus!=='saved')return anniversaryStorageError(storageStatus,'保存')
  setAnniversaryCampaigns(nextCampaigns);setAnniversaryShipments(nextShipments)
  return null
 }
 const saveAnniversaryShipmentQrReference=(shipment:AnniversaryShipment,expectedShipmentId:string):string|null=>{
  const oldShipment=anniversaryShipments.find(item=>item.id===expectedShipmentId)
  if(!oldShipment||shipment.id!==expectedShipmentId||oldShipment.shippingQrImage||!shipment.shippingQrImage)
   return '対象の発送記録またはQR画像の登録状態が変化したため保存できません。'
  if(shipment.campaignId!==oldShipment.campaignId||shipment.fanboxPlan!==oldShipment.fanboxPlan||
   shipment.destinationNumber!==oldShipment.destinationNumber||shipment.itemDescription!==oldShipment.itemDescription||
   shipment.quantity!==oldShipment.quantity||shipment.status!==oldShipment.status||
   shipment.shippedAt!==oldShipment.shippedAt||shipment.memo!==oldShipment.memo||
   shipment.createdAt!==oldShipment.createdAt)
   return 'QR画像以外の発送記録が変化したため保存できません。'
  if(!anniversaryCampaigns.some(item=>item.id===shipment.campaignId)||
   oldShipment.campaignId!==shipment.campaignId)
   return '対象の周年記念を安全に確認できないため保存できません。'
  const nextShipments=anniversaryShipments.map(item=>item.id===shipment.id?shipment:item)
  const storageStatus=saveAnniversaryDataAtomically(anniversaryCampaigns,nextShipments)
  if(storageStatus!=='saved')return anniversaryStorageError(storageStatus,'保存')
  setAnniversaryShipments(nextShipments)
  return null
 }
 const deleteAnniversary=(shipmentId:string):string|null=>{
  const target=anniversaryShipments.find(item=>item.id===shipmentId)
  if(!target)return '削除対象の周年記念記録が見つかりません。'
  const nextShipments=anniversaryShipments.filter(item=>item.id!==shipmentId)
  const now=new Date().toISOString()
  const nextCampaigns=anniversaryCampaigns.map(item=>item.id===target.campaignId?{...item,updatedAt:now}:item)
  const storageStatus=saveAnniversaryDataAtomically(nextCampaigns,nextShipments)
  if(storageStatus!=='saved')return anniversaryStorageError(storageStatus,'削除')
  setAnniversaryCampaigns(nextCampaigns);setAnniversaryShipments(nextShipments)
  return null
 }
 const deleteAnniversaryCampaign=(campaignId:string):string|null=>{
  if(!anniversaryCampaigns.some(item=>item.id===campaignId))return '削除対象の周年記念が見つかりません。'
  const nextCampaigns=anniversaryCampaigns.filter(item=>item.id!==campaignId)
  const nextShipments=anniversaryShipments.filter(item=>item.campaignId!==campaignId)
  const storageStatus=saveAnniversaryDataAtomically(nextCampaigns,nextShipments)
  if(storageStatus!=='saved')return anniversaryStorageError(storageStatus,'削除')
  setAnniversaryCampaigns(nextCampaigns);setAnniversaryShipments(nextShipments)
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
 return {products,inventoryMovements,eventSalesRecords,boothSalesRecords,boothWarehouseSalesRecords,anniversaryCampaigns,anniversaryShipments,saveProduct,addMovement,saveEventSale,saveEventSalesBatch,deleteEventSale,saveBoothSale,deleteBoothSale,saveBoothWarehouseSale,deleteBoothWarehouseSale,saveAnniversaryCampaign,saveAnniversaryShipment,saveAnniversaryShipmentQrReference,deleteAnniversary,deleteAnniversaryCampaign,getSyncSnapshot,getStoredSyncSnapshot,applySyncSnapshot,replaceProducts:setProducts,replaceInventoryMovements:setInventoryMovements,replaceEventSalesRecords:setEventSalesRecords,replaceBoothSalesRecords:setBoothSalesRecords,replaceBoothWarehouseSalesRecords:setBoothWarehouseSalesRecords,replaceAnniversaryCampaigns:setAnniversaryCampaigns,replaceAnniversaryShipments:setAnniversaryShipments}
}
