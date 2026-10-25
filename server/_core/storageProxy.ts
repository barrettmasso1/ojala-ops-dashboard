import type { Express } from "express";
import { ENV } from "./env";

/** Local detection ledgers are private API data, never publicly signed media. */
export function isPrivateLocalLedgerKey(raw:string):boolean {
  let key=raw;
  for(let n=0;n<4;n++){
    try{const next=decodeURIComponent(key);if(next===key)break;key=next;}catch{return true;}
  }
  const parts:string[]=[];
  for(const part of key.replace(/\\/g,"/").split("/")){
    if(!part||part===".")continue;
    if(part===".."){parts.pop();continue;}
    parts.push(part);
  }
  return parts[0]==="local-cup-ledger" || (parts[0]==="directional-handoffs" && parts[1]==="v1");
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as { 0?: string })[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (isPrivateLocalLedgerKey(key)) {
      res.status(404).send("Not found");
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
