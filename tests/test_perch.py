"""Perch test suite — pure-helper units plus an HTTP smoke test.

Runs with stdlib unittest only:  python3 -m unittest discover -s tests -v
The module is imported with HOME pointed at a temp dir so token/config/cache
files never touch the real home directory.
"""
import http.client
import json
import os
import stat
import sys
import tempfile
import threading
import unittest

_TMP_HOME = tempfile.mkdtemp(prefix="perch-test-home-")
os.environ["HOME"] = _TMP_HOME
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from http.server import ThreadingHTTPServer  # noqa: E402
from perch import server as S  # noqa: E402


class AtomicWrite(unittest.TestCase):
    def test_writes_and_replaces(self):
        p = os.path.join(_TMP_HOME, "aw.json")
        S.atomic_write(p, '{"a": 1}')
        S.atomic_write(p, '{"a": 2}')
        with open(p) as f:
            self.assertEqual(json.load(f), {"a": 2})
        self.assertFalse(os.path.exists(p + ".tmp"))

    def test_mode_0600(self):
        p = os.path.join(_TMP_HOME, "aw2.json")
        S.atomic_write(p, "x")
        self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o600)


class RunWrapper(unittest.TestCase):
    def test_success(self):
        r = S._run(["echo", "hi"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "hi")

    def test_timeout_returns_failed_process(self):
        r = S._run(["sleep", "5"], timeout=0.2, capture_output=True,
                   text=True)
        self.assertEqual(r.returncode, 124)
        self.assertIn("timed out", r.stderr)


class AuthLockout(unittest.TestCase):
    def setUp(self):
        S._AUTH_FAILS.clear()

    def tearDown(self):
        S._AUTH_FAILS.clear()

    def test_locks_after_20_failures(self):
        for _ in range(19):
            S._auth_fail("10.0.0.1")
        self.assertFalse(S._auth_locked("10.0.0.1"))
        S._auth_fail("10.0.0.1")
        self.assertTrue(S._auth_locked("10.0.0.1"))
        self.assertFalse(S._auth_locked("10.0.0.2"))

    def test_window_expires(self):
        S._AUTH_FAILS["10.0.0.3"] = (25, 0)  # long ago
        self.assertFalse(S._auth_locked("10.0.0.3"))


class GnumParsing(unittest.TestCase):
    def _with(self, raw):
        orig = S._gset
        S._gset = lambda schema, key: raw
        try:
            return S._gnum("s", "k")
        finally:
            S._gset = orig

    def test_uint_tag(self):
        self.assertEqual(self._with("uint32 300"), 300)

    def test_float(self):
        self.assertEqual(self._with("0.25"), 0.25)

    def test_negative(self):
        self.assertEqual(self._with("-1"), -1)

    def test_garbage(self):
        self.assertIsNone(self._with("abc"))
        self.assertIsNone(self._with(None))


class SetSettingValidation(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self._orig_write = S._gset_write
        self._orig_opts = S._tweak_options
        S._gset_write = lambda sch, k, v: self.calls.append((sch, k, v))
        S._tweak_options = lambda: {
            "gtk_themes": ["Yaru"], "icon_themes": ["Yaru"],
            "cursor_themes": ["Yaru"], "fonts": ["Ubuntu"]}

    def tearDown(self):
        S._gset_write = self._orig_write
        S._tweak_options = self._orig_opts

    def test_unknown_key(self):
        with self.assertRaises(ValueError):
            S.set_setting("nonsense", 1)

    def test_theme_must_be_installed(self):
        with self.assertRaises(ValueError):
            S.set_setting("gtk_theme", "NotATheme")
        S.set_setting("gtk_theme", "Yaru")
        self.assertEqual(self.calls[-1][2], "Yaru")

    def test_titlebar_layout_mapping(self):
        S.set_setting("titlebar_buttons", "min-max-close")
        self.assertEqual(self.calls[-1][2], "appmenu:minimize,maximize,close")
        with self.assertRaises(ValueError):
            S.set_setting("titlebar_buttons", "everything")

    def test_speed_clamped(self):
        out = S.set_setting("mouse_speed", 7)
        self.assertEqual(out["mouse_speed"], 1.0)

    def test_font_rejects_empty(self):
        with self.assertRaises(ValueError):
            S.set_setting("font_name", "   ")


class PmParsers(unittest.TestCase):
    def test_apt_search(self):
        out = "htop - interactive processes viewer\nbtop - modern monitor\n"
        p = S._parse_pm_search("apt", out)
        self.assertEqual(p[0], {"name": "htop", "desc":
                                "interactive processes viewer"})

    def test_dnf_search(self):
        out = "htop.x86_64 : Interactive process viewer\n"
        p = S._parse_pm_search("dnf", out)
        self.assertEqual(p[0]["name"], "htop")

    def test_pacman_search(self):
        out = ("extra/htop 3.3.0-1\n    Interactive process viewer\n"
               "extra/btop 1.3.2-1\n    A monitor of resources\n")
        p = S._parse_pm_search("pacman", out)
        self.assertEqual([x["name"] for x in p], ["htop", "btop"])
        self.assertEqual(p[0]["desc"], "Interactive process viewer")

    def test_zypper_search(self):
        out = ("S | Name | Summary                    | Type\n"
               "--+------+----------------------------+--------\n"
               "  | htop | Interactive process viewer | package\n")
        p = S._parse_pm_search("zypper", out)
        self.assertEqual(p[0]["name"], "htop")

    def test_apt_updates(self):
        out = ("curl/jammy-security 7.81.0-1ubuntu1.16 amd64 "
               "[upgradable from: 7.81.0-1ubuntu1.15]\n")
        p = S._parse_updates("apt", out)
        self.assertEqual(p[0]["name"], "curl")
        self.assertTrue(p[0]["security"])

    def test_pacman_updates(self):
        p = S._parse_updates("pacman", "linux 6.9.1-1 -> 6.9.2-1\n")
        self.assertEqual(p[0], {"name": "linux", "repo": "",
                                "new": "6.9.2-1", "old": "6.9.1-1",
                                "security": False})

    def test_dnf_updates(self):
        p = S._parse_updates("dnf", "curl.x86_64  8.6.0-1.fc40  updates\n")
        self.assertEqual(p[0]["name"], "curl")
        self.assertEqual(p[0]["new"], "8.6.0-1.fc40")


class HttpSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), S.Handler)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def _req(self, method, path, headers=None, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r, data

    def setUp(self):
        S._AUTH_FAILS.clear()

    def test_health_needs_no_auth(self):
        r, data = self._req("GET", "/api/health")
        self.assertEqual(r.status, 200)
        self.assertEqual(json.loads(data), {"ok": True})

    def test_root_without_token_403(self):
        r, _ = self._req("GET", "/")
        self.assertEqual(r.status, 403)

    def test_token_url_sets_cookie_and_redirects(self):
        r, _ = self._req("GET", "/?t=" + S.TOKEN)
        self.assertEqual(r.status, 303)
        self.assertIn("perch_t=" + S.TOKEN, r.getheader("Set-Cookie", ""))
        self.assertEqual(r.getheader("Location"), "/")

    def test_cookie_auth_serves_index(self):
        r, data = self._req("GET", "/",
                            {"Cookie": "perch_t=" + S.TOKEN})
        self.assertEqual(r.status, 200)
        self.assertIn(b"<html", data[:200] or data)

    def test_api_with_header_token(self):
        r, data = self._req("GET", "/api/history",
                            {"X-Token": S.TOKEN})
        self.assertEqual(r.status, 200)
        self.assertIsInstance(json.loads(data), list)

    def test_bad_post_is_400(self):
        r, _ = self._req("POST", "/api/setsetting",
                         {"X-Token": S.TOKEN,
                          "Content-Length": "26",
                          "Content-Type": "application/json"},
                         '{"key":"nonsense","value":1}')
        self.assertEqual(r.status, 400)

    def test_lockout_returns_403_even_with_good_token(self):
        S._AUTH_FAILS["127.0.0.1"] = (20, __import__("time").time())
        r, _ = self._req("GET", "/api/history", {"X-Token": S.TOKEN})
        self.assertEqual(r.status, 403)


if __name__ == "__main__":
    unittest.main()
