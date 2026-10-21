"""Validate the new persisted-image receipt. Pure validation; no network or queue writes."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PROTOCOL = 'handoff_persisted_receipt_v1'
STATUSES = {'pending_review', 'approved_by_ai', 'discarded', 'approved_by_manager', 'discarded_by_manager'}

class ReceiptError(ValueError):
    pass

def require(ok, code):
    if not ok:
        raise ReceiptError(code)

def timestamp(value):
    require(isinstance(value, str), 'receipt_timestamp_missing')
    try:
        at = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        raise ReceiptError('receipt_timestamp_invalid') from None
    require(at.tzinfo is not None, 'receipt_timestamp_zone_missing')
    return at

def validate_persisted_receipt(ack, capture, store_id=1, store_timezone='America/Mazatlan', now=None):
    """Do not mark a photograph as delivered unless all persisted identities match.

    This confirms image storage only, not AI success, cups sold, or a daily cup count.
    The caller must retain its transport hold until authorized ingress is available.
    """
    require(isinstance(ack, dict) and isinstance(capture, dict), 'receipt_invalid_structure')
    require(type(store_id) is int and store_id > 0, 'invalid_expected_store')
    require(ack.get('success') is True and ack.get('retryable') is False, 'receipt_not_final_for_transport')
    receipt = ack.get('receipt')
    require(isinstance(receipt, dict), 'persisted_receipt_missing')
    require(receipt.get('protocol') == PROTOCOL, 'receipt_protocol_mismatch')
    require(receipt.get('evidencePersisted') is True and receipt.get('physicalCupCountCreated') is False, 'receipt_scope_mismatch')
    require(type(receipt.get('storeId')) is int and receipt['storeId'] == store_id, 'receipt_store_mismatch')
    eid = receipt.get('eventId')
    require(type(eid) is int and eid > 0 and type(ack.get('eventId')) is int and ack['eventId'] == eid, 'receipt_event_row_mismatch')
    for key, expected in [('cupEventId', capture.get('cup_event_id')),
                          ('cameraName', capture.get('camera')),
                          ('capturedAt', capture.get('captured_at_utc')),
                          ('imageSha256', capture.get('image_sha256'))]:
        require(isinstance(expected, str) and receipt.get(key) == expected, 'receipt_' + key + '_mismatch')
    at = timestamp(capture['captured_at_utc'])
    day = at.astimezone(ZoneInfo(store_timezone)).date().isoformat()
    require(receipt.get('businessDate') == day, 'receipt_business_date_mismatch')
    require(receipt.get('evidenceOrigin') == 'verified_snapshot', 'receipt_origin_mismatch')
    require(receipt.get('analysisStatus') in STATUSES and ack.get('status') == receipt['analysisStatus'], 'receipt_analysis_status_mismatch')
    received = timestamp(receipt.get('receivedAt'))
    current = now or datetime.now(timezone.utc)
    require(received.timestamp() <= current.timestamp() + 120, 'receipt_time_in_future')
    return dict(receipt)
