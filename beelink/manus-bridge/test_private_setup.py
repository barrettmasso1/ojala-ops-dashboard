import unittest
import configure_private as c
import manus_bridge as b


class SetupTest(unittest.TestCase):
    def test_untrusted_exception_text_is_not_logged(self):
        self.assertEqual(c.setup_error_code(ValueError('secret_api_key_example')), 'setup_step_failed')
        self.assertEqual(c.setup_error_code(b.BridgeError('secret_api_key_example')), 'setup_step_failed')

    def test_supported_error_codes_keep_actionable_reason(self):
        self.assertEqual(c.setup_error_code(b.ApiError(401)), 'api_http_401')
        self.assertEqual(c.setup_error_code(b.BridgeError('task_must_be_private')), 'task_must_be_private')


if __name__ == '__main__':
    unittest.main()
