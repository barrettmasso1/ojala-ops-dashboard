"""Prepare real reference crops and evaluate a local size model, without writes
into production detection/count records. Owner annotations are a prerequisite.
The optional dashboard handoff is separate and must validate model provenance.
"""
from __future__ import annotations
import argparse,html,io,json,os,re,signal,sqlite3,sys,time
from pathlib import Path
from datetime import datetime,timezone
from PIL import Image
from size_classifier import descriptor,fit,predict,canonical,sha,CalibrationError,CLASSES

MAX_CANDIDATES=100

def atomic(path,data):
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if path.is_symlink():raise CalibrationError('output_symlink')
    tmp=path.with_suffix(path.suffix+'.tmp')
    if tmp.is_symlink():raise CalibrationError('output_symlink')
    with tmp.open('wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    os.chmod(tmp,0o600);os.replace(tmp,path)
def save(path,value):atomic(path,(canonical(value)+'\n').encode())

def safe_file(root,relative,expected_hash):
    p=root/relative
    if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()) or not p.is_file():raise CalibrationError('evidence_path')
    if p.stat().st_size>8*1024*1024:raise CalibrationError('evidence_too_large')
    raw=p.read_bytes()
    if sha(raw)!=expected_hash:raise CalibrationError('evidence_hash_mismatch')
    return raw

def load_samples(ledger_root,output):
    p=ledger_root/'ledger.sqlite3'
    if not p.is_file():raise CalibrationError('ledger_missing')
    with sqlite3.connect(p.as_uri()+'?mode=ro',uri=True,timeout=5) as db:
        db.execute('PRAGMA query_only=ON')
        rows=[json.loads(r[0]) for r in db.execute('SELECT payload FROM observations ORDER BY day DESC,first_seen DESC LIMIT ?', (MAX_CANDIDATES,))]
    samples=[];errors=[]
    for row in rows:
        ev=row.get('sameFrameEvidence')
        if row.get('verification')!='same_frame_local_cv' or not ev:continue
        try:
            raw=safe_file(ledger_root,ev['storedImageRelativePath'],ev['imageSha256'])
            bind={'deviceId':row['deviceId'],'cameraName':row['cameraName'],'zoneSha256':ev['sourceZoneSha256'],'detectorModelSha256':row['detectorModelSha256']}
            key=sha(ev['imageSha256']+canonical(ev['targetBox']))
            cached=output/'features'/(key+'.json')
            if cached.exists():
                f=json.loads(cached.read_text())
                if f.get('imageSha256')!=ev['imageSha256']:raise CalibrationError('cached_hash_mismatch')
            else:f=descriptor(raw,ev['targetBox'],ev['imageSha256']);save(cached,f)
            crop_path=output/'crops'/(key+'.jpg')
            if not crop_path.exists():
                with Image.open(io.BytesIO(raw)) as im:
                    iw,ih=im.size;x,y,w,h=ev['targetBox'];crop=im.convert('RGB').crop((int(x*iw),int(y*ih),int((x+w)*iw),int((y+h)*ih)))
                    crop.thumbnail((180,180),Image.Resampling.LANCZOS);b=io.BytesIO();crop.save(b,format='JPEG',quality=92);atomic(crop_path,b.getvalue())
            samples.append({'sampleId':key,'sourceEventId':row['sourceEventId'],'observationId':row['observationId'],'startedAt':row['startedAt'],
                'imageSha256':ev['imageSha256'],'imageRelativePath':ev['storedImageRelativePath'],'targetBox':ev['targetBox'],
                'binding':bind,'feature':f,'cropPath':'crops/'+key+'.jpg','size':None,'labelSource':None})
        except (ValueError,OSError,KeyError) as exc:errors.append({'sourceEventId':row.get('sourceEventId'),'reason':str(exc) if isinstance(exc,CalibrationError) else type(exc).__name__})
    return samples,errors

