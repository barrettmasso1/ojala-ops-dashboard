import unittest
from unittest.mock import Mock
import configure_private as c
import manus_bridge as b


class SetupTest(unittest.TestCase):
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
