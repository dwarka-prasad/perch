"""Perch test suite — pure-helper units plus an HTTP smoke test.

Runs with stdlib unittest only:  python3 -m unittest discover -s tests -v
The module is imported with HOME pointed at a temp dir so token/config/cache
files never touch the real home directory.
"""
import http.client
import io
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


class AlertControl(unittest.TestCase):
    def setUp(self):
        try:
            os.remove(S.ALERTCTL_FILE)
        except OSError:
            pass
        self.sent = []
        self._orig = S.dispatch
        S.dispatch = lambda *a, **kw: self.sent.append(a)

    def tearDown(self):
        S.dispatch = self._orig
        try:
            os.remove(S.ALERTCTL_FILE)
        except OSError:
            pass

    def test_defaults_to_enabled(self):
        self.assertTrue(S.alert_ctl()["enabled"])
        self.assertFalse(S.alerts_paused())

    def test_stop_and_start(self):
        S.alert_ctl_set("stop")
        self.assertTrue(S.alerts_paused())
        S._alert("cpu", "CPU is hot", 99)
        self.assertEqual(self.sent, [])
        S.alert_ctl_set("start")
        self.assertFalse(S.alerts_paused())
        S._alert("cpu", "CPU is hot", 99)
        self.assertEqual(len(self.sent), 1)

    def test_snooze_expires_by_itself(self):
        S.alert_ctl_set("snooze", 30)
        st = S.alert_ctl()
        self.assertFalse(st["enabled"])
        self.assertGreater(st["until"], 0)
        # rewind the deadline into the past — reading resumes alerting
        S._alert_ctl_write({"enabled": False, "until": 1.0})
        self.assertTrue(S.alert_ctl()["enabled"])

    def test_snooze_minutes_are_clamped(self):
        S.alert_ctl_set("snooze", 10 ** 9)
        self.assertLessEqual(S.alert_ctl()["until"],
                             __import__("time").time() + S.SNOOZE_MAX * 60 + 5)

    def test_unknown_action_rejected(self):
        with self.assertRaises(ValueError):
            S.alert_ctl_set("explode")

    def test_stopped_rule_does_not_burn_its_cooldown(self):
        """A rule that breaches while stopped must alert as soon as it starts."""
        S._mon_fired.clear()
        S.alert_ctl_set("stop")
        S._fire("mem", "Memory at 99%", 99)
        self.assertNotIn("mem", S._mon_fired)
        S.alert_ctl_set("start")
        S._fire("mem", "Memory at 99%", 99)
        self.assertEqual(len(self.sent), 1)
        S._mon_fired.clear()

    def test_clear_wipes_history(self):
        os.makedirs(S.MON_DIR, exist_ok=True)
        with open(S.ALERTS_FILE, "w") as f:
            f.write('{"t":1,"rule":"cpu","msg":"x","value":1}\n')
        S.alert_ctl_set("clear")
        self.assertEqual(S.monitor_state()["events"], [])

    def test_brief_state_drops_the_24h_history(self):
        """Home widgets ask for events only — 1440 samples would be wasted."""
        full = S.monitor_state()
        brief = S.monitor_state(brief=True)
        self.assertIn("history", full)
        self.assertNotIn("history", brief)
        for key in ("cfg", "ctl", "events"):
            self.assertIn(key, brief)