def build_form(output,samples):
    manifest={'schemaVersion':1,'purpose':'owner_capacity_reference_not_sales','samples':samples}
    mh=sha(canonical(manifest));saved=output/'manifests'/(mh+'.json')
    if saved.exists():return mh
    save(saved,manifest)
    options='<option value="">Sin confirmar</option>'+''.join('<option value="'+v+'">'+l+'</option>' for v,l in [('chico','Chico (4 oz)'),('mediano','Mediano (8 oz)'),('pint','Pint'),('litro','Litro'),('not_cup','No es recipiente de helado')])
    cards=[]
    for index,s in enumerate(samples):
        cards.append('<article><b>Referencia '+str(index+1)+'</b><img alt="Recorte real del recipiente" src="'+s['cropPath']+'"><small>'+html.escape(s['sourceEventId'])+'</small><select data-id="'+s['sampleId']+'">'+options+'</select></article>')
    payload=json.dumps({'schemaVersion':1,'manifestSha256':mh,'ownerConfirmed':True,'labelSource':'owner_confirmed_capacity','labels':[]})
    page='''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ojala - Referencias de tamanos</title><style>body{font:16px system-ui;margin:32px;background:#f5f6f2;color:#21332b}main{max-width:1200px;margin:auto}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}article{background:white;border:1px solid #ced7cf;border-radius:14px;padding:14px;display:flex;gap:9px;flex-direction:column}img{height:160px;object-fit:contain;image-rendering:auto}small{font-size:10px;overflow-wrap:anywhere}select,button{padding:12px;border-radius:8px;font:inherit}aside{padding:20px;background:#fff6da;margin:24px 0}button{background:#214b3c;color:white;border:0;cursor:pointer}h1{font-size:28px}</style><main><h1>Referencias reales para clasificar los recipientes</h1><p>Esta calibracion se hace una vez, no por cada venta. Confirma solo capacidades que conoces. No adivines por el aspecto ni uses ventas del POS. Las fotos sin identificacion permanecen sin clasificar.</p><aside>El clasificador necesita al menos tres escenas independientes por categoria y una categoria distinta para contrastar. Los ejemplos de una misma escena no se cuentan como pruebas independientes. Si la apariencia no permite distinguir capacidades, no se activa esa categoria.</aside><section>'''+''.join(cards)+'''</section><aside><label><input id="confirm" type="checkbox"> Confirmo que conozco las capacidades seleccionadas; no son estimaciones por la foto.</label></aside><button id="save">Guardar referencias confirmadas</button><p id="result"></p><p>Este archivo no modifica ventas ni conteos. No abre ventanas ni hace solicitudes por internet. Guarda el JSON en Descargas con el nombre indicado; el servicio local lo revisa.</p></main><script>const template='''+payload+''';document.getElementById('save').onclick=()=>{if(!document.getElementById('confirm').checked){document.getElementById('result').textContent='Falta confirmar el origen de las etiquetas.';return;}const out={...template,labels:Array.from(document.querySelectorAll('select')).filter(x=>x.value).map(x=>({sampleId:x.dataset.id,size:x.value}))};if(!out.labels.length){document.getElementById('result').textContent='No hay etiquetas confirmadas.';return;}const url=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Ojala_tamanos_confirmados.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);document.getElementById('result').textContent='Referencias exportadas. No equivalen a un modelo validado ni a ventas.';};</script></html>'''
    atomic(output/'Calibrar_tamanos.html',page.encode());return mh

def train_from_annotations(annotations,output,ledger_root):
    if annotations.get('ownerConfirmed') is not True or annotations.get('labelSource')!='owner_confirmed_capacity':raise CalibrationError('owner_attestation_required')
    mh=annotations.get('manifestSha256')
    if not isinstance(mh,str) or len(mh)!=64 or any(c not in '0123456789abcdef' for c in mh):raise CalibrationError('invalid_manifest_hash')
    path=output/'manifests'/(mh+'.json')
    if path.is_symlink() or not path.is_file():raise CalibrationError('original_manifest_missing')
    m=json.loads(path.read_text())
    if sha(canonical(m))!=mh:raise CalibrationError('manifest_tampered')
    byid={s['sampleId']:s for s in m['samples']};labels=annotations.get('labels')
    if not isinstance(labels,list) or not 1<=len(labels)<=100:raise CalibrationError('invalid_labels')
    references=[];seen=set();binding=None
    for label in labels:
        if not isinstance(label,dict) or set(label)!={'sampleId','size'} or label['size'] not in CLASSES:raise CalibrationError('invalid_reference_label')
        sid=label['sampleId']
        if sid not in byid or sid in seen:raise CalibrationError('unknown_or_duplicate_reference')
        seen.add(sid);s=byid[sid]
        raw=safe_file(ledger_root,s['imageRelativePath'],s['imageSha256'])
        f=descriptor(raw,s['targetBox'],s['imageSha256'])
        if binding is None:binding=s['binding']
        if binding!=s['binding']:raise CalibrationError('mixed_camera_calibration')
        references.append({'feature':f,'imageSha256':s['imageSha256'],'size':label['size'],'ownerConfirmed':True,
            'labelSource':'owner_confirmed_capacity','sourceEventId':s['sourceEventId'],'startedAt':s['startedAt']})
    return fit(references,binding)

