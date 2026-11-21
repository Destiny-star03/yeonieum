"""Loopback-only web origin, configurable for isolated browser tests."""

import os


def web_port():
    port = int(os.environ.get("YEONIEUM_WEB_PORT", "5173"))
    if not 1024 <= port <= 65535:
        raise RuntimeError("Invalid local web port")
    return port


def web_origin():
    return f"http://127.0.0.1:{web_port()}"
