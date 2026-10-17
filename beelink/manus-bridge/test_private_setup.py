import unittest
from unittest.mock import Mock, patch
from pathlib import Path
import tempfile
import configure_private as c
import manus_bridge as b


class SetupTest(unittest.TestCase):
    def test_outer_copy_formatting_preserves_the_token(self):
        for raw in ['  token-123\n', '\ufefftoken-123\u200b', '"token-123"', '“token-123”']:
            self.assertEqual(c.parse_key_entry(raw), 'token-123')

    def test_input_problems_are_distinct_and_never_reveal_input(self):
        for raw, code in [('', 'api_key_empty'), ('***abcd', 'api_key_masked'),
                          ('abc...def', 'api_key_masked'), ('Ojala Beelink', 'api_key_whitespace'),
                          ('abc\ndef', 'api_key_whitespace'), ('abc\u200bdef', 'api_key_characters')]:
            with self.subTest(code=code), self.assertRaisesRegex(b.BridgeError, '^'+code+'$'):
                c.parse_key_entry(raw)

    def test_length_is_validated_by_api_not_an_invented_minimum(self):
        self.assertEqual(c.parse_key_entry('short-token'), 'short-token')

    def test_only_authenticated_key_is_saved_privately_and_readable_by_worker(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(b, 'BASE', Path(temp)):
            api = Mock()
            c.remember_authenticated_key(api, 'short-token')
            path = Path(temp)/'manus-bridge/setup-authenticated-key.private.json'
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(b.read_key(path), 'short-token')
            api.call.assert_called_once_with('user.me')

    def test_rejected_authentication_does_not_save_key(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(b, 'BASE', Path(temp)):
            api = Mock()
            api.call.side_effect = b.ApiError(401)
            with self.assertRaises(b.ApiError):
                c.remember_authenticated_key(api, 'test-not-a-real-secret')
            self.assertFalse((Path(temp)/'manus-bridge/setup-authenticated-key.private.json').exists())

    def api(self, before, after=None):
        api = Mock()
        api.call.side_effect = [
            {'task': {'id': b.TASK, 'share_visibility': before}},
            {'ok': True, 'task_id': b.TASK, 'share_visibility': 'private'},
            {'task': {'id': b.TASK, 'share_visibility': after}},
        ]
        return api

    def test_shared_task_is_made_private_and_read_back(self):
        for visibility in ('team', 'public'):
            with self.subTest(visibility=visibility):
                api = self.api(visibility, 'private')
                receipt = c.ensure_task_private(api)
                self.assertTrue(receipt['changed'])
                self.assertEqual(receipt['previousVisibility'], visibility)
                self.assertEqual(api.call.call_args_list[1].args,
                                 ('task.update', {'task_id': b.TASK, 'share_visibility': 'private'}))
                self.assertEqual(api.call.call_args_list[1].kwargs, {'post': True})
                self.assertEqual(api.call.call_args_list[2].args,
                                 ('task.detail', {'task_id': b.TASK}))

    def test_private_task_has_no_update(self):
        api = self.api('private')
        self.assertFalse(c.ensure_task_private(api)['changed'])
        self.assertEqual(api.call.call_count, 1)

    def test_update_ack_cannot_replace_private_read_back(self):
        with self.assertRaisesRegex(b.BridgeError, 'task_privacy_update_not_verified'):
            c.ensure_task_private(self.api('public', 'public'))

    def test_unknown_or_wrong_task_cannot_be_updated(self):
        api = self.api(None)
        with self.assertRaisesRegex(b.BridgeError, 'task_visibility_unknown'):
            c.ensure_task_private(api)
        self.assertEqual(api.call.call_count, 1)
        api = Mock()
        api.call.return_value = {'task': {'id': 'other', 'share_visibility': 'public'}}
        with self.assertRaisesRegex(b.BridgeError, 'wrong_task'):
            c.ensure_task_private(api)
        self.assertEqual(api.call.call_count, 1)

    def test_failed_update_stops_without_upload(self):
        api = self.api('public')
        api.call.side_effect = [{'task': {'id': b.TASK, 'share_visibility': 'public'}}, b.ApiError(403)]
        with self.assertRaises(b.ApiError):
            c.ensure_task_private(api)
        self.assertEqual(api.call.call_count, 2)

    def test_api_rejects_other_task_or_visibility_changes(self):
        api = b.ManusApi('test-key-never-sent')
        api.opener = Mock()
        for params, post in [({'task_id': 'other', 'share_visibility': 'private'}, True),
                             ({'task_id': b.TASK, 'share_visibility': 'public'}, True),
                             ({'task_id': b.TASK, 'share_visibility': 'private'}, False)]:
            with self.subTest(params=params, post=post), self.assertRaises(b.BridgeError):
                api.call('task.update', params, post=post)
        api.opener.open.assert_not_called()

    def test_untrusted_exception_text_is_not_logged(self):
        self.assertEqual(c.setup_error_code(ValueError('secret_api_key_example')), 'setup_step_failed')
        self.assertEqual(c.setup_error_code(b.BridgeError('secret_api_key_example')), 'setup_step_failed')

    def test_supported_error_codes_keep_actionable_reason(self):
        self.assertEqual(c.setup_error_code(b.ApiError(401)), 'api_http_401')
        self.assertEqual(c.setup_error_code(b.BridgeError('task_must_be_private')), 'task_must_be_private')


if __name__ == '__main__':
    unittest.main()