def cycle(config):
    base=Path(config['basePath']);root=Path(config['stateRoot']);ledger=Path(config['ledgerRoot']);sys.path.insert(0,str(base/'manus-bridge'))
    from package_storage import verify_external
    verify_external(base,root,writable=True,required_bytes=64*1024*1024)
    samples,errors=load_samples(ledger,root);manifest=build_form(root,samples)
    annotation=Path(config['annotationFile']);model=None;import_error=None
    candidates=[p for p in annotation.parent.glob('Ojala_tamanos_confirmados*.json') if re.fullmatch(r'Ojala_tamanos_confirmados(?: \(\d+\))?\.json',p.name) and p.is_file() and not p.is_symlink()]
    if candidates:annotation=max(candidates,key=lambda p:p.stat().st_mtime_ns)
    stored_model=root/'model.json'
    if stored_model.exists():
        if stored_model.is_symlink() or stored_model.stat().st_size>2*1024*1024:raise CalibrationError('stored_model_invalid')
        model=json.loads(stored_model.read_text())
        if sha(canonical(model.get('model')))!=model.get('modelSha256'):raise CalibrationError('stored_model_checksum')
    if annotation.exists():
        try:
            if annotation.is_symlink() or annotation.stat().st_size>65536:raise CalibrationError('annotation_file_invalid')
            raw=annotation.read_bytes();marker=root/'annotation-import.json';last=json.loads(marker.read_text()) if marker.exists() else {}
            if last.get('inputSha256')==sha(raw) and (root/'model.json').exists():model=json.loads((root/'model.json').read_text())
            else:
                model=train_from_annotations(json.loads(raw),root,ledger)
                save(root/'models'/(model['modelSha256']+'.json'),model);save(root/'model.json',model);save(marker,{'inputSha256':sha(raw),'modelSha256':model['modelSha256'],'ownerConfirmed':True})
        except (OSError,ValueError,KeyError) as exc:import_error=str(exc) if isinstance(exc,CalibrationError) else type(exc).__name__
    results=[]
    for sample in samples:
        assessment=predict(sample['feature'],model,sample['binding'])
        results.append({'observationId':sample['observationId'],'sourceEventId':sample['sourceEventId'],'imageSha256':sample['imageSha256'],**assessment})
    report={'checkedAt':datetime.now(timezone.utc).isoformat(),'protocol':'ojala_local_size_candidates_v1','status':'ready_for_reviewed_handoff' if model and model['model']['status']=='ready' else 'calibration_required',
        'verifiedCandidateImages':len(samples),'confirmedReferenceLabels':len(model['model']['references']) if model else 0,'supportedCategories':list(model['model']['supported']) if model else [],
        'missingCategories':model['model']['missingCategories'] if model else ['chico','mediano','pint','litro'],'classifiedCandidates':sum(r['size']!='unknown' for r in results),
        'manifestSha256':manifest,'annotationError':import_error,'evidenceErrors':errors,'results':results,'sourceDatabaseReadOnly':True,'salesOrProductionCountsChanged':False,
        'externalAiUsed':False,'networkRequests':0,'windowsOpened':0,'calibrationPage':str(root/'Calibrar_tamanos.html'),'nativeCollectorConsumesModel':config.get('nativeCollectorConsumesModel') is True}
    save(root/'assessments.json',report);return report

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);p.add_argument('--daemon',action='store_true');a=p.parse_args();os.umask(0o077)
    c=json.loads(a.config.read_text());stop=[False]
    def finish(*_):stop[0]=True
    signal.signal(signal.SIGTERM,finish);signal.signal(signal.SIGINT,finish)
    while not stop[0]:
        try:
            r=cycle(c);summary={k:v for k,v in r.items() if k!='results'}
            if not a.daemon:print(canonical(summary),flush=True)
        except Exception as exc:
            print(canonical({'status':'paused','errorType':type(exc).__name__,'productionWrites':False}),flush=True)
            if not a.daemon:return 2
        if not a.daemon:break
        for _ in range(120):
            if stop[0]:break
            time.sleep(.25)
    return 0
if __name__=='__main__':raise SystemExit(main())
