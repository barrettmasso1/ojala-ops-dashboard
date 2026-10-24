"""Optional local size inference for the detection collector.

Without a validated owner-labeled model it returns no assignment. It never adds
an image, source event, physical delivery, POS record or unconfirmed size.
"""
from pathlib import Path
import json
from size_classifier import descriptor,predict,canonical,sha,CalibrationError

class SizeRuntime:
    def __init__(self,model_path,ledger_root):
        self.path=Path(model_path);self.root=Path(ledger_root);self.stamp=None;self.model=None;self.cache={};self.status='calibration_required'
    def reload(self):
        if not self.path.exists():
            self.model=None;self.status='calibration_required';self.stamp=None;return
        if self.path.is_symlink() or not self.path.is_file() or self.path.stat().st_size>2*1024*1024:raise CalibrationError('size_model_file_invalid')
        info=self.path.stat();stamp=(info.st_ino,info.st_mtime_ns,info.st_size)
        if stamp==self.stamp:return
        m=json.loads(self.path.read_text())
        if sha(canonical(m.get('model')))!=m.get('modelSha256'):raise CalibrationError('model_checksum')
        if m['model'].get('labelProvenance')!='owner_confirmed_capacity' or m['model'].get('runtimeGenerativeAi') is not False:raise CalibrationError('model_provenance')
        self.model=m;self.stamp=stamp;self.cache={};self.status=m['model'].get('status','calibration_required')
    def assess(self,track,evidence):
        self.reload()
        if not evidence or track.get('sourceFalsePositive') or not self.model or self.status!='ready':return None
        binding={'deviceId':track['deviceId'],'cameraName':track['cameraName'],'zoneSha256':evidence['sourceZoneSha256'],'detectorModelSha256':track['detectorModelSha256']}
        key=(self.model['modelSha256'],evidence['imageSha256'],canonical(evidence['targetBox']))
        if key in self.cache:return self.cache[key]
        relative=evidence.get('storedImageRelativePath');p=self.root/relative if isinstance(relative,str) else None
        if p is None or p.is_symlink() or not p.resolve().is_relative_to(self.root.resolve()) or not p.is_file():raise CalibrationError('size_image_path')
        if p.stat().st_size>8*1024*1024:raise CalibrationError('size_image_too_large')
        raw=p.read_bytes();f=descriptor(raw,evidence['targetBox'],evidence['imageSha256']);result=predict(f,self.model,binding)
        value=result if result.get('status')=='classified' else None
        if len(self.cache)>1000:self.cache={}
        self.cache[key]=value;return value