class ContainerNormalise(unittest.TestCase):
    def test_docker_shape(self):
        c = S._ctr_norm({"ID": "abc123", "Names": "web", "Image": "nginx",
                         "State": "running", "Status": "Up 2 hours",
                         "Ports": "0.0.0.0:80->80/tcp"})
        self.assertEqual(c["name"], "web")
        self.assertEqual(c["state"], "running")
        self.assertEqual(c["ports"], "0.0.0.0:80->80/tcp")

    def test_podman_shape(self):
        """Podman emits a name list, a port list of dicts and an Id key."""
        c = S._ctr_norm({"Id": "def456", "Names": ["api", "api2"],
                         "Image": "alpine", "State": "exited",
                         "Status": "Exited (0) 3 minutes ago",
                         "Ports": [{"host_port": 8080, "container_port": 80,
                                    "protocol": "tcp"}]})
        self.assertEqual(c["id"], "def456")
        self.assertEqual(c["name"], "api, api2")
        self.assertEqual(c["state"], "exited")
        self.assertEqual(c["ports"], "8080->80/tcp")

    def test_state_inferred_from_status(self):
        c = S._ctr_norm({"ID": "x", "Names": "n", "Image": "i",
                         "Status": "Up 5 seconds"})
        self.assertEqual(c["state"], "running")

    def test_ports_without_host_binding(self):
        c = S._ctr_norm({"ID": "x", "Ports": [{"container_port": 5432,
                                               "protocol": "tcp"}]})
        self.assertEqual(c["ports"], "5432/tcp")


class ContainerPs(unittest.TestCase):
    def _with(self, stdout, rc=0):
        orig = S._run
        S._run = lambda cmd, **kw: __import__("subprocess").CompletedProcess(
            cmd, rc, stdout, "boom" if rc else "")
        try:
            return S._ctr_ps("podman")
        finally:
            S._run = orig

    def test_json_lines(self):
        out = ('{"ID":"a1","Names":"one","Image":"i","State":"running"}\n'
               '{"ID":"b2","Names":"two","Image":"i","State":"exited"}\n')
        rows = self._with(out)
        self.assertEqual([r["id"] for r in rows], ["a1", "b2"])

    def test_json_array(self):
        rows = self._with('[{"Id":"a1","Names":["one"],"Image":"i",'
                          '"State":"running"}]')
        self.assertEqual(rows[0]["name"], "one")

    def test_empty_output(self):
        self.assertEqual(self._with("   "), [])

    def test_failure_raises(self):
        with self.assertRaises(ValueError):
            self._with("", rc=1)


class LxdAndK8sShapes(unittest.TestCase):
    """Both CLIs emit nulls where a dict is expected — parsing must survive it."""

    def _stub(self, stdout, rc=0):
        return lambda cmd, **kw: __import__("subprocess").CompletedProcess(
            cmd, rc, stdout, "")

    def test_lxd_stopped_instance_has_null_state(self):
        rows = json.dumps([
            {"name": "stopped-one", "status": "Stopped", "state": None,
             "config": None},
            {"name": "running-one", "status": "Running",
             "state": {"network": {"lo": {"addresses": []},
                                   "eth0": {"addresses": [
                                       {"family": "inet", "address": "10.0.0.5"},
                                       {"family": "inet6", "address": "fe80::1"}]}}},
             "config": {"image.description": "ubuntu 24.04"}}])
        orig_run, orig_which = S._run, S.shutil.which
        S._run = self._stub(rows)
        S.shutil.which = lambda b: "/usr/bin/" + b if b == "incus" else None
        try:
            out = S._lxd_containers()
        finally:
            S._run, S.shutil.which = orig_run, orig_which
        self.assertEqual(out["engine"], "incus")
        self.assertEqual(out["containers"][0]["state"], "stopped")
        self.assertEqual(out["containers"][0]["ports"], "")
        # only the non-loopback IPv4 address is shown
        self.assertEqual(out["containers"][1]["ports"], "10.0.0.5")
        self.assertEqual(out["containers"][1]["image"], "ubuntu 24.04")

    def test_k8s_pod_with_missing_fields(self):
        payload = json.dumps({"items": [
            {"metadata": {"name": "p1", "namespace": "default"},
             "status": {"phase": "Pending", "podIP": None,
                        "containerStatuses": None},
             "spec": None}]})
        orig_run, orig_which = S._run, S.shutil.which
        S._run = lambda cmd, **kw: __import__("subprocess").CompletedProcess(
            cmd, 0, "ctx" if cmd[1] == "config" else payload, "")
        S.shutil.which = lambda b: "/usr/bin/kubectl"
        try:
            out = S._k8s_pods()
        finally:
            S._run, S.shutil.which = orig_run, orig_which
        self.assertEqual(out["pods"][0]["ready"], "0/0")
        self.assertEqual(out["pods"][0]["restarts"], 0)
        self.assertEqual(out["pods"][0]["node"], "")

    def test_k8s_unreachable_cluster_reports_error(self):
        orig_run, orig_which = S._run, S.shutil.which
        S._run = lambda cmd, **kw: __import__("subprocess").CompletedProcess(
            cmd, 0 if cmd[1] == "config" else 1, "ctx",
            "" if cmd[1] == "config" else "dial tcp: connection refused")
        S.shutil.which = lambda b: "/usr/bin/kubectl"
        try:
            out = S._k8s_pods()
        finally:
            S._run, S.shutil.which = orig_run, orig_which
        self.assertEqual(out["pods"], [])
        self.assertIn("connection refused", out["error"])

    def test_no_kubectl_means_no_k8s_section(self):
        orig_which = S.shutil.which
        S.shutil.which = lambda b: None
        try:
            self.assertIsNone(S._k8s_pods())
        finally:
            S.shutil.which = orig_which


