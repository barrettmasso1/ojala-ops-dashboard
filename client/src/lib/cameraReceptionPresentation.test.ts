import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,it,expect,vi,beforeEach} from "vitest";
import {readFileSync} from "node:fs";
import {receptionView} from "../lib/cameraReceptionPresentation";
const state=vi.hoisted(()=>({query:{} as any}));
vi.mock("@/lib/trpc",()=>({trpc:{dashboard:{localCupLedger:{useQuery:()=>state.query}}}}));
import {LocalCupLedgerPanel} from "../components/LocalCupLedgerPanel";
const day="2026-10-23";
function fixture(){return {businessDate:day,detectedTracks:28,locallyVerifiedTargets:9,withoutSameFrameEvidence:11,
 ownerExcludedTargets:8,ownerConfirmedSizeTargets:6,automaticallyEstimatedSizeTargets:0,
 sizeBreakdown:{chico:2,mediano:4,pint:0,litro:0,unknown:3},receivedAt:"2026-10-24T03:11:58Z",sequence:19,potentialRepeatedTracks:2,records:[]};}
function render(){return renderToStaticMarkup(React.createElement(LocalCupLedgerPanel,{businessDate:day}));}
 beforeEach(()=>{state.query={data:fixture(),dataUpdatedAt:Date.parse("2026-10-24T03:12:00Z"),isLoading:false,error:null};});
describe("one authoritative camera size view",()=>{
 it("renders stored values without a manual closing or cloud photo",()=>{const html=render();expect(html).toContain("Registro recibido");expect(html).toContain("6 observaciones con tama");expect(html).toContain("2</td>");expect(html).toContain("4</td>");});
 it("shows successful query time separately from the last received event",()=>{const html=render();expect(html).toContain("Última consulta exitosa");expect(html).toContain("Último evento recibido");expect(html).toContain("Actualización automática cada 5 segundos");});
 it("does not claim missing categories are waiting for transport",()=>{const html=render();expect(html).toContain("Sin asignaci");expect(html).not.toContain("Pint</td><td class=\"p-2\">Pendiente");});
 it("separates exclusions and missing same-scene evidence",()=>{const html=render();expect(html).toContain("Excluidos por tu revisi");expect(html).toContain("Sin evidencia de la misma escena");});
 it("never turns missing data into a zero",()=>{state.query.data=null;const html=render();expect(html).toContain("Sin registro de detecciones recibido");expect(html).not.toContain("Registro recibido</span>");});
 it("never reuses yesterday's rows for today",()=>{state.query.data.businessDate="2026-10-22";expect(render()).toContain("otra fecha");expect(render()).not.toContain("2</td>");});
 it("retains same-day last data on transient query error with an explicit warning",()=>{state.query.error=new Error("network");const html=render();expect(html).toContain("consulta actual sin confirmar");expect(html).toContain("2</td>");expect(html).toContain('role="alert"');});
 it("error without any data is not an empty received ledger",()=>{state.query.data=null;state.query.error=new Error("network");expect(render()).toContain("No se pudo verificar");});
 it("date mismatch is not revived by an error",()=>{state.query.data.businessDate="2026-10-22";state.query.error=new Error("network");expect(render()).not.toContain("2</td>");});
 it("does not discard same-day data merely during refetch",()=>{state.query.isLoading=true;expect(render()).toContain("2</td>");});
 it("loading without data is explicit",()=>{state.query.data=undefined;state.query.isLoading=true;expect(render()).toContain("Consultando");});
 it("real stored zeros remain numeric",()=>{Object.assign(state.query.data,{detectedTracks:0,locallyVerifiedTargets:0,withoutSameFrameEvidence:0,ownerExcludedTargets:0,ownerConfirmedSizeTargets:0,sizeBreakdown:{chico:0,mediano:0,pint:0,litro:0,unknown:0}});expect(render()).toContain("0</td>");expect(receptionView(state.query.data,day).state).toBe("received");});
 it.each([NaN,-1,1.5,Infinity])("rejects corrupt counts %s",n=>{state.query.data.detectedTracks=n;expect(receptionView(state.query.data,day).state).toBe("invalid");});
 it("rejects mismatching assigned totals",()=>{state.query.data.sizeBreakdown.chico=20;expect(receptionView(state.query.data,day).state).toBe("invalid");});
 it("rejects inconsistent owner versus automatic assignments",()=>{state.query.data.ownerConfirmedSizeTargets=5;expect(receptionView(state.query.data,day).state).toBe("invalid");});
 it("never creates certified unique deliveries",()=>{expect(receptionView(fixture(),day)).toMatchObject({uniqueDeliveryCount:null,manualValuesUsed:false});});
 it("all five categories remain visible",()=>{const html=render();for(const x of ["Chico (4 oz)","Mediano (8 oz)","Pint","Litro","Sin clasificar"])expect(html).toContain(x);});
 it("old photo sizes are labelled as archive and stay separate",()=>{const s=readFileSync(new URL("../components/CameraSizeBreakdown.tsx",import.meta.url),"utf8");expect(s).toContain("Archivo de etiquetas");expect(s).not.toContain("Cámara: desglose automático por tamaño");});
 it("legacy photo table cannot replace the native table on overview",()=>{const s=readFileSync(new URL("../pages/ManagerDashboard.tsx",import.meta.url),"utf8");const start=s.indexOf('aria-label="Archivo independiente');const legacy=s.indexOf('<CameraSizeBreakdown');expect(start).toBeGreaterThan(0);expect(legacy).toBeGreaterThan(start);expect(s.slice(start,legacy)).toContain('<summary');expect(s.match(/<LocalCupLedgerPanel /g)).toHaveLength(1);});
});
