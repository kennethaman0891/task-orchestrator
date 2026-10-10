"""Unit tests for browse proxy SSRF protection and redirect validation."""
import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import _validate_browse_url


class TestBrowseSSRFValidation(unittest.TestCase):
    def test_blocks_metadata_ip(self):
        with self.assertRaises(ValueError) as ctx:
            _validate_browse_url("http://169.254.169.254/latest/meta-data/")
        self.assertIn("forbidden", str(ctx.exception).lower())

    def test_blocks_metadata_hostname(self):
        with self.assertRaises(ValueError) as ctx:
            _validate_browse_url("http://metadata.google.internal/computeMetadata/v1/")
        self.assertIn("forbidden", str(ctx.exception).lower())

    def test_blocks_private_lan_by_default(self):
        for ip in ("http://192.168.1.1", "http://10.0.0.1", "http://172.16.0.1"):
            with self.subTest(ip=ip):
                with self.assertRaises(ValueError) as ctx:
                    _validate_browse_url(ip)
                msg = str(ctx.exception).lower()
                self.assertTrue("blocked" in msg or "private" in msg)

    def test_blocks_non_http_schemes(self):
        for bad_url in ("file:///etc/passwd", "gopher://localhost:70", "ftp://example.com"):
            with self.subTest(url=bad_url):
                with self.assertRaises(ValueError):
                    _validate_browse_url(bad_url)

    def test_allows_public_https_domains(self):
        valid = _validate_browse_url("https://example.com/test")
        self.assertEqual(valid, "https://example.com/test")

    def test_allows_localhost_loopback(self):
        valid = _validate_browse_url("http://localhost:3000")
        self.assertEqual(valid, "http://localhost:3000")


if __name__ == "__main__":
    unittest.main()