class ContainerActionValidation(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self._orig = S._run
        S._run = lambda cmd, **kw: (
            self.calls.append(cmd),
            __import__("subprocess").CompletedProcess(cmd, 0, "ok", ""))[1]

    def tearDown(self):
        S._run = self._orig

    def test_rejects_unknown_engine(self):
        with self.assertRaises(ValueError):
            S.ctr_action("rm -rf", "abc", "stop")

    def test_rejects_unknown_action(self):
        with self.assertRaises(ValueError):
            S.ctr_action("podman", "abc", "exec")

    def test_rejects_shell_metacharacters_in_id(self):
        for bad in ("a;b", "$(id)", "../x", "", "a b"):
            with self.assertRaises(ValueError):
                S.ctr_action("podman", bad, "stop")

    def test_allows_names_and_ids(self):
        S.ctr_action("podman", "my-app_1.2", "restart")
        self.assertEqual(self.calls[-1], ["podman", "restart", "my-app_1.2"])

    def test_k8s_log_names_validated(self):
        with self.assertRaises(ValueError):
            S.ctr_logs("k8s", "pod", "ns;rm")
        S.ctr_logs("k8s", "my-pod-abc", "kube-system")
        self.assertIn("kubectl", self.calls[-1][0])

    def test_logs_reject_unknown_engine(self):
        with self.assertRaises(ValueError):
            S.ctr_logs("bash", "abc")


class KillPortTargeting(unittest.TestCase):
    class _Conn:
        def __init__(self, port, pid):
            self.status = "LISTEN"
            self.pid = pid
            self.laddr = type("A", (), {"port": port, "ip": "127.0.0.1"})()

    def setUp(self):
        self.killed = []
        self._orig_conns = S.psutil.net_connections
        self._orig_kill = S.kill_proc
        S.kill_proc = lambda pid, force=False: (
            self.killed.append((pid, force)), "proc")[1]

    def tearDown(self):
        S.psutil.net_connections = self._orig_conns
        S.kill_proc = self._orig_kill

    def _listen(self, *pairs):
        S.psutil.net_connections = lambda kind=None: [
            self._Conn(p, pid) for p, pid in pairs]

    def test_kills_listener_on_port(self):
        self._listen((8080, 42))
        S.kill_port(8080)
        self.assertEqual(self.killed, [(42, False)])

    def test_force_flag_passed_through(self):
        self._listen((8080, 42))
        S.kill_port(8080, force=True)
        self.assertEqual(self.killed, [(42, True)])

    def test_pid_pins_the_target(self):
        """A port re-bound by a different process must not be killed blindly."""
        self._listen((8080, 99))
        with self.assertRaises(ValueError) as cm:
            S.kill_port(8080, pid=42)
        self.assertIn("no longer listening", str(cm.exception))
        self.assertEqual(self.killed, [])

    def test_matching_pid_is_killed(self):
        self._listen((8080, 42), (9090, 7))
        S.kill_port(8080, pid=42)
        self.assertEqual(self.killed, [(42, False)])

    def test_nothing_listening(self):
        self._listen()
        with self.assertRaises(ValueError):
            S.kill_port(1234)


class CustomAlertRules(unittest.TestCase):
    def setUp(self):
        try:
            os.remove(S.CUSTOM_FILE)
        except OSError:
            pass

    tearDown = setUp

    def test_rejects_bad_rules(self):
        for bad, why in (
                ({"kind": "nope", "target": "x"}, "unknown type"),
                ({"kind": "unit", "target": "not a unit"}, "bad unit name"),
                ({"kind": "unit", "target": ""}, "empty target"),
                ({"kind": "port", "target": "99999"}, "port out of range"),
                ({"kind": "port", "target": "http"}, "non-numeric port"),
                ({"kind": "path", "target": "/tmp", "value": "abc"}, "bad number")):
            with self.assertRaises(ValueError, msg=why):
                S._custom_clean(bad)

    def test_normalises_a_good_rule(self):
        r = S._custom_clean({"kind": "port", "target": " 8080 ", "name": " api "})
        self.assertEqual(r, {"name": "api", "kind": "port", "target": "8080",
                             "value": 0.0, "enabled": True})

    def test_name_defaults_to_the_target(self):
        self.assertEqual(S._custom_clean({"kind": "port", "target": "22"})["name"],
                         "port:22")

    def test_save_round_trip_and_cap(self):
        S.custom_save([{"kind": "port", "target": "8080", "name": "api"}])
        self.assertEqual(len(S.custom_rules()), 1)
        with self.assertRaises(ValueError):
            S.custom_save([{"kind": "port", "target": "80"}] * (S.CUSTOM_MAX + 1))

    def test_corrupt_file_yields_no_rules(self):
        os.makedirs(S.CFG_DIR, exist_ok=True)
        S.atomic_write(S.CUSTOM_FILE, "{not json")
        self.assertEqual(S.custom_rules(), [])

    def test_port_rule_fires_only_when_nothing_listens(self):
        orig = S.psutil.net_connections
        S.psutil.net_connections = lambda kind=None: []
        try:
            rule = S._custom_clean({"kind": "port", "target": "8080"})
            self.assertIn("8080", S.custom_check(rule))
        finally:
            S.psutil.net_connections = orig

    def test_port_rule_quiet_when_something_listens(self):
        conn = type("C", (), {"status": "LISTEN", "pid": 1,
                              "laddr": type("A", (), {"port": 8080})()})()
        orig = S.psutil.net_connections
        S.psutil.net_connections = lambda kind=None: [conn]
        try:
            rule = S._custom_clean({"kind": "port", "target": "8080"})
            self.assertIsNone(S.custom_check(rule))
        finally:
            S.psutil.net_connections = orig

    def test_unreadable_connections_do_not_cry_wolf(self):
        orig = S.psutil.net_connections

        def boom(kind=None):
            raise S.psutil.AccessDenied()
        S.psutil.net_connections = boom
        try:
            self.assertTrue(S._port_listening(8080))
        finally:
            S.psutil.net_connections = orig

    def test_path_rule_compares_against_the_limit(self):
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "big"), "wb") as f:
            f.write(b"x" * (3 * 1024 * 1024))
        over = S._custom_clean({"kind": "path", "target": d, "value": 0.001})
        under = S._custom_clean({"kind": "path", "target": d, "value": 100})
        self.assertIn("over the", S.custom_check(over))
        self.assertIsNone(S.custom_check(under))

    def test_zero_limit_path_rule_never_fires(self):
        rule = S._custom_clean({"kind": "path", "target": _TMP_HOME, "value": 0})
        self.assertIsNone(S.custom_check(rule))


