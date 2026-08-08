#!/usr/bin/env python3
"""Perch desktop app — a native GTK3 + WebKit2GTK window around the local server.

Falls back to Chrome/Chromium app-mode, then the default browser, if WebKitGTK
is unavailable. Launched by the ``perch-desktop`` console script.
"""

import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request

PORT = int(os.environ.get("PERCH_PORT", 9080))
HOME = os.path.expanduser("~")
TOKEN_FILE = os.path.join(HOME, ".perch-token")
ICON = "perch"


def _token():
    with open(TOKEN_FILE) as f:
        return f.read().strip()


def _ensure_server():
    # start the user service if it exists, else spawn the module directly
    if subprocess.run(["systemctl", "--user", "start", "perch"],
                      capture_output=True).returncode != 0:
        subprocess.Popen(["python3", "-m", "perch"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=1)
            return
        except urllib.error.HTTPError:
            return
        except Exception:  # noqa: BLE001
            time.sleep(0.25)


def _webview(url):
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.0")
    from gi.repository import GLib, Gtk, WebKit2
    GLib.set_prgname("perch")
    win = Gtk.Window(title="Perch")
    win.set_default_size(1280, 860)
    view = WebKit2.WebView()
    view.get_settings().set_enable_developer_extras(True)
    view.load_uri(url)

    def on_decide(view, decision, dtype):
        if dtype == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            uri = decision.get_navigation_action().get_request().get_uri()
            if not uri.startswith(f"http://127.0.0.1:{PORT}"):
                subprocess.Popen(["xdg-open", uri])
                decision.ignore()
                return True
        return False

    view.connect("decide-policy", on_decide)
    win.add(view)
    win.connect("destroy", Gtk.main_quit)
    win.show_all()
    Gtk.main()


def main():
    _ensure_server()
    url = f"http://127.0.0.1:{PORT}/?t={_token()}"
    try:
        _webview(url)
        return
    except Exception:  # noqa: BLE001 — no WebKitGTK, fall back to a browser
        pass
    for br in ("google-chrome", "chromium-browser", "chromium"):
        if shutil.which(br):
            os.execvp(br, [br, f"--app={url}", "--window-size=1280,860"])
    os.execvp("xdg-open", ["xdg-open", url])


if __name__ == "__main__":
    main()
