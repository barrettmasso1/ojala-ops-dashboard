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