class FileFinders(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def _write(self, name, data, age_days=0):
        p = os.path.join(self.d, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)
        if age_days:
            old = __import__("time").time() - age_days * 86400
            os.utime(p, (old, old))
        return p

    def test_finds_identical_files_and_ignores_same_size_differing(self):
        self._write("a.bin", b"x" * 2_000_000)
        self._write("b.bin", b"x" * 2_000_000)
        self._write("sub/c.bin", b"x" * 2_000_000)
        self._write("d.bin", b"y" * 2_000_000)   # same size, different bytes
        r = S.find_duplicates(self.d, min_mb=1, seconds=10)
        self.assertEqual(len(r["groups"]), 1)
        self.assertEqual(r["groups"][0]["count"], 3)
        self.assertEqual(r["wasted"], 2 * 2_000_000)

    def test_small_files_are_below_the_floor(self):
        self._write("a.txt", b"hello")
        self._write("b.txt", b"hello")
        self.assertEqual(S.find_duplicates(self.d, min_mb=1, seconds=5)["groups"], [])

    def test_old_large_files(self):
        self._write("fresh.bin", b"z" * 1_500_000)
        self._write("stale.bin", b"w" * 1_500_000, age_days=800)
        r = S.find_old_large(self.d, min_mb=1, days=365, seconds=10)
        self.assertEqual([os.path.basename(f["path"]) for f in r["files"]],
                         ["stale.bin"])

    def test_missing_folder_is_rejected(self):
        with self.assertRaises(ValueError):
            S.find_duplicates(os.path.join(self.d, "nope"), seconds=2)


class HomeLayout(unittest.TestCase):
    def setUp(self):
        try:
            os.remove(S.HOME_LAYOUT_FILE)
        except OSError:
            pass

    tearDown = setUp

    def test_absent_layout(self):
        self.assertIsNone(S.home_layout()["layout"])

    def test_round_trip(self):
        S.home_layout_save({"layout": {"order": ["cpu", "mem"], "hidden": ["gpu"],
                                       "sizes": {"cpu": "full"}}})
        got = S.home_layout()["layout"]
        self.assertEqual(got["order"], ["cpu", "mem"])
        self.assertEqual(got["sizes"], {"cpu": "full"})

    def test_drops_junk_ids_and_sizes(self):
        out = S.home_layout_save({"layout": {
            "order": ["cpu", "../etc/passwd", 42, "a" * 80],
            "sizes": {"cpu": "enormous", "mem": "m"}}})["layout"]
        self.assertEqual(out["order"], ["cpu"])
        self.assertEqual(out["sizes"], {"mem": "m"})

    def test_null_layout_clears_the_file(self):
        S.home_layout_save({"layout": {"order": ["cpu"]}})
        S.home_layout_save({"layout": None})
        self.assertIsNone(S.home_layout()["layout"])


class StaticPathContainment(unittest.TestCase):
    """_static must not serve anything outside web/static."""

    class _Fake(S.Handler):
        def __init__(self):            # bypass BaseHTTPRequestHandler.__init__
            self.sent = []
            self.wfile = io.BytesIO()

        def _err(self, msg, code=400):
            self.sent.append(("err", code))

        # _static writes the response itself, so stub the socket plumbing
        def send_response(self, code, *a):
            self.sent.append(("send", code))

        def send_header(self, *a):
            pass

        def end_headers(self):
            pass

    def _try(self, rel):
        h = self._Fake()
        h._static(rel)
        return h.sent[0]

    def test_escape_attempts_are_404(self):
        for rel in ("../../../../etc/passwd", "....//....//etc/passwd",
                    "/etc/passwd", "..%2f..%2fetc/passwd",
                    "subdir/../../../server.py"):
            kind, code = self._try(rel)
            self.assertEqual((kind, code), ("err", 404), rel)

    def test_real_asset_is_served(self):
        kind, code = self._try("app.js")
        self.assertEqual((kind, code), ("send", 200))


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
