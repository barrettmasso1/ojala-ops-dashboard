/** Display-only boundaries: never creates a cup, sale, label or receipt. */
export function hasClosingRecord(actualDate:string|undefined,selectedDate:string,reportCount:number|undefined) {
  return actualDate===selectedDate && typeof reportCount==="number" && Number.isSafeInteger(reportCount) && reportCount>0;
}
export function closingValue(formatted:string,hasClosing:boolean):string {
  return hasClosing ? formatted : "Pendiente";
}
export function sizeCategoryValue(count:number,unclassified:number,isUnknown:boolean):string {
  if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(unclassified)||unclassified<0)return "No verificable";
  return !isUnknown && count===0 && unclassified>0 ? "Pendiente" : String(count);
}

export const LOCAL_CAMERA_DEVICE_ID="38395f07-90c9-4ab4-a47e-a8881a3498fb";
export function nativeEvidenceDate(data:{businessDate:string;detectedTracks:number}|null|undefined,today:string):string|null {
  return data?.businessDate===today && Number.isSafeInteger(data.detectedTracks) && data.detectedTracks>=0 ? today : null;
}
