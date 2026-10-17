#!/usr/bin/env python3
"""Export existing evidence ZIP to an audited administrative import JSON.

No network, source edits, queue acknowledgements, review decisions or counts.
The original sidecar bytes and both zone hashes accompany each normalized item.
"""
import argparse
import base64
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import zipfile
from zoneinfo import ZoneInfo
from handoff_visual_sender import normalize_capture_zone, EVENT_ID_PATTERN


def need(ok, code):
    if not ok:
        raise ValueError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def convert(package):
    need(package.stat().st_size <= 200*1024*1024, 'package_too_large')
    with zipfile.ZipFile(package) as z:
        entries = z.infolist()
        need(len({e.filename for e in entries}) == len(entries), 'duplicate_zip_entries')
        need(sum(e.file_size for e in entries) <= 220*1024*1024, 'expanded_package_too_large')
        for e in entries:
            p = PurePosixPath(e.filename)
            need(not p.is_absolute() and '..' not in p.parts, 'unsafe_zip_path')
        need(z.getinfo('manifest.json').file_size <= 1024*1024, 'manifest_too_large')
        manifest = json.loads(z.read('manifest.json'))
        need(manifest.get('schemaVersion') == 1 and manifest.get('storeId') == 1
             and manifest.get('cameraName') == 'handoff', 'wrong_store_or_camera')
        files = {}
        for item in manifest['files']:
            need(item['path'] not in files, 'duplicate_manifest_path')
            data = z.read(item['path'])
            need(len(data) == item['bytes'] and sha(data) == item['sha256'], 'package_hash_mismatch')
            files[item['path']] = item
        items, ids, summary = [], set(), []
        need(1 <= len(manifest['events']) <= 25, 'invalid_batch_size')
        for event in manifest['events']:
            need(event.get('source') == 'verified_snapshot', 'not_original_verified_snapshot')
            need(event['image'] in files and event['metadata'] in files, 'unhashed_event_source')
            raw = z.read(event['metadata'])
            need(len(raw) <= 65_536, 'sidecar_too_large')
            source = json.loads(raw)
            image = z.read(event['image'])
            need(0 < len(image) <= 8*1024*1024, 'image_size')
            suffix = PurePosixPath(event['image']).suffix.lower()
            mime = {'.jpg':'jpeg','.jpeg':'jpeg','.png':'png','.webp':'webp'}.get(suffix)
            need(mime is not None, 'image_type')
            need((mime == 'jpeg' and image.startswith(b'\xff\xd8\xff'))
                 or (mime == 'png' and image.startswith(b'\x89PNG\r\n\x1a\n'))
                 or (mime == 'webp' and image[:4] == b'RIFF' and image[8:12] == b'WEBP'), 'image_signature')
            need(source.get('schema_version') == 3 and source.get('camera') == 'handoff'
                 and source.get('cup_zone') == 'handoff_zone', 'invalid_capture_source')
            event_id = source['cup_event_id']
            need(isinstance(event_id,str) and EVENT_ID_PATTERN.fullmatch(event_id)
                 and not event_id.startswith('rec-') and event_id == event['cupEventId']
                 and event_id not in ids, 'capture_identity')
            ids.add(event_id)
            need(source['image_sha256'] == sha(image), 'capture_image_hash')
            captured = datetime.fromisoformat(source['captured_at_utc'].replace('Z','+00:00'))
            need(captured.tzinfo is not None and captured.utcoffset().total_seconds() == 0
                 and captured.astimezone(ZoneInfo('America/Mazatlan')).date().isoformat() == manifest['businessDate'],
                 'capture_business_date')
            geometry, original_hash = normalize_capture_zone(source['zone_geometry'],
                source['zone_config_sha256'], source['image_dimensions'])
            normalized_hash = sha(geometry.encode())
            capture = {k: source[k] for k in ['schema_version','camera','cup_zone','cup_event_id',
                'captured_at_utc','image_sha256','image_dimensions']}
            capture.update(zone_geometry=json.loads(geometry),zone_config_sha256=normalized_hash)
            item = {'imageDataUrl':f'data:image/{mime};base64,'+base64.b64encode(image).decode(), 'capture':capture}
            if original_hash:
                item['normalizationProof'] = {'adapter':'beelink_object_v3',
                    'sourceMetadataJson':raw.decode('utf-8'),'sourceMetadataSha256':sha(raw),
                    'sourceZoneCanonicalJson':json.dumps(source['zone_geometry'],sort_keys=True,separators=(',',':'),allow_nan=False)}
            items.append(item)
            summary.append({'cupEventId':event_id,'sourceZoneHash':original_hash,
                            'normalizedZoneHash':normalized_hash,'sourceMetadataSha256':sha(raw)})
    document = {'schemaVersion':1,'businessDate':manifest['businessDate'], 'packageReference':package.name,
        'intendedProcedure':'dashboard.importVerifiedSnapshotHandoffFrame','requiresAuthenticatedAdmin':True,
        'productionCountsEligible':False,'transport':'manus_official_api_administrative_review',
        'sourcePackageSha256':sha(package.read_bytes()),'items':items}
    return document, summary


if __name__ == '__main__':
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('package',type=Path)
    p.add_argument('destination',type=Path)
    args = p.parse_args()
    document, summary = convert(args.package)
    with args.destination.open('x') as f:
        os.chmod(args.destination,0o600)
        json.dump(document,f,ensure_ascii=False,separators=(',',':'))
        f.flush();os.fsync(f.fileno())
    print(json.dumps({'path':str(args.destination),'items':len(summary),'normalizations':summary,
                      'sourcePackageSha256':document['sourcePackageSha256'],'posted':False}))
