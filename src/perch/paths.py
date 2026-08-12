"""Where Perch keeps things on disk.

One module so every other module agrees on the locations, rather than each
recomputing them from HOME.
"""
import os

HOME = os.path.expanduser("~")
CACHE_DIR = os.path.join(HOME, ".cache")

#: user-editable configuration — alert rules, channels, fleet, home layout
CFG_DIR = os.path.join(HOME, ".config/perch")
#: state Perch owns and can rebuild — history, alerts, screenshots, index
MON_DIR = os.path.join(HOME, ".cache/perch")
INDEX_DIR = MON_DIR
SHOT_DIR = os.path.join(MON_DIR, "shots")
TOKEN_FILE = os.path.join(HOME, ".perch-token")
