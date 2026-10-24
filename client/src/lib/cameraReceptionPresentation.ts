/** Read-only presentation of the same-date native registry, not sales or deliveries. */
export const SIZE_KEYS = ["chico","mediano","pint","litro","unknown"] as const;
export type SizeKey=typeof SIZE_KEYS[number];
type NativeData={businessDate:string;detectedTracks:number;locallyVerifiedTargets:number;
  withoutSameFrameEvidence:number;sizeBreakdown:Record<SizeKey,number>;receivedAt:string;
  sequence:number;ownerExcludedTargets:number;ownerConfirmedSizeTargets:number;automaticallyEstimatedSizeTargets:number};
const count=(n:unknown):n is number=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0;
export function receptionView<T extends NativeData>(data:T|null|undefined,day:string){
 if(!data)return {state:"missing" as const,data:null};
 if(data.businessDate!==day)return {state:"wrong_date" as const,data:null};
 if(![data.detectedTracks,data.locallyVerifiedTargets,data.withoutSameFrameEvidence,data.ownerExcludedTargets,data.ownerConfirmedSizeTargets,data.automaticallyEstimatedSizeTargets].every(count)
  ||!count(data.sequence)||data.sequence<1||!Number.isFinite(Date.parse(data.receivedAt))
  ||!data.sizeBreakdown||!SIZE_KEYS.every(k=>count(data.sizeBreakdown[k]))
  ||SIZE_KEYS.reduce((n,k)=>n+data.sizeBreakdown[k],0)!==data.locallyVerifiedTargets
  ||data.ownerConfirmedSizeTargets+data.automaticallyEstimatedSizeTargets!==data.locallyVerifiedTargets-data.sizeBreakdown.unknown)
  return {state:"invalid" as const,data:null};
 return {state:"received" as const,data,classified:data.locallyVerifiedTargets-data.sizeBreakdown.unknown,
  unclassified:data.sizeBreakdown.unknown,classificationComplete:data.sizeBreakdown.unknown===0,
  uniqueDeliveryCount:null,manualValuesUsed:false};
}
